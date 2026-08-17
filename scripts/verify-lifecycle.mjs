/**
 * Guards the three rules that decide whether a fact's countdown is true.
 *
 * Amber's memory curates itself, and every one of these is a place where the obvious
 * reading of a fact row is wrong. Each would produce a confident, specific, false
 * sentence on screen — which is worse than showing nothing at all, because a countdown
 * that lies teaches you to ignore the ones that don't.
 *
 * Run via `npm run verify:lifecycle`.
 */

import { lifecycleOf } from '../out/verify/fact-lifecycle.mjs'

const failures = []
const fail = (msg) => failures.push(msg)

const POLICY = {
  short_ttl_days: 30,
  session_ttl_hours: 12,
  promote_uses: 3,
  decay_immune_uses: 2,
  pass_interval_s: 21600,
}

const NOW = Date.parse('2026-08-17T12:00:00Z')
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString()

// --- rule 1: durable facts never decay --------------------------------------

{
  const state = lifecycleOf(
    { tier: 'durable', use_count: 0, created_at: daysAgo(500) },
    POLICY,
    NOW,
  )
  if (state.decaysInDays !== null) fail('a durable fact must never show a countdown')
  if (state.summary !== null) fail('a durable fact should say nothing at all')
}

// --- rule 2: a short fact used twice is immune, but still not durable --------

{
  // `decay_facts` requires `use_count < 2`, so this fact is in no danger — but
  // `promote_facts` requires 3, so it is not durable either. "Safe" and "durable" are
  // different states and a UI that conflated them would be wrong in both directions.
  const safe = lifecycleOf(
    { tier: 'short', use_count: 2, last_used_at: daysAgo(400) },
    POLICY,
    NOW,
  )
  if (safe.decaysInDays !== null) {
    fail('a short fact used twice is immune to decay — no countdown')
  }
  if (safe.promoteInUses !== 1) {
    fail(`it still needs one more use to become durable, got ${safe.promoteInUses}`)
  }

  // One use below the threshold, and it is decaying again.
  const atRisk = lifecycleOf(
    { tier: 'short', use_count: 1, last_used_at: daysAgo(29.5) },
    POLICY,
    NOW,
  )
  if (atRisk.decaysInDays === null) fail('a short fact used once still decays')
  if (!atRisk.atRisk) fail('half a day left should read as at risk')
}

// --- rule 3: a session fact is never promoted by anything --------------------

{
  // `promote_facts` only touches `tier='short'`, so however often a session fact is
  // used it still dies at the session TTL. Offering it a promotion countdown would
  // promise something the server will never do.
  const state = lifecycleOf(
    { tier: 'session', use_count: 99, last_used_at: daysAgo(0.1) },
    POLICY,
    NOW,
  )
  if (state.promoteInUses !== null) {
    fail('a session fact has no promotion path, however often it is used')
  }
  if (state.decaysInDays === null) fail('a session fact still decays')
}

// --- the clock a never-used fact runs on ------------------------------------

{
  // The deadline is `COALESCE(last_used_at, created_at)`, so a fact that has never
  // been used measures from creation — and that is exactly the fact most at risk.
  // Before `created_at` reached the wire this case was uncomputable.
  const never = lifecycleOf({ tier: 'short', use_count: 0, created_at: daysAgo(29) }, POLICY, NOW)
  if (never.decaysInDays === null) fail('a never-used fact must still have a deadline')
  if (Math.round(never.decaysInDays) !== 1) {
    fail(`should be about a day left, got ${never.decaysInDays}`)
  }

  const noClock = lifecycleOf({ tier: 'short', use_count: 0 }, POLICY, NOW)
  if (noClock.decaysInDays !== null) fail('no timestamps at all means no claim')
}

// --- honesty about the pass --------------------------------------------------

{
  // Decay happens on the next maintenance pass, not at the stroke of the deadline, so
  // the wording must not imply a precise moment.
  const state = lifecycleOf({ tier: 'short', use_count: 0, created_at: daysAgo(20) }, POLICY, NOW)
  if (!/about/.test(state.summary)) {
    fail(`countdown should hedge — decay lands on the next pass. Got: ${state.summary}`)
  }

  const overdue = lifecycleOf({ tier: 'short', use_count: 0, created_at: daysAgo(90) }, POLICY, NOW)
  if (!/next pass/.test(overdue.summary)) {
    fail(`an overdue fact should name the pass, got: ${overdue.summary}`)
  }
}

// --- nothing is claimed without a policy, or for an inactive fact ------------

{
  if (lifecycleOf({ tier: 'short', use_count: 0, created_at: daysAgo(1) }, undefined).summary) {
    fail('with no policy from the server, nothing may be asserted')
  }
  const forgotten = lifecycleOf(
    { tier: 'short', use_count: 0, created_at: daysAgo(1), status: 'forgotten' },
    POLICY,
    NOW,
  )
  if (forgotten.summary) fail('a fact already gone needs no countdown')
}

// --- report -----------------------------------------------------------------

if (failures.length) {
  console.error(`verify-lifecycle: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  'verify-lifecycle: ok — durable never decays, a twice-used short fact is safe but ' +
    'not durable, a session fact is never promoted, and a never-used fact still has a clock',
)
