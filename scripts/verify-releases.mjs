/**
 * "A newer version is available" has to be right in both directions.
 *
 * A false negative is a missed update. A false *positive* — saying "up to date" when
 * the check failed — is the thing worth testing hard, because it is the same shape as
 * the bug that started all of this: a screen that reads as fine because it could not
 * look. So every failure path below asserts `unknown`, not `up-to-date`.
 *
 * THE VERSION IS THE COMMIT now. Nothing mints release tags: every repo publishes one
 * image per commit on its default branch as `sha-<40hex>`, so resolving means asking
 * for the newest commit and comparing means asking whether two SHAs match. The semver
 * cases below are kept in full — a box may still be pinned to a pre-switch image, and
 * that is a true answer this can still give.
 *
 * The case worth reading twice is the compare-API inversion. `compare/BASE...HEAD`
 * reports the *head* relative to the base, so GitHub saying "ahead" about a branch tip
 * means the pinned box is BEHIND. Getting that backwards renders "3 commits ahead" on
 * an out-of-date server and offers no update — a confident false sentence, which is
 * the one thing this module is written to never produce.
 *
 * `fetch` is stubbed, so this needs no network and no token.
 */
import {
  commitOf,
  compareVersions,
  describeDistance,
  displayVersion,
  releaseKey,
  repoSlug,
  resolveLatest,
  shortSha,
  tagOf,
} from '../out/verify/releases.mjs'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `${ok ? '  ok  ' : ' FAIL '} ${label} — ${ok ? JSON.stringify(actual) : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`,
  )
}

const SHA = '0ad599bdd7245f67309879d6df7e85b5b931e63e'
const OTHER = 'ce126f343f70966ad287e832c93cf4ba606ca1a3'

console.log('\ntagOf\n')
check('a commit-tagged image', tagOf(`ghcr.io/johonnyy/amber:sha-${SHA}`), `sha-${SHA}`)
check('a legacy semver image', tagOf('ghcr.io/johonnyy/amber:0.1.0'), '0.1.0')
check('no tag', tagOf('ghcr.io/johonnyy/amber'), null)
check('a registry port is not a tag', tagOf('registry:5000/amber'), null)
check('port and tag together', tagOf('registry:5000/amber:1.2.3'), '1.2.3')
check('null in, null out', tagOf(null), null)

console.log('\ncommitOf — a tag, or a bare sha from the API\n')
check('the sha- form', commitOf(`sha-${SHA}`), SHA)
check('the bare form', commitOf(SHA), SHA)
check('uppercase is normalised', commitOf(SHA.toUpperCase()), SHA)
// 12 hex characters is a plausible short sha AND a plausible nothing. Refusing it
// here is what makes the full-40 rule in update-app.sh enforceable end to end.
check('a short sha is not a commit', commitOf('0ad599bdd724'), null)
check('39 characters is not a commit', commitOf(SHA.slice(0, 39)), null)
check('semver is not a commit', commitOf('0.1.0'), null)
check('null in, null out', commitOf(null), null)

console.log('\nshortSha / displayVersion — how a version is named on screen\n')
check('a commit is shortened to 12', shortSha(`sha-${SHA}`), '0ad599bdd724')
check('a non-commit has no short form', shortSha('0.1.0'), null)
check('a commit is displayed bare', displayVersion(`sha-${SHA}`), '0ad599bdd724')
// `v0ad599bdd724` is what the old `v${tag}` templating produced the moment a pin
// became a commit: a version string that does not exist.
check('a commit never gets a v prefix', displayVersion(SHA).startsWith('v'), false)
check('semver keeps its v', displayVersion('0.1.0'), 'v0.1.0')
check('semver is not double-prefixed', displayVersion('v0.1.0'), 'v0.1.0')
check('nothing in, nothing out', displayVersion(null), null)

