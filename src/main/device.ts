/**
 * This machine's identity in the fleet.
 *
 * Amber addresses devices by id, so the id has to outlive a restart — otherwise every
 * launch is a new machine, the registry fills with ghosts, and "my desktop" stops
 * resolving the moment there are two entries claiming to be it.
 *
 * ## Why its own file rather than a key in `settings.json`
 *
 * `settings.json` is what a person edits and what any "reset settings" would clear. A
 * device id is an **identity**, not a preference: losing it renames this machine in the
 * fleet and orphans anything keyed to it. `config.ts` already sets the precedent with
 * the audit log — "separate file so clearing the audit log can't disturb app config" —
 * and this is the same argument pointed the other way.
 *
 * There is a second, sharper reason. `DEFAULT_SETTINGS` would have to carry a default,
 * and any default for an id is a sentinel: `''` is indistinguishable from "not minted
 * yet" for every reader, which is exactly the ambiguity `ttsVoice` documents at length.
 * Minting on first read here means the value is never absent and never a placeholder.
 *
 * Two flat string keys, because `JsonStore` merges exactly one level.
 */

import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

import { JsonStore } from './store'

interface DeviceRecord {
  deviceId: string
  deviceName: string
}

let store: JsonStore<DeviceRecord> | null = null

/** Lazily — `app.getPath('userData')` is invalid before the app is ready. */
function device(): JsonStore<DeviceRecord> {
  return (store ??= new JsonStore<DeviceRecord>('device.json', {
    deviceId: '',
    deviceName: '',
  }))
}

export function getDeviceId(): string {
  const current = device().get().deviceId
  if (current) return current
  // Minted once, on first read, and immediately persisted. A caller can never observe
  // the empty default, so nothing downstream needs a "not set yet" branch.
  return device().set({ deviceId: randomUUID() }).deviceId
}

export function getDeviceName(): string {
  const current = device().get().deviceName
  if (current) return current
  // The hostname is a better first guess than "Device 1" and is usually what someone
  // would have typed anyway. Editable in Settings, and stored once chosen so a machine
  // renamed at the OS level doesn't quietly rename itself in the fleet.
  return device().set({ deviceName: hostname() || 'This machine' }).deviceName
}

export function setDeviceName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return getDeviceName()
  return device().set({ deviceName: trimmed }).deviceName
}
