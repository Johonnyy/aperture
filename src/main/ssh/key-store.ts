import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { KeyRecord } from '../../shared/types'

/**
 * The private key vault.
 *
 * Private halves are encrypted with Electron's `safeStorage` (DPAPI on Windows,
 * Keychain on macOS, libsecret on Linux) and stored as opaque base64. They are never
 * written in plaintext and never leave the main process — the renderer sees only
 * public keys and ids.
 *
 * Machine-bound by construction: `safeStorage` ties the ciphertext to the OS user
 * account, so the vault does not survive a profile migration. That's the right
 * trade for a credential store, but it means "export" is not a feature you can add
 * later without changing the encryption story.
 */
interface VaultShape {
  keys: Array<KeyRecord & { encryptedPrivateKey: string }>
}

const FILE = 'keys.json'

let cache: VaultShape | null = null

function path(): string {
  return join(app.getPath('userData'), FILE)
}

function load(): VaultShape {
  if (cache) return cache
  try {
    cache = existsSync(path())
      ? (JSON.parse(readFileSync(path(), 'utf8')) as VaultShape)
      : { keys: [] }
  } catch {
    cache = { keys: [] }
  }
  return cache
}

function flush(): void {
  const tmp = `${path()}.tmp`
  writeFileSync(tmp, JSON.stringify(load(), null, 2), 'utf8')
  renameSync(tmp, path())
}

/**
 * Refuse to store secrets we can't encrypt. Writing a private key in plaintext
 * because the platform keyring is unavailable would be worse than failing loudly.
 */
function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS encryption is unavailable, so private keys cannot be stored safely. ' +
        'On Linux this usually means no keyring (gnome-keyring / kwallet) is running.',
    )
  }
}

export function isVaultAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function listKeys(): KeyRecord[] {
  // Strip the ciphertext — callers outside this module have no business with it.
  return load().keys.map(({ encryptedPrivateKey: _omit, ...rest }) => rest)
}

export function storeKey(label: string, publicKey: string, privateKey: string): KeyRecord {
  assertEncryptionAvailable()
  const record = { id: randomUUID(), label, publicKey, createdAt: Date.now() }
  load().keys.push({
    ...record,
    encryptedPrivateKey: safeStorage.encryptString(privateKey).toString('base64'),
  })
  flush()
  return record
}

/** Decrypt a private key for immediate use. Never persist or log the result. */
export function readPrivateKey(id: string): string | null {
  const entry = load().keys.find((k) => k.id === id)
  if (!entry) return null
  try {
    return safeStorage.decryptString(Buffer.from(entry.encryptedPrivateKey, 'base64'))
  } catch {
    // Ciphertext from a different OS account or machine — unrecoverable, not a bug.
    return null
  }
}

export function getPublicKey(id: string): string | null {
  return load().keys.find((k) => k.id === id)?.publicKey ?? null
}

export function deleteKey(id: string): void {
  const vault = load()
  vault.keys = vault.keys.filter((k) => k.id !== id)
  flush()
}
