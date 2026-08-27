/**
 * What each declared action actually does.
 *
 * The table is typed `Record<ImplementedKey, ActionHandler>`, so a missing handler and a
 * stray one are both `tsc` errors. `verify:extensions` closes the other half by asserting
 * `IMPLEMENTED` equals the manifest key set — together: manifest ⟺ IMPLEMENTED ⟺
 * handlers, with no runtime reflection and nothing for the verify script to import from
 * Electron.
 *
 * ## `after`, and why a shutdown needs it
 *
 * A handler that powers the machine down cannot answer once it has run. So the result may
 * carry an `after` callback: the bridge sends `tool_result` **first** and calls it
 * second. Combined with Windows' `/t 5` delay that is what stops every shutdown looking
 * like a timeout to the model — which would make it say something confidently wrong about
 * whether anything happened.
 *
 * ## `ctx`
 *
 * Handlers take `(args, ctx)` from day one even though `ctx` carries little today. The
 * permission model is declare-and-display right now (see `grants.ts`); making it real
 * means moving `child_process` and the key vault behind capability objects on `ctx`. If
 * handlers already take it, that change is deleting direct imports rather than reshaping
 * every signature.
 */

import { execFile } from 'node:child_process'
import { shell } from 'electron'

import type { AudioState } from '../../shared/audio-state'
import type { TargetPlatform } from '../../shared/extensions'
import { appendAudit, getServer, listServers } from '../config'
import { exec } from '../ssh/ssh-client'
import type { ImplementedKey } from './index'
import {
  clampVolume,
  describeAudio,
  getVolumeCommand,
  parseAudioState,
  setVolumeCommand,
} from './system-control/audio'
import { closeAppCommand, listAppsCommand, parseApps } from './system-control/apps'
import { commandFor, UnsupportedPlatformError } from './system-control/commands'

export interface ActionContext {
  /** Which platform we are actually running on. */
  platform: TargetPlatform
  /** Ceiling for this dispatch, from the manifest. */
  timeoutMs: number
  /** Correlates with the `tool_call` that asked, for the audit trail. */
  callId: string
}

export interface ActionResult {
  message: string
  isError?: boolean
  /** Run *after* the reply is on the wire. See the module docstring. */
  after?: () => void
}

export type ActionHandler = (
  args: Record<string, unknown>,
  ctx: ActionContext,
) => Promise<ActionResult>

/**
 * Run one OS command with **argv, never a shell**.
 *
 * No `shell: true`, no interpolated string: `execFile` hands the array straight to the
 * OS, so there is nothing to quote and no quoting bug to have. See
 * `system-control/commands.ts` for why that rule exists rather than a better quoter.
 */
function run(
  file: string,
  args: string[],
  timeoutMs: number,
  extraEnv?: Record<string, string>,
): Promise<{ ok: boolean; output: string; detail: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        // The only way a value ever reaches the Windows audio script — it stays a
        // module constant and reads its input from here, so there is nothing to quote.
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      },
      (error, stdout, stderr) => {
        const output = String(stdout ?? '').trim()
        if (error) {
          resolve({
            ok: false,
            output,
            detail: String(stderr ?? '').trim() || error.message,
          })
          return
        }
        resolve({ ok: true, output, detail: '' })
      },
    )
  })
}

/** Build a command, turning an unsupported platform into a result rather than a throw. */
function build<T>(make: () => T): { value: T } | { error: ActionResult } {
  try {
    return { value: make() }
  } catch (error) {
    if (error instanceof UnsupportedPlatformError) {
      return { error: { message: error.message, isError: true } }
    }
    throw error
  }
}

/** Both power actions are the same shape; only the command and the wording differ. */
function powerAction(
  key: 'power.sleep' | 'power.shutdown',
  spoken: string,
): ActionHandler {
  return async (_args, ctx) => {
    const built = build(() => commandFor(key, ctx.platform))
    if ('error' in built) return built.error
    const command = built.value

    // Answer first, act second. The reply cannot survive the machine going down, and a
    // silent timeout would leave the model guessing about what it just did.
    return {
      message: spoken,
      after: () => {
        execFile(
          command.file,
          command.args,
          { timeout: ctx.timeoutMs, windowsHide: true },
          () => {
            // Nothing to report to: the answer is already sent, and on success this
            // process is about to stop existing.
          },
        )
      },
    }
  }
}

