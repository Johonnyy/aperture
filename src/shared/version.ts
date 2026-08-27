/**
 * Comparing what is pinned against what is published.
 *
 * In `shared/` because both sides need it and must agree: main resolves the newest
 * version, the renderer decides whether that means a button. A second copy of "is this
 * behind" in the UI is how a row offers an update to a version it is already running.
 *
 * **THE VERSION IS THE COMMIT.** Nothing in this ecosystem mints release tags any
 * more: every repo publishes one image per commit on its default branch, tagged
 * `sha-<40hex>`. So "the newest release" is "the newest commit", and comparing means
 * asking whether two SHAs are the same — with GitHub's compare API supplying the
 * direction and distance, since commits carry no ordering of their own.
 *
 * The semver path is kept, not as a second scheme but as a reader for pins predating
 * the switch. A `sha-…` pin used to be deliberately `unknown` here; it is now the
 * normal case, and the comment that said otherwise was the first thing this rewrite
 * had to delete.
 *
 * The rule that matters is unchanged: **anything unparseable is `unknown`, never a
 * reassurance and never a prompt.** A check that failed is not evidence of being up
 * to date.
 */

export interface ReleaseInfo {
  /**
   * The newest published version. Under commit-based versioning this is a bare
   * 40-character commit SHA — every repo in the ecosystem publishes one image per
   * commit and mints no tags. A semver string (without a leading `v`) is still
   * possible for a box pinned to an image from before the switch. Null when
   * unresolved.
   */
  latest: string | null
  /** Why it is null. Shown to the user rather than swallowed. */
  error?: string
  /** When this was resolved, so a stale answer can say so. */
  checkedAt: number
  /** Subject line of the newest commit, so a row can say what the update *is*. */
  message?: string
  /** ISO timestamp of the newest commit — "3 days ago" beats a bare SHA. */
  committedAt?: string
  /**
   * How the pinned commit relates to the newest one, from GitHub's compare API.
   *
   * Only present when a pinned commit was supplied and the two differ, because that
   * is the only case worth a second request. `distance` is how many commits are
   * between them in the reported direction; `status` is GitHub's own word, and
   * `diverged` is kept distinct rather than folded into `behind` — a pin that is not
   * an ancestor of the branch head means a force-push or a build from another branch,
   * which is a different problem from being out of date.
   */
  compare?: {
    status: 'identical' | 'ahead' | 'behind' | 'diverged'
    distance: number
  }
}

export type Comparison =
  | 'up-to-date'
  | 'behind'
  /** Pinned to something newer than the newest release — a prerelease, or a typo. */
  | 'ahead'
  /** Either side unparseable, or the check failed. Never rendered as reassurance. */
  | 'unknown'

/** `ghcr.io/johonnyy/amber:0.1.0` -> `0.1.0`. Null when there is no tag to read. */
export function tagOf(imageRef: string | null | undefined): string | null {
  if (!imageRef) return null
  // Split on the LAST colon, but only when it is part of the tag rather than a
  // registry port — `registry:5000/app` has a colon and no tag.
  const slash = imageRef.lastIndexOf('/')
  const colon = imageRef.lastIndexOf(':')
  if (colon <= slash) return null
  const tag = imageRef.slice(colon + 1)
  return tag || null
}

/**
 * A clone URL as GitHub's `owner/repo`, which is what the release check takes.
 *
 * The registry is published from amber-infra's own tags and has no manifest to declare
 * a repo in — `sync-store/` is a directory in that repo, not an app with a checkout. So
 * the only name available is the clone URL the Servers tab already holds for
 * bootstrapping, and this is the one line that turns one into the other.
 *
 * Null for anything that is not recognisably a GitHub repo, because a wrong slug
 * resolves to a 404 that reads as "no releases" — a silent wrong answer where an
 * absent one would have been honest.
 */
export function repoSlug(url: string | null | undefined): string | null {
  const raw = (url ?? '').trim()
  if (!raw) return null
  // `owner/repo` already.
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return raw.replace(/\.git$/, '')
  const match =
    /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(raw) ??
    /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(raw)
  return match ? `${match[1]}/${match[2]}` : null
}

/**
 * Numeric-only semver. No longer what anything *publishes* — release.yml emits one
 * `sha-<commit>` tag per commit and no semver at all — but kept because a box may
 * still be pinned to an image built under the old scheme, and rendering that as
 * `unknown` would lose a true answer this can still give.
 */
export const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/

/**
 * A commit, as an image tag (`sha-<40hex>`) or bare. Both forms appear: `tagOf` reads
 * the first out of a compose pin, GitHub's API returns the second.
 */
export const COMMIT = /^(?:sha-)?([0-9a-f]{40})$/i

/** The 40-hex commit in `pinned`, lowercased, or null if it is not one. */
export function commitOf(ref: string | null | undefined): string | null {
  const m = COMMIT.exec((ref ?? '').trim())
  return m ? m[1].toLowerCase() : null
}

