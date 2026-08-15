import { randomUUID } from 'node:crypto'

import { EMPTY_BLOOM_LINK, type BloomLink } from '../shared/bloom'
import { DEFAULT_SETTINGS, type AuditEntry, type ServerConfig, type Settings } from '../shared/types'
import { JsonStore } from './store'

/** How many audit entries to keep. It's a record of recent activity, not an archive. */
const AUDIT_CAP = 500

/** The persisted half of a `BloomLink` — `hasToken` is derived, see `bloom/link.ts`. */
type BloomRecord = Omit<BloomLink, 'hasToken'>

let settingsStore: JsonStore<Settings> | null = null
let serversStore: JsonStore<{ servers: ServerConfig[] }> | null = null
let auditStore: JsonStore<{ entries: AuditEntry[] }> | null = null
let bloomStore: JsonStore<BloomRecord> | null = null

// Lazily constructed: `app.getPath('userData')` isn't valid until Electron is ready.
function settings(): JsonStore<Settings> {
  return (settingsStore ??= new JsonStore<Settings>('settings.json', DEFAULT_SETTINGS))
}
function servers(): JsonStore<{ servers: ServerConfig[] }> {
  return (serversStore ??= new JsonStore('servers.json', { servers: [] }))
}
function audit(): JsonStore<{ entries: AuditEntry[] }> {
  // Separate file so clearing the audit log can't disturb app config.
  return (auditStore ??= new JsonStore('audit.json', { entries: [] }))
}
function bloom(): JsonStore<BloomRecord> {
  // A file per concern, like audit.json. Kept flat because JsonStore merges exactly
  // one level over its defaults — a nested object from an older build would arrive
  // partial, cast as complete, and `strict` would never see it.
  const { hasToken: _derived, ...defaults } = EMPTY_BLOOM_LINK
  return (bloomStore ??= new JsonStore<BloomRecord>('bloom.json', defaults))
}

// --- settings ---------------------------------------------------------------

export function getSettings(): Settings {
  return settings().get()
}

export function updateSettings(patch: Partial<Settings>): Settings {
  return settings().set(patch)
}

// --- servers ----------------------------------------------------------------

export function listServers(): ServerConfig[] {
  return servers().get().servers
}

export function getServer(idOrName: string): ServerConfig | undefined {
  // Amber refers to servers by name (that's what's in the tool schema); the UI uses
  // ids. Accept either so the bridge doesn't need to care.
  return listServers().find((s) => s.id === idOrName || s.name === idOrName)
}

export function addServer(input: Omit<ServerConfig, 'id'>): ServerConfig {
  const server: ServerConfig = { ...input, id: randomUUID() }
  servers().set({ servers: [...listServers(), server] })
  return server
}

export function updateServer(id: string, patch: Partial<ServerConfig>): ServerConfig | undefined {
  const next = listServers().map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s))
  servers().set({ servers: next })
  return next.find((s) => s.id === id)
}

export function removeServer(id: string): void {
  servers().set({ servers: listServers().filter((s) => s.id !== id) })
}

// --- audit ------------------------------------------------------------------

export function listAudit(): AuditEntry[] {
  return audit().get().entries
}

export function appendAudit(entry: AuditEntry): AuditEntry {
  // Newest first, capped — a ring buffer without the bookkeeping.
  const entries = [entry, ...listAudit()].slice(0, AUDIT_CAP)
  audit().set({ entries })
  return entry
}

export function clearAudit(): void {
  audit().set({ entries: [] })
}

// --- bloom ------------------------------------------------------------------
//
// The record only. The admin token lives in `bloom/token-store.ts` behind
// `safeStorage`, and `hasToken` is derived from it on every read rather than
// persisted here — see `bloom/link.ts`.

export function getBloomRecord(): BloomRecord {
  return bloom().get()
}

export function setBloomRecord(record: BloomRecord): BloomRecord {
  return bloom().replace(record)
}
