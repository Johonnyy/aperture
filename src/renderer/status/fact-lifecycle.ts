/**
 * What is about to happen to a remembered fact.
 *
 * Amber's memory curates itself — short-tier facts decay when they stop being useful,
 * and get promoted to durable when they keep proving useful — and all of that has been
 * invisible machinery. A panel that shows `tier: short` tells you nothing about whether
 * the fact is thriving or four days from being forgotten, which is the only part anyone
 * would act on.
 *
 * Everything here is derived from the fact row and the policy Amber reports on her
 * `status` frame. Nothing is hardcoded: the thresholds are tunable per install, and a
 * client guessing them would be confidently wrong on any box that tuned them.
 *
 * **Three details it would be easy to get wrong, and all three would make it lie:**
 *
 * 1. A short-tier fact used twice or more is *immune to decay* but still not durable —
 *    `decay_facts` requires `use_count < 2`. So "safe" and "durable" are different
 *    states, and showing a countdown for such a fact would be pure invention.
 * 2. A **session-tier fact is never promoted by anything**. `promote_facts` only
 *    touches `tier='short'`, so however often a session fact is used it still dies at
 *    the session TTL. Offering it a promotion countdown would promise something the
 *    server will never do.
 * 3. Removal happens on the next *maintenance pass*, not the instant a deadline passes.
 *    The pass runs every few hours, so an exact-looking countdown is wrong by up to one
 *    interval — hence "about", and hence `atRisk` rather than a precise clock.
 *
 * DOM-free so `scripts/verify-lifecycle.mjs` can hold those three rules still.
 */

export interface FactLike {
  tier: 'session' | 'short' | 'durable'
  use_count?: number
  last_used_at?: string | null
  created_at?: string
  status?: string
}

export interface MemoryPolicy {
  short_ttl_days: number
  session_ttl_hours: number
  promote_uses: number
  decay_immune_uses: number
  pass_interval_s: number
}

export interface Lifecycle {
  /** Days until decay, or null when this fact is not decaying at all. */
  decaysInDays: number | null
  /** Uses still needed to become durable, or null when promotion cannot happen. */
  promoteInUses: number | null
  /** True when it will be forgotten within a day and nothing has used it. */
  atRisk: boolean
  /** One short line, or null when there is nothing worth saying. */
  summary: string | null
}

const DAY_MS = 86_400_000

export function lifecycleOf(
  fact: FactLike,
  policy: MemoryPolicy | undefined,
  now: number = Date.now(),
): Lifecycle {
  const none: Lifecycle = {
    decaysInDays: null,
    promoteInUses: null,
    atRisk: false,
    summary: null,
  }
  if (!policy || (fact.status && fact.status !== 'active')) return none

  const uses = fact.use_count ?? 0

  // Promotion: only short-tier rises, and only on use count. A session fact used
  // fifty times is still a session fact.
  const promoteInUses =
    fact.tier === 'short' ? Math.max(0, policy.promote_uses - uses) || null : null

  // Decay: durable never; short only while under the immunity threshold.
  let ttlMs: number | null = null
  if (fact.tier === 'session') {
    ttlMs = policy.session_ttl_hours * 3_600_000
  } else if (fact.tier === 'short' && uses < policy.decay_immune_uses) {
    ttlMs = policy.short_ttl_days * DAY_MS
  }

  if (ttlMs === null) {
    return {
      ...none,
      promoteInUses,
      summary: promoteInUses ? `${promoteInUses} more use${plural(promoteInUses)} to stick` : null,
    }
  }

  // The clock starts at the last use, or at creation for a fact never used — which is
  // exactly the fact most at risk, and the reason `created_at` had to reach the wire.
  const anchor = Date.parse(fact.last_used_at || fact.created_at || '')
  if (Number.isNaN(anchor)) return { ...none, promoteInUses }

  const remainingMs = anchor + ttlMs - now
  const decaysInDays = remainingMs / DAY_MS

  return {
    decaysInDays,
    promoteInUses,
    atRisk: remainingMs <= DAY_MS,
    summary: decaySummary(remainingMs),
  }
}

function decaySummary(remainingMs: number): string {
  // "about", because decay lands on the next maintenance pass rather than on the
  // stroke of the deadline.
  if (remainingMs <= 0) return 'forgotten at the next pass'
  const hours = remainingMs / 3_600_000
  if (hours < 1) return 'forgotten within the hour, unless used'
  if (hours < 24) return `forgotten in about ${Math.round(hours)}h, unless used`
  const days = Math.round(hours / 24)
  return `forgotten in about ${days} day${plural(days)}, unless used`
}

function plural(n: number): string {
  return n === 1 ? '' : 's'
}
