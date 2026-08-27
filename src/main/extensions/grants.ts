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
}

let store: JsonStore<GrantRecord> | null = null

/**
 * Lazily, because `app.getPath('userData')` is invalid before the app is ready — the
 * same reason every store in `config.ts` is built on first use.
 */
function grants(): JsonStore<GrantRecord> {
  return (store ??= new JsonStore<GrantRecord>('extensions.json', { granted: [] }))
}

export function listGrants(): string[] {
  const raw = grants().get().granted
  // Defensive: this file is user-editable, and a hand-edited array of nulls should cost
  // a permission rather than a crash on boot.
  return Array.isArray(raw) ? raw.filter((entry) => typeof entry === 'string') : []
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
