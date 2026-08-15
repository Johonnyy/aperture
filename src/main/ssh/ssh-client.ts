import { createHash } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
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

// --- streamed commands ------------------------------------------------------

export interface StreamOptions {
  /** Every complete line of output, stdout and stderr interleaved as they arrive. */
  onLine: (line: string) => void
  /**
   * Written once to stdin for a `sudo -S` command. Held only for the duration of
   * this call: never stored, never logged, never echoed back to the renderer.
   */
  sudoPassword?: string
  /** Generous by default — `install.sh` runs apt and waits on ACME. */
  timeoutMs?: number
}

export interface StreamResult {
  ok: boolean
  code: number | null
  error?: string
}

/** Running streamed commands, so a long install can be cancelled from the UI. */
const running = new Map<string, { client: Client; stream: ClientChannel | null }>()

/**
 * Run one long command and narrate it line by line.
 *
 * Distinct from `exec` in the three ways that matter for driving a deploy script:
 * output arrives as it happens rather than at the end, there is no 64KB ceiling or
 * 8-second cap, and it can be cancelled.
 *
 * Deliberately **no pty**. A pty has terminal echo on by default, so the password
 * written to stdin for `sudo -S` would be echoed straight back out and into the
 * operation log. `-S` exists precisely so that no pty is needed; the scripts emit
 * their colour codes unconditionally, so nothing is lost by not having one.
 */
export async function execStream(
  opId: string,
  server: ServerConfig,
  command: string,
  opts: StreamOptions,
): Promise<StreamResult> {
  let client: Client
  try {
    client = await connect(server)
  } catch (err) {
    return { ok: false, code: null, error: (err as Error).message }
  }

  const entry = { client, stream: null as ClientChannel | null }
  running.set(opId, entry)

  return new Promise<StreamResult>((resolve) => {
    const decoder = new StringDecoder('utf8')
    let pending = ''
    let settled = false

    const emit = (chunk: Buffer): void => {
      pending += decoder.write(chunk)
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) opts.onLine(line)
    }

    const finish = (result: StreamResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      running.delete(opId)
      if (pending.trim()) opts.onLine(pending)
      client.end()
      resolve(result)
    }

    const timer = setTimeout(
      () => {
        entry.stream?.signal('KILL')
        finish({ ok: false, code: null, error: 'Timed out.' })
      },
      opts.timeoutMs ?? 30 * 60_000,
    )

    client.exec(command, (err, stream: ClientChannel) => {
      if (err) {
        finish({ ok: false, code: null, error: err.message })
        return
      }
      entry.stream = stream

      // `sudo -S -p ''` reads the password from stdin and prints no prompt, so
      // nothing about it reaches the log. Sent unconditionally when we have one:
      // a command that does not want it simply never reads stdin, and the write is
      // harmless. `end()` closes stdin so anything that *does* read it sees EOF
      // rather than waiting forever.
      if (opts.sudoPassword) stream.write(`${opts.sudoPassword}\n`)
      stream.end()

      stream.on('data', emit)
      stream.stderr.on('data', emit)
      stream.on('close', (code: number | null) =>
        finish({ ok: code === 0, code, error: code === 0 ? undefined : `Exited with code ${code}.` }),
      )
    })
  })
}

/** Kill a streamed command mid-flight. Returns false if it already finished. */
export function cancelStream(opId: string): boolean {
  const entry = running.get(opId)
  if (!entry) return false
  entry.stream?.signal('KILL')
  entry.client.end()
  running.delete(opId)
  return true
}

// --- interactive shells -----------------------------------------------------

/**
 * How long output may sit in the buffer before it is flushed to the renderer.
 *
 * One `htop` repaint or one scrolled screen arrives as a dozen TCP chunks. Sending
 * each as its own IPC message meant a dozen `term.write` calls and a dozen renders
 * for one visual frame. 4ms is under a frame at 144Hz, so coalescing is invisible
 * while collapsing the burst into a single write.
 */
const FLUSH_MS = 4

/** Flush early rather than let one burst grow unboundedly before the timer fires. */
const FLUSH_MAX_CHARS = 64 * 1024

