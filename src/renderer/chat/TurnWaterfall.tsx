import { useState } from 'react'

import { cn } from '../cn'
import { formatMs, layoutTurn, type SegmentKind, type ToolSpan, type TurnTimings } from './turn-layout'

/**
 * Why that turn took as long as it did.
 *
 * A turn that felt slow has a shape — a long transcription, a peer call that ran for
 * two minutes, synthesis grinding through six sentences — and until Amber started
 * reporting her own timings there was no way to tell those apart from the outside. The
 * only honest answer available was "it was slow".
 *
 * Collapsed to one line by default, because most turns are fine and a chart per turn
 * would bury the conversation it is annotating. The line itself carries the answer —
 * total, and what dominated it — so expanding is for when you want the breakdown, not
 * for finding out whether you need it.
 *
 * The **unaccounted** segment is deliberately visible. If the measured stages don't
 * fill the turn, that gap is real time the user waited, and hiding it would make this a
 * chart that reassures rather than one that explains.
 */
export function TurnWaterfall({
  timings,
  tools,
  turnStart,
}: {
  timings: TurnTimings | undefined
  tools: readonly ToolSpan[]
  turnStart: number
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const layout = layoutTurn(timings, tools, turnStart)

  if (layout.totalMs <= 0) return null

  return (
    <div className="mx-auto w-full max-w-3xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-control px-1 py-0.5 text-nano text-muted transition hover:text-ink"
      >
        <span className="font-mono tabular-nums">{formatMs(layout.totalMs)}</span>
        {layout.dominant && (
          <span className="truncate">
            mostly {layout.dominant.label.toLowerCase()} (
            {Math.round(layout.dominant.fraction * 100)}%)
          </span>
        )}
        <span className="ml-auto shrink-0">{open ? 'hide' : 'why'}</span>
      </button>

      {open && (
        <ol className="mt-1 flex flex-col gap-1 rounded-field border border-line px-2 py-2">
          {layout.segments.map((segment, i) => (
            <li key={`${segment.kind}-${i}`} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-nano text-muted" title={segment.label}>
                {segment.label}
                {segment.detail && <span className="text-accent"> ·{segment.detail}</span>}
              </span>
              {/* The track is the turn; the bar is this segment's share of it. */}
              <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-control bg-line/40">
                <span
                  className={cn('absolute inset-y-0 rounded-control', TONE[segment.kind])}
                  style={{
                    left: `${segment.offset * 100}%`,
                    // A floor, so a 3ms call is still a visible mark rather than
                    // nothing at all — same reason `CostStrip` floors its heights.
                    width: `${Math.max(1.5, segment.fraction * 100)}%`,
                  }}
                />
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-nano text-muted tabular-nums">
                {formatMs(segment.ms)}
              </span>
            </li>
          ))}

          {layout.unaccountedMs > 0 && (
            <li className="flex items-center gap-2 pt-0.5">
              <span className="w-24 shrink-0 text-nano text-muted">Unaccounted</span>
              <span
                className="h-2 min-w-0 flex-1 rounded-control border border-dashed border-line"
                aria-hidden
              />
              <span className="w-12 shrink-0 text-right font-mono text-nano text-muted tabular-nums">
                {formatMs(layout.unaccountedMs)}
              </span>
            </li>
          )}
        </ol>
      )}
    </div>
  )
}

const TONE: Record<SegmentKind, string> = {
  stt: 'bg-muted',
  think: 'bg-accent-deep',
  tool: 'bg-accent',
  speak: 'bg-ok',
  gap: 'bg-line',
}
