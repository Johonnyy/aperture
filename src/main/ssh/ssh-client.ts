import { createHash } from 'node:crypto'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'

import type { ExecResult, OpLogLevel, ServerConfig } from '../../shared/types'
import { updateServer } from '../config'
import { readPrivateKey } from './key-store'

/** Cap captured output so a runaway command can't blow up memory or the audit log. */
const MAX_OUTPUT = 64 * 1024

/** Narrates a step of an operation. See `OpLogEntry`. */
export type Log = (level: OpLogLevel, message: string, detail?: string) => void

const noop: Log = () => {}

export interface ConnectOptions {
  /** Password auth, used only for the first connect that installs a key. */
  password?: string
  /** Accept and pin whatever host key the server presents (first contact only). */
  trustOnFirstUse?: boolean
  timeoutMs?: number
  /** Narrate progress so the caller can show the user what is happening. */
  log?: Log
}

function fingerprintOf(key: Buffer): string {
  // The same SHA256:base64 form OpenSSH prints, so it can be eyeballed against
  // `ssh-keyscan` output.
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

/**
 * Open a connection to `server`.
 *
 * Host keys are verified, which `ssh2` does *not* do by default — without a
 * `hostVerifier` it accepts anything, which would make this bridge a plausible
 * man-in-the-middle target. First contact pins the fingerprint (trust on first use);
 * every later connection refuses a mismatch outright.
 */
export function connect(server: ServerConfig, opts: ConnectOptions = {}): Promise<Client> {
  const log = opts.log ?? noop
  return new Promise((resolve, reject) => {
    const client = new Client()
    let rejectedHostKey = false

    const config: ConnectConfig = {
      host: server.host,
      port: server.port || 22,
      username: server.username,
      readyTimeout: opts.timeoutMs ?? 15_000,
      // Some servers only offer keyboard-interactive rather than plain password.
      // Without this, a correct password fails with a generic "all methods failed".
      tryKeyboard: Boolean(opts.password),
      hostVerifier: (key: Buffer) => {
        const seen = fingerprintOf(key)
        if (!server.fingerprint) {
          if (!opts.trustOnFirstUse) {
            rejectedHostKey = true
            log('error', 'Host key is unknown and this connection will not pin it.')
            return false
          }
          updateServer(server.id, { fingerprint: seen })
          log('ok', 'Pinned host key on first contact', seen)
          return true
        }
        if (server.fingerprint === seen) {
          log('debug', 'Host key matches the pinned fingerprint', seen)
          return true
        }
        rejectedHostKey = true
        log('error', 'Host key does not match the pinned fingerprint', `expected ${server.fingerprint}\ngot      ${seen}`)
        return false
      },
    }

    if (opts.password) {
      config.password = opts.password
      log('info', `Authenticating as ${server.username} with a password`)
    } else if (server.keyId) {
      const privateKey = readPrivateKey(server.keyId)
      if (!privateKey) {
        reject(
          new Error(
            'The stored key could not be decrypted — it may have been created under a different OS account.',
          ),
        )
        return
      }
      config.privateKey = privateKey
      log('info', `Authenticating as ${server.username} with the stored key`)
    } else {
      reject(new Error(`No key installed for ${server.name}, and no password given.`))
      return
    }

    // Servers that answer password auth via keyboard-interactive send a prompt
    // list instead; reply with the same password rather than failing the attempt.
    client.on(
      'keyboard-interactive',
      (_n, _i, _l, prompts: unknown[], finish: (answers: string[]) => void) => {
        log('debug', `Server asked ${prompts.length} keyboard-interactive prompt(s)`)
        finish(prompts.map(() => opts.password ?? ''))
      },
    )

    client.once('ready', () => {
      log('ok', 'Authenticated')
      resolve(client)
    })

    client.once('error', (err: Error & { level?: string }) => {
      if (rejectedHostKey) {
        reject(
          new Error(
            `Host key verification failed for ${server.host}. If the server was ` +
              'legitimately rebuilt, remove and re-add it to pin the new key.',
          ),
        )
      } else if (err.level === 'client-authentication') {
        reject(
          new Error(
            `Authentication failed for ${server.username}@${server.host} — ` +
              'wrong password, or the server does not allow password logins.',
          ),
        )
      } else if (/timed? ?out/i.test(err.message)) {
        reject(
          new Error(
            `Timed out reaching ${server.host}:${server.port || 22}. ` +
              'Check the host, port, and that sshd is reachable from here.',
          ),
        )
      } else {
        reject(err)
      }
    })

    log('info', `Connecting to ${server.host}:${server.port || 22}`)
    client.connect(config)
  })
}

/**
 * Run one command and collect its output.
 *
 * Never rejects for a command-level problem — a non-zero exit, a timeout, or a
 * refused connection all come back as an `ExecResult`. The tool bridge turns those
 * into a sentence the model can act on, mirroring how Amber's own tool registry
 * converts every failure into a descriptive string rather than an exception.
 */
export async function exec(
  server: ServerConfig,
  command: string,
  timeoutMs = 8_000,
): Promise<ExecResult> {
  let client: Client
  try {
    client = await connect(server, { timeoutMs: Math.min(timeoutMs, 15_000) })
  } catch (err) {
    return { stdout: '', stderr: '', code: null, error: (err as Error).message }
  }

  return new Promise<ExecResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: ExecResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.end()
      resolve(result)
    }

    const timer = setTimeout(
      () =>
        finish({
          stdout,
          stderr,
          code: null,
          error: `Timed out after ${Math.round(timeoutMs / 1000)}s.`,
        }),
      timeoutMs,
    )

    client.exec(command, (err, stream: ClientChannel) => {
      if (err) {
        finish({ stdout: '', stderr: '', code: null, error: err.message })
        return
      }
      // Close stdin immediately. Nothing here ever writes to it, and a remote
      // command that reads stdin would otherwise wait for an EOF that never comes.
      stream.end()
      stream.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
      })
      stream.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
      })
      stream.on('close', (code: number | null) =>
        finish({
          stdout: stdout.slice(0, MAX_OUTPUT),
          stderr: stderr.slice(0, MAX_OUTPUT),
          code,
        }),
      )
    })
  })
}

