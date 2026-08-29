/**
 * Opening and closing TouchDesigner itself.
 *
 * Pure command construction, like `system-control/commands.ts` and `apps.ts`, so the
 * shell-metacharacter canary in verify can sweep the argv this produces.
 *
 * ## Why launching needs `spawn` and not the shared `run()` helper
 *
 * `run()` in `handlers.ts` passes `timeout: ctx.timeoutMs` to `execFile` and awaits the
 * process exiting. Both are right for `taskkill` and wrong for TouchDesigner: it would
 * **kill the application five seconds after starting it**, and buffer the stdout of
 * something meant to run all evening. So the launch path spawns detached and unrefs.
 *
 * That is a deliberate, narrow amendment to the argv rule, not a hole in it. The rule's
 * content is *no shell, no `shell: true`, no interpolated command string* — see
 * `system-control/commands.ts` — and `spawn(file, argv)` satisfies all three exactly as
 * `execFile(file, argv)` does. The only thing that changes is who waits for the exit.
 *
 * ## Why launching needs an executable path at all
 *
 * `shell.openPath` cannot pass arguments, so it can open a `.toe` through its file
 * association but cannot open a *specific* TouchDesigner build with a chosen project.
 * Both routes are kept: the association when no executable is configured, argv when one
 * is. `system-control/apps.ts` already explains why launch-by-name is not on offer.
 */

import type { TargetPlatform } from '../../../shared/extensions'
import { UnsupportedPlatformError, type Command } from '../system-control/commands'

/**
 * The executable name `process.close` targets when none is configured.
 *
 * Guessing is safe here in a way it would not be for an arbitrary app: this extension is
 * TouchDesigner-specific, and these are the names it installs under. A configured value
 * always wins, for a portable install or a renamed build.
 */
export function tdProcessName(platform: TargetPlatform): string {
  switch (platform) {
    case 'win32':
      return 'TouchDesigner.exe'
    case 'darwin':
      return 'TouchDesigner'
    default:
      throw new UnsupportedPlatformError('close TouchDesigner', platform)
  }
}

/** argv, always. The project path is an argument, never part of a command string. */
export function launchCommand(executablePath: string, projectPath: string): Command {
  return { file: executablePath, args: projectPath ? [projectPath] : [] }
}
