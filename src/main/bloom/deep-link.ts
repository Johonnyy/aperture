/**
 * The `aperture://` handoff back from a browser.
 *
 * Bloom hosts the OAuth callback because it has a public address and a desktop app
 * does not. Its completion page then fires `aperture://oauth-complete?provider=…`,
 * which is how control returns here without the user copying anything.
 *
 * **Nothing in the URL is trusted.** Any local process can invoke a registered
 * scheme, so the link carries no code and no token — it is a nudge, and the renderer
 * answers it by re-reading the connection status from Bloom, which is the only thing
 * that knows what actually happened. Passing an authorization code through here and
 * exchanging it would let any local process feed Aperture an attacker's grant.
 *
 * Its own module rather than living in `index.ts` so `ipc.ts` can reach the buffer
 * without importing the entry point back — a cycle that happens to work today and
 * would not survive someone moving an import.
 */

export interface DeepLinkPayload {
  provider: string | null
}

/** Held until a renderer is listening. See `take`. */
let pending: DeepLinkPayload | null = null

/**
 * Parse an `aperture://` URL, returning what it meant or null if it meant nothing.
 *
 * Note both `hostname` and `pathname` are accepted: `aperture://oauth-complete` puts
 * the word in the *hostname* with an empty path, so checking only the path is a
 * silent no-op that is thoroughly unpleasant to debug.
 */
export function parseDeepLink(raw: string | undefined): DeepLinkPayload | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'aperture:') return null

  const target = url.hostname || url.pathname.replace(/^\/+/, '')
  if (target !== 'oauth-complete') return null

  return { provider: url.searchParams.get('provider') }
}

export function hold(payload: DeepLinkPayload): void {
  pending = payload
}

/**
 * Take whatever is held, once.
 *
 * `emit` is documented as safe to drop, and for most events it is — but a dropped
 * OAuth handoff leaves the user watching a "waiting for authorization" state that
 * will never change. So this one is buffered and pulled on mount instead.
 */
export function take(): DeepLinkPayload | null {
  const held = pending
  pending = null
  return held
}