console.log('\nrepoSlug — the registry has no manifest, so a clone URL is all there is\n')
check('https', repoSlug('https://github.com/Johonnyy/amber-infra.git'), 'Johonnyy/amber-infra')
check('https without .git', repoSlug('https://github.com/Johonnyy/amber-infra'), 'Johonnyy/amber-infra')
check('a trailing slash', repoSlug('https://github.com/Johonnyy/amber-infra/'), 'Johonnyy/amber-infra')
check('ssh', repoSlug('git@github.com:Johonnyy/amber-infra.git'), 'Johonnyy/amber-infra')
check('already a slug', repoSlug('Johonnyy/amber-infra'), 'Johonnyy/amber-infra')
// A wrong slug 404s, and a 404 reads as "no releases" — a silent wrong answer where an
// absent one is honest.
check('a non-GitHub host is null, not a guess', repoSlug('https://gitlab.com/a/b.git'), null)
check('a deep path is null', repoSlug('https://github.com/Johonnyy/amber-infra/tree/main'), null)
check('empty', repoSlug(''), null)

console.log('\nreleaseKey — the pin is part of the cache key, or the distance lies\n')
check('a commit pin joins the key', releaseKey('o/r', `ghcr.io/o/r:sha-${SHA}`), `o/r@${SHA}`)
check('a semver pin does not', releaseKey('o/r', 'ghcr.io/o/r:0.1.0'), 'o/r')
check('no pin at all', releaseKey('o/r', null), 'o/r')
// Two boxes on different commits must not share one cached `compare`.
check(
  'different pins are different keys',
  releaseKey('o/r', `ghcr.io/o/r:sha-${SHA}`) === releaseKey('o/r', `ghcr.io/o/r:sha-${OTHER}`),
  false,
)

console.log('\ncompareVersions — commits\n')
check('the same commit', compareVersions(`sha-${SHA}`, SHA), 'up-to-date')
check('a tag against a bare sha still matches', compareVersions(`sha-${SHA}`, SHA), 'up-to-date')
check('a different commit, with nothing else known', compareVersions(`sha-${SHA}`, OTHER), 'behind')
check(
  'behind, per the compare API',
  compareVersions(`sha-${SHA}`, OTHER, { status: 'behind', distance: 3 }),
  'behind',
)
check(
  'ahead is its own answer',
  compareVersions(`sha-${SHA}`, OTHER, { status: 'ahead', distance: 1 }),
  'ahead',
)
// Not an ancestor of the branch head: a force-push, or a build from a branch that no
// longer exists. "3 commits behind" would be a sentence about a history that never
// contained this build.
check(
  'diverged declines to answer rather than saying behind',
  compareVersions(`sha-${SHA}`, OTHER, { status: 'diverged', distance: 0 }),
  'unknown',
)
check('an unresolved latest is unknown', compareVersions(`sha-${SHA}`, null), 'unknown')
// THE MIGRATION CASE, and the one this got wrong first. No ordering exists between
// `0.2.10` and a SHA, so it is not `behind` — but it is not `unknown` either: the repo
// has demonstrably moved to commits and this pin cannot follow it. Returning `unknown`
// offered no button, and since every box in the fleet carried a semver pin on the day
// of the switch, that made the entire fleet un-updatable from the UI at once.
check('a semver pin against a commit head is the legacy migration', compareVersions('0.2.10', SHA), 'legacy')
check('and it is offered, not hidden', ['behind', 'legacy'].includes(compareVersions('0.2.10', SHA)), true)
// The reverse means the repo went backwards, which no workflow here can produce.
check('a commit pin against a semver head is unknown', compareVersions(`sha-${SHA}`, '0.1.0'), 'unknown')
// Still unknown when the pin is not a version at all — `legacy` is a claim about a
// readable semver pin, not a shrug at anything unparseable.
check('junk against a commit head stays unknown', compareVersions('not-a-version', SHA), 'unknown')
check('a null pin against a commit head stays unknown', compareVersions(null, SHA), 'unknown')

