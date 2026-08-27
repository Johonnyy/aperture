/**
 * The extension model: what an extension is, what it may do, and what it exposes.
 *
 * Everything Aperture can do on Amber's behalf used to be one hardcoded tool called
 * `run_command`, checked by a single equality in `tool-bridge.ts`. That was fine while
 * SSH was the only capability. It stops being fine the moment there are two, and it
 * stops being *possible* once actions have to be announced as a device's capabilities
 * rather than declared as one conversation's tools.
 *
 * So: an extension is a manifest plus a set of handlers. The manifest is data — read by
 * the bridge, the Devices panel, a Settings page and a verify script — which is why it
 * is JSON rather than a TypeScript object. This file is the part with no Electron and no
 * Node in it, so `verify:extensions` can bundle and exercise it.
 *
 * ## Two exposure surfaces, and why the distinction is load-bearing
 *
 * Amber has two entirely different ways to reach this process, with different rules:
 *
 * - **`register_tools`** — tools for *this conversation*. Amber sanitizes each name to
 *   `[a-zA-Z0-9_-]` (so a `.` is destroyed), force-prefixes `client_`, and caps the set
 *   at 16. Right for free-form agentic work like "run this command".
 * - **`device_announce`** — capabilities of *this machine*. Names are neither sanitized
 *   nor capped, because they identify an action on a device rather than a tool in a
 *   conversation, and they come back as a `tool_call` carrying `device_id`.
 *
 * `ActionDef.expose` picks the surface. That one field is the answer to three separate
 * constraints at once: it is why the 16-tool cap doesn't bind device actions, why the
 * dotted `{extensionId}.{action}` key survives the wire, and how the bridge tells a
 * device action from a client tool without parsing a name.
 *
 * ## The timeout budget
 *
 * Amber waits `device_action_timeout_s` (20s) and sends no cancel frame, discarding a
 * late answer silently. So every layer budgets *inside* the one above it and always
 * answers itself, the way the SSH bridge already budgets inside `client_tool_timeout_s`:
 *
 * ```
 *   Amber                      20s   device_action_timeout_s
 *     our self-answer          15s   DEVICE_BUDGET_MS
 *       local approval         10s   APPROVAL_TIMEOUT_MS
 *         the action itself     5s   ActionDef.timeoutMs, ≤ MAX_ACTION_TIMEOUT_MS
 * ```
 *
 * `validateManifests` enforces the bottom two rows, so a manifest that would let Amber
 * time out before we could answer fails `verify:extensions` rather than in the field.
 */

/** Desktop platforms an action can target. Deliberately *not* the same type as the
 *  `platform` string we announce on the wire — that one is free-form so Aperture mobile
 *  can announce `ios` without this becoming a breaking protocol change. */
export type TargetPlatform = 'win32' | 'darwin' | 'linux'

export const TARGET_PLATFORMS: TargetPlatform[] = ['win32', 'darwin', 'linux']

/**
 * What an extension may reach.
 *
 * **Honest scope:** in this build a permission is declared and displayed, not sandboxed.
 * Every extension compiles into the same main bundle with the same privileges, so this
 * array cannot withhold `node:child_process` from code that imports it directly. What it
 * does do is real: an unknown permission fails `tsc` and `verify:extensions`, so granting
 * one is a reviewed diff, and the Settings page can say "may power off this machine"
 * before you trust it. Making it enforceable means handing each handler a capability
 * object instead of letting it import — which is why `ActionContext` exists from day one.
 */
export type Permission = 'pty' | 'secrets' | 'process' | 'power' | 'network' | 'audio'

export const PERMISSIONS: Permission[] = [
  'pty',
  'secrets',
  'process',
  'power',
  'network',
  'audio',
]

/** Human-readable, for the Settings page. What someone is actually agreeing to. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  pty: 'open interactive terminals on remote servers',
  secrets: 'read stored SSH keys and credentials',
  process: 'launch and close applications on this machine',
  power: 'shut down, restart or sleep this machine',
  network: 'make network requests on your behalf',
  audio: 'read and change this machine’s volume',
}

/** How the Devices panel should render an action, so the panel is generated rather
 *  than hardcoded — which is what lets Aperture mobile ship without a desktop change. */
