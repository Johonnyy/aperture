/**
 * The one door into an extension's actions.
 *
 * Handlers are exported nowhere else and `src/main/ipc.ts` never reaches into an
 * extension directly, so a key that isn't in this registry cannot be invoked from Amber,
 * from the Devices panel, or from IPC. That single-door property is what the permission
 * gate below is worth anything at all: there is one place to check.
 *
 * Everything shaped here mirrors what already exists rather than inventing a pattern —
 * `ACTIONS` in `src/main/infra/actions.ts` is the same idea (a record of declared
 * operations resolved by key in main, never in the renderer), just static where this is
 * assembled from manifests.
 */

import {
  capabilitiesFor,
  findAction,
  isAllowed,
  summarize,
  toolSpecsFor,
  type DeviceCapability,
  type ExtensionManifest,
  type ExtensionSummary,
  type TargetPlatform,
  type ToolSpecLike,
} from '../../shared/extensions'
import { listGrants } from './grants'
import { HANDLERS, type ActionContext, type ActionResult } from './handlers'
import { IMPLEMENTED, MANIFESTS, type ImplementedKey } from './index'

/** The platform we are actually on, narrowed to what an action can target.
 *  `null` on anything else — an unsupported platform announces nothing rather than
 *  guessing at a command that would be wrong. */
export function currentPlatform(): TargetPlatform | null {
  const platform = process.platform
  return platform === 'win32' || platform === 'darwin' || platform === 'linux'
    ? platform
    : null
}

function isImplemented(key: string): key is ImplementedKey {
  return (IMPLEMENTED as readonly string[]).includes(key)
}

export class ExtensionRegistry {
  constructor(private readonly manifests: ExtensionManifest[] = MANIFESTS) {}

  all(): ExtensionManifest[] {
    return this.manifests
  }

  /** Whether an action may run right now: implemented, on this platform, and granted. */
  private permits(key: string): boolean {
    if (!isImplemented(key)) return false
    const platform = currentPlatform()
    if (!platform) return false
    const found = findAction(this.manifests, key)
    if (!found) return false
    if (found.action.platforms && !found.action.platforms.includes(platform)) return false
    return isAllowed(this.manifests, listGrants(), key)
  }

  /** What we announce on `device_announce`. Ungranted actions are simply absent — Amber
   *  refuses anything a device never announced, so a revoked permission is enforced on
   *  both ends rather than only here. */
  capabilities(): DeviceCapability[] {
    const platform = currentPlatform()
    if (!platform) return []
    return capabilitiesFor(this.manifests, platform, (key) => this.permits(key))
  }

  /** What we declare on `register_tools`. Truncated here rather than by Amber, who caps
   *  silently at 16 — the caller traces `dropped` so a missing tool is a log line. */
  tools(): { specs: ToolSpecLike[]; dropped: string[] } {
    const platform = currentPlatform()
    if (!platform) return { specs: [], dropped: [] }
    return toolSpecsFor(this.manifests, platform, (key) => this.permits(key))
  }

  /** Resolve a bare `register_tools` name back to its capability key.
   *
   *  Amber calls a declared tool by its (prefixed, sanitized) bare name and a device
   *  action by its dotted key, so the bridge has to map one back. Names are unique across
   *  manifests because `validateManifests` rejects duplicate keys and a tool-exposed
   *  action's bare name is what goes on the wire. */
  keyForToolName(name: string): string | null {
    const platform = currentPlatform()
    if (!platform) return null
    for (const manifest of this.manifests) {
      for (const action of manifest.actions) {
        if ((action.expose ?? 'device') === 'device') continue
        if (action.name === name) return `${manifest.id}.${action.name}`
      }
    }
    return null
  }

  describe(): ExtensionSummary[] {
    return summarize(this.manifests, listGrants(), currentPlatform() ?? 'linux')
  }

  /**
   * Run one action. **Never throws** — a failure is a message the model can react to,
   * exactly as `registry.dispatch` guarantees on Amber's side.
   */
  async run(
    key: string,
    args: Record<string, unknown>,
    callId: string,
  ): Promise<ActionResult> {
    const found = findAction(this.manifests, key)
    if (!found) {
      return { message: `Error: ${key} is not something this device provides.`, isError: true }
    }
    if (!isImplemented(key)) {
      return { message: `Error: ${key} is declared but not implemented in this build.`, isError: true }
    }

    const platform = currentPlatform()
    if (!platform) {
      return { message: `Error: ${process.platform} is not a supported platform.`, isError: true }
    }
    if (found.action.platforms && !found.action.platforms.includes(platform)) {
      return { message: `Error: ${key} is not available on ${platform}.`, isError: true }
    }
    if (!isAllowed(this.manifests, listGrants(), key)) {
      return {
        message:
          `Error: ${key} is switched off — ${found.manifest.name} has not been granted ` +
          `permission on this machine. It can be enabled in Settings → Extensions.`,
        isError: true,
      }
    }

    const ctx: ActionContext = { platform, timeoutMs: found.action.timeoutMs, callId }
    try {
      return await HANDLERS[key](args, ctx)
    } catch (error) {
      return {
        message: `Error running ${key}: ${(error as Error).message}`,
        isError: true,
      }
    }
  }
}

export const extensionRegistry = new ExtensionRegistry()
