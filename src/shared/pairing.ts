/**
 * The pairing payload, and the address rewrite it depends on.
 *
 * In `shared/` for the reason `audio-state.ts` is: two processes need the same rule and
 * neither can borrow the other's copy. Main enumerates the interfaces, the renderer
 * draws the QR, and both have to agree on exactly what host ends up in it — two copies
 * of a regex is how they stop agreeing.
 *
 * Pure, so `verify:pairing` exercises it without an Electron window.
 */

/** What Aperture mobile expects to scan. Versioned so a v2 can be refused clearly. */
export interface PairingPayload {
  v: 1
  url: string
  /** Omitted entirely when Amber runs without `AMBER_AUTH_SECRET`. */
  token?: string
}

/**
 * Swap a URL's host, keeping scheme, port and path.
 *
 * String surgery rather than `new URL`, and deliberately: `URL` normalises the path,
 * and `/ws` is not `/ws/` to FastAPI's route table. The mobile client avoids `URL` for
 * the same family of reasons.
 */
export function withHost(url: string, host: string): string {
  const match = /^(wss?:\/\/)([^/?#]*)(.*)$/.exec(url.trim())
  if (!match) return url
  const [, scheme, authority, rest] = match
  // An explicit port matters to the phone exactly as much as it does here.
  const port = authority.includes(':') ? authority.slice(authority.lastIndexOf(':')) : ''
  return `${scheme}${host}${port}${rest}`
}

/**
 * Hosts that mean "this machine".
 *
 * The one address a phone can never reach, and the one Aperture ships as its default —
 * which is the entire reason the pairing page rewrites anything.
 */
export function isLoopback(url: string): boolean {
  return /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url.trim())
}

/**
 * Build what the QR carries.
 *
 * The token is **omitted rather than empty** when there isn't one: the mobile side
 * treats a missing token as "Amber runs open", and an empty string would be sent as
 * `?token=` — a failed comparison rather than no comparison.
 */
export function pairingPayload(url: string, token: string): string {
  const payload: PairingPayload = token ? { v: 1, url, token } : { v: 1, url }
  return JSON.stringify(payload)
}