/**
 * The level this machine was at before it was muted.
 *
 * In memory rather than on disk, and that is a judgement rather than an oversight: it is
 * only meaningful while a mute is in effect, and a mute that survived a restart of
 * Aperture would be a machine sitting silently with no visible reason. If the process
 * does restart while muted, unmuting lands on `DEFAULT_UNMUTE_LEVEL` — audible, modest,
 * and obviously a fallback rather than a value anyone chose.
 */
let levelBeforeMute: number | null = null
const DEFAULT_UNMUTE_LEVEL = 30

async function readLevel(ctx: ActionContext): Promise<number | null> {
  const built = build(() => getVolumeCommand(ctx.platform))
  if ('error' in built) return null
  const { file, args, env } = built.value
  const result = await run(file, args, ctx.timeoutMs, env)
  return result.ok ? parseAudioState(result.output).level : null
}

async function writeLevel(
  ctx: ActionContext,
  level: number,
): Promise<{ ok: boolean; state: AudioState; detail: string }> {
  const built = build(() => setVolumeCommand(ctx.platform, level))
  if ('error' in built) return { ok: false, state: { level: null }, detail: built.error.message }
  const { file, args, env } = built.value
  const result = await run(file, args, ctx.timeoutMs, env)
  return { ok: result.ok, state: parseAudioState(result.output), detail: result.detail }
}

