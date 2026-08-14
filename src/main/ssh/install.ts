import type { ClientChannel } from 'ssh2'

import type { OpLogLevel } from '../../shared/types'
import { getServer, updateServer } from '../config'
import { listKeys } from './key-store'
import { buildInstallCommand, INSTALL_OK_MARKER } from './keygen'
import { connect, exec, type Log } from './ssh-client'

/**
 * Install a public key on a server, narrating every step.
 *
 * Each stage is separately bounded. The previous version had no timeout anywhere:
 * when the remote command blocked, the whole thing hung on "Installing…" with
 * nothing to look at and no way to tell a wrong password from an unreachable host.
 */
const CONNECT_TIMEOUT_MS = 15_000
const EXEC_TIMEOUT_MS = 15_000
const VERIFY_TIMEOUT_MS = 15_000

export interface InstallResult {
  ok: boolean
  error?: string
}

/** Reject rather than hang, whatever the underlying library decides to do. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)),
      ms,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export async function installKey(
  serverId: string,
  keyId: string,
  password: string,
  log: Log,
): Promise<InstallResult> {
  const fail = (message: string, detail?: string): InstallResult => {
    log('error', message, detail)
    return { ok: false, error: message }
  }

  const server = getServer(serverId)
  if (!server) return fail('That server is no longer configured.')

  const key = listKeys().find((k) => k.id === keyId)
  if (!key) return fail('That key is no longer in the vault.')

  log('info', `Installing "${key.label}" on ${server.name}`)
  log('debug', 'Public key', key.publicKey)

  const command = buildInstallCommand(key.publicKey)
  log('debug', 'Command to run', command)

  let client: Awaited<ReturnType<typeof connect>>
  try {
    client = await withTimeout(
      connect(server, { password, trustOnFirstUse: true, timeoutMs: CONNECT_TIMEOUT_MS, log }),
      CONNECT_TIMEOUT_MS + 2_000,
      'Connecting',
    )
  } catch (err) {
    return fail((err as Error).message)
  }

  // --- append the key ---
  try {
    log('info', 'Appending the key to ~/.ssh/authorized_keys')
    const output = await withTimeout(
      runCommand(client, command),
      EXEC_TIMEOUT_MS,
      'Running the install command',
    )

    if (output.stdout.trim()) log('debug', 'stdout', output.stdout.trim())
    if (output.stderr.trim()) log('warn', 'stderr', output.stderr.trim())

    if (output.code !== 0) {
      client.end()
      return fail(
        `The install command exited with code ${output.code}.`,
        output.stderr.trim() || output.stdout.trim() || undefined,
      )
    }
    if (!output.stdout.includes(INSTALL_OK_MARKER)) {
      client.end()
      return fail(
        'The install command finished but did not report success.',
        'Expected the completion marker in stdout and it was not there, so the key may not have been written.',
      )
    }
    log('ok', 'Key written and permissions set')
  } catch (err) {
    client.end()
    return fail((err as Error).message)
  }
  client.end()

  // --- prove key auth actually works ---
  // A half-installed key that silently falls back to a password is worse than a
  // clean failure, so the credential only switches over after a fresh key-only
  // connection succeeds.
  log('info', 'Verifying with a new key-only connection')
  updateServer(serverId, { keyId })
  const verifying = getServer(serverId)
  if (!verifying) return fail('That server was removed mid-install.')

  try {
    const check = await withTimeout(
      exec(verifying, `echo ${INSTALL_OK_MARKER}`, VERIFY_TIMEOUT_MS),
      VERIFY_TIMEOUT_MS + 2_000,
      'Verifying',
    )
    if (check.error || !check.stdout.includes(INSTALL_OK_MARKER)) {
      updateServer(serverId, { keyId: null }) // roll back; password auth still works
      return fail(
        'The key was written but did not authenticate.',
        check.error ??
          'sshd often ignores authorized_keys when ~/.ssh permissions are too open, ' +
            'or when the account is restricted. The server is unchanged in Aperture.',
      )
    }
  } catch (err) {
    updateServer(serverId, { keyId: null })
    return fail((err as Error).message)
  }

  log('ok', `${server.name} now uses key authentication`)
  return { ok: true }
}

/** One-shot exec on an already-open client, with stdin closed so it cannot block. */
function runCommand(
  client: Awaited<ReturnType<typeof connect>>,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream: ClientChannel) => {
      if (err) {
        reject(err)
        return
      }
      let stdout = ''
      let stderr = ''
      stream.end() // nothing writes to stdin; make sure the remote side sees EOF
      stream.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
      stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
      stream.on('close', (code: number | null) => resolve({ stdout, stderr, code }))
    })
  })
}

export type { OpLogLevel }
