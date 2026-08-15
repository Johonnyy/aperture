import {
  EMPTY_BLOOM_LINK,
  type BloomLink,
  type BloomLinkState,
} from '../../shared/bloom'
import type { ApertureEvent, ServerConfig } from '../../shared/types'
import { getBloomRecord, setBloomRecord } from '../config'
import { verifyToken, type BloomTarget } from './client'
import { discoverBloom, redact } from './discover'
import { clearToken, hasToken, isVaultAvailable, readToken, storeToken } from './token-store'

/**
 * Where Aperture stands with Bloom, and how it finds out.
 *
 * Two questions kept apart on purpose. **Discovery** is expensive — SSH, sudo, a
 * box that may be asleep — and only ever happens because a user pressed something.
 * **Visibility** is cheap, local and synchronous, and is what the sidebar reads.
 *
 * So the tab keys off *holding a record*, not off Bloom being up. A stopped
 * container shows the tab with an explanation inside it; hiding the tab would make
 * an outage look like an uninstall and move the fix somewhere the user can no longer
 * reach. Only an explicit unlink returns to `unlinked`.
 *
 * **Nothing here runs SSH at startup.** `connect()` has a 15s ready timeout, so a
 * boot probe against a dead box is a fifteen-second floor before it even begins to
 * fail. The disk answers instantly; a single HTTP check follows, unawaited, and can
 * only ever *demote* — `linked ⇄ unreachable ⇄ unauthorized`. It can never reach
 * `unlinked`, because "your network is down" is not "you uninstalled Bloom".
 */

/** How long the unattended startup check may take before it is simply not news. */
const VERIFY_TIMEOUT_HINT = 'Bloom did not answer.'

export type Emit = (event: ApertureEvent) => void

/**
 * The stored record, plus the two things that must be derived rather than persisted.
 *
 * `hasToken` is read from the vault every time. A stored `true` against ciphertext
 * that no longer decrypts — the documented different-OS-account case — would be a
 * tab that can never work and never says why.
 */
export function getLink(): BloomLink {
  const record = getBloomRecord()
  const token = hasToken()
  return {
    ...record,
    hasToken: token,
    // A record with no readable token is not linked, whatever the file says. This is
    // the one place that can notice a vault that stopped decrypting.
    state: record.state !== 'unlinked' && !token ? 'unauthorized' : record.state,
    detail:
      record.state !== 'unlinked' && !token
        ? 'The stored admin key could not be read. Re-link Bloom from the Servers tab.'
        : record.detail,
  }
}

function save(patch: Partial<BloomLink>): BloomLink {
  // `hasToken` is derived, so it never goes to disk — see `getLink`.
  const { hasToken: _derived, ...persistable } = { ...getBloomRecord(), ...patch }
  setBloomRecord(persistable)
  return getLink()
}

function publish(emit: Emit, link: BloomLink): BloomLink {
  emit({ kind: 'bloom-link', link })
  return link
}

/** The credentials a request needs, or null when there is nothing usable. */
export function currentTarget(): BloomTarget | null {
  const record = getBloomRecord()
  const token = readToken()
  if (!record.baseUrl || token === null) return null
  return { baseUrl: record.baseUrl, token }
}

/**
 * Map a call's outcome onto the link's state. **The only place that mapping lives.**
 *
 * Anywhere else and it drifts: `unauthorized` means the token is wrong and must not
 * be retried, `transport` means Bloom is unreachable and will be, and every other
 * code is one call failing while the link is perfectly healthy. Collapsing those is
 * how a 404 on one agent ends up reporting the whole backend as down.
 */
export function noteResult(
  emit: Emit,
  result: { ok: boolean; code?: string; error?: string },
): void {
  const record = getBloomRecord()
  if (record.state === 'unlinked') return

  let next: BloomLinkState | null = null
  let detail: string | null = null

  if (result.ok) {
    next = 'linked'
  } else if (result.code === 'unauthorized' || result.code === 'forbidden') {
    next = 'unauthorized'
    detail = result.error ?? 'Bloom rejected the stored admin key.'
  } else if (result.code === 'transport') {
    next = 'unreachable'
    detail = result.error ?? VERIFY_TIMEOUT_HINT
  }

  // Anything else left `next` null: the call failed, the link did not.
  if (next === null) return
  if (next === record.state && detail === record.detail) return

  publish(emit, save({ state: next, detail, lastCheckedAt: Date.now() }))
}

/**
 * The unattended startup check. Fire it, do not await it.
 *
 * Demotion-only by construction: it never writes `unlinked`, so a laptop that woke
 * up on a train cannot uninstall the tab.
 */
