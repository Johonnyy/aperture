import type { ToolCallFrame, ToolSpec } from '../../shared/protocol'
import type {
  ApertureEvent,
  AuditEntry,
  AuditOutcome,
  ExecResult,
  PendingApproval,
} from '../../shared/types'
import { appendAudit, getServer, getSettings, listServers } from '../config'
import { exec } from '../ssh/ssh-client'
import type { AmberConnection } from './connection'

/**
 * The bridge that lets Amber run commands on your servers.
 *
 * Amber's half of this was already built — `register_tools` / `tool_call` /
 * `tool_result` are part of her protocol, and `app/client_tools.py` implements the
 * server side. So nothing here required a backend change: Aperture declares a tool
 * on connect and answers calls.
 *
 * ## The timeout budget
 *
 * Amber waits `client_tool_timeout_s` (30s) for a `tool_result` and then tells the
 * model "the client didn't respond in time". Critically she sends *no* cancel frame,
 * and discards a late result silently — so if we let her time out, we'd be running a
 * command nobody is listening for and the model would learn nothing useful.
 *
 * So we budget inside that window and always answer ourselves:
 *   approval  20s  -> "not approved in time"
 *   exec       8s  -> "timed out after 8s"
 * Both land well inside 30s, so the model gets an honest, actionable answer instead
 * of an opaque server-side timeout.
 */
const APPROVAL_TIMEOUT_MS = 20_000
const EXEC_TIMEOUT_MS = 8_000

/** The bare name; Amber prefixes it with `client_` and calls it back that way. */
const TOOL_NAME = 'run_command'
const PREFIXED_TOOL_NAME = `client_${TOOL_NAME}`

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
   * Declare our tools to Amber.
   *
   * Must run after *every* `ready`, not just the first: Amber keeps declared specs
   * across a reconnect and only drops the send channel, so a stale build's tools
   * stay advertised to the model until they're replaced. `register_tools` replaces
   * the whole set, so this is always a full re-send, never a diff.
   *
   * Also call it whenever the server list changes, since the names are baked into
   * the schema.
   */
  register(): void {
    const servers = listServers()
    if (servers.length === 0) {
      // Nothing to run commands on. Declaring the tool anyway would invite the model
      // to call something that can only fail.
      this.amber.send({ type: 'register_tools', tools: [] })
      return
    }

    const names = servers.map((s) => s.name)
    const tool: ToolSpec = {
      name: TOOL_NAME,
      description:
        'Run a shell command on one of Johnny\'s servers over SSH and return its ' +
        `output. Available servers: ${names.join(', ')}. Commands run as the ` +
        'configured user; there is no interactive input, so prefer non-interactive ' +
        'flags. Long-running commands are cut off after 8 seconds.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
          server: {
            type: 'string',
            // The enum keeps the model from inventing a server that doesn't exist.
            enum: names,
            description: 'Which server to run it on.',
          },
        },
        required: ['command', 'server'],
      },
    }
    this.amber.send({ type: 'register_tools', tools: [tool] })
    this.trace('info', `declared ${TOOL_NAME}`, `servers: ${names.join(', ')}`)
  }

  // --- dispatch -------------------------------------------------------------

  async handleToolCall(frame: ToolCallFrame): Promise<void> {
    if (frame.name !== PREFIXED_TOOL_NAME) {
      this.reply(frame.id, `Error: ${frame.name} is not a tool this client provides.`, true)
      return
    }

    const command = String(frame.input.command ?? '').trim()
    const serverName = String(frame.input.server ?? '').trim()

    if (!command) {
      this.reply(frame.id, 'Error: no command was given.', true)
      return
    }

    const server = getServer(serverName)
    if (!server) {
      const known = listServers().map((s) => s.name).join(', ') || 'none configured'
      this.reply(
        frame.id,
        `Error: there is no server called "${serverName}". Known servers: ${known}.`,
        true,
      )
      return
    }

    const started = Date.now()
    const log = (outcome: AuditOutcome, extra: Partial<AuditEntry> = {}): void => {
      // Every command Amber asks for is logged, approved or not — the audit trail is
      // about what was *requested*, not only what ran.
      const entry = appendAudit({
        id: frame.id,
        ts: started,
        server: server.name,
        command,
        outcome,
        durationMs: Date.now() - started,
        ...extra,
      })
      this.emit({ kind: 'audit', entry })
    }

    // --- the confirmation gate ---
    if (getSettings().confirmBeforeExec) {
      this.trace('warn', 'approval requested', `${server.name}: ${command}`)
      const approved = await this.requestApproval(frame.id, server.name, command)
      if (approved === 'denied') {
        log('denied')
        this.reply(frame.id, 'The user declined to run that command.', true)
        return
      }
      if (approved === 'timeout') {
        log('timeout')
        this.reply(
          frame.id,
          'The user did not approve that command in time, so it was not run.',
          true,
        )
        return
      }
    }

    // --- run it ---
    this.trace('info', `exec on ${server.name}`, command)
    const result = await exec(server, command, EXEC_TIMEOUT_MS)
    const outcome: AuditOutcome = result.error || result.code !== 0 ? 'error' : 'approved'

    log(getSettings().confirmBeforeExec ? outcome : result.error ? 'error' : 'auto', {
      exitCode: result.code ?? undefined,
      output: format(result).slice(0, 2_000),
    })

    this.trace(
      result.error || result.code !== 0 ? 'warn' : 'info',
      `exit ${result.code ?? '—'}`,
      result.error,
    )
    this.reply(frame.id, format(result), Boolean(result.error))
  }

  // --- approvals ------------------------------------------------------------

  private requestApproval(
    id: string,
    server: string,
    command: string,
  ): Promise<'approved' | 'denied' | 'timeout'> {
    return new Promise((resolve) => {
      const approval: PendingApproval = {
        id,
        server,
        command,
        requestedAt: Date.now(),
        expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
      }

      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.emitPending()
        resolve('timeout')
      }, APPROVAL_TIMEOUT_MS)

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

/** Render an exec result as prose the model can reason about. */
function format(result: ExecResult): string {
  if (result.error) return `The command could not be run: ${result.error}`

  const parts: string[] = []
  if (result.stdout.trim()) parts.push(result.stdout.trim())
  if (result.stderr.trim()) parts.push(`[stderr]\n${result.stderr.trim()}`)
  if (result.code !== 0) parts.push(`[exited with code ${result.code}]`)
  return parts.join('\n\n') || '(the command produced no output)'
}
