/**
 * `BloomClient` against a real Bloom.
 *
 * The only verify script here that needs something running, and it earns that: what
 * it checks is the *contract between two repos*. A stub written from the same
 * understanding that produced the client would only ever confirm that understanding
 * back to itself.
 *
 * It has already caught one thing. Node's `fetch` reports every network failure as a
 * bare `TypeError: fetch failed` and hides the real reason on `err.cause`, so a
 * refused connection and a DNS failure both surfaced as "Could not reach Bloom:
 * fetch failed" — a sentence naming nothing, in a codebase whose errors name the fix.
 *
 * Start Bloom first, from its repo:
 *
 *   BLOOM_DB_PATH=data/link.db BLOOM_ADMIN_KEYS=Aperture:link-admin-token \
 *     BLOOM_OPENROUTER_API_KEY=fake uvicorn app.main:app --port 8031
 *
 * Skips rather than fails when nothing answers, so `npm run verify` stays useful on a
 * machine with no Bloom checkout.
 */
import { health, request, verifyToken } from '../out/verify/client.mjs'

const base = 'http://127.0.0.1:8031'
const good = { baseUrl: base, token: 'link-admin-token' }
const bad = { baseUrl: base, token: 'wrong-token' }

let failures = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  const mark = ok ? '  ok  ' : ' FAIL '
  const detail = ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('\ntransport failures, which must each name their fix\n')

const closed = await request({ baseUrl: 'http://127.0.0.1:59997', token: 't' }, '/health')
check('a refused connection is `transport`', [closed.ok, closed.code], [false, 'transport'])
check('  and says so', /nothing is listening/i.test(closed.error), true)

const unresolvable = await request({ baseUrl: 'https://nope.invalid', token: 't' }, '/health', { timeoutMs: 3000 })
check('an unresolvable host is `transport`', [unresolvable.ok, unresolvable.code], [false, 'transport'])
check('  and says so', /does not resolve/i.test(unresolvable.error), true)

const malformed = await request({ baseUrl: 'not a url', token: 't' }, '/health')
check('a malformed base URL is a result, not a throw', [malformed.ok, malformed.code], [false, 'transport'])

// Neither of these may ever read "fetch failed" — that is the message this script exists to prevent.
check('no error is left as Node\'s bare "fetch failed"', [closed.error, unresolvable.error].some((m) => /fetch failed/i.test(m)), false)

// The live section needs a Bloom; the transport section above deliberately does not,
// and used to sit below this skip where it never ran on a machine without one. A
// check that cannot fail is not a check.
const reachable = await health(good)
if (!reachable.ok) {
  console.log(`\n  skip  no Bloom on ${base} — start one to run the live checks.`)
  console.log(failures === 0 ? '\nAll offline checks passed.\n' : `\n${failures} check(s) failed.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

console.log('\nagainst a live Bloom\n')

check('health answers, and it is Bloom', [reachable.ok, reachable.value?.service], [true, 'bloom'])

const authorised = await verifyToken(good)
check('a good token lists agents', [authorised.ok, Array.isArray(authorised.value)], [true, true])

// The distinction the whole link state machine rests on: a rejected token demotes the
// link, a transport failure marks it unreachable, and everything else leaves it alone.
const refused = await verifyToken(bad)
check('a bad token is `unauthorized`, not `transport`', [refused.ok, refused.code, refused.status], [false, 'unauthorized', 401])

const missing = await request(good, '/admin/agents/does-not-exist')
check('a 404 keeps its own code', [missing.ok, missing.code], [false, 'not_found'])

// Self-seeding, so this is repeatable: the delete check below removes it again.
const seeded = await request(good, '/admin/agents', { method: 'POST', body: { slug: 'dj', name: 'DJ' } })
const id = seeded.ok ? seeded.value.id : (await request(good, '/admin/agents')).value[0].id

const duplicate = await request(good, '/admin/agents', { method: 'POST', body: { slug: 'dj' } })
check('a duplicate slug is a conflict', [duplicate.ok, duplicate.code], [false, 'conflict'])

const badTier = await request(good, '/admin/agents', { method: 'POST', body: { slug: 'x2', model_tier: 'nope' } })
check('an unknown model tier is unprocessable', [badTier.ok, badTier.code], [false, 'unprocessable'])

const deleted = await request(good, `/admin/agents/${id}`, { method: 'DELETE' })
check('a 204 succeeds with no body', [deleted.ok, deleted.value], [true, undefined])

const queried = await request(good, '/admin/runs', { query: { limit: 5, origin: undefined } })
check('query params serialise, and undefined is skipped', [queried.ok, Array.isArray(queried.value)], [true, true])

const slashed = await request({ baseUrl: `${base}/`, token: good.token }, '/health')
check('a trailing slash on the base URL is harmless', slashed.ok, true)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
