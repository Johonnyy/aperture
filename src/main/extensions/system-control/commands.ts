/**
 * The commands that power this machine down, as `{file, args}` — never as a string.
 *
 * This module is pure on purpose: no `child_process`, no Electron, no Node API beyond
 * types. `verify:devices` bundles it and exercises every platform, which is the only way
 * to test a Windows shutdown command without shutting down a Windows machine.
 *
 * ## Never build a shell string
 *
 * `src/main/infra/actions.ts` has a `q()` helper that does POSIX `'…'` quoting. It is
 * correct there and **wrong here**: PowerShell escapes an apostrophe by doubling it
 * (`''`), and `cmd.exe` doesn't honour single quotes at all, so a value passed through
 * `q()` into a Windows command line is mis-escaped in exactly the cases that matter — an
 * apostrophe in a path, a `$` in a name.
 *
 * The fix is not a better quoter. `execFile(file, args)` with no `shell` option hands
 * argv straight to the OS and nothing parses anything, so there is nothing to quote.
 * Hence this return type, and hence the rule for everything under `src/main/extensions/`:
 * **no `exec`, no `shell: true`, no template-built command strings.** None of the
 * actions here interpolate user input at all; the rule is what keeps that true when one
 * eventually does.
 *
 * ## Two Windows details, both load-bearing
 *
 * `/f` is **deliberately omitted** from `shutdown`. It force-closes applications with
 * unsaved work, and a shutdown that can be reached by a misheard sentence must not be
 * the kind that loses a document. Without it Windows lets a blocking app cancel the
 * shutdown, which is the correct outcome.
 *
 * `/t 5` is not politeness. The action has to answer Amber *before* the machine goes, or
 * every shutdown looks like a timeout to the model and it says something wrong about
 * what happened. Five seconds is enough for the `tool_result` to reach the socket.
 *
 * And the caveat we ship rather than hide: on Windows there is no reliable built-in
 * "sleep, definitely not hibernate". `SetSuspendState` hibernates whenever hibernation
 * is enabled, and the only fix (`powercfg -h off`) needs admin and permanently changes
 * the machine's configuration, which Aperture has no business doing.
 *
 * This is **confirmed on Johnny's desktop**, not hypothetical: `powercfg /a` there
 * reports Hibernate available, Fast Startup on, and S1-S3 unavailable because the
 * machine uses S0 modern standby. So `power.sleep` hibernates it. There is no better
 * non-admin call — the .NET `Application.SetSuspendState` route has exactly the same
 * behaviour — so the manifest description states it outright and the model is told to
 * say so rather than claim the machine slept. Don't re-investigate this; the answer is
 * "no", and the honest description is the fix.
 */

import type { TargetPlatform } from '../../../shared/extensions'

export interface Command {
  file: string
  args: string[]
}

/** Seconds Windows waits before going down — the window the reply has to get out in. */
export const SHUTDOWN_DELAY_S = 5

export class UnsupportedPlatformError extends Error {
  constructor(action: string, platform: string) {
    super(`${action} is not supported on ${platform}`)
    this.name = 'UnsupportedPlatformError'
  }
}

export function shutdownCommand(platform: TargetPlatform): Command {
  switch (platform) {
    case 'win32':
      // No `/f`. See the module docstring — this is the difference between a shutdown
      // that respects unsaved work and one that discards it.
      return { file: 'shutdown.exe', args: ['/s', '/t', String(SHUTDOWN_DELAY_S)] }
    case 'darwin':
      return {
        file: 'osascript',
        args: ['-e', 'tell application "System Events" to shut down'],
      }
    case 'linux':
      return { file: 'systemctl', args: ['poweroff'] }
    default:
      // Exhaustive today; explicit so a new platform is a loud failure rather than
      // silently inheriting whichever branch happened to be last.
      throw new UnsupportedPlatformError('shutdown', platform)
  }
}

export function sleepCommand(platform: TargetPlatform): Command {
  switch (platform) {
    case 'win32':
      return {
        file: 'rundll32.exe',
        args: ['powrprof.dll,SetSuspendState', '0,1,0'],
      }
    case 'darwin':
      // `pmset sleepnow` rather than osascript: it is the direct call, needs no
      // Automation permission prompt, and cannot be intercepted by a dialog.
      return { file: 'pmset', args: ['sleepnow'] }
    case 'linux':
      return { file: 'systemctl', args: ['suspend'] }
    default:
      throw new UnsupportedPlatformError('sleep', platform)
  }
}

/** The **power** actions, asserted against the manifest by `verify:extensions` so a
 *  declared power action can never lack a command. Audio and process actions live in
 *  their own modules and carry their own lists, for the same reason. */
export const POWER_ACTIONS = ['power.sleep', 'power.shutdown'] as const

export function commandFor(
  action: (typeof POWER_ACTIONS)[number],
  platform: TargetPlatform,
): Command {
  return action === 'power.shutdown' ? shutdownCommand(platform) : sleepCommand(platform)
}