// --- interactive shells -----------------------------------------------------

interface Shell {
  client: Client
  stream: ClientChannel
}

const shells = new Map<string, Shell>()

/**
 * Open an interactive pty and stream it to the renderer. Same connection machinery
 * as `exec` — one code path serves both the human terminal and Amber's tool calls.
 */
export async function openShell(
  id: string,
  server: ServerConfig,
  onData: (data: string) => void,
  onClose: () => void,
): Promise<void> {
  const client = await connect(server)
  await new Promise<void>((resolve, reject) => {
    client.shell({ term: 'xterm-256color' }, (err, stream) => {
      if (err) {
        client.end()
        reject(err)
        return
      }
      shells.set(id, { client, stream })
      stream.on('data', (chunk: Buffer) => onData(chunk.toString('utf8')))
      stream.stderr.on('data', (chunk: Buffer) => onData(chunk.toString('utf8')))
      stream.on('close', () => {
        closeShell(id)
        onClose()
      })
      resolve()
    })
  })
}

export function writeShell(id: string, data: string): void {
  shells.get(id)?.stream.write(data)
}

export function resizeShell(id: string, cols: number, rows: number): void {
  shells.get(id)?.stream.setWindow(rows, cols, 0, 0)
}

export function closeShell(id: string): void {
  const shell = shells.get(id)
  if (!shell) return
  shells.delete(id)
  shell.stream.end()
  shell.client.end()
}

export function closeAllShells(): void {
  for (const id of [...shells.keys()]) closeShell(id)
}
