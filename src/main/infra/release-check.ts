import { listCredentials, readCredential } from '../keys/credential-store'
import type { ReleaseInfo } from '../../shared/version'
import { resolveLatest } from './releases'

/**
 * Resolving releases for the Servers tab: cached, batched, and off the SSH path.
 *
 * Kept out of `readStatus` deliberately. That is one SSH round trip answering "what is
 * on this box", and it is what the whole tab waits for; hanging a GitHub call off it
 * would make an unreachable api.github.com look like an unreachable *server*. So this
 * is a second, independent call the renderer fires in parallel, and a failure here
 * degrades one line of one row rather than the page.
 *
 * The TTL exists because unauthenticated GitHub allows 60 requests an hour and every
 * refresh of the tab would otherwise spend two of them. "Check now" bypasses it.
 *
 * Ten minutes was chosen against a release cadence of "whenever someone cuts a tag".
 * Commit-based versioning makes that cadence "whenever someone pushes", which is far
 * more often — but the number stays, because it bounds *requests*, not staleness, and
 * a check that costs a person a rate limit to be sixty seconds fresher is a bad trade
 * on a personal deployment. The row shows when it last looked.
 */

const TTL_MS = 10 * 60_000

const cache = new Map<string, ReleaseInfo>()

/**
 * The GitHub token, if one is saved.
 *
 * Optional by design: without it, public repos still resolve at 60 requests an hour,
 * which the TTL keeps this well inside. With it, private repos work and the limit rises
 * to 5000. This is the first real inhabitant of the credential vault, and the failure
 * message when the limit is hit names it so the fix is obvious.
 */
function githubToken(): string | null {
  const match = listCredentials().find((c) => c.credentialId === 'github-token' && c.readable)
  return match ? readCredential(match.uid) : null
}

/**
 * `repos` may carry the commit each box is pinned to, as `owner/repo@<sha>`.
 *
 * That pin is what turns "different" into "3 commits behind" — commits have no
 * ordering of their own, so the distance comes from a compare call that needs both
 * ends. It stays part of the cache key rather than being passed alongside it: a
 * cached answer carries a `compare` computed against one pin, and serving that for a
 * box pinned somewhere else would report the wrong distance with full confidence.
 */
function splitPin(entry: string): { repo: string; pinned: string | null } {
  const at = entry.lastIndexOf('@')
  if (at <= 0) return { repo: entry, pinned: null }
  return { repo: entry.slice(0, at), pinned: entry.slice(at + 1) || null }
}

export async function checkReleases(
  repos: string[],
  opts: { force?: boolean } = {},
): Promise<Record<string, ReleaseInfo>> {
  const wanted = [...new Set(repos.filter(Boolean))]
  const now = Date.now()
  const stale = wanted.filter((repo) => {
    if (opts.force) return true
    const hit = cache.get(repo)
    // A *failed* check is cached too, so a rate limit does not turn one refresh into
    // one request per row per refresh — which is how you stay rate limited.
    return !hit || now - hit.checkedAt > TTL_MS
  })

  // One token read for the whole batch rather than per repo: each read is a decrypt,
  // and the answer cannot change mid-batch.
  const token = stale.length > 0 ? githubToken() : null

  await Promise.all(
    stale.map(async (entry) => {
      const { repo, pinned } = splitPin(entry)
      cache.set(entry, await resolveLatest(repo, { token, pinned }))
    }),
  )

  const out: Record<string, ReleaseInfo> = {}
  for (const repo of wanted) {
    const hit = cache.get(repo)
    if (hit) out[repo] = hit
  }
  return out
}
