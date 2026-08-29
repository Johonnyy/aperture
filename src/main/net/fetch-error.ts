/**
 * Turn a thrown `fetch` into a sentence that names the fix.
 *
 * **The cause chain is the whole job.** Node's `fetch` reports every network failure
 * as a bare `TypeError: fetch failed` and puts the actual reason — `ECONNREFUSED`,
 * `ENOTFOUND`, a certificate error — on `err.cause`, sometimes nested a second time.
 * Matching only `err.message` produces "Could not reach X: fetch failed", which is
 * exactly the kind of non-answer the rest of this codebase goes out of its way to
 * avoid. Walk the chain and match against everything in it.
 *
 * Extracted from `bloom/client.ts` when a second HTTP client appeared. `subject` is
 * the only thing that differed between them: the sentences name what you were trying
 * to reach, and "Bloom" was baked into four of the six branches. The wording for
 * `subject: 'Bloom'` is byte-identical to what it replaced, which is what lets
 * `verify:bloom-client` keep asserting the same strings.
 *
 * No imports at all, so it bundles into any verify script that needs it.
 */

const FALLBACK_TIMEOUT_MS = 15_000

/** Depth cap on the cause walk: a malformed chain must not spin here. */
const MAX_DEPTH = 5

export interface DescribeOptions {
  /** What we were trying to reach, e.g. `Bloom` or `TouchDesigner`. Named in four branches. */
  subject: string
  /** The budget that actually applied, so a timeout can say how long it waited. */
  timeoutMs?: number
  /** What the caller's budget is when it did not pass one. */
  defaultTimeoutMs?: number
}

export function describeFetchError(err: unknown, options: DescribeOptions): string {
  const { subject, timeoutMs, defaultTimeoutMs } = options

  const name = (err as { name?: string })?.name
  if (name === 'TimeoutError' || name === 'AbortError') {
    const budget = timeoutMs ?? defaultTimeoutMs ?? FALLBACK_TIMEOUT_MS
    return `Timed out after ${Math.round(budget / 1000)}s.`
  }

  const parts: string[] = []
  let current: unknown = err
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    const layer = current as { message?: string; code?: string; cause?: unknown }
    if (layer.code) parts.push(layer.code)
    if (layer.message) parts.push(layer.message)
    current = layer.cause
  }
  const text = parts.join(' ') || String(err)

  if (/ECONNREFUSED/i.test(text)) {
    return `Nothing is listening at that address. Check the port, or that ${subject} is running.`
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) {
    return 'That address does not resolve. Check the domain, or that DNS is reachable.'
  }
  if (/certificate|self.signed|CERT_|UNABLE_TO_VERIFY/i.test(text)) {
    return `Could not verify ${subject}'s TLS certificate. A self-signed instance is not supported here.`
  }
  if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(text)) {
    return 'That address did not answer. The box may be down, or a firewall is in the way.'
  }
  if (/ECONNRESET|EPIPE|socket hang up/i.test(text)) {
    return `The connection was closed before ${subject} answered.`
  }
  // Prefer the innermost message: the outer one is always "fetch failed".
  return `Could not reach ${subject}: ${parts[parts.length - 1] ?? text}`
}
