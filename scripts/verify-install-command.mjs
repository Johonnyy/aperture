/**
 * Runs the generated authorized_keys command against a real POSIX shell.
 *
 * The command this replaces used a heredoc and could hang forever waiting on stdin
 * that never closed. A shell string that "looks right" is exactly the kind of thing
 * that was wrong last time, so this executes it for real: with a scratch HOME, with
 * stdin closed, and under a hard timeout that fails loudly rather than blocking.
 *
 * Run: node scripts/verify-install-command.mjs
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { buildInstallCommand, INSTALL_OK_MARKER } from '../out/verify/authorized-keys.mjs'

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures++
}

/**
 * Find a POSIX shell. `sh` is on PATH almost everywhere except a Windows shell,
 * where Git ships one but does not export it — and running this from PowerShell
 * rather than Git Bash is exactly how it gets missed.
 */
function findShell() {
  const candidates = [
    'sh',
    'C:/Program Files/Git/usr/bin/sh.exe',
    'C:/Program Files/Git/bin/sh.exe',
    'C:/Program Files (x86)/Git/usr/bin/sh.exe',
  ]
  for (const candidate of candidates) {
    if (candidate !== 'sh' && !existsSync(candidate)) continue
    try {
      execFileSync(candidate, ['-c', 'exit 0'], { stdio: 'ignore' })
      return candidate
    } catch {
      // not usable; try the next one
    }
  }
  return null
}

const SHELL = findShell()
if (!SHELL) {
  // Never pass silently: a skipped check that looks like a passing one is worse
  // than a failing one.
  console.error(
    '\nNo POSIX shell found, so the install command could not be executed.\n' +
      'Install Git for Windows, or run this from a shell where `sh` is on PATH.',
  )
  process.exit(1)
}

/**
 * Git's `sh.exe` sits beside its coreutils, but launching it from PowerShell
 * inherits a PATH without them, so `mkdir` and friends come back "command not
 * found". Put the shell's own directory on PATH so it behaves like a real one.
 */
const SHELL_DIR = SHELL === 'sh' ? null : dirname(SHELL)
const SHELL_PATH = SHELL_DIR
  ? `${SHELL_DIR}${delimiter}${process.env.PATH ?? ''}`
  : process.env.PATH

/** Execute with a scratch HOME, stdin closed, and a hard timeout. */
function run(command, home) {
  return new Promise((resolve) => {
    const child = execFile(
      SHELL,
      ['-c', command],
      { env: { ...process.env, HOME: home, PATH: SHELL_PATH }, timeout: 5000 },
      (err, stdout, stderr) =>
        resolve({
          stdout,
          stderr,
          code: err?.code ?? 0,
          // execFile reports a killed process when the timeout fires — that is the
          // exact signature of the hang this command was rewritten to avoid.
          timedOut: Boolean(err?.killed),
        }),
    )
    child.stdin?.end()
  })
}

const KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOwBexampleexampleexampleexampleexample aperture'

const home = mkdtempSync(join(tmpdir(), 'aperture-verify-'))
try {
  console.log('\ninstall command against a real shell')

  const first = await run(buildInstallCommand(KEY), home)
  check('does not hang', !first.timedOut, first.timedOut ? 'killed by timeout' : '')
  check('exits 0', first.code === 0, `code ${first.code} ${first.stderr.trim()}`)
  check(
    'reports the success marker',
    first.stdout.includes(INSTALL_OK_MARKER),
    JSON.stringify(first.stdout.trim()),
  )

  const authorized = join(home, '.ssh', 'authorized_keys')
  const contents = readFileSync(authorized, 'utf8')
  check('wrote the key', contents.includes(KEY))
  check('key is on its own line', contents.split('\n').includes(KEY))
  check('file ends with a newline', contents.endsWith('\n'))

  // A missing trailing newline is the classic way a second key silently corrupts
  // the first one by concatenating onto its line.
  const secondRun = await run(buildInstallCommand(KEY), home)
  const afterRepeat = readFileSync(authorized, 'utf8')
  check('rerunning does not hang', !secondRun.timedOut)
  check(
    'rerunning does not duplicate',
    afterRepeat.split('\n').filter((l) => l === KEY).length === 1,
    `${afterRepeat.split('\n').filter((l) => l === KEY).length} copies`,
  )

  // Permissions matter: sshd ignores authorized_keys when ~/.ssh is too open, and
  // does it silently, which is the worst possible failure mode to debug.
  const mode = (p) => (statSync(p).mode & 0o777).toString(8)
  if (process.platform === 'win32') {
    console.log('  --   permission bits not meaningful on win32, skipped')
  } else {
    check('~/.ssh is 700', mode(join(home, '.ssh')) === '700', mode(join(home, '.ssh')))
    check('authorized_keys is 600', mode(authorized) === '600', mode(authorized))
  }

  // A key whose comment contains a quote must not break out of the shell literal.
  const nasty = `${KEY.split(' ').slice(0, 2).join(' ')} it's a 'quoted' comment`
  const injected = await run(buildInstallCommand(nasty), home)
  check('survives quotes in the comment', injected.code === 0, injected.stderr.trim())
  check(
    'writes the quoted key verbatim',
    readFileSync(authorized, 'utf8').split('\n').includes(nasty),
  )

  // The real prize: prove the *old* heredoc form is the thing that hung, so this
  // test would have caught the bug rather than just describing it.
  const oldForm = [
    'mkdir -p ~/.ssh',
    `grep -qxF '${KEY}' ~/.ssh/authorized_keys || cat >> ~/.ssh/authorized_keys <<'APERTURE_EOF'\n${KEY}\nAPERTURE_EOF`,
  ].join(' && ')
  const legacy = await run(oldForm, mkdtempSync(join(tmpdir(), 'aperture-legacy-')))
  console.log(
    `\n  note  old heredoc form: ${legacy.timedOut ? 'HUNG (killed by timeout)' : `completed, code ${legacy.code}`}`,
  )
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