/**
 * Backpressure thresholds, in characters the renderer has not yet parsed.
 *
 * Without this, `yes` (or any runaway command) delivers faster than xterm can parse
 * and the renderer never gets a frame in to handle the Ctrl-C that would stop it —
 * the interrupt is unreachable exactly when it is needed. Pausing the ssh2 stream
 * pushes the backlog onto the TCP window, where it belongs.
 */
const PAUSE_ABOVE = 256 * 1024
const RESUME_BELOW = 64 * 1024

interface Shell {
  client: Client
  stream: ClientChannel
  /**
   * A multi-byte character can be split across TCP chunks. `chunk.toString('utf8')`
   * turns each half into a replacement character; the decoder holds the tail until
   * the rest arrives.
   */
  decoder: StringDecoder
  onData: (data: string) => void
  /** Decoded text not yet sent to the renderer. */
  buffer: string
  timer: NodeJS.Timeout | null
  /** Characters sent to the renderer that xterm has not reported parsing yet. */
  unacked: number
  paused: boolean
}

const shells = new Map<string, Shell>()

function flush(shell: Shell): void {
  if (shell.timer) {
    clearTimeout(shell.timer)
    shell.timer = null
  }
  if (!shell.buffer) return
  const data = shell.buffer
  shell.buffer = ''
  shell.unacked += data.length
  shell.onData(data)
  if (!shell.paused && shell.unacked > PAUSE_ABOVE) {
    shell.paused = true
    shell.stream.pause()
  }
}

function absorb(shell: Shell, chunk: Buffer): void {
  shell.buffer += shell.decoder.write(chunk)
  if (shell.buffer.length >= FLUSH_MAX_CHARS) {
    flush(shell)
    return
  }
  shell.timer ??= setTimeout(() => flush(shell), FLUSH_MS)
}

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
      const shell: Shell = {
        client,
        stream,
        decoder: new StringDecoder('utf8'),
        onData,
        buffer: '',
        timer: null,
        unacked: 0,
        paused: false,
      }
      shells.set(id, shell)
      stream.on('data', (chunk: Buffer) => absorb(shell, chunk))
      stream.stderr.on('data', (chunk: Buffer) => absorb(shell, chunk))
      stream.on('close', () => {
        flush(shell) // never lose the last line to the timer
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

/**
 * The renderer reporting that xterm has finished parsing `chars` characters.
 *
 * The other half of the pause above: a paused stream only resumes because the
 * renderer said it caught up, so a wedged renderer stalls the transfer rather than
 * drowning in it.
 */
export function ackShell(id: string, chars: number): void {
  const shell = shells.get(id)
  if (!shell) return
  shell.unacked = Math.max(0, shell.unacked - chars)
  if (shell.paused && shell.unacked < RESUME_BELOW) {
    shell.paused = false
    shell.stream.resume()
  }
}

export function resizeShell(id: string, cols: number, rows: number): void {
  shells.get(id)?.stream.setWindow(rows, cols, 0, 0)
}

/**
 * Run one command on a shell's *existing* connection.
 *
 * `exec` above dials a fresh connection every call — a full TCP handshake plus key
 * auth. That is fine for a tool call and unusable for completion, which needs an
 * answer between keystrokes. This borrows the authenticated `Client` the shell is
 * already holding, so the cost is one channel open.
 */
export function execOnShell(id: string, command: string, timeoutMs = 4_000): Promise<ExecResult> {
  const shell = shells.get(id)
  if (!shell) return Promise.resolve({ stdout: '', stderr: '', code: null, error: 'No such shell.' })

  return new Promise<ExecResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: ExecResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => finish({ stdout, stderr, code: null, error: 'Timed out.' }), timeoutMs)

    shell.client.exec(command, (err, stream: ClientChannel) => {
      if (err) {
        finish({ stdout: '', stderr: '', code: null, error: err.message })
        return
      }
      stream.end()
      stream.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
      })
      stream.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
      })
      stream.on('close', (code: number | null) =>
        finish({ stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), code }),
      )
    })
  })
}

export function closeShell(id: string): void {
  const shell = shells.get(id)
  if (!shell) return
  shells.delete(id)
  if (shell.timer) clearTimeout(shell.timer)
  shell.stream.end()
  shell.client.end()
}

export function closeAllShells(): void {
  for (const id of [...shells.keys()]) closeShell(id)
}
