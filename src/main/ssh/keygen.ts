import { utils } from 'ssh2'

import type { KeyRecord } from '../../shared/types'
import { storeKey } from './key-store'

/**
 * Ed25519 key generation.
 *
 * Uses `ssh2`'s own generator rather than shelling out to `ssh-keygen`. On Windows
 * OpenSSH is an optional feature that may be absent, and PATH resolution from a
 * packaged Electron app is unreliable — but more importantly, generating in-process
 * means the private key goes straight into the encrypted vault without ever
 * existing as a file on disk.
 */
export function generateKey(label: string, comment = 'aperture'): KeyRecord {
  const pair = utils.generateKeyPairSync('ed25519', { comment })
  // `storeKey` encrypts the private half immediately; it is not retained here.
  return storeKey(label, pair.public.trim(), pair.private)
}

// The remote half of `ssh-copy-id` lives in `authorized-keys.ts`, kept free of
// Electron imports so it can be exercised against a real shell in the verify script.
export { buildInstallCommand, INSTALL_OK_MARKER } from './authorized-keys'
