/**
 * Is there a newer version of this app than the one pinned on the box?
 *
 * "Set the version" in this ecosystem means **pushing to the default branch**.
 * `release.yml` runs the tests on every push and, if they pass, publishes
 * `ghcr.io/<owner>/<app>:sha-<40hex>`. There are no `v*` tags and no version bumps, so
 * the newest commit on a repo's default branch *is* the newest publishable image. That
 * is why this asks GitHub rather than the registry — the registry would answer with
 * every tag ever pushed and leave this deciding which of them counted as a version.
 * The repo already decided.
 *
 * **The default branch is never named here.** GitHub's commits endpoint defaults to
 * whatever the repo's own default branch is, which matters because this ecosystem is
 * split: `main` for amber and the libraries, `master` for bloom and amber-template.
 * Anything that hardcoded one would be wrong for half the fleet and silent about it —
 * which is precisely how amber-template's CI never ran once.
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
  COMMIT,
  SEMVER,
  commitOf,
  compareCommits,
  compareVersions,
  describeDistance,
  displayVersion,
  releaseKey,
  repoSlug,
  shortSha,
  tagOf,
} from '../../shared/version'

// Re-exported so `scripts/verify-releases.mjs` can drive resolution and comparison
// from one bundle, and so a caller in main needs only this module.
export {
  COMMIT,
  SEMVER,
  commitOf,
  compareCommits,
  compareVersions,
  describeDistance,
  displayVersion,
  releaseKey,
  repoSlug,
  shortSha,
  tagOf,
}
export type { Comparison, ReleaseInfo }

interface FetchLike {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean
    status: number
    json: () => Promise<unknown>
  }>
}

interface CommitResponse {
  sha?: string
  commit?: { message?: string; committer?: { date?: string } }
}

interface CompareResponse {
  status?: string
  ahead_by?: number
  behind_by?: number
}

/**
 * The newest commit on `owner/repo`'s default branch.
 *
 * One request, because `/commits?per_page=1` already defaults to the default branch —
 * asking `/repos/{repo}` for `default_branch` first would double the rate-limit cost
 * to learn something the next call knows anyway.
 *
 * A second request happens only when `pinned` was supplied and differs from the head:
 * `/compare` turns "different" into "3 commits behind", and distinguishes a pin that is
 * merely old from one that is not on this branch at all. It is strictly an
 * enrichment — a failure there leaves the answer usable rather than discarding it.
 *
 * `token` is optional but wanted: unauthenticated calls are limited to 60/hour per IP
 * and a private repo answers 404 without one. It comes from the credential vault
 * (`github-token`), which is the first thing that vault is for.
 */
export async function resolveLatest(
  repo: string,
  opts: {
    token?: string | null
    fetchImpl?: FetchLike
    now?: number
    /** The commit currently pinned, if known — enables the ahead/behind enrichment. */
    pinned?: string | null
  } = {},
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
    const res = await doFetch(`https://api.github.com/repos/${repo}/commits?per_page=1`, {
      headers,
    })
    if (!res.ok) {
      // Named, because each fix is specific.
      if (res.status === 403 || res.status === 429) {
        return fail('GitHub rate limit reached — add a github-token credential to raise it')
      }
      if (res.status === 401) return fail('the saved github-token was rejected')
      if (res.status === 404) return fail(`no such repo, or it is private: ${repo}`)
      // 409 is GitHub's answer for a repository with no commits at all.
      if (res.status === 409) return fail(`${repo} has no commits on its default branch`)
      return fail(`GitHub answered ${res.status}`)
    }

    const body = (await res.json()) as CommitResponse[]
    if (!Array.isArray(body) || body.length === 0) {
      return fail('unexpected response from GitHub')
    }
    const head = commitOf(body[0]?.sha ?? null)
    if (!head) return fail('GitHub returned no commit SHA')

    const info: ReleaseInfo = {
      latest: head,
      checkedAt,
      // First line only. A commit body can be arbitrarily long and this lands in a
      // one-line row; the full message is a click away on GitHub.
      message: (body[0]?.commit?.message ?? '').split('\n')[0] || undefined,
      committedAt: body[0]?.commit?.committer?.date,
    }

    const pinned = commitOf(opts.pinned ?? null)
    if (!pinned || pinned === head) return info
    return { ...info, compare: await resolveCompare(repo, pinned, head, doFetch, headers) }
  } catch (err) {
    return fail((err as Error).message || 'the check failed')
  }
}

/**
 * How far apart two commits are, per GitHub — reported **relative to the pin**.
 *
 * THE INVERSION IS THE WHOLE SUBTLETY. For `compare/BASE...HEAD`, GitHub's `status`
 * describes the *head* relative to the base. We pass base = the pinned commit and
 * head = the branch tip, so GitHub answering `ahead` (with `ahead_by: 3`) means the
 * branch tip is three commits past the pin — i.e. **the box is three commits behind**.
 * Passing that word straight through would render "3 commits ahead" on a box that is
 * out of date, and offer no update: a confident false sentence, in the one module
 * written to avoid them. So the two directional cases are swapped here, once, and
 * everything downstream reads pin-relative.
 *
 * Undefined on any failure, and that is deliberate: this only ever *adds* precision to
 * an answer that already exists. Turning a failed enrichment into a failed check would
 * mean a rate limit on the second request threw away a perfectly good first one.
 */
async function resolveCompare(
  repo: string,
  base: string,
  head: string,
  doFetch: FetchLike,
  headers: Record<string, string>,
): Promise<ReleaseInfo['compare']> {
  try {
    const res = await doFetch(`https://api.github.com/repos/${repo}/compare/${base}...${head}`, {
      headers,
    })
    if (!res.ok) return undefined
    const body = (await res.json()) as CompareResponse
    switch (body?.status) {
      case 'identical':
        return { status: 'identical', distance: 0 }
      // A pin GitHub cannot place on this branch — a build from a deleted branch, or a
      // force-pushed history — and the caller renders it as unknown rather than
      // inventing a distance for it.
      case 'diverged':
        return { status: 'diverged', distance: 0 }
      // Branch tip is past the pin → the pin is behind.
      case 'ahead':
        return { status: 'behind', distance: body.ahead_by ?? 0 }
      // Branch tip is before the pin → the pin is ahead (a force-push, usually).
      case 'behind':
        return { status: 'ahead', distance: body.behind_by ?? 0 }
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}