console.log('\ncompareVersions — semver, for pins predating the switch\n')
check('behind', compareVersions('0.1.0', '0.2.0'), 'behind')
check('equal', compareVersions('0.3.1', '0.3.1'), 'up-to-date')
check('a v prefix on either side is fine', compareVersions('v0.3.1', '0.3.1'), 'up-to-date')
check('patch only', compareVersions('1.2.3', '1.2.4'), 'behind')
check('minor beats patch', compareVersions('1.2.9', '1.3.0'), 'behind')
check('ahead is its own answer, not "behind"', compareVersions('2.0.0', '1.9.9'), 'ahead')
check('an unresolved latest is unknown', compareVersions('1.0.0', null), 'unknown')
check('a prerelease against a release declines to guess', compareVersions('1.0.0-rc1', '1.0.0'), 'unknown')

console.log('\ndescribeDistance — a number only when one is known\n')
check('behind', describeDistance({ compare: { status: 'behind', distance: 3 } }), '3 commits behind')
check('singular', describeDistance({ compare: { status: 'behind', distance: 1 } }), '1 commit behind')
check('ahead', describeDistance({ compare: { status: 'ahead', distance: 2 } }), '2 commits ahead')
check('identical has no distance', describeDistance({ compare: { status: 'identical', distance: 0 } }), null)
check('diverged has no distance', describeDistance({ compare: { status: 'diverged', distance: 0 } }), null)
// The compare call is an enrichment; when it did not happen, "different" is all that
// is known and a fabricated "1 commit behind" would be worse than silence.
check('no compare call, no number', describeDistance({ latest: SHA }), null)
check('no release at all', describeDistance(null), null)

console.log('\nresolveLatest — the happy path\n')

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const err = (status) => ({ ok: false, status, json: async () => ({}) })
const commitBody = (sha, message = 'Add timing instrumentation', date = '2026-08-27T10:00:00Z') => [
  { sha, commit: { message, committer: { date } } },
]

let seenUrl = null
let r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  fetchImpl: async (url) => {
    seenUrl = url
    return ok(commitBody(SHA))
  },
})
check('reads the newest commit', r.latest, SHA)
check('and its subject line', r.message, 'Add timing instrumentation')
check('and when it landed', r.committedAt, '2026-08-27T10:00:00Z')
// The default branch is `main` for amber and the libraries, `master` for bloom and
// amber-template. Naming one would be wrong for half the fleet and silent about it —
// the commits endpoint already defaults to whatever each repo's own default branch is.
check('never names a branch', /main|master|\bsha=/.test(seenUrl), false)
check('asks for exactly one commit', seenUrl.includes('per_page=1'), true)

// Only the first line of the message: a commit body is arbitrarily long and this
// lands in a one-line row.
r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  fetchImpl: async () => ok(commitBody(SHA, 'Subject line\n\nA long body\nwith detail')),
})
check('only the subject survives', r.message, 'Subject line')

console.log('\nresolveLatest — the compare enrichment\n')

let compareUrl = null
const withCompare = (body) => async (url) => {
  if (url.includes('/compare/')) {
    compareUrl = url
    return ok(body)
  }
  return ok(commitBody(SHA))
}

r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  pinned: OTHER,
  fetchImpl: withCompare({ status: 'ahead', ahead_by: 3, behind_by: 0 }),
})
check('compares the pin against the head', compareUrl.includes(`${OTHER}...${SHA}`), true)
// THE INVERSION. GitHub's "ahead" describes the HEAD relative to the base, and the
// base is the pin — so a head 3 commits ahead means the box is 3 commits BEHIND.
check('github "ahead" means the pin is behind', r.compare, { status: 'behind', distance: 3 })
check('and that reads correctly', describeDistance(r), '3 commits behind')
check('and offers an update', compareVersions(`sha-${OTHER}`, r.latest, r.compare), 'behind')

r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  pinned: OTHER,
  fetchImpl: withCompare({ status: 'behind', ahead_by: 0, behind_by: 2 }),
})
check('github "behind" means the pin is ahead', r.compare, { status: 'ahead', distance: 2 })

r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  pinned: OTHER,
  fetchImpl: withCompare({ status: 'diverged', ahead_by: 1, behind_by: 1 }),
})
check('diverged is carried through as itself', r.compare, { status: 'diverged', distance: 0 })

