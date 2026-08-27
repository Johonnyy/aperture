import type { ToolCallFrame } from '../../shared/protocol'
import type { ApertureEvent, PendingApproval } from '../../shared/types'
import { findAction, needsApproval } from '../../shared/extensions'
import { getSettings, listServers } from '../config'
import { extensionRegistry } from '../extensions/registry'
import type { AmberConnection } from './connection'

/**
 * The bridge that lets Amber run things on this machine and on your servers.
 *
 * Amber's half was already built — `register_tools` / `tool_call` / `tool_result` and,
 * now, `device_announce` — so nothing here required a backend change beyond the device
 * frames themselves.
 *
 * ## It used to be one tool, and that stopped working
 *
 * This file was `if (frame.name !== 'client_run_command') reject`. That was right while
 * SSH was the only capability. It cannot survive a second one, and it cannot express a
 * *device* action at all, so the dispatch now goes through `extensionRegistry` and every
 * capability — SSH included — is an extension. Retrofitting SSH rather than leaving it
 * beside the new path is the point: the abstraction is proven against something that
 * already worked, so a regression is visible instead of confounded with a new feature.
 *
 * ## Two surfaces, one handler
 *
 * A `tool_call` arrives on one of two contracts, and the discriminator is
 * `frame.device_id`:
 *
 * - **absent** — a tool we declared via `register_tools`. Amber has sanitized and
 *   `client_`-prefixed the name, so it is bare and dotless; we map it back to a
 *   capability key.
 * - **present** — an action we announced via `device_announce`. The name is the dotted
 *   `{extensionId}.{action}` key, untouched.
 *
 * Routing on the explicit key rather than on the shape of the name is deliberate. The
 * two name sets genuinely cannot collide — Amber's sanitizer destroys dots — but that
 * rule lives in her repo, and depending on it here would make a silent breakage possible
 * from a change nobody thought was ours.
 *
 * ## The timeout budget
 *
 * Amber waits and then tells the model "didn't respond in time". Critically she sends
 * *no* cancel frame and discards a late result silently, so letting her time out means
 * running something nobody is listening for while the model learns nothing useful. We
 * therefore budget inside her window and always answer ourselves:
 *
 * ```
 *   client tools (30s)      approval 20s  -> "not approved in time"
 *                           exec      8s  -> "timed out after 8s"
 *   device actions (20s)    approval 10s  -> APPROVAL_TIMEOUT_MS
 *                           dispatch ≤8s  -> the action's own manifest timeoutMs
 * ```
 *
 * The device row is enforced by `validateManifests`, so a manifest that would blow the
 * budget fails `verify:extensions` rather than in the field.
 */
const APPROVAL_TIMEOUT_MS = 20_000
/** Destructive device actions get a shorter window: Amber's is 20s, not 30s. */
const DEVICE_APPROVAL_TIMEOUT_MS = 10_000

interface Pending {
  approval: PendingApproval
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
}

export class ToolBridge {
  private pending = new Map<string, Pending>()

  constructor(
    private readonly amber: AmberConnection,
    private readonly emit: (event: ApertureEvent) => void,
  ) {}

  // --- declaration ----------------------------------------------------------

