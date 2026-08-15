/**
 * Comparing what is pinned against what is published.
 *
 * In `shared/` because both sides need it and must agree: main resolves the newest
 * release, the renderer decides whether that means a button. A second copy of "is this
 * behind" in the UI is how a row offers an update to a version it is already running.
 *
 * The rule that matters: **anything unparseable is `unknown`, never a reassurance and
 * never a prompt.** A box pinned to `sha-9f2c…` is a deliberate choice, and a check
 * that failed is not evidence of being up to date.
 */

export interface ReleaseInfo {
  /** The newest published version, without a leading `v`. Null when unresolved. */
  latest: string | null
  /** Why it is null. Shown to the user rather than swallowed. */
  error?: string
  /** When this was resolved, so a stale answer can say so. */
  checkedAt: number
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

/** Numeric-only semver, which is what `type=semver` in release.yml publishes. */
export const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/

function parse(version: string | null): [number, number, number] | null {
  if (!version) return null
  const m = SEMVER.exec(version.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function compareVersions(pinned: string | null, latest: string | null): Comparison {
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
