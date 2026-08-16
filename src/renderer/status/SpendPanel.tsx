import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useStore } from '../store'

/**
 * What this session has cost.
 *
 * Worth knowing why this panel could not have existed a week ago: `AgentRunner.stream`
 * built its bookkeeping state inline and threw it away, and the recording step was
 * reachable only from `run()` — which Amber never calls. So every voice turn
 * discarded its model, token counts and cost, and Amber had never written a single
 * cost row despite carefully pointing the tracker at her own database. The numbers
 * below are newly *knowable*, not newly collected.
 *
 * Recharts rather than hand-rolled SVG here, unlike the rest of `viz/`: this is a
 * real chart with axes and a tooltip, at a size where a library earns its weight.
 * Every colour is passed explicitly as a CSS variable — `verify:theme` forbids hex
 * literals, and a library's default palette would fight all six themes anyway.
 */
export function SpendPanel(): React.JSX.Element {
  const turns = useStore((s) => s.turnStats)

  if (turns.length === 0) {
    return (
      <p className="text-meta text-muted">
        Nothing spent yet this session.
      </p>
    )
  }

  const total = turns.reduce((sum, t) => sum + t.cost_usd, 0)
  const tokens = turns.reduce((sum, t) => sum + t.tokens_in + t.tokens_out, 0)
  const data = turns.map((turn, i) => ({
    turn: i + 1,
    in: turn.tokens_in,
    out: turn.tokens_out,
    cost: turn.cost_usd,
  }))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-lead text-ink tabular-nums">
          ${total.toFixed(4)}
        </span>
        <span className="font-mono text-nano text-muted tabular-nums">
          {tokens.toLocaleString()} tok · {turns.length} turn
          {turns.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="h-24 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid
              vertical={false}
              stroke="var(--color-line)"
              strokeDasharray="2 2"
            />
            <XAxis dataKey="turn" hide />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: 'var(--color-accent)', fillOpacity: 0.08 }}
              contentStyle={{
                background: 'var(--color-raised)',
                border: '1px solid var(--color-line)',
                borderRadius: 'var(--radius-control)',
                fontSize: 11,
                color: 'var(--color-ink)',
              }}
              labelFormatter={(turn) => `Turn ${turn}`}
              formatter={(value, name) => [Number(value).toLocaleString(), name]}
            />
            {/* Stacked, because in and out are the same budget seen twice — and the
                ratio between them is the thing worth noticing when a turn is dear. */}
            <Bar dataKey="in" stackId="tok" fill="var(--color-accent-deep)" />
            <Bar dataKey="out" stackId="tok" fill="var(--color-accent)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-3 text-nano text-muted">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-accent-deep" /> prompt
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-accent" /> reply
        </span>
        <span className="flex-1" />
        <span className="truncate font-mono">{turns.at(-1)?.model}</span>
      </div>
    </div>
  )
}
