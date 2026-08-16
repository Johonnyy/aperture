import { Check, Loader2 } from 'lucide-react'

import { cn } from '../../cn'
import { PHASES, type PhaseState } from './phases'

/**
 * The build's arc, as four chips that fill in order.
 *
 * The single biggest legibility win over the flat list: it answers "how far along is
 * this, and what is it doing right now" without reading a single tool name.
 */
export function PhaseRail({
  states,
}: {
  states: Record<string, PhaseState>
}): React.JSX.Element {
  return (
    <ol className="flex items-stretch gap-1.5">
      {PHASES.map((phase) => {
        const state = states[phase.id] ?? 'pending'
        return (
          <li key={phase.id} className="min-w-0 flex-1" title={phase.hint}>
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-control border px-2 py-1.5 transition',
                state === 'done' && 'border-ok/40 bg-ok/10 text-ok',
                state === 'active' && 'border-accent-deep bg-accent/15 text-accent-hi',
                state === 'pending' && 'border-line text-muted',
              )}
            >
              {state === 'done' && <Check className="size-3 shrink-0" />}
              {state === 'active' && (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              )}
              {state === 'pending' && (
                <span className="size-3 shrink-0 rounded-full border border-current opacity-40" />
              )}
              <span className="truncate text-meta">{phase.label}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
