import { Hourglass, Loader2, Square } from 'lucide-react'
import { useEffect, useState } from 'react'

import { PhaseRail } from '../bloom/build/PhaseRail'
import { phaseStates } from '../bloom/build/phases'
import { useStore } from '../store'
import { Dot } from '../viz/primitives'

/**
 * What is happening right now, across both kinds of work.
 *
 * Amber's own tool calls and Bloom's runs, in one list, because from the outside
 * they are the same question — "is something still going, and how long has it been
 * going for". Keeping them in separate panels would mean a build kicked off by voice
 * appeared in neither: it is Amber's call *and* Bloom's run.
 *
 * This is the section that stays expanded on every tab. A build takes minutes, and
 * the whole point of the rebuild is that wandering off to Settings should not mean
 * losing sight of it.
 *
 * Background watches belong here for the same reason and are the strongest case for it:
 * a watch exists *because* the turn that started it already ended, so the chat card it
 * came from has long since closed. Without a row here there is no surface at all
 * between starting one and being told it finished, however long that takes.
 */
export function RunningPanel(): React.JSX.Element {
  const timeline = useStore((s) => s.timeline)
  const runs = useStore((s) => s.bloomRuns)

  const waits = useStore((s) => s.status?.waits ?? [])

  const calls = timeline.filter(
    (item) => item.kind === 'activity' && item.running,
  )
  const live = Object.entries(runs).filter(([, run]) => !run.done)

  if (calls.length === 0 && live.length === 0 && waits.length === 0) {
    return <p className="text-meta text-muted">Nothing running.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {calls.map(
        (item) =>
          item.kind === 'activity' && (
            <div key={item.id} className="flex items-center gap-1.5">
              <Dot tone="accent" pulse />
              <span className="min-w-0 flex-1 truncate text-meta text-ink/85">
                {item.name}
              </span>
              <Elapsed since={item.ts} />
            </div>
          ),
      )}

      {waits.map((wait) => (
        <div key={wait.id} className="flex items-center gap-1.5">
          <Hourglass className="size-3 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-meta text-ink/85" title={wait.check}>
            {wait.what}
          </span>
          <span className="shrink-0 font-mono text-nano text-muted tabular-nums">
            ×{wait.attempts}
          </span>
          <Elapsed since={Date.now() - wait.elapsed_s * 1000} />
          <button
            type="button"
            title={`Stop waiting for ${wait.what}`}
            onClick={() => void window.aperture.amber.cancelWait(wait.id)}
            className="shrink-0 rounded-control p-0.5 text-muted transition hover:text-danger"
          >
            <Square className="size-2.5 fill-current" />
          </button>
        </div>
      ))}

      {live.map(([runId, run]) => {
        const tools = run.events
          .filter((e) => e.kind === 'tool_started')
          .map((e) => e.toolName)
        const started = run.events.find((e) => e.kind === 'run_started')
        const cost = run.events.reduce((sum, e) => sum + (e.costUsd ?? 0), 0)

        return (
          <div key={runId} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Loader2 className="size-3 shrink-0 animate-spin text-accent" />
              <span className="min-w-0 flex-1 truncate text-meta text-ink">
                {String(started?.payload.agent_slug ?? 'building…')}
              </span>
              {cost > 0 && (
                <span className="shrink-0 font-mono text-nano text-muted tabular-nums">
                  ${cost.toFixed(3)}
                </span>
              )}
              <button
                type="button"
                title="Stop this run"
                onClick={() => void window.aperture.bloom.cancelRun(runId)}
                className="shrink-0 rounded-control p-0.5 text-muted transition hover:text-danger"
              >
                <Square className="size-2.5 fill-current" />
              </button>
            </div>
            <PhaseRail states={phaseStates(tools, false)} />
          </div>
        )
      })}
    </div>
  )
}

/** Counting up, because a number that moves is the difference between working and hung. */
function Elapsed({ since }: { since: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [])
  const s = (now - since) / 1000
  return (
    <span className="shrink-0 font-mono text-nano text-muted tabular-nums">
      {s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, '0')}`}
    </span>
  )
}
