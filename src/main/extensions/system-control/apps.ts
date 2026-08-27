/**
 * Listing and closing applications, and launching one from a path.
 *
 * Pure command construction, like `commands.ts` and `audio.ts`.
 *
 * ## `process.close` takes a name from the model, and that is fine
 *
 * The name goes straight into argv via `execFile`, with no shell anywhere, so a name
 * containing `; rm -rf /` is simply a process name that matches nothing. This is exactly
 * what the argv rule buys: the dangerous-looking case needs no sanitising because there
 * is no parser to fool. It is *not* fine the moment someone reintroduces a shell, which
 * is why `verify:devices` has a metacharacter canary.
 *
 * ## Why there is no launch-by-name
 *
 * Launching "Spotify" by name is a genuinely unsolved per-platform problem: on Windows
 * most GUI apps are not on `PATH` and live in the App Paths registry, which only
 * `cmd /c start` consults — and `cmd` re-parses its arguments, which would reintroduce
 * the injection surface argv removes. So `process.launch` takes a **path**, opened
 * through Electron's own `shell.openPath`, and its description says so. A `launch` that
 * quietly only worked for things on `PATH` would be the kind of half-truth this build
 * avoids, and the path form is what TouchDesigner will want anyway.
 */

import type { TargetPlatform } from '../../../shared/extensions'
import { UnsupportedPlatformError, type Command } from './commands'

export function listAppsCommand(platform: TargetPlatform): Command {
  switch (platform) {
    case 'win32':
      // Only windowed processes: the full list is ~300 rows of services nobody means
      // when they say "what's running".
      return {
        file: 'tasklist.exe',
        args: ['/fi', 'STATUS eq RUNNING', '/fo', 'csv', '/nh'],
      }
    case 'darwin':
      return { file: 'ps', args: ['-Ao', 'comm='] }
    case 'linux':
      return { file: 'ps', args: ['-eo', 'comm='] }
    default:
      throw new UnsupportedPlatformError('list applications', platform)
  }
}

export function closeAppCommand(platform: TargetPlatform, name: string): Command {
  switch (platform) {
    case 'win32':
      // No `/f`, for the same reason `shutdown` has none: a close that discards unsaved
      // work should never be one sentence away.
      return { file: 'taskkill.exe', args: ['/im', name] }
    case 'darwin':
    case 'linux':
      // SIGTERM, not SIGKILL — same argument.
      return { file: 'pkill', args: ['-x', name] }
    default:
      throw new UnsupportedPlatformError('close an application', platform)
  }
}

/**
 * Reduce raw process output to a short, readable list.
 *
 * Deduped and capped, because the honest answer to "what's running" is a dozen names, and
 * three hundred rows of output would be clamped mid-word by Amber's result limit anyway —
 * truncating here means the list ends at a name rather than in the middle of one.
 */
export function parseApps(platform: TargetPlatform, output: string, limit = 40): string[] {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const names = lines.map((line) => {
    if (platform !== 'win32') return basename(line)
    // tasklist csv: "name.exe","pid","session",…  — the first quoted field.
    const match = line.match(/^"([^"]+)"/)
    return match ? match[1] : line
  })
  return [...new Set(names)].filter(Boolean).sort().slice(0, limit)
}

function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}
