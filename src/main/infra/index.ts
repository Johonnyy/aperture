import type { ApertureEvent, ServerConfig } from '../../shared/types'
import { cancelStream, execStream } from '../ssh/ssh-client'
import { ACTIONS, compose, type Params, type Secret } from './actions'
import { readCredential } from '../keys/credential-store'
import { redactCommand } from './redact'
import { classify } from './status'

export { readStatus } from './status'
export { checkReleases } from './release-check'
export { ACTIONS } from './actions'

export interface RunContext {
  emit: (event: ApertureEvent) => void
  /** Suppress `debug` lines, mirroring the key-install log. */
  verbose: boolean
}

/**
 * Run one catalogued action and narrate it.
 *
 * Everything is pushed onto the existing `op` event stream, which means the
 * `OperationLog` dialog built for key installs renders a 12-minute `install.sh` with
 * no new UI at all — live, timestamped, copyable, and honest about which step failed.
 * That reuse is why this file is short.
 */
export async function runAction(
  opId: string,
  server: ServerConfig,
  actionId: string,
  params: Params,
  opts: { dryRun?: boolean; sudoPassword?: string },
  ctx: RunContext,
): Promise<{ ok: boolean; error?: string }> {
  const action = ACTIONS[actionId]
  if (!action) return { ok: false, error: `Unknown action: ${actionId}` }

  let seq = 0
  const log = (
    level: 'info' | 'ok' | 'warn' | 'error' | 'debug',
    message: string,
    detail?: string,
  ): void => {
    if (level === 'debug' && !ctx.verbose) return
    ctx.emit({
      kind: 'op',
      opId,
      entry: { id: `${opId}-${seq++}`, ts: Date.now(), level, message, detail },
    })
  }

  /**
   * The last lines of raw output, kept regardless of verbosity.
   *
   * Most output from apt, git or docker is `debug` and hidden with verbose off — and
   * when something fails, that hidden text is precisely the sentence naming the
   * cause. "Exited with code 127" on its own is the least useful thing this could
   * say, so a failure replays the tail whether or not verbose logging is on.
   */
  const tail: string[] = []

  // A rehearsal that silently ran for real would be the worst bug this file could
  // have, so an action with no `rehearse` form does nothing at all in dry-run and
  // says so. The caller's confirm step is then the only path to a mutation.
  if (opts.dryRun && !action.rehearse) {
    log('warn', `${action.label} cannot be rehearsed — nothing was run. Confirm to go ahead.`)
    ctx.emit({ kind: 'op-done', opId, ok: true })
    return { ok: true }
  }
  const rehearsing = Boolean(opts.dryRun)

  /**
   * Decrypt the credentials this action was asked to fill, here and nowhere else.
   *
   * The renderer sent uids — it cannot send values, because no IPC channel returns
   * one. They are read in this process and handed straight to `build`, which puts each
   * into a quoted heredoc on stdin. They never enter `params`, so they cannot reach
   * the op log, an audit entry, or a rehearsal echo.
   *
   * A credential that cannot be decrypted aborts BEFORE anything runs. Installing with
   * a key silently missing is how you get an app that starts, serves, and 401s on its
   * first real request — the same shape of failure as everything else this release is
   * about.
   */
  const secrets: Secret[] = []
  if (action.resolvesCredentials && params.fills) {
    let requested: Array<{ key: string; uid: string }> = []
    try {
      requested = JSON.parse(params.fills) as Array<{ key: string; uid: string }>
    } catch {
      return { ok: false, error: 'the list of credentials to fill was malformed' }
    }
    for (const { key, uid } of requested) {
      const value = readCredential(uid)
      if (value === null) {
        const error =
          `the saved credential for ${key} cannot be read on this machine — ` +
          're-enter it on the Keys page'
        log('error', error)
        ctx.emit({ kind: 'op-done', opId, ok: false })
        return { ok: false, error }
      }
      secrets.push({ key, value })
    }
    if (secrets.length > 0) {
      log('info', `Filling ${secrets.map((s) => s.key).join(', ')} from saved credentials`)
    }
  }

  // Always `sudo -S -p ''` for an action that needs root, whether or not we have a
  // password. `-S` reads stdin only when sudo actually needs a credential, so this is
  // a no-op under NOPASSWD — and asking first would cost an extra SSH connection to
  // learn something sudo will tell us anyway.
  const command = compose(action, params, {
    dryRun: rehearsing,
    withSudo: action.needsSudo,
    secrets,
  })
  log('info', rehearsing ? `Rehearsing: ${action.label}` : action.label)
  // The exact command, at `debug`, so verbose logging shows precisely what ran —
  // and so a flag this GUI composed wrongly is visible rather than inferred. Every
  // heredoc body is replaced by its length first: those bodies are the values the
  // user typed, `verboseLogging` defaults to on, and this line used to render an API
  // key into the Status Panel the moment you saved one. See `redact.ts`.
  log('debug', redactCommand(command).replace(/^sudo -S -p '' /, 'sudo '))

  let result: { ok: boolean; code?: number | null; error?: string }
  try {
    result = await execStream(opId, server, command, {
      onLine: (line) => {
        const entry = classify(line)
        if (!entry) return
        tail.push(entry.message)
        if (tail.length > TAIL_LINES) tail.shift()
        log(entry.level, entry.message)
      },
      sudoPassword: action.needsSudo ? opts.sudoPassword : undefined,
      timeoutMs: action.timeoutMs,
    })
  } catch (err) {
    result = { ok: false, error: (err as Error).message }
  }

  if (result.ok) {
    log('ok', rehearsing ? 'Rehearsal finished — nothing was changed.' : `${action.label} finished.`)
    ctx.emit({ kind: 'op-done', opId, ok: true })
    return { ok: true }
  }

  // With verbose on, every one of these lines is already in the log in order, so
  // replaying them would just say it twice.
  const error = explain(result.code, result.error)
  log('error', error, !ctx.verbose && tail.length ? tail.join('\n') : undefined)
  ctx.emit({ kind: 'op-done', opId, ok: false, error })
  return { ok: false, error }
}

/** How much raw output to replay when something fails. */
const TAIL_LINES = 25

/**
 * Say what an exit status means.
 *
 * These are the shell's own conventions, and they are worth spelling out because
 * each one points at a different fix: 127 is a missing package, 126 is a permission
 * or a missing shebang, 130 is you.
 */
function explain(code: number | null | undefined, fallback?: string): string {
  switch (code) {
    case 126:
      return 'Exit 126 — a command was found but could not be run (not executable, or a bad shebang).'
    case 127:
      return 'Exit 127 — a command the script needs is not installed, or is not on root’s PATH. The output below names it.'
    case 130:
      return 'Exit 130 — interrupted.'
    case 137:
      return 'Exit 137 — killed (SIGKILL). Either cancelled here, or the box ran out of memory.'
    case 143:
      return 'Exit 143 — terminated (SIGTERM).'
    case 255:
      return 'Exit 255 — the SSH connection itself failed.'
    case null:
    case undefined:
      return fallback ?? 'The command did not finish.'
    default:
      return `Exit ${code}${fallback && !/^Exited with code/.test(fallback) ? ` — ${fallback}` : ''}.`
  }
}

export function cancelAction(opId: string): boolean {
  return cancelStream(opId)
}