// One request, not two, when there is nothing to compare.
let calls = 0
r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  pinned: SHA,
  fetchImpl: async () => {
    calls += 1
    return ok(commitBody(SHA))
  },
})
check('an identical pin spends no second request', calls, 1)
check('and is up to date', compareVersions(`sha-${SHA}`, r.latest, r.compare), 'up-to-date')

calls = 0
r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  fetchImpl: async () => {
    calls += 1
    return ok(commitBody(SHA))
  },
})
check('no pin, no second request', calls, 1)

// The enrichment must never cost the answer. A rate limit on the second request
// throwing away a perfectly good first one would be a self-inflicted "unknown".
r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  pinned: OTHER,
  fetchImpl: async (url) => (url.includes('/compare/') ? err(403) : ok(commitBody(SHA))),
})
check('a failed compare keeps the answer', r.latest, SHA)
check('and simply has no distance', describeDistance(r), null)
check('and still offers the update', compareVersions(`sha-${OTHER}`, r.latest, r.compare), 'behind')

r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  pinned: OTHER,
  fetchImpl: async (url) => {
    if (url.includes('/compare/')) throw new Error('socket hang up')
    return ok(commitBody(SHA))
  },
})
check('a throwing compare keeps the answer too', r.latest, SHA)

console.log('\nresolveLatest — every failure must be unknown\n')

const cases = [
  ['rate limited', async () => err(403), /rate limit/],
  ['too many requests', async () => err(429), /rate limit/],
  ['a rejected token', async () => err(401), /rejected/],
  ['a private or missing repo', async () => err(404), /private|no such repo/],
  ['an empty repository', async () => err(409), /no commits/],
  ['a server error', async () => err(500), /500/],
  ['the network throwing', async () => { throw new Error('getaddrinfo ENOTFOUND') }, /ENOTFOUND/],
  ['nonsense json', async () => ok({ not: 'what we expected' }), /unexpected/],
  ['an empty commit list', async () => ok([]), /unexpected/],
  ['a commit with no sha', async () => ok([{ commit: { message: 'x' } }]), /no commit SHA/],
  ['a truncated sha', async () => ok(commitBody('0ad599b')), /no commit SHA/],
]
for (const [label, fetchImpl, pattern] of cases) {
  const res = await resolveLatest('Johonnyy/amber-v2', { now: 1, fetchImpl })
  const unknown = res.latest === null && pattern.test(res.error ?? '')
  check(`${label} -> unresolved, with a reason`, unknown, true)
  check(`  …and comparing it is "unknown"`, compareVersions(`sha-${SHA}`, res.latest), 'unknown')
  check(`  …and it is never "up to date"`, compareVersions(`sha-${SHA}`, res.latest) === 'up-to-date', false)
}

check(
  'a malformed repo never reaches the network',
  (await resolveLatest('not-a-repo', { now: 1, fetchImpl: async () => { throw new Error('should not be called') } })).latest,
  null,
)

console.log('\nauthorization header\n')
let sawAuth = null
await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  token: 'ghp_test',
  fetchImpl: async (_url, init) => {
    sawAuth = init?.headers?.Authorization ?? null
    return ok(commitBody(SHA))
  },
})
check('the token is sent when there is one', sawAuth, 'Bearer ghp_test')

sawAuth = 'unset'
await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  fetchImpl: async (_url, init) => {
    sawAuth = init?.headers?.Authorization ?? null
    return ok(commitBody(SHA))
  },
})
check('and no Authorization header when there is not', sawAuth, null)

// The compare request is a second call and needs the token just as much — GitHub
// counts it against the same 60/hour, and a private repo 404s without it.
let authOnCompare = 'unset'
await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  token: 'ghp_test',
  pinned: OTHER,
  fetchImpl: async (url, init) => {
    if (url.includes('/compare/')) {
      authOnCompare = init?.headers?.Authorization ?? null
      return ok({ status: 'ahead', ahead_by: 1 })
    }
    return ok(commitBody(SHA))
  },
})
check('the compare request is authorized too', authOnCompare, 'Bearer ghp_test')

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
