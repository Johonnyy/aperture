/**
 * Flags for the handful of tools this terminal actually exists to drive.
 *
 * Not an attempt at a completion database — `compgen` and history cover the general
 * case. This table is here for the things you type once a month and never remember:
 * `docker` plumbing, `systemctl`, and above all **amber-infra's own scripts**, whose
 * flags are documented in exactly one `usage()` heredoc on a server you are currently
 * ssh'd into.
 *
 * Keys are matched against the first word, or the first two for tools with a
 * subcommand layer ("docker compose").
 */
export const FLAGS: Record<string, readonly string[]> = {
  docker: [
    'ps', 'logs', 'inspect', 'exec', 'restart', 'stop', 'start', 'pull', 'images',
    'compose', 'system', 'volume', 'network', '--format', '--tail', '-f', '-a',
  ],
  'docker compose': [
    'up', 'down', 'pull', 'restart', 'logs', 'ps', 'config', '-f', '-d',
    '--project-directory', '-q',
  ],
  systemctl: [
    'status', 'start', 'stop', 'restart', 'reload', 'enable', 'disable',
    'daemon-reload', 'list-units', 'is-active', '--now', '--no-pager',
  ],
  journalctl: ['-u', '-f', '-n', '--since', '--until', '--no-pager', '-p', '-b'],
  git: ['status', 'pull', 'push', 'log', 'diff', 'checkout', 'branch', 'fetch', 'reset'],

  // --- amber-infra ---------------------------------------------------------
  'install.sh': [
    '--app', '--domain', '--upstream', '--role', '--image', '--descriptor',
    '--secrets', '--dry-run', '--help',
  ],
  'uninstall.sh': ['--app', '--secrets', '--dry-run', '--help'],
  'rollback.sh': ['--list', '--yes', '--dry-run'],
  'update-amber.sh': ['--dry-run'],
  'migrate-amber-db.sh': ['--dry-run'],
  'status.sh': ['--json', '--secrets'],
  'backup-sqlite.sh': ['--dry-run'],
  yq: ['-r', '-i', '-o=json', '-P'],
}

/**
 * Words that stand in front of the real command and must be looked past.
 *
 * Without this, `sudo bash /opt/amber-infra/install/install.sh --` resolves to `sudo`
 * and offers nothing — which is the exact line this table exists for.
 */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'time', 'nohup', 'exec', 'bash', 'sh', 'command'])

/**
 * The flag table key for the words preceding the token being completed, or null.
 *
 * Matches on the basename, so `/opt/amber-infra/install/install.sh` completes the same
 * as `install.sh` — which is how it is invariably typed after a tab-completed path.
 */
export function flagKeyFor(words: readonly string[]): string | null {
  const real = [...words]
  while (real.length && (WRAPPERS.has(basename(real[0])) || /^[A-Za-z_]\w*=/.test(real[0]))) {
    real.shift()
  }
  if (real.length === 0) return null

  const head = basename(real[0])
  if (real.length > 1) {
    const pair = `${head} ${real[1]}`
    if (pair in FLAGS) return pair
  }
  return head in FLAGS ? head : null
}

function basename(word: string): string {
  const i = word.lastIndexOf('/')
  return i === -1 ? word : word.slice(i + 1)
}
