/**
 * Which extensions have been granted which permissions, on this machine.
 *
 * Stored **flat**, as `["system-control:power", "ssh-terminal:pty", …]`, and that shape
 * is a deliberate response to a real constraint rather than a style choice: `JsonStore`
 * merges exactly one level over its defaults, so a nested
 * `Record<string, Permission[]>` would arrive from an older build partial and be typed as
 * complete. A flat array of strings has no second level to get wrong.
 *
 * Its own file rather than a key in `settings.json` for the same reason the audit log has
 * one: clearing or resetting app preferences must not silently revoke — or silently
 * re-grant — permission to power the machine off.
 *
 * ## What a grant actually buys, honestly
 *
 * An ungranted action is removed from `capabilities()`, so it is never announced to Amber
 * and never appears in the panel, **and** `run()` refuses it. Two gates in one process,
 * plus Amber's own capability check in another — she refuses any action a device did not
 * announce, so a revoked permission is enforced on both ends of the socket.
 *
 * What it is *not* is a sandbox. Every extension is compiled into the same bundle with
 * the same privileges; this cannot stop a handler importing `node:child_process`
 * directly. See `src/shared/extensions.ts` for what making that real would take.
 */

import { JsonStore } from '../store'

interface GrantRecord {
  granted: string[]
  /** Whether the one-time seed below has run. Flat, like everything else here. */
  seeded?: boolean
}

/**
 * Permissions that were **already in effect before this consent screen existed**.
 *
 * SSH shipped working, with no grant to give and no screen to give it on. Introducing
 * a permission model that silently revoked it on upgrade would be a regression dressed
 * up as a security improvement: the capability would vanish, `register_tools` would go
 * out empty, and Amber would simply stop being able to run commands with nothing
 * anywhere saying why. A consent screen is only worth having if it records a decision
 * someone actually made, and nobody ever decided to turn SSH off.
 *
 * So these are granted once, when the file is first created, and never again — if you
 * revoke `ssh-terminal:pty` it stays revoked through every later launch. Genuinely new
 * capabilities are deliberately **not** here: powering the machine off is a fresh
 * decision, so `system-control` starts ungranted and asks.
 */
const SEEDED_GRANTS = ['ssh-terminal:pty', 'ssh-terminal:secrets']

let store: JsonStore<GrantRecord> | null = null

/**
 * Lazily, because `app.getPath('userData')` is invalid before the app is ready — the
 * same reason every store in `config.ts` is built on first use.
 */
function grants(): JsonStore<GrantRecord> {
  if (store) return store
  store = new JsonStore<GrantRecord>('extensions.json', { granted: [], seeded: false })
  if (!store.get().seeded) {
    // Union rather than overwrite: on a fresh install `granted` is empty, but a
    // hand-edited file must not lose what it already says.
    const current = new Set(listGrantsFrom(store))
    for (const key of SEEDED_GRANTS) current.add(key)
    store.set({ granted: [...current], seeded: true })
  }
  return store
}

function listGrantsFrom(from: JsonStore<GrantRecord>): string[] {
  const raw = from.get().granted
  return Array.isArray(raw) ? raw.filter((entry) => typeof entry === 'string') : []
}

export function listGrants(): string[] {
  // Defensive inside `listGrantsFrom`: this file is user-editable, and a hand-edited
  // array of nulls should cost a permission rather than a crash on boot.
  return listGrantsFrom(grants())
}

export function setGrant(key: string, granted: boolean): string[] {
  const current = new Set(listGrants())
  if (granted) current.add(key)
  else current.delete(key)
  return grants().set({ granted: [...current] }).granted
}

export function hasGrant(key: string): boolean {
  return listGrants().includes(key)
}
