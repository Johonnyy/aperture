import type { BloomRunEvent } from '../../../shared/bloom'

/**
 * Every step's spend, as one strip instead of twenty rows.
 *
 * Bloom emits `step_finished` for the whole run at once, at the end, because that is
 * when the runtime makes it available. The old view rendered each as a list item, so
 * a finished build ended in a wall of twenty near-identical token/cost lines — the
 * least useful part of the trace taking the most space.
 *
 * It is drawn all at once for the same reason it arrives all at once. Staggering the
 * bars to look live would be, in `TraceView`'s own words, a lie the user eventually
 * notices.
 *
 * **"at least"** is not hedging. A run stopped by a cost or step ceiling under-reports
 * by exactly one model call — the closing completion produces no `Step` — so the
 * total is a floor, and saying so is cheaper than being quietly wrong.
 */
export function CostStrip({
  steps,
  stopped,
}: {
  steps: BloomRunEvent[]
  stopped: boolean
}): React.JSX.Element | null {
  if (steps.length === 0) return null

  const totals = steps.map((s) => (s.tokensIn ?? 0) + (s.tokensOut ?? 0))
  const peak = Math.max(...totals, 1)
  const cost = steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0)
  const tokens = totals.reduce((a, b) => a + b, 0)
  const model = String(steps[0]?.payload.model ?? '')

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-nano tracking-wide text-muted uppercase">
          {steps.length} step{steps.length === 1 ? '' : 's'}
          {model && ` · ${model}`}
        </span>
        <span className="font-mono text-meta text-ink tabular-nums">
          {tokens.toLocaleString()} tok · {stopped ? 'at least ' : ''}$
          {cost.toFixed(4)}
        </span>
      </div>

      <div className="flex h-8 items-end gap-px" aria-hidden>
        {steps.map((step, i) => {
          const total = totals[i]
          return (
            <div
              key={step.id}
              title={`step ${step.stepIndex ?? i} · ${total} tok${
                step.costUsd ? ` · $${step.costUsd.toFixed(4)}` : ''
              }`}
              style={{ height: `${Math.max(8, (total / peak) * 100)}%` }}
              // Square on purpose: a bar a few pixels wide has no room for a radius,
              // and hardcoding one would be the theme's call to make, not this file's.
              className="min-w-0 flex-1 bg-accent/45 transition-colors hover:bg-accent"
            />
          )
        })}
      </div>
    </div>
  )
}