export type ControlSpec =
  | { kind: 'button'; label: string; tone?: 'default' | 'danger' }
  | { kind: 'toggle'; label: string; arg: string }
  | { kind: 'slider'; label: string; arg: string; min: number; max: number; step?: number }

export interface ActionDef {
  /** Bare and dotted, e.g. `power.sleep`. The wire key is `${extensionId}.${name}`. */
  name: string
  description: string
  input_schema?: Record<string, unknown>
  /**
   * Needs a person to say yes.
   *
   * Declared **once, here**, and it drives two independent gates: Amber offers a
   * destructive action only through her confirmation-gated `device_power` tool, and we
   * prompt locally before running one. Neither side holds a list of dangerous names, so
   * a new destructive capability is gated the day it ships rather than the day someone
   * remembers to update the other repo.
   */
  destructive?: boolean
  /** Ceiling for one dispatch. Checked against the budget by `validateManifests`. */
  timeoutMs: number
  /** Omitted means everywhere. A platform-specific action is simply not announced. */
  platforms?: TargetPlatform[]
  /** Which wire surface carries it. Defaults to `'device'`. See the module docstring. */
  expose?: 'tool' | 'device' | 'both'
  control?: ControlSpec
}

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  description: string
  permissions: Permission[]
  actions: ActionDef[]
}

/** One capability as it goes out on `device_announce`. */
export interface DeviceCapability {
  action: string
  description?: string
  destructive?: boolean
  input_schema?: Record<string, unknown>
}

