import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import {
  type CredentialSummary,
  type StoredCredential,
  type VaultShape,
  normalizeId,
  publicView,
} from '../../shared/credentials'

/**
 * The credentials you own, encrypted at rest.
 *
 * **A deliberate mirror of `bloom/token-store.ts`, which is itself a mirror of
 * `ssh/key-store.ts`.** That file argues the case and this is the third caller, which
 * is exactly when the temptation to unify arrives — so, explicitly: the SSH vault's
 * shape is `KeyRecord[]` and it feeds the SSH key manager, where a smuggled-in API key
 * would render as a fake key pair; Bloom's is a single token; this one is a keyed
 * multi-record store. Unifying them makes `listKeys()` a union type that both existing
 * call sites have to narrow, to save thirty lines. The three rules are copied verbatim
 * instead: refuse to store when the platform cannot encrypt, return `null` rather than
 * throw when the ciphertext is unreadable, and never let a value cross
 * `contextBridge`.
 *
 * Machine-bound by construction: `safeStorage` ties ciphertext to the OS account, so
 * this does not survive a profile migration. That is acceptable only because it is
 * never the sole copy — a filled value is written into the box's `secrets.yaml`, which
 * is what the backups hold. Losing this vault costs retyping, never re-authorising.
 */

const FILE = 'credentials.json'
const EMPTY: VaultShape = { credentials: [] }

let cache: VaultShape | null = null

function path(): string {
  return join(app.getPath('userData'), FILE)
}

function load(): VaultShape {
  if (cache) return cache
  try {
    cache = existsSync(path())
      ? (JSON.parse(readFileSync(path(), 'utf8')) as VaultShape)
      : { ...EMPTY, credentials: [] }
  } catch {
    // A corrupt vault is an empty one, not a crash. Re-entering a key rewrites it.
    cache = { ...EMPTY, credentials: [] }
  }
  if (!Array.isArray(cache.credentials)) cache.credentials = []
  return cache
}

function flush(): void {
  const tmp = `${path()}.tmp`
  writeFileSync(tmp, JSON.stringify(load(), null, 2), 'utf8')
  renameSync(tmp, path())
}

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS encryption is unavailable, so credentials cannot be stored safely. ' +
        'On Linux this usually means no keyring (gnome-keyring / kwallet) is running.',
    )
  }
}

export function isVaultAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/** Decrypt one credential for immediate use. Never persist, log or forward it. */
export function readCredential(uid: string): string | null {
  const entry = load().credentials.find((c) => c.uid === uid)
  if (!entry) return null
  try {
    return safeStorage.decryptString(Buffer.from(entry.encryptedValue, 'base64'))
  } catch {
    // Ciphertext from a different OS account or machine — unrecoverable, not a bug.
    return null
  }
}

/**
 * Every credential, without its ciphertext, with `readable` computed now.
 *
 * The decrypt-to-test is deliberate: a vault that lists entries it cannot open is the
 * failure this makes visible, and it is cheap at the scale of a personal key list.
 */
export function listCredentials(): CredentialSummary[] {
  return load().credentials.map((record: StoredCredential) =>
    publicView(record, readCredential(record.uid) !== null),
  )
}

/**
 * Save a new credential, or replace the value of one that exists.
 *
 * Throws when the platform cannot encrypt. Falling back to plaintext because the
 * keyring is missing would be worse than failing loudly — this is the credential, not
 * a cache of it.
 */
export function saveCredential(input: {
  uid?: string
  credentialId: string
  label: string
  value: string
}): CredentialSummary {
  assertEncryptionAvailable()
  const credentialId = normalizeId(input.credentialId)
  if (!credentialId) throw new Error('a credential needs an id, e.g. openrouter-api-key')
  if (!input.value) throw new Error('a credential needs a value')

  const vault = load()
  const now = Date.now()
  const encryptedValue = safeStorage.encryptString(input.value).toString('base64')
  const existing = input.uid ? vault.credentials.find((c) => c.uid === input.uid) : undefined

  if (existing) {
    existing.credentialId = credentialId
    existing.label = input.label || existing.label
    existing.encryptedValue = encryptedValue
    existing.updatedAt = now
    flush()
    return publicView(existing, true)
  }

  const record: StoredCredential = {
    uid: randomUUID(),
    credentialId,
    label: input.label || credentialId,
    createdAt: now,
    updatedAt: now,
    encryptedValue,
  }
  vault.credentials.push(record)
  flush()
  return publicView(record, true)
}

/** Rename without re-entering the value — the label is not the secret. */
export function updateCredential(uid: string, patch: { label?: string; credentialId?: string }): void {
  const entry = load().credentials.find((c) => c.uid === uid)
  if (!entry) return
  if (patch.label !== undefined) entry.label = patch.label
  if (patch.credentialId !== undefined) {
    const id = normalizeId(patch.credentialId)
    if (id) entry.credentialId = id
  }
  entry.updatedAt = Date.now()
  flush()
}

export function deleteCredential(uid: string): void {
  const vault = load()
  vault.credentials = vault.credentials.filter((c) => c.uid !== uid)
  flush()
}
