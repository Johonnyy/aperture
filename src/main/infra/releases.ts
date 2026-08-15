/**
 * Is there a newer version of this app than the one pinned on the box?
 *
 * "Set the version" in this ecosystem means pushing a `v*` git tag: `release.yml`
 * builds on that tag with `flavor: latest=false` and `type=semver`, so the newest
 * release of an app's repo *is* the newest publishable image. That is why this asks
 * GitHub rather than the registry — the registry would answer with every tag ever
 * pushed, including `sha-…` and the `:stable` pointer, and then this would have to
 * decide which of them counted as a version. The repo already decided.
 *
 * The rule that matters: **a failure is `unknown`, never "up to date"**. A rate-limited
 * or offline check that rendered green would be the same class of invisible failure as
 * the env-prefix bug — a screen that says everything is fine because it could not look.
 *
 * No Electron imports: `scripts/verify-releases.mjs` drives this with a stubbed
 * `fetch`. Uses the global `fetch` that `bloom/client.ts` already established here,
 * with the same caveat that undici ignores Electron's proxy and certificate settings.
 */

import {
  type Comparison,
  type ReleaseInfo,
  SEMVER,
  compareVersions,
  tagOf,
} from '../../shared/version'

// Re-exported so `scripts/verify-releases.mjs` can drive resolution and comparison
// from one bundle, and so a caller in main needs only this module.
export { compareVersions, tagOf }
export type { Comparison, ReleaseInfo }

interface FetchLike {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean
    status: number
    json: () => Promise<unknown>
  }>
}

/**
 * The newest release of `owner/repo`.
 *
 * Falls back to the tag list, because `releases/latest` is 404 for a repo that pushes
 * tags without cutting GitHub Releases — which is exactly what `release.yml` does. The
 * fallback is the normal path, not the exceptional one.
 *
 * `token` is optional but wanted: unauthenticated calls are limited to 60/hour per IP
 * and a private repo answers 404 without one. It comes from the credential vault
 * (`github-token`), which is the first thing that vault is for.
 */
export async function resolveLatest(
  repo: string,
  opts: { token?: string | null; fetchImpl?: FetchLike; now?: number } = {},
): Promise<ReleaseInfo> {
  const checkedAt = opts.now ?? Date.now()
  const fail = (error: string): ReleaseInfo => ({ latest: null, error, checkedAt })

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) return fail(`not an owner/repo: ${repo}`)

  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  if (!doFetch) return fail('no fetch available')

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`

  try {
    const rel = await doFetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers })
    if (rel.ok) {
      const body = (await rel.json()) as { tag_name?: string }
      const tag = body?.tag_name?.replace(/^v/, '') ?? null
      if (tag) return { latest: tag, checkedAt }
    } else if (rel.status === 403 || rel.status === 429) {
      // Named, because the fix is specific: save a `github-token` on the Keys page.
      return fail('GitHub rate limit reached — add a github-token credential to raise it')
    } else if (rel.status === 401) {
      return fail('the saved github-token was rejected')
    } else if (rel.status !== 404) {
      return fail(`GitHub answered ${rel.status}`)
    }

    // No Release cut, or none visible. The tags are what release.yml actually builds
    // from, so they are the real answer rather than a consolation prize.
    const tags = await doFetch(`https://api.github.com/repos/${repo}/tags?per_page=100`, { headers })
    if (!tags.ok) {
      return fail(tags.status === 404 ? `no such repo, or it is private: ${repo}` : `GitHub answered ${tags.status}`)
    }
    const list = (await tags.json()) as Array<{ name?: string }>
    if (!Array.isArray(list)) return fail('unexpected response from GitHub')

    const versions = list
      .map((t) => t?.name ?? '')
      .filter((n) => SEMVER.test(n))
      .map((n) => n.replace(/^v/, ''))
      .sort((x, y) => (compareVersions(x, y) === 'behind' ? 1 : -1))

    if (versions.length === 0) return fail('no version tags published yet')
    return { latest: versions[0], checkedAt }
  } catch (err) {
    return fail((err as Error).message || 'the check failed')
  }
}
