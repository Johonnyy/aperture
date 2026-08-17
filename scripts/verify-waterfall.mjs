/**
 * Guards the turn waterfall's geometry.
 *
 * The layout joins two clocks that cannot be reconciled — the server's monotonic
 * durations and the client's `Date.now()` on each tool call — so the invariants that
 * matter are about *proportion and containment*, not alignment. A bar that escapes its
 * track, a negative offset, or a remainder computed by subtracting overlapping spans
 * are all things that render as an obvious visual bug and are easy to reintroduce.
 *
 * Run via `npm run verify:waterfall`.
 */

import { formatMs, layoutTurn } from '../out/verify/turn-layout.mjs'

const failures = []
const fail = (msg) => failures.push(msg)

const tool = (name, ts, ms, origin = 'own') => ({ name, origin, ts, ms })

// --- containment ------------------------------------------------------------

{
  const layout = layoutTurn(
    { total_ms: 8000, stt_ms: 800, first_token_ms: 1200, tts_ms: 1500 },
    [tool('web_search', 1_000_500, 4000, 'peer:bloom')],
    1_000_000,
  )

  for (const s of layout.segments) {
    if (s.fraction < 0 || s.fraction > 1) fail(`${s.label}: fraction out of range (${s.fraction})`)
    if (s.offset < 0 || s.offset > 1) fail(`${s.label}: offset out of range (${s.offset})`)
    if (s.offset + s.fraction > 1.0001) {
      fail(`${s.label}: bar escapes the track (${s.offset} + ${s.fraction})`)
    }
    if (s.ms < 0) fail(`${s.label}: negative duration`)
  }

  const kinds = layout.segments.map((s) => s.kind)
  if (!kinds.includes('stt')) fail('stt segment missing')
  if (!kinds.includes('think')) fail('think segment missing')
  if (!kinds.includes('tool')) fail('tool segment missing')
  if (!kinds.includes('speak')) fail('speak segment missing')

  const peer = layout.segments.find((s) => s.kind === 'tool')
  if (peer.detail !== 'bloom') fail(`peer name not surfaced: ${peer.detail}`)

  // Think is the wait for the first token *minus* what transcription explained, or
  // the two would double-count the same 800ms.
  const think = layout.segments.find((s) => s.kind === 'think')
  if (think.ms !== 400) fail(`think should exclude stt: got ${think.ms}, want 400`)

  if (layout.dominant.kind !== 'tool') fail(`dominant should be the 4s tool, got ${layout.dominant.kind}`)
}

// --- the remainder ----------------------------------------------------------

{
  // Tools that ran before the first token overlap the think span, so a naive sum
  // exceeds the total. The remainder must clamp rather than go negative.
  const layout = layoutTurn(
    { total_ms: 1000, stt_ms: 400, first_token_ms: 900, tts_ms: 400 },
    [tool('slow', 1_000_100, 5000)],
    1_000_000,
  )
  if (layout.unaccountedMs < 0) fail(`negative remainder: ${layout.unaccountedMs}`)
}

{
  // And when nothing explains the time, the gap is reported rather than hidden —
  // that is the whole reason the segment exists.
  const layout = layoutTurn({ total_ms: 5000, stt_ms: 500 }, [], 0)
  if (layout.unaccountedMs !== 4500) fail(`gap should be 4500, got ${layout.unaccountedMs}`)
}

// --- degenerate input -------------------------------------------------------

{
  if (layoutTurn(undefined, [], 0).segments.length) fail('no timings should mean no bars')
  if (layoutTurn({ total_ms: 0 }, [], 0).segments.length) fail('a zero turn should mean no bars')
  if (layoutTurn({ total_ms: 0 }, [], 0).dominant !== null) fail('a zero turn has no dominant')

  // A tool with no duration yet (still running when the turn ended) is not a bar.
  const layout = layoutTurn({ total_ms: 1000 }, [tool('open', 0, undefined)], 0)
  if (layout.segments.some((s) => s.kind === 'tool')) fail('an unfinished tool should not draw')

  // A tool timestamped before the turn started must not render off the left edge.
  const skewed = layoutTurn({ total_ms: 1000 }, [tool('early', 500, 100)], 1000)
  const bar = skewed.segments.find((s) => s.kind === 'tool')
  if (bar.offset !== 0) fail(`clock skew should floor the offset, got ${bar.offset}`)
}

// --- formatting -------------------------------------------------------------

{
  if (formatMs(840) !== '840ms') fail(`formatMs(840) = ${formatMs(840)}`)
  if (formatMs(1200) !== '1.2s') fail(`formatMs(1200) = ${formatMs(1200)}`)
  if (formatMs(0) !== '0ms') fail(`formatMs(0) = ${formatMs(0)}`)
}

// --- report -----------------------------------------------------------------

if (failures.length) {
  console.error(`verify-waterfall: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  'verify-waterfall: ok — bars stay inside the track, think excludes stt, ' +
    'the remainder never goes negative, and clock skew floors at zero',
)