export const HANDLERS: Record<ImplementedKey, ActionHandler> = {
  'ssh-terminal.run_command': async (args, ctx) => {
    const command = String(args.command ?? '').trim()
    const serverName = String(args.server ?? '').trim()
    if (!command) return { message: 'Error: no command was given.', isError: true }

    const server = getServer(serverName)
    if (!server) {
      const known = listServers().map((s) => s.name).join(', ') || 'none configured'
      return {
        message: `Error: there is no server called "${serverName}". Known servers: ${known}.`,
        isError: true,
      }
    }

    const started = Date.now()
    const result = await exec(server, command, ctx.timeoutMs)
    appendAudit({
      id: ctx.callId,
      ts: started,
      server: server.name,
      command,
      outcome: result.error ? 'error' : 'auto',
      durationMs: Date.now() - started,
      exitCode: result.code ?? undefined,
    })
    return { message: formatExec(result), isError: Boolean(result.error) }
  },

  'system-control.power.sleep': powerAction(
    'power.sleep',
    'Putting this machine to sleep now.',
  ),
  'system-control.power.shutdown': powerAction(
    'power.shutdown',
    `Shutting this machine down in a few seconds. Anything with unsaved work can still ` +
      `stop it — nothing is being force-closed.`,
  ),

  'system-control.audio.get_volume': async (_args, ctx) => {
    // A reading we couldn't parse is reported as unreadable rather than guessed at — a
    // confident wrong percentage is worse than admitting the read failed, and the panel
    // shows a dash rather than parking its slider at zero, which would look like silence.
    const level = await readLevel(ctx)
    return level === null
      ? { message: `Couldn't read the volume.`, isError: true }
      : { message: describeAudio({ level }) }
  },

  'system-control.audio.set_volume': async (args, ctx) => {
    const level = clampVolume(args.level)
    const wrote = await writeLevel(ctx, level)
    if (!wrote.ok) {
      return { message: `Couldn't set the volume: ${wrote.detail}`, isError: true }
    }
    // Moving the slider away from zero is an unmute, so the remembered level is spent —
    // otherwise a later unmute would jump back to a value from before you last adjusted it.
    if (level > 0) levelBeforeMute = null
    // Every platform's set command re-reports the resulting level, so the answer says
    // what is true now rather than what was asked for. Those differ more often than you
    // would think: a clamped value, or a device that quantises to steps.
    return { message: describeAudio(wrote.state.level === null ? { level } : wrote.state) }
  },

  /**
   * Mute is **level zero**, not the OS mute flag.
   *
   * The flag was a second source of truth for one question, and the two could disagree:
   * volume 67 and silence, or volume 0 reported as "not muted". It also had to be read
   * back three different ways per platform, and Linux does not report it at all. Setting
   * the level to zero has none of that: one value, one control, and the slider and the
   * speaker button cannot contradict each other because they read the same number.
   *
   * The cost is that unmuting has to remember where the level was, which is what
   * `levelBeforeMute` is for.
   */
  'system-control.audio.mute': async (args, ctx) => {
    const muted = Boolean(args.muted)

    if (muted) {
      // Read first: muting has to know what to come back to. A failed read is not fatal
      // — better to mute and restore to the fallback than to refuse to mute at all.
      const current = await readLevel(ctx)
      if (current !== null && current > 0) levelBeforeMute = current
      const wrote = await writeLevel(ctx, 0)
      return wrote.ok
        ? { message: 'Muted.' }
        : { message: `Couldn't mute: ${wrote.detail}`, isError: true }
    }

    const restore = levelBeforeMute ?? DEFAULT_UNMUTE_LEVEL
    const wrote = await writeLevel(ctx, restore)
    if (!wrote.ok) {
      return { message: `Couldn't unmute: ${wrote.detail}`, isError: true }
    }
    levelBeforeMute = null
    return { message: describeAudio(wrote.state.level === null ? { level: restore } : wrote.state) }
  },

  'system-control.process.list': async (_args, ctx) => {
    const built = build(() => listAppsCommand(ctx.platform))
    if ('error' in built) return built.error
    const { file, args } = built.value
    const result = await run(file, args, ctx.timeoutMs)
    if (!result.ok) return { message: `Couldn't list processes: ${result.detail}`, isError: true }
    const apps = parseApps(ctx.platform, result.output)
    return apps.length
      ? { message: `Running: ${apps.join(', ')}.` }
      : { message: 'Nothing readable is running.' }
  },

  'system-control.process.close': async (args, ctx) => {
    const name = String(args.name ?? '').trim()
    if (!name) return { message: 'Error: no application name was given.', isError: true }
    const built = build(() => closeAppCommand(ctx.platform, name))
    if ('error' in built) return built.error
    const { file, args: argv } = built.value
    // `name` goes straight into argv with no shell anywhere, so a hostile-looking value
    // is just a process name that matches nothing. That is what the argv rule buys.
    const result = await run(file, argv, ctx.timeoutMs)
    return result.ok
      ? { message: `Asked ${name} to close.` }
      : {
          message:
            `Couldn't close ${name} — it may not be running, or it refused. ` +
            `Nothing was force-closed. (${result.detail})`,
          isError: true,
        }
  },

  'system-control.process.launch': async (args) => {
    const path = String(args.path ?? '').trim()
    if (!path) return { message: 'Error: no path was given.', isError: true }
    // Electron's own opener rather than a spawn: it honours the OS file associations, so
    // this works for a document as well as an executable, and it takes a path rather than
    // a command line — there is no argument string to get wrong.
    const failure = await shell.openPath(path)
    return failure
      ? { message: `Couldn't open ${path}: ${failure}`, isError: true }
      : { message: `Opened ${path}.` }
  },
}

/** Render an exec result as prose the model can reason about. */
function formatExec(result: {
  stdout: string
  stderr: string
  code: number | null
  error?: string
}): string {
  if (result.error) return `The command could not be run: ${result.error}`
  const parts: string[] = []
  if (result.stdout.trim()) parts.push(result.stdout.trim())
  if (result.stderr.trim()) parts.push(`[stderr]\n${result.stderr.trim()}`)
  if (result.code !== 0) parts.push(`[exited with code ${result.code}]`)
  return parts.join('\n\n') || '(the command produced no output)'
}

