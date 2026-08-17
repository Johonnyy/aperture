/**
 * Turning a finished turn into waterfall bars.
 *
 * Amber could always tell you a turn took eight seconds and never where they went. She
 * now reports the three spans only the server can see — transcription, the wait for the
 * first token, and synthesis — and every tool call has always arrived as an `activity`
 * pair carrying its own duration. This is the join.
 *
 * **Two clocks, and that is the whole difficulty.** The server's `timings` are
 * durations measured with its own monotonic clock; the client's activities carry a
 * local `Date.now()` at dispatch and a server-measured `ms`. They cannot be placed on
 * one absolute timeline without a clock sync nobody wants. So the layout uses each
 * source for what it is actually good for: server durations give the *widths* of the
 * pipeline stages, and activity timestamps give tool bars their *offsets relative to
 * each other*, anchored to the turn's own start. The result is honest about proportion
 * and does not pretend to millisecond alignment between the two.
 *
 * **The unaccounted remainder is the point, not an error.** If the stages and tools
 * don't fill `total_ms`, the gap is real — model generation between tool calls,
 * queueing, network. Showing it is the difference between a chart that explains a slow
 * turn and one that quietly hides the part you needed.
 *
 * DOM-free and dependency-free on purpose, like `infra/registry-layout.ts`, so
 * `scripts/verify-waterfall.mjs` can assert the invariants without a browser.
 */

/** The kinds of work a turn does, in the order they first happen. */
export type SegmentKind = 'stt' | 'think' | 'tool' | 'speak' | 'gap'

export interface Segment {
  kind: SegmentKind
  label: string
  ms: number
  /** Fraction of the turn, 0..1. */
  fraction: number
  /** Where the bar starts, 0..1. Tools are laid out in the order they ran. */
  offset: number
  /** Peer name for a peer call, so a bar can say who it was waiting on. */
  detail?: string
}

export interface TurnLayout {
  totalMs: number
  segments: Segment[]
  /** Time the turn spent somewhere none of the segments explain. */
  unaccountedMs: number
  /** The single largest segment — what to blame when a turn felt slow. */
  dominant: Segment | null
}

export interface TurnTimings {
  total_ms: number
  stt_ms?: number
  first_token_ms?: number
  tts_ms?: number
}

export interface ToolSpan {
  name: string
  origin: string
  /** Client `Date.now()` when the call was dispatched. */
  ts: number
  ms?: number
}

const LABELS: Record<SegmentKind, string> = {
  stt: 'Heard you',
  think: 'Thinking',
  tool: 'Tool',
  speak: 'Speaking',
  gap: 'Unaccounted',
}

/**
 * Build the bars for one turn.
 *
 * `turnStart` is the client timestamp the turn began at — the preceding user message's
 * `ts`. Tool offsets are measured from it; when a tool predates it (a clock skew, or a
 * call attributed to the wrong turn) the offset floors at zero rather than going
 * negative, because a bar with a negative offset renders off the left edge and looks
 * like a bug rather than the data problem it is.
 */
export function layoutTurn(
  timings: TurnTimings | undefined,
  tools: readonly ToolSpan[],
  turnStart: number,
): TurnLayout {
  const totalMs = Math.max(0, timings?.total_ms ?? 0)
  if (totalMs <= 0) return { totalMs: 0, segments: [], unaccountedMs: 0, dominant: null }

  const span = (ms: number): number => Math.min(1, Math.max(0, ms / totalMs))
  const segments: Segment[] = []
  let accounted = 0

  const stt = timings?.stt_ms ?? 0
  if (stt > 0) {
    segments.push({ kind: 'stt', label: LABELS.stt, ms: stt, fraction: span(stt), offset: 0 })
    accounted += stt
  }

  // The wait before the first word, minus what transcription already explained.
  const think = Math.max(0, (timings?.first_token_ms ?? 0) - stt)
  if (think > 0) {
    segments.push({
      kind: 'think',
      label: LABELS.think,
      ms: think,
      fraction: span(think),
      offset: span(stt),
    })
    accounted += think
  }

  for (const tool of tools) {
    const ms = tool.ms ?? 0
    if (ms <= 0) continue
    segments.push({
      kind: 'tool',
      label: tool.name,
      ms,
      fraction: span(ms),
      offset: span(Math.max(0, tool.ts - turnStart)),
      detail: tool.origin.startsWith('peer:') ? tool.origin.slice(5) : undefined,
    })
    accounted += ms
  }

  const tts = timings?.tts_ms ?? 0
  if (tts > 0) {
    segments.push({
      kind: 'speak',
      label: LABELS.speak,
      ms: tts,
      fraction: span(tts),
      // Synthesis interleaves with generation rather than following it, so anchoring
      // the bar to the end of the turn is the honest placement: it says "this much of
      // the turn was spent speaking", not "it happened at this instant".
      offset: Math.max(0, 1 - span(tts)),
    })
    accounted += tts
  }

  // Tools run *inside* the first-token wait when they precede the first word, so the
  // two genuinely overlap and a naive sum can exceed the turn. Clamp rather than
  // report a negative remainder, which would be a nonsense number on screen.
  const unaccountedMs = Math.max(0, totalMs - accounted)

  const dominant = segments.reduce<Segment | null>(
    (worst, s) => (worst === null || s.ms > worst.ms ? s : worst),
    null,
  )

  return { totalMs, segments, unaccountedMs, dominant }
}

/** `1.2s` / `840ms`, matching how `ActivityCard` already prints a duration. */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}
