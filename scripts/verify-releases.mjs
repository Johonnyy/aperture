/**
 * "A newer version is available" has to be right in both directions.
 *
 * A false negative is a missed update. A false *positive* — saying "up to date" when
 * the check failed — is the thing worth testing hard, because it is the same shape as
 * the bug that started all of this: a screen that reads as fine because it could not
 * look. So every failure path below asserts `unknown`, not `up-to-date`.
 *
 * `fetch` is stubbed, so this needs no network and no token.
 */
import { compareVersions, repoSlug, resolveLatest, tagOf } from '../out/verify/releases.mjs'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `${ok ? '  ok  ' : ' FAIL '} ${label} — ${ok ? JSON.stringify(actual) : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`,
  )
}

console.log('\ntagOf\n')
check('a normal image', tagOf('ghcr.io/johonnyy/amber:0.1.0'), '0.1.0')
check('no tag', tagOf('ghcr.io/johonnyy/amber'), null)
check('a registry port is not a tag', tagOf('registry:5000/amber'), null)
check('port and tag together', tagOf('registry:5000/amber:1.2.3'), '1.2.3')
check('null in, null out', tagOf(null), null)

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

console.log('\ncompareVersions\n')
check('behind', compareVersions('0.1.0', '0.2.0'), 'behind')
check('equal', compareVersions('0.3.1', '0.3.1'), 'up-to-date')
check('a v prefix on either side is fine', compareVersions('v0.3.1', '0.3.1'), 'up-to-date')
check('patch only', compareVersions('1.2.3', '1.2.4'), 'behind')
check('minor beats patch', compareVersions('1.2.9', '1.3.0'), 'behind')
check('ahead is its own answer, not "behind"', compareVersions('2.0.0', '1.9.9'), 'ahead')
check('a sha pin is unknown, never behind', compareVersions('sha-9f2c1a', '1.0.0'), 'unknown')
check('an unresolved latest is unknown', compareVersions('1.0.0', null), 'unknown')
check('a prerelease against a release declines to guess', compareVersions('1.0.0-rc1', '1.0.0'), 'unknown')

console.log('\nresolveLatest — the happy paths\n')

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const err = (status) => ({ ok: false, status, json: async () => ({}) })

let r = await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  fetchImpl: async (url) =>
    url.includes('/releases/latest') ? ok({ tag_name: 'v0.4.2' }) : err(404),
})
check('reads tag_name and strips the v', r.latest, '0.4.2')

// release.yml pushes tags without cutting Releases, so this is the NORMAL path.
r = await resolveLatest('Johonnyy/bloom', {
  now: 1,
  fetchImpl: async (url) =>
    url.includes('/releases/latest')
      ? err(404)
      : ok([{ name: 'v0.1.0' }, { name: 'v0.10.0' }, { name: 'v0.9.0' }, { name: 'sha-abc' }]),
})
check('falls back to tags, sorted by version not string', r.latest, '0.10.0')
check('and ignores non-version tags', r.error, undefined)

console.log('\nresolveLatest — every failure must be unknown\n')

const cases = [
  ['rate limited', async () => err(403), /rate limit/],
  ['too many requests', async () => err(429), /rate limit/],
  ['a rejected token', async () => err(401), /rejected/],
  ['a private or missing repo', async () => err(404), /private|no such repo/],
  ['a server error', async () => err(500), /500/],
  ['the network throwing', async () => { throw new Error('getaddrinfo ENOTFOUND') }, /ENOTFOUND/],
  ['nonsense json', async () => ok({ not: 'what we expected' }), /unexpected|no version/],
  ['no version tags at all', async () => ok([{ name: 'nightly' }]), /no version tags/],
]
for (const [label, fetchImpl, pattern] of cases) {
  const res = await resolveLatest('Johonnyy/amber-v2', { now: 1, fetchImpl })
  const unknown = res.latest === null && pattern.test(res.error ?? '')
  check(`${label} -> unresolved, with a reason`, unknown, true)
  check(`  …and comparing it is "unknown"`, compareVersions('0.1.0', res.latest), 'unknown')
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
    return ok({ tag_name: 'v1.0.0' })
  },
})
check('the token is sent when there is one', sawAuth, 'Bearer ghp_test')

sawAuth = 'unset'
await resolveLatest('Johonnyy/amber-v2', {
  now: 1,
  fetchImpl: async (_url, init) => {
    sawAuth = init?.headers?.Authorization ?? null
    return ok({ tag_name: 'v1.0.0' })
  },
})
check('and no Authorization header when there is not', sawAuth, null)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