/**
 * A commit at reading length. Twelve, not seven: this labels deploy targets across a
 * whole ecosystem rather than one repo's recent history, and seven is short enough to
 * make two builds look identical at a glance.
 *
 * Never used where a value is copied for `--to`, which requires the full forty.
 */
export function shortSha(ref: string | null | undefined): string | null {
  const full = commitOf(ref)
  return full ? full.slice(0, 12) : null
}

function parse(version: string | null): [number, number, number] | null {
  if (!version) return null
  const m = SEMVER.exec(version.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/**
 * Is the pinned commit the newest one?
 *
 * Equality is the whole comparison, because commits do not order themselves — which
 * is the one thing genuinely lost with semver. `compare` supplies the direction when
 * it is known; without it, "different from the branch head" is reported as `behind`,
 * since the newest commit on the default branch is by definition something this box is
 * not running, and offering that update is the right prompt even in the rare case the
 * pin is off-branch rather than behind.
 *
 * `diverged` is `unknown` rather than `behind`: a pin that is not an ancestor of the
 * head means a force-push or a build from another branch, and "3 commits behind" would
 * be a confident false sentence about a repo that never contained this build.
 */
export function compareCommits(
  pinned: string | null,
  latest: string | null,
  compare?: ReleaseInfo['compare'],
): Comparison {
  const a = commitOf(pinned)
  const b = commitOf(latest)
  if (!a || !b) return 'unknown'
  if (a === b) return 'up-to-date'
  if (compare?.status === 'diverged') return 'unknown'
  if (compare?.status === 'ahead') return 'ahead'
  return 'behind'
}

/**
 * Compare a pin against the newest published version, whichever scheme each is in.
 *
 * The dispatch rule: **a commit on either side means a commit comparison.** Mixing
 * the two is not a version question at all — a semver pin against a commit head is a
 * box still running a pre-switch image, and there is no ordering between those two
 * strings — so it is `unknown`, which is the honest answer and the one that offers no
 * button rather than a wrong one.
 */
export function compareVersions(
  pinned: string | null,
  latest: string | null,
  compare?: ReleaseInfo['compare'],
): Comparison {
  const pinnedCommit = commitOf(pinned)
  const latestCommit = commitOf(latest)
  if (pinnedCommit || latestCommit) return compareCommits(pinned, latest, compare)

  const a = parse(pinned)
  const b = parse(latest)
  if (!a || !b) return 'unknown'
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return 'behind'
    if (a[i] > b[i]) return 'ahead'
  }
  // A prerelease sorts before its release, and getting that subtly wrong is worse than
  // declining to answer for a case nothing in this ecosystem publishes.
  const pre = (v: string | null): boolean => Boolean(v && /[-+]/.test(v))
  if (pre(pinned) !== pre(latest)) return 'unknown'
  return 'up-to-date'
}

/**
 * "3 commits behind", or null when there is no honest number to give.
 *
 * Null rather than falling back to "1 commit behind": without the compare call all
 * that is known is *different*, and a fabricated distance is exactly the kind of
 * confident false sentence this module exists to avoid. `diverged` gets null too — a
 * pin that is not on this branch is not a distance.
 *
 * In `shared/` rather than beside the resolver, because the renderer is what says this
 * out loud and must not import from `main/`.
 */
export function describeDistance(release: ReleaseInfo | null | undefined): string | null {
  const c = release?.compare
  if (!c || c.status === 'identical' || c.status === 'diverged' || c.distance <= 0) return null
  return `${c.distance} ${c.distance === 1 ? 'commit' : 'commits'} ${c.status}`
}

/**
 * The key a release answer is stored and looked up under: `owner/repo@<commit>`, or
 * plain `owner/repo` when the pin is not a commit.
 *
 * The pin belongs in the key because the answer depends on it. A cached `ReleaseInfo`
 * carries a `compare` computed against one specific pinned commit, so serving it for a
 * box pinned somewhere else would state a distance — "3 commits behind" — that is
 * confidently wrong rather than merely stale.
 *
 * One function, used by both the request and the lookup: two call sites building this
 * string separately is how a row silently reads `undefined` and renders "latest
 * unknown" forever, with no error anywhere to explain it.
 */
export function releaseKey(repo: string, imagePinned: string | null | undefined): string {
  const commit = commitOf(tagOf(imagePinned))
  return commit ? `${repo}@${commit}` : repo
}

/**
 * How to name a version in the UI: a short commit, or a `v`-prefixed semver.
 *
 * One function because the `v` prefix is right for exactly one of the two schemes, and
 * `v0ad599bdd724` — which is what the old templating produced the moment a pin became
 * a commit — is a version string that does not exist.
 */
export function displayVersion(ref: string | null | undefined): string | null {
  const short = shortSha(ref)
  if (short) return short
  const raw = (ref ?? '').trim()
  if (!raw) return null
  return SEMVER.test(raw) ? `v${raw.replace(/^v/, '')}` : raw
}