/** One tool as it goes out on `register_tools`. Bare name — Amber prefixes it. */
export interface ToolSpecLike {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

export const MAX_ACTION_TIMEOUT_MS = 8_000
export const DEVICE_BUDGET_MS = 15_000
export const APPROVAL_TIMEOUT_MS = 10_000
/** Amber's `max_client_tools`. Exceeding it means she silently drops the tail. */
export const MAX_REGISTERED_TOOLS = 16

const ID_RE = /^[a-z][a-z0-9-]*$/
const ACTION_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/

export function capabilityKey(extensionId: string, action: string): string {
  return `${extensionId}.${action}`
}

/**
 * Split a wire key back into its parts.
 *
 * The **first** dot separates, because an extension id may not contain one (`ID_RE`)
 * while an action name may (`power.sleep`). Splitting on the last dot would route
 * `system-control.power.sleep` to an extension called `system-control.power`.
 */
export function parseCapabilityKey(
  key: string,
): { extensionId: string; action: string } | null {
  const dot = key.indexOf('.')
  if (dot <= 0 || dot === key.length - 1) return null
  return { extensionId: key.slice(0, dot), action: key.slice(dot + 1) }
}

function actionApplies(action: ActionDef, platform: TargetPlatform): boolean {
  return !action.platforms || action.platforms.includes(platform)
}

function exposure(action: ActionDef): 'tool' | 'device' | 'both' {
  return action.expose ?? 'device'
}

/** Everything this platform can announce as a device capability. */
export function capabilitiesFor(
  manifests: ExtensionManifest[],
  platform: TargetPlatform,
  allowed?: (key: string) => boolean,
): DeviceCapability[] {
  const out: DeviceCapability[] = []
  for (const manifest of manifests) {
    for (const action of manifest.actions) {
      if (exposure(action) === 'tool') continue
      if (!actionApplies(action, platform)) continue
      const key = capabilityKey(manifest.id, action.name)
      if (allowed && !allowed(key)) continue
      const capability: DeviceCapability = { action: key, description: action.description }
      if (action.destructive) capability.destructive = true
      if (action.input_schema) capability.input_schema = action.input_schema
      out.push(capability)
    }
  }
  return out
}

/**
 * Everything this platform declares to Amber as a conversation tool.
 *
 * Truncated at `MAX_REGISTERED_TOOLS` **here** rather than left to Amber, who caps
 * silently — the caller traces what was dropped so a missing tool is a line in the log
 * rather than a capability that mysteriously doesn't exist.
 */
export function toolSpecsFor(
  manifests: ExtensionManifest[],
  platform: TargetPlatform,
  allowed?: (key: string) => boolean,
): { specs: ToolSpecLike[]; dropped: string[] } {
  const all: ToolSpecLike[] = []
  for (const manifest of manifests) {
    for (const action of manifest.actions) {
      if (exposure(action) === 'device') continue
      if (!actionApplies(action, platform)) continue
      if (allowed && !allowed(capabilityKey(manifest.id, action.name))) continue
      all.push({
        name: action.name,
        description: action.description,
        input_schema: action.input_schema,
      })
    }
  }
  return {
    specs: all.slice(0, MAX_REGISTERED_TOOLS),
    dropped: all.slice(MAX_REGISTERED_TOOLS).map((s) => s.name),
  }
}

export function findAction(
  manifests: ExtensionManifest[],
  key: string,
): { manifest: ExtensionManifest; action: ActionDef } | null {
  const parsed = parseCapabilityKey(key)
  if (!parsed) return null
  const manifest = manifests.find((m) => m.id === parsed.extensionId)
  if (!manifest) return null
  const action = manifest.actions.find((a) => a.name === parsed.action)
  return action ? { manifest, action } : null
}

/** Every `{id}.{action}` key across all manifests, in declaration order. */
export function allCapabilityKeys(manifests: ExtensionManifest[]): string[] {
  return manifests.flatMap((m) => m.actions.map((a) => capabilityKey(m.id, a.name)))
}

/** A grant is stored flat as `"{extensionId}:{permission}"`. */
export function grantKey(extensionId: string, permission: Permission): string {
  return `${extensionId}:${permission}`
}

/**
 * Whether an action may run: its extension must hold the permission the action needs.
 *
 * An action's permission is the one its extension declares — a manifest may declare
 * several, and each action names which of them it uses, so granting `power` doesn't
 * implicitly grant `secrets` to the same extension.
 */
export function isAllowed(
  manifests: ExtensionManifest[],
  granted: string[],
  key: string,
): boolean {
  const found = findAction(manifests, key)
  if (!found) return false
  const needed = permissionFor(found.manifest, found.action)
  return needed === null || granted.includes(grantKey(found.manifest.id, needed))
}

/**
 * Which permission an action consumes.
 *
 * Deliberately *derived* rather than declared per action: an extension declares the set
 * it needs, and an action's first path segment names which one it is (`power.sleep` uses
 * `power`, `audio.set_volume` uses `audio`). A manifest whose action doesn't map onto
 * one of its declared permissions fails validation, so this can never silently return
 * `null` for something that should have been gated.
 */
export function permissionFor(
  manifest: ExtensionManifest,
  action: ActionDef,
): Permission | null {
  const segment = action.name.split('.')[0] as Permission
  if (manifest.permissions.includes(segment)) return segment
  // Single-permission extensions (ssh-terminal declares pty + secrets for one action)
  // consume all of them, so the whole manifest is one grant decision.
  return manifest.permissions[0] ?? null
}

/**
 * Structural checks over every manifest. Returns problems; `[]` means valid.
 *
 * Run by `verify:extensions` rather than at startup, deliberately — a malformed manifest
 * is a build-time mistake, and failing a packaged app to boot over one would be worse
 * than the bug it caught.
 */
export function validateManifests(manifests: ExtensionManifest[]): string[] {
  const problems: string[] = []
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()

  for (const manifest of manifests) {
    const where = `manifest "${manifest.id ?? '(no id)'}"`
    if (!ID_RE.test(manifest.id ?? '')) {
      problems.push(`${where}: id must match ${ID_RE} and contain no dot`)
    }
    if (seenIds.has(manifest.id)) problems.push(`${where}: duplicate id`)
    seenIds.add(manifest.id)

    if (!manifest.name?.trim()) problems.push(`${where}: missing name`)
    if (!manifest.version?.trim()) problems.push(`${where}: missing version`)
    if (!manifest.description?.trim()) problems.push(`${where}: missing description`)

    if (!Array.isArray(manifest.permissions) || manifest.permissions.length === 0) {
      problems.push(`${where}: must declare at least one permission`)
    } else {
      for (const permission of manifest.permissions) {
        if (!PERMISSIONS.includes(permission)) {
          problems.push(`${where}: unknown permission "${permission}"`)
        }
      }
    }

    if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) {
      problems.push(`${where}: must declare at least one action`)
      continue
    }

    for (const action of manifest.actions) {
      const at = `${where} action "${action.name ?? '(no name)'}"`
      if (!ACTION_RE.test(action.name ?? '')) {
        problems.push(`${at}: name must match ${ACTION_RE}`)
      }
      if (!action.description?.trim()) {
        problems.push(`${at}: missing description — it is what the model reads`)
      }

      const key = capabilityKey(manifest.id, action.name)
      if (seenKeys.has(key)) problems.push(`${at}: duplicate capability key "${key}"`)
      seenKeys.add(key)

      if (permissionFor(manifest, action) === null) {
        problems.push(`${at}: consumes no declared permission`)
      }

      if (!(action.timeoutMs > 0)) {
        problems.push(`${at}: timeoutMs must be positive`)
      } else if (action.timeoutMs > MAX_ACTION_TIMEOUT_MS) {
        problems.push(`${at}: timeoutMs ${action.timeoutMs} exceeds ${MAX_ACTION_TIMEOUT_MS}`)
      }

      // The budget rule, and the reason it is enforced here: a destructive action also
      // waits on a person, and approval + dispatch must still land inside our own
      // self-answer window or Amber times out first and the model learns nothing.
      if (action.destructive && APPROVAL_TIMEOUT_MS + action.timeoutMs > DEVICE_BUDGET_MS) {
        problems.push(
          `${at}: approval (${APPROVAL_TIMEOUT_MS}ms) + timeoutMs (${action.timeoutMs}ms) ` +
            `exceeds the ${DEVICE_BUDGET_MS}ms self-answer budget`,
        )
      }

      if (action.destructive && action.control && action.control.kind === 'button') {
        if (action.control.tone !== 'danger') {
          problems.push(`${at}: a destructive button must carry tone "danger"`)
        }
      }

      if (action.platforms) {
        for (const platform of action.platforms) {
          if (!TARGET_PLATFORMS.includes(platform)) {
            problems.push(`${at}: unknown platform "${platform}"`)
          }
        }
      }
    }
  }

  for (const platform of TARGET_PLATFORMS) {
    const { dropped } = toolSpecsFor(manifests, platform)
    if (dropped.length) {
      problems.push(
        `more than ${MAX_REGISTERED_TOOLS} tools on ${platform}; Amber would drop ${dropped.join(', ')}`,
      )
    }
  }

  return problems
}

/** What the Settings page renders. Prose, not shape. */
export interface ExtensionSummary {
  id: string
  name: string
  version: string
  description: string
  permissions: { permission: Permission; label: string; granted: boolean }[]
  actions: { key: string; description: string; destructive: boolean; available: boolean }[]
}

export function summarize(
  manifests: ExtensionManifest[],
  granted: string[],
  platform: TargetPlatform,
): ExtensionSummary[] {
  return manifests.map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    permissions: manifest.permissions.map((permission) => ({
      permission,
      label: PERMISSION_LABELS[permission],
      granted: granted.includes(grantKey(manifest.id, permission)),
    })),
    actions: manifest.actions.map((action) => {
      const key = capabilityKey(manifest.id, action.name)
      return {
        key,
        description: action.description,
        destructive: Boolean(action.destructive),
        available: actionApplies(action, platform) && isAllowed(manifests, granted, key),
      }
    }),
  }))
}
