import type { ExecResult } from '../../../shared/types'

/** Runs one command on the shell's existing SSH connection. See `execOnShell`. */
export type Exec = (command: string) => Promise<ExecResult>

/** Single-quote for `sh`. The only safe way to interpolate a path we did not write. */
export function q(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const lines = (out: string): string[] =>
  out.split('\n').map((l) => l.trim()).filter(Boolean)

/**
 * Recently run commands, newest first.
 *
 * Read once per shell rather than watched: the file is only written when a shell
 * exits, so re-reading it mid-session would never show anything new. What you typed
 * *this* session is tracked separately, in `Completer`.
 *
 * zsh's extended format prefixes each line with `: <epoch>:<elapsed>;`, which is
 * stripped here so both shells produce the same list.
 */
export async function fetchHistory(exec: Exec): Promise<string[]> {
  const res = await exec(
    'tail -n 2000 ~/.bash_history 2>/dev/null; tail -n 2000 ~/.zsh_history 2>/dev/null',
  )
  if (res.error) return []
  const seen = new Set<string>()
  const out: string[] = []
  // Reversed so the most recent occurrence of a repeated command is the one kept.
  for (const raw of lines(res.stdout).reverse()) {
    const line = raw.replace(/^:\s*\d+:\d+;/, '')
    if (line.length < 2 || seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

/**
 * Every command name on the remote `PATH`, plus builtins, aliases and functions.
 *
 * A login shell (`-l`) is what makes this match what the interactive shell can
 * actually run — a non-login `bash -c` misses everything `/etc/profile.d` adds, which
 * on a deploy box is most of the interesting entries.
 */
export async function fetchCommands(exec: Exec): Promise<string[]> {
  const res = await exec("bash -lc 'compgen -c 2>/dev/null | sort -u | head -n 4000'")
  if (res.error) return []
  return lines(res.stdout).filter((c) => !c.startsWith('-'))
}

/** The shell's starting directory and home, used to resolve relative paths. */
export async function fetchLocation(exec: Exec): Promise<{ cwd: string; home: string }> {
  const res = await exec("bash -lc 'pwd; echo $HOME'")
  const [cwd = '', home = ''] = lines(res.stdout)
  return { cwd: cwd || home || '/', home: home || cwd || '/' }
}

/**
 * Directory entries for completing a path token.
 *
 * `-p` appends a trailing slash to directories, which is both the visual cue and
 * what makes accepting a directory leave the cursor ready to keep descending.
 */
export async function listDir(exec: Exec, cwd: string | null, dir: string): Promise<string[]> {
  const absolute = dir.startsWith('/') || dir.startsWith('~')
  if (!absolute && !cwd) return [] // relative token with no idea where we are
  const prefix = absolute ? '' : `cd ${q(cwd as string)} 2>/dev/null || exit 0; `
  const res = await exec(`bash -lc ${q(`${prefix}ls -1ap -- ${dir || '.'} 2>/dev/null | head -n 500`)}`)
  if (res.error) return []
  return lines(res.stdout).filter((e) => e !== './' && e !== '../')
}
