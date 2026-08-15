import type { ServerConfig } from '../../shared/types'
import { q } from '../infra/actions'
import { execStream } from '../ssh/ssh-client'
import { parseAdminToken, redact } from './keys'

export { redact } from './keys'

/**
 * Finding Bloom on a box, and reading the credential Aperture needs to drive it.
 *
 * One SSH connection, composed the way `infra/status.ts` composes its probe: each
 * `execStream` dials fresh, so asking two questions separately costs two
 * connections and twice the latency.
 *
 * **This module emits no `op` events, and that is a security property, not a
 * style choice.** `readStatus` and `runAction` push every remote line through
 * `classify()` at `debug` level, and `verboseLogging` defaults to *true* — copy that
 * pattern here and the admin bearer token renders in the Status Panel and in every
 * screenshot of it. Worse, `sudoHint()` returns the last three lines verbatim as its
 * fallback error string, which would put the token straight into a red banner. So
 * output is collected locally, nothing is narrated, and every string that leaves
 * this module goes through `redact()`.
 *
 * The domain is a *parameter*, deliberately. `status.sh` already reports it as
 * `InfraApp.domain` and `InfraView` is holding that object when the user presses the
 * button; grepping `secrets.yaml` for it would be a second, worse YAML parser for a
 * value already in hand. What this probe uniquely provides is the one thing the
 * status document is designed never to carry: `EnvVar.value` is null for secrets
 * precisely so that document stays safe to poll and log.
 */

/** Long enough for a slow box, short enough that a dead one fails while you watch. */
const TIMEOUT_MS = 20_000

/** What amber-infra names the container, and where install.sh renders its env file. */
const CONTAINER = 'bloom'
const ENV_FILE = '/etc/amber-infra/bloom/bloom.env'

export interface DiscoveryResult {
  ok: boolean
  found?: {
    baseUrl: string
    container: string
    /** Empty when the token could not be read — usually sudo, see `needsSudo`. */
    token: string
  }
  /** True when the box grants sudo without a password. */
  passwordlessSudo?: boolean
  /** True when the container was found but the token needs a password to read. */
  needsSudo?: boolean
  error?: string
}

/**
 * Ask a box whether it runs Bloom, and read the admin token if it does.
 *
 * Never throws and never narrates. `domain` comes from the box's own status
 * document; `sudoPassword` is the same transient, per-call value `InfraView` already
 * holds for every other privileged action, and is never stored here or anywhere.
 */
export async function discoverBloom(
  opId: string,
  server: ServerConfig,
  opts: { domain: string; sudoPassword?: string },
): Promise<DiscoveryResult> {
  // Each answer is printed behind a sentinel so the parser never has to guess which
  // line is which — an MOTD, a banner or a sudo notice can appear anywhere.
  //
  // `docker inspect` runs under $SUDO too: a user outside the `docker` group would
  // otherwise report `missing` for a container that is running perfectly well.
  const probe = [
    'SUDO=;',
    'if sudo -n true 2>/dev/null; then SUDO="sudo -n"; echo SUDO_OK; fi;',
    `echo "STATE=$($SUDO docker inspect -f '{{.State.Status}}' ${CONTAINER} 2>/dev/null || echo missing)";`,
    `$SUDO sh -c 'sed -n "s/^BLOOM_ADMIN_KEYS=//p" ${ENV_FILE}' 2>/dev/null | sed 's/^/KEYS=/';`,
    'echo PROBE_DONE',
  ].join(' ')

  const command = opts.sudoPassword
    ? `sudo -S -p '' bash -lc ${q(probe)}`
    : `bash -lc ${q(probe)}`

  // Collected, never emitted. See the module docstring.
  const lines: string[] = []
  let token = ''

  const result = await execStream(opId, server, command, {
    onLine: (raw) => {
      // eslint-disable-next-line no-control-regex
      const line = raw.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '')
      if (line.startsWith('KEYS=')) {
        // Captured here and nowhere else — this line never joins `lines`.
        token = parseAdminToken(line.slice('KEYS='.length))
        return
      }
      lines.push(line)
    },
    sudoPassword: opts.sudoPassword,
    timeoutMs: TIMEOUT_MS,
  })

  const passwordlessSudo = lines.includes('SUDO_OK')

  if (!result.ok && !lines.includes('PROBE_DONE')) {
    return {
      ok: false,
      passwordlessSudo,
      error: redact(hint(lines, result.error)),
    }
  }

  const state = lines.find((l) => l.startsWith('STATE='))?.slice('STATE='.length).trim() ?? 'missing'

  if (state === 'missing') {
    return {
      ok: true,
      passwordlessSudo,
      error: `No container named ${CONTAINER} on ${server.name}. Install it from the Servers tab first.`,
    }
  }

  if (!token) {
    // The container is there, so this is almost always privilege rather than
    // absence — the env file is 0600 root:root by design.
    return {
      ok: true,
      passwordlessSudo,
      needsSudo: true,
      error:
        `Found the ${CONTAINER} container, but could not read its admin key from ` +
        `${ENV_FILE}. That file is root-only, so this needs the sudo password.`,
    }
  }

  const domain = opts.domain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!domain) {
    return {
      ok: false,
      passwordlessSudo,
      error:
        'This box has no domain recorded for Bloom, so there is no address to reach ' +
        'it on. Set apps.bloom.domain in secrets.yaml and re-read the box.',
    }
  }

  return {
    ok: true,
    passwordlessSudo,
    found: { baseUrl: `https://${domain}`, container: state, token },
  }
}

/**
 * Turn a failed probe into a sentence naming the fix.
 *
 * A local copy rather than `status.ts`'s `sudoHint`, for one reason: that one ends
 * by returning the last three lines verbatim, and on this probe those lines can be
 * the token.
 */
function hint(lines: string[], fallback?: string): string {
  const text = lines.join('\n').toLowerCase()
  if (text.includes('incorrect password') || text.includes('sorry, try again')) {
    return 'That sudo password was not accepted.'
  }
  if (text.includes('is not in the sudoers file')) {
    return 'This account cannot use sudo on that box, so the admin key cannot be read.'
  }
  if (text.includes('command not found') && text.includes('docker')) {
    return 'Docker is not installed on that box, so nothing could be running there.'
  }
  return fallback ?? 'Could not read the box.'
}