  /**
   * Declare our conversation tools to Amber.
   *
   * Must run after *every* `ready`, not just the first: Amber keeps declared specs
   * across a reconnect and only drops the send channel, so a stale build's tools stay
   * advertised to the model until they're replaced. `register_tools` replaces the whole
   * set, so this is always a full re-send, never a diff. Also call it whenever the
   * server list changes, since the names are baked into the schema.
   */
  register(): void {
    const { specs, dropped } = extensionRegistry.tools()
    const servers = listServers().map((s) => s.name)

    // Bake the server enum in at send time. It keeps the model from inventing a server
    // that doesn't exist, and it is the reason this has to be re-sent on a config change
    // rather than being static in the manifest.
    const withServers = specs.map((spec) =>
      spec.name === 'run_command'
        ? {
            ...spec,
            description:
              `${spec.description} Available servers: ${servers.join(', ') || 'none'}. ` +
              `Commands run as the configured user; there is no interactive input, so ` +
              `prefer non-interactive flags. Long-running commands are cut off after 8 seconds.`,
            input_schema: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'The shell command to run.' },
                server: { type: 'string', enum: servers, description: 'Which server to run it on.' },
              },
              required: ['command', 'server'],
            },
          }
        : spec,
    )

    // Declaring `run_command` with no servers invites the model to call something that
    // can only fail, so it is withheld rather than advertised broken.
    const usable = servers.length === 0
      ? withServers.filter((spec) => spec.name !== 'run_command')
      : withServers

    this.amber.send({ type: 'register_tools', tools: usable })
    if (dropped.length) {
      // Amber caps at 16 silently; say so here or a missing tool has no explanation.
      this.trace('warn', 'tools dropped at the cap', dropped.join(', '))
    }
    this.trace(
      'info',
      `declared ${usable.length} tool(s)`,
      usable.map((s) => s.name).join(', ') || '(none)',
    )
  }

  /** Announce this machine as an addressable device. Same re-send rule as `register`. */
  announce(deviceId: string, deviceName: string, version: string): void {
    const capabilities = extensionRegistry.capabilities()
    this.amber.send({
      type: 'device_announce',
      device_id: deviceId,
      name: deviceName,
      platform: process.platform,
      version,
      capabilities,
    })
    this.trace(
      'info',
      `announced as ${deviceName}`,
      capabilities.map((c) => c.action).join(', ') || '(no capabilities granted)',
    )
  }

  // --- dispatch -------------------------------------------------------------

  async handleToolCall(frame: ToolCallFrame): Promise<void> {
    const key = frame.device_id
      ? frame.name
      : extensionRegistry.keyForToolName(stripPrefix(frame.name))

    if (!key) {
      this.reply(frame.id, `Error: ${frame.name} is not a tool this client provides.`, true)
      return
    }

    const found = findAction(extensionRegistry.all(), key)
    if (!found) {
      this.reply(frame.id, `Error: ${key} is not something this device provides.`, true)
      return
    }

    // --- the confirmation gate ---
    //
    // The rule is in `shared/extensions.ts` so it can be tested; the short version is
    // that a device action asks only when it declares itself destructive, and
    // `confirmBeforeExec` applies to SSH commands alone. Setting the volume must not
    // stop and ask — the panel exists so a tap goes straight through.
    if (
      needsApproval({
        isDeviceAction: Boolean(frame.device_id),
        destructive: Boolean(found.action.destructive),
        confirmBeforeExec: getSettings().confirmBeforeExec,
      })
    ) {
      const timeout = frame.device_id ? DEVICE_APPROVAL_TIMEOUT_MS : APPROVAL_TIMEOUT_MS
      const label = describe(key, frame.input)
      this.trace('warn', 'approval requested', label)
      const answer = await this.requestApproval(frame.id, key, label, timeout, frame.input)
      if (answer === 'denied') {
        this.reply(frame.id, 'The user declined to do that.', true)
        return
      }
      if (answer === 'timeout') {
        this.reply(frame.id, 'The user did not approve that in time, so it was not done.', true)
        return
      }
    }

    const result = await extensionRegistry.run(key, frame.input ?? {}, frame.id)
    this.trace(result.isError ? 'warn' : 'info', key, result.message.slice(0, 200))

    // Reply *first*. A handler that powers the machine down cannot answer once it has
    // run, so it hands back an `after` and we call it once the result is on the wire —
    // otherwise every shutdown reads as a timeout and the model says so.
    this.reply(frame.id, result.message, Boolean(result.isError))
    result.after?.()
  }

  // --- approvals ------------------------------------------------------------

  private requestApproval(
    id: string,
    action: string,
    detail: string,
    timeoutMs: number,
    input?: Record<string, unknown>,
  ): Promise<'approved' | 'denied' | 'timeout'> {
    return new Promise((resolve) => {
      const approval: PendingApproval = {
        id,
        action,
        detail,
        // Carried through for SSH so the approval card keeps showing the command the
        // way it always has. Absent for every other action, which is what the card's
        // fallback to `detail` is for.
        server: typeof input?.server === 'string' ? input.server : undefined,
        command: typeof input?.command === 'string' ? input.command : undefined,
        requestedAt: Date.now(),
        expiresAt: Date.now() + timeoutMs,
      }

      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.emitPending()
        resolve('timeout')
      }, timeoutMs)

      this.pending.set(id, {
        approval,
        timer,
        resolve: (approved) => resolve(approved ? 'approved' : 'denied'),
      })
      this.emitPending()
    })
  }

  /** Called from IPC when the human clicks approve/deny. */
  resolveApproval(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id)
    if (!entry) return false // already expired or already answered
    clearTimeout(entry.timer)
    this.pending.delete(id)
    this.emitPending()
    entry.resolve(approved)
    return true
  }

  listPending(): PendingApproval[] {
    return [...this.pending.values()].map((p) => p.approval)
  }

  /** Fail every waiting approval — the socket is gone, nobody will read the result. */
  abortAll(): void {
    for (const [id] of this.pending) this.resolveApproval(id, false)
  }

  // --- plumbing -------------------------------------------------------------

  private emitPending(): void {
    // Send the whole set rather than a delta — the renderer replaces its list, so a
    // dropped event can't leave a phantom approval card on screen forever.
    this.emit({ kind: 'approvals', pending: this.listPending() })
  }

  private reply(id: string, content: string, isError = false): void {
    // `content` must be a string and `id` must be a string — Amber passes content
    // through Python `str()` and silently drops a non-string id.
    this.amber.send({ type: 'tool_result', id, content, is_error: isError })
  }

  private trace(level: 'info' | 'warn' | 'error', label: string, detail?: string): void {
    this.emit({
      kind: 'trace',
      entry: { id: `${Date.now()}-${Math.random()}`, ts: Date.now(), level, label, detail },
    })
  }
}

/** Amber prefixes declared tool names with `client_`; strip it to match the manifest. */
function stripPrefix(name: string): string {
  return name.startsWith('client_') ? name.slice('client_'.length) : name
}

/** A one-line description of what is being approved, for the card. */
function describe(key: string, input: Record<string, unknown> | undefined): string {
  if (key === 'ssh-terminal.run_command') {
    return `${String(input?.server ?? '?')}: ${String(input?.command ?? '')}`
  }
  const args = Object.entries(input ?? {})
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(' ')
  return args || 'no arguments'
}
