/**
 * What *this* machine calls the other machines.
 *
 * A device's real name comes from the machine itself (`device.ts`, announced to Amber
 * and shown to every other client). A nickname is the opposite: local, private to this
 * install, and never announced.
 *
 * ## The honest limit, stated once
 *
 * A nickname is **display only**. Amber does not know it, so "sleep the loft mac" will
 * not resolve if "loft mac" exists only here — she matches against the announced name.
 * That is a real edge on design principle 3, so the panel does the one thing that
 * closes it where it can: renaming **this** machine goes through `device.rename`
 * instead, which re-announces and teaches Amber the name for real. Only other people's
 * machines fall back to a local alias, and for those there is no alternative — this
 * install cannot rename a computer it does not run on.
 *
 * Its own file rather than a key in `settings.json`, for the reason `device.json` has
 * one: a name you chose is not a preference, and clearing preferences should not
 * silently rename half your fleet.
 */

import { JsonStore } from './store'

interface NicknameRecord {
  /** device_id -> what this machine calls it. */
  nicknames: Record<string, string>
}

let store: JsonStore<NicknameRecord> | null = null

/**
 * Lazily, like every store here — `app.getPath('userData')` is invalid before ready.
 *
 * `JsonStore` merges exactly one level, which is fine for this shape: `nicknames` is
 * replaced wholesale rather than merged key by key, and there are no per-device
 * defaults that a merge would need to supply.
 */
function nicknames(): JsonStore<NicknameRecord> {
  return (store ??= new JsonStore<NicknameRecord>('nicknames.json', { nicknames: {} }))
}

export function listNicknames(): Record<string, string> {
  const raw = nicknames().get().nicknames
  if (!raw || typeof raw !== 'object') return {}
  // The file is user-editable; a hand-broken entry should cost one nickname, not boot.
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([id, name]) => typeof id === 'string' && typeof name === 'string' && name.trim(),
    ),
  )
}

/** Set a nickname, or clear it by passing an empty string. Returns the whole map. */
export function setNickname(deviceId: string, nickname: string): Record<string, string> {
  const next = { ...listNicknames() }
  const trimmed = nickname.trim().slice(0, 60)
  if (trimmed) next[deviceId] = trimmed
  else delete next[deviceId]
  return nicknames().set({ nicknames: next }).nicknames
}
