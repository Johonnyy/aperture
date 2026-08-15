import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bloom's admin bearer token, encrypted at rest.
 *
 * `safeStorage` is warranted and it isn't close. This token grants full CRUD over
 * every agent configuration *and* the ability to inspect and disconnect a user's
 * connected accounts — a strictly higher-value credential than an SSH key on a
 * personal box, and the key vault already sets that bar.
 *
 * **A deliberate mirror of `ssh/key-store.ts`, not a reuse of it.** That vault's
 * shape is an array of `KeyRecord`, and `listKeys()` feeds the SSH key manager — a
 * token smuggled in as a synthetic key would render there as a fake key pair. Thirty
 * mirrored lines beat a leaky abstraction. The three rules are copied verbatim:
 * refuse to store when the platform cannot encrypt, return `null` rather than throw
 * when the ciphertext is unreadable, and never let the value cross `contextBridge`.
 *
 * Machine-bound by construction, like the key vault: `safeStorage` ties the
 * ciphertext to the OS account, so this does not survive a profile migration. The
 * recovery is re-linking, which reads the token off the server again — cheap, and
 * why an unreadable token maps to `unauthorized` rather than to a mystery.
 */
interface VaultShape {
  /** Base64 `safeStorage` ciphertext. Empty string means "no token stored". */
  encryptedToken: string
}

const FILE = 'bloom-token.json'
const EMPTY: VaultShape = { encryptedToken: '' }

let cache: VaultShape | null = null

function path(): string {
  return join(app.getPath('userData'), FILE)
}

function load(): VaultShape {
  if (cache) return cache
  try {
    cache = existsSync(path()) ? (JSON.parse(readFileSync(path(), 'utf8')) as VaultShape) : { ...EMPTY }
  } catch {
    // A corrupt vault is an unlinked Bloom, not a crash. Re-linking rewrites it.
    cache = { ...EMPTY }
  }
  return cache
}

function flush(): void {
  const tmp = `${path()}.tmp`
  writeFileSync(tmp, JSON.stringify(load(), null, 2), 'utf8')
  renameSync(tmp, path())
}

export function isVaultAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Store the admin token. Throws when the platform cannot encrypt.
 *
 * Falling back to plaintext because the keyring is missing would be worse than
 * failing loudly — this is the credential, not a cache of it.
 */
export function storeToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS encryption is unavailable, so Bloom\'s admin token cannot be stored safely. ' +
        'On Linux this usually means no keyring (gnome-keyring / kwallet) is running.',
    )
  }
  cache = { encryptedToken: safeStorage.encryptString(token).toString('base64') }
  flush()
}

/**
 * Decrypt the token for immediate use. Never persist, log or forward the result.
 *
 * `null` covers both "nothing stored" and "stored by a different OS account", which
 * the caller treats identically: there is no usable token, and the fix is the same.
 */
export function readToken(): string | null {
  const { encryptedToken } = load()
  if (!encryptedToken) return null
  try {
    return safeStorage.decryptString(Buffer.from(encryptedToken, 'base64'))
  } catch {
    // Ciphertext from a different OS account or machine — unrecoverable, not a bug.
    return null
  }
}

/** Whether a token is readable *right now*. The source of `BloomLink.hasToken`. */
export function hasToken(): boolean {
  return readToken() !== null
}

export function clearToken(): void {
  cache = { ...EMPTY }
  flush()
}
