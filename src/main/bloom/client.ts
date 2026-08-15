import type { BloomErrorCode } from '../../shared/bloom'

/**
 * Talking to Bloom over HTTP.
 *
 * **No new dependency.** Electron 33 runs Node 20 in main, so `fetch`,
 * `AbortSignal.timeout` and `ReadableStream` are global. The two runtime
 * dependencies this repo has both carry a comment justifying them by native
 * bindings Vite cannot trace; neither justification applies to an HTTP client, and
 * a global needs no import, so `externalizeDepsPlugin` has nothing to decide.
 *
 * **No Electron imports either**, like `amber/connection.ts` — so this can be
 * esbuilt and driven headlessly against a stub server. Credentials arrive as a
 * parameter; the vault is `link.ts`'s business.
 *
 * One caveat worth recording rather than solving: `fetch` here is Node's undici,
 * not Chromium's stack, so it ignores Electron's session proxy and certificate
 * settings and has no `setCertificateVerifyProc` escape hatch. Bloom sits behind
 * Caddy with real certificates, so this is fine; a self-signed instance would fail
 * with an opaque verification error. Everything goes through `request()`, so
 * swapping to `net.fetch` from Electron is a one-line change if that ever matters.
 */

export interface BloomTarget {
  /** No trailing slash. */
  baseUrl: string
  token: string
}

export type BloomResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: BloomErrorCode; status?: number }

/** Bloom's own envelope. Every error it authors has exactly this shape. */
interface ErrorEnvelope {
  error?: string
  message?: string
}

const BLOOM_CODES = new Set<string>([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'unprocessable',
  'unavailable',
])

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * One request, one place where an error becomes a sentence.
 *
 * Never throws. The distinction between a `transport` code and one of Bloom's is
 * load-bearing and is decided only here: `unauthorized` demotes the whole link,
 * `transport` marks it unreachable, and anything else is a single call failing while
 * the link stays fine. Inventing a Bloom code from a bare status would collapse all
 * three — which is why a body that is not Bloom's envelope becomes `transport`
 * regardless of what the status says. A 502 from Caddy is not Bloom speaking.
 */
export async function request<T>(
  target: BloomTarget,
  path: string,
  init: {
    method?: string
    body?: unknown
    timeoutMs?: number
    query?: Record<string, string | number | undefined>
  } = {},
): Promise<BloomResult<T>> {
  let url: URL
  try {
    // Path-relative, so a trailing slash on baseUrl is harmless either way.
    url = new URL(path.replace(/^\//, ''), `${target.baseUrl.replace(/\/+$/, '')}/`)
  } catch {
    return {
      ok: false,
      code: 'transport',
      error: `Not a valid Bloom address: ${target.baseUrl || '(empty)'}`,
    }
  }
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${target.token}`,
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, code: 'transport', error: describe(err, init.timeoutMs) }
  }

  if (response.status === 204) return { ok: true, value: undefined as T }

  const text = await response.text().catch(() => '')
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (response.ok) return { ok: true, value: parsed as T }

  const envelope = (parsed ?? {}) as ErrorEnvelope
  if (envelope.error && BLOOM_CODES.has(envelope.error) && envelope.message) {
    return {
      ok: false,
      code: envelope.error as BloomErrorCode,
      error: envelope.message,
      status: response.status,
    }
  }
  // Not Bloom's envelope, so not Bloom answering — a proxy, a gateway, or an
  // unauthenticated redirect to something else entirely.
  return {
    ok: false,
    code: 'transport',
    error: `Bloom's address answered with HTTP ${response.status}, but not in Bloom's voice. Something else may be serving it.`,
    status: response.status,
  }
}

/**
 * Turn a thrown fetch into a sentence that names the fix.
 *
 * **The cause chain is the whole job.** Node's `fetch` reports every network failure
 * as a bare `TypeError: fetch failed` and puts the actual reason — `ECONNREFUSED`,
 * `ENOTFOUND`, a certificate error — on `err.cause`, sometimes nested a second time.
 * Matching only `err.message` produces "Could not reach Bloom: fetch failed", which
 * is exactly the kind of non-answer the rest of this codebase goes out of its way to
 * avoid. Walk the chain and match against everything in it.
 */
function describe(err: unknown, timeoutMs?: number): string {
  const name = (err as { name?: string })?.name
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `Timed out after ${Math.round((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s.`
  }

  // Depth-capped: a malformed chain must not spin here.
  const parts: string[] = []
  let current: unknown = err
  for (let depth = 0; current && depth < 5; depth += 1) {
    const layer = current as { message?: string; code?: string; cause?: unknown }
    if (layer.code) parts.push(layer.code)
    if (layer.message) parts.push(layer.message)
    current = layer.cause
  }
  const text = parts.join(' ') || String(err)

  if (/ECONNREFUSED/i.test(text)) {
    return 'Nothing is listening at that address. Check the port, or that Bloom is running.'
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) {
    return 'That address does not resolve. Check the domain, or that DNS is reachable.'
  }
  if (/certificate|self.signed|CERT_|UNABLE_TO_VERIFY/i.test(text)) {
    return "Could not verify Bloom's TLS certificate. A self-signed instance is not supported here."
  }
  if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(text)) {
    return 'That address did not answer. The box may be down, or a firewall is in the way.'
  }
  if (/ECONNRESET|EPIPE|socket hang up/i.test(text)) {
    return 'The connection was closed before Bloom answered.'
  }
  // Prefer the innermost message: the outer one is always "fetch failed".
  return `Could not reach Bloom: ${parts[parts.length - 1] ?? text}`
}

export interface HealthReport {
  status: string
  service: string
  version: string
  database?: string
  agents?: number
}

/**
 * The cheapest possible "is it there, and does our token work".
 *
 * Shallow rather than `?deep=true`: this runs unattended at startup, and whether
 * Bloom's database opened is a question for the panel, not for deciding the link.
 */
export async function health(target: BloomTarget): Promise<BloomResult<HealthReport>> {
  return request<HealthReport>(target, '/health', { timeoutMs: 4_000 })
}

/**
 * Whether our token is actually accepted.
 *
 * `/health` is deliberately unauthenticated in Bloom — a load balancer has to reach
 * it — so it proves reachability and nothing about credentials. Listing agents is
 * the cheapest authenticated read, and its failure mode is exactly the one worth
 * distinguishing: 401 means the token is wrong, not that Bloom is down.
 */
export async function verifyToken(target: BloomTarget): Promise<BloomResult<unknown[]>> {
  return request<unknown[]>(target, '/admin/agents', { timeoutMs: 6_000 })
}
