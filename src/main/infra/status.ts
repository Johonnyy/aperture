import { EXPECTED_SCHEMA, type InfraStatus, type OpLogLevel, type ServerConfig } from '../../shared/types'
import { execStream } from '../ssh/ssh-client'
import { INFRA_ROOT, q } from './actions'

const STATUS_SCRIPT = `${INFRA_ROOT}/deploy/status.sh`

/**
 * Colour codes from `common.sh`. Stripped before classification and before display —
 * the palette is for a human watching a terminal, and this log renders its own.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g

/**
 * Map one line of script output onto an operation-log level.
 *
 * The prefixes come straight from `install/lib/common.sh`: `step` prints `==>`, `ok`
 * prints ` ok`, `warn` prints ` ! `, `die` prints `error:`, and `run` under a dry run
 * prints `dry-run`. Anything else is the underlying tool talking — apt, docker, curl —
 * which is `debug`, so it is hidden unless verbose logging is on, exactly like the
 * key-install log.
 */
export function classify(raw: string): { level: OpLogLevel; message: string } | null {
  const line = raw.replace(ANSI, '').replace(/\r/g, '').trimEnd()
  if (!line.trim()) return null

  if (line.startsWith('==> ')) return { level: 'info', message: line.slice(4) }
  if (line.startsWith(' ok ')) return { level: 'ok', message: line.slice(4) }
  if (line.startsWith(' ! ')) return { level: 'warn', message: line.slice(3) }
  if (line.startsWith('error: ')) return { level: 'error', message: line.slice(7) }
  if (/^\s*dry-run /.test(line)) return { level: 'warn', message: line.trim() }
  // Lines the underlying tools use to report a failure. Promoted out of `debug` so
  // they are visible with verbose logging off — the whole reason to look at this log
  // is to find out what went wrong, and hiding the sentence that says so is absurd.
  if (TOOL_ERROR.test(line)) return { level: 'error', message: line.trim() }
  return { level: 'debug', message: line }
}

/**
 * Conservative on purpose. A false positive here paints a normal line red, which is
 * merely noisy; the tail replay in `runAction` is what guarantees nothing is lost,
 * so this only needs to catch the common cases rather than every one.
 */
const TOOL_ERROR =
  /(command not found|not found in PATH|No such file or directory|Permission denied|^fatal:|^E: |^Err: |^sudo: |Cannot connect to the Docker daemon|Unable to locate package|is not in the sudoers file)/i

const EMPTY: InfraStatus = {
  installed: false,
  schema: 0,
  repoRoot: null,
  commit: null,
  role: null,
  primaryDomain: null,
  docker: null,
  compose: null,
  secretsReadable: false,
  tools: { git: false, jq: false, yq: false, docker: false },
  secrets: {
    present: false,
    readable: false,
    path: '/etc/amber-infra/secrets.yaml',
    acmeEmailSet: false,
    placeholders: { generatable: [], manual: [] },
  },
  settings: { acmeEmail: null, primaryDomain: null, timezone: null, role: null },
  hostServices: { port80: null, port443: null, caddyContainer: false, units: [] },
  serverLabel: null,
  catalogue: [],
  dns: { publicIp: null, records: [] },
  apps: [],
  caddy: { running: false, health: 'missing', sites: [] },
  syncStore: { url: null, reachable: false, servers: [], containerState: 'missing', detail: null },
  history: [],
  backups: { target: null, count: 0, newest: null },
  warnings: [],
}

/**
 * Read the box's state.
 *
 * One round trip answers both questions the Servers tab has: *is amber-infra here*,
 * and if so *what does it say*. When it is not here the same command reports which
 * prerequisites exist, because the next screen the user sees is the bootstrap card
 * and it needs exactly that.
 *
 * Runs under sudo when it can — `secrets.yaml` is 0600 root, and without it the
 * report degrades to what Docker alone knows rather than failing.
 */