export async function verifyLink(emit: Emit): Promise<void> {
  const target = currentTarget()
  if (!target) return

  publish(emit, save({ state: 'probing' }))
  const result = await verifyToken(target)
  noteResult(emit, result)
  // `noteResult` skips a no-op transition, and `probing` -> `linked` after a success
  // on an already-linked record is exactly that. Settle it explicitly.
  if (getBloomRecord().state === 'probing') {
    publish(
      emit,
      save({
        state: result.ok ? 'linked' : 'unreachable',
        detail: result.ok ? null : (result.error ?? VERIFY_TIMEOUT_HINT),
        lastCheckedAt: Date.now(),
      }),
    )
  }
}

/**
 * Link Bloom by reading it off a box over SSH.
 *
 * Called from the Servers tab, which is where the sudo password already lives —
 * transiently, per action, never stored. That is the whole reason discovery belongs
 * there rather than behind a button in Settings: asking for a root password in a
 * second place would mean a second lifetime for it.
 */
export async function linkFromServer(
  emit: Emit,
  opId: string,
  server: ServerConfig,
  opts: { domain: string; sudoPassword?: string },
): Promise<{ ok: boolean; link?: BloomLink; error?: string; needsSudo?: boolean }> {
  if (!isVaultAvailable()) {
    return { ok: false, error: vaultUnavailable() }
  }

  publish(emit, save({ state: getBloomRecord().state === 'unlinked' ? 'unlinked' : 'probing' }))

  const found = await discoverBloom(opId, server, opts)
  if (!found.ok || !found.found) {
    return {
      ok: false,
      needsSudo: found.needsSudo,
      error: redact(found.error ?? 'Could not find Bloom on that box.'),
    }
  }

  try {
    storeToken(found.found.token)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  const link = save({
    serverId: server.id,
    baseUrl: found.found.baseUrl,
    container: found.found.container,
    state: 'probing',
    detail: null,
    lastProbedAt: Date.now(),
  })
  publish(emit, link)

  // Prove the credential before claiming a link, so "linked" always means the token
  // actually works rather than merely that a file was readable.
  const check = await verifyToken({ baseUrl: found.found.baseUrl, token: found.found.token })
  const settled = save(
    check.ok
      ? { state: 'linked', detail: null, lastCheckedAt: Date.now() }
      : {
          state: check.code === 'unauthorized' ? 'unauthorized' : 'unreachable',
          detail: check.error,
          lastCheckedAt: Date.now(),
        },
  )
  publish(emit, settled)
  return check.ok
    ? { ok: true, link: settled }
    : { ok: false, link: settled, error: check.error }
}

/**
 * Link a Bloom by hand — a local instance, or one this app cannot reach by SSH.
 *
 * Two refusals worth having. Without a vault there is no link, because the fallback
 * would be a full-control bearer token in a plaintext JSON file. And plain `http` is
 * allowed only for loopback: shipping that token unencrypted to a public host is
 * worth refusing here rather than documenting.
 */
export async function linkManually(
  emit: Emit,
  baseUrl: string,
  token: string,
): Promise<{ ok: boolean; link?: BloomLink; error?: string }> {
  if (!isVaultAvailable()) return { ok: false, error: vaultUnavailable() }

  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'That is not a valid URL. It should look like https://bloom.example.com.' }
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !loopback) {
    return {
      ok: false,
      error:
        'Only https:// is allowed for a remote Bloom. The admin key grants full ' +
        'control, and plain http would put it on the wire in the clear.',
    }
  }
  if (!token.trim()) return { ok: false, error: 'An admin key is required.' }

  try {
    storeToken(token.trim())
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  publish(
    emit,
    save({ serverId: null, baseUrl: trimmed, container: null, state: 'probing', detail: null }),
  )

  const check = await verifyToken({ baseUrl: trimmed, token: token.trim() })
  const settled = save(
    check.ok
      ? { state: 'linked', detail: null, lastCheckedAt: Date.now() }
      : {
          state: check.code === 'unauthorized' ? 'unauthorized' : 'unreachable',
          detail: check.error,
          lastCheckedAt: Date.now(),
        },
  )
  publish(emit, settled)
  return check.ok ? { ok: true, link: settled } : { ok: false, link: settled, error: check.error }
}

/**
 * Forget Bloom entirely. The only path back to `unlinked`, and it is always a
 * deliberate act — a box that has been down for a week must not silently uninstall
 * the tab.
 */
export function unlink(emit: Emit): BloomLink {
  clearToken()
  setBloomRecord({ ...EMPTY_BLOOM_LINK })
  return publish(emit, getLink())
}

function vaultUnavailable(): string {
  return (
    'OS encryption is unavailable, so Bloom\'s admin key cannot be stored safely. ' +
    'On Linux this usually means no keyring (gnome-keyring / kwallet) is running.'
  )
}
