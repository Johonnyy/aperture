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

/**
 * The remote half of `ssh-copy-id`.
 *
 * Appends the public key to `~/.ssh/authorized_keys` with the permissions sshd
 * insists on — a group-writable `~/.ssh` makes sshd silently ignore the file, which
 * presents as "the key didn't work" with no useful error anywhere.
 *
 * The key is passed through a quoted heredoc so nothing in it is shell-expanded,
 * and `grep -qxF` makes re-running harmless instead of accumulating duplicates.
 */
export function buildInstallCommand(publicKey: string): string {
  const key = publicKey.trim()
  return [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    'touch ~/.ssh/authorized_keys',
    'chmod 600 ~/.ssh/authorized_keys',
    `grep -qxF '${key.replace(/'/g, "'\\''")}' ~/.ssh/authorized_keys || cat >> ~/.ssh/authorized_keys <<'APERTURE_EOF'\n${key}\nAPERTURE_EOF`,
  ].join(' && ')
}