export async function readStatus(
  opId: string,
  server: ServerConfig,
  sudoPassword?: string,
): Promise<{
  ok: boolean
  status?: InfraStatus
  /** Whether this account can sudo without being asked — drives the password prompt. */
  passwordlessSudo?: boolean
  error?: string
}> {
  // One connection answers everything: whether sudo is free, whether amber-infra is
  // here, what it says, and which prerequisites exist if it is not. Each `execStream`
  // dials a fresh SSH connection, so asking these as separate questions would triple
  // the cost of every refresh.
  const probe = [
    'SUDO=;',
    'if sudo -n true 2>/dev/null; then SUDO="sudo -n"; echo SUDO_OK; fi;',
    `if [ -f ${q(STATUS_SCRIPT)} ]; then $SUDO bash ${q(STATUS_SCRIPT)} --json;`,
    'else echo NOT_INSTALLED;',
    'command -v git >/dev/null && echo HAS_git;',
    'command -v docker >/dev/null && echo HAS_docker;',
    `[ -d ${q(INFRA_ROOT)} ] && echo HAS_dir; true; fi`,
  ].join(' ')

  // With a password we are already root for the whole probe, so the inner `sudo -n`
  // simply succeeds and $SUDO is a no-op.
  const command = sudoPassword ? `sudo -S -p '' bash -lc ${q(probe)}` : `bash -lc ${q(probe)}`

  const lines: string[] = []
  const result = await execStream(opId, server, command, {
    onLine: (line) => lines.push(line.replace(ANSI, '').replace(/\r/g, '')),
    sudoPassword,
    timeoutMs: 60_000,
  })

  const passwordlessSudo = lines.includes('SUDO_OK')

  if (lines.includes('NOT_INSTALLED')) {
    const has = (name: string): boolean => lines.includes(`HAS_${name}`)
    return {
      ok: true,
      passwordlessSudo,
      status: {
        ...EMPTY,
        docker: has('docker') ? 'present' : null,
        tools: { ...EMPTY.tools, git: has('git'), docker: has('docker') },
        warnings: [
          `amber-infra is not installed at ${INFRA_ROOT}.`,
          has('git') ? 'git is present.' : 'git is missing — install it first: apt install git.',
          has('docker') ? 'docker is present.' : 'docker is missing — install.sh installs it.',
          has('dir')
            ? `${INFRA_ROOT} exists but has no deploy/status.sh — an old or partial checkout.`
            : '',
        ].filter(Boolean),
      },
    }
  }

  // A login shell can print a banner or an MOTD before the document. Not our problem
  // to prevent, only to skip.
  const start = lines.findIndex((l) => l.trim().startsWith('{'))
  if (start === -1) {
    return {
      ok: false,
      passwordlessSudo,
      error: sudoHint(lines, result.error ?? 'status.sh produced no JSON.'),
    }
  }

  try {
    const parsed = JSON.parse(lines.slice(start).join('\n')) as Partial<InfraStatus>
    const status: InfraStatus = { ...EMPTY, ...parsed, installed: true }
    if (status.schema < EXPECTED_SCHEMA) {
      // Say it in the document rather than letting the UI infer it from a pile of
      // false capabilities. Everything below this line is unreliable and the reader
      // needs to know that before it acts on any of it.
      status.warnings = [
        `deploy/status.sh on this box reports schema ${status.schema || 'none'}, but this ` +
          `build of Aperture expects ${EXPECTED_SCHEMA}. Fields it does not emit read as ` +
          'absent, so anything below may be wrong. Update the checkout.',
        ...status.warnings,
      ]
    }
    return { ok: true, passwordlessSudo, status }
  } catch (err) {
    return {
      ok: false,
      passwordlessSudo,
      error: `Could not parse status.sh output: ${(err as Error).message}`,
    }
  }
}

/**
 * Turn sudo's own refusal into the sentence that names the fix.
 *
 * "Exited with code 1" after a wrong password is the least useful thing this could
 * say, and it is what you get without this.
 */
function sudoHint(lines: string[], fallback?: string): string {
  const text = lines.join('\n')
  if (/incorrect password|Sorry, try again|sudo: no password was provided/i.test(text)) {
    return 'sudo rejected the password.'
  }
  if (/is not in the sudoers file/i.test(text)) {
    return 'This account is not allowed to run sudo on that box.'
  }
  if (/a terminal is required|no tty present/i.test(text)) {
    return 'sudo on that box is configured to require a terminal (requiretty), which blocks non-interactive use.'
  }
  return [fallback, lines.slice(-3).join('\n')].filter(Boolean).join('\n')
}
