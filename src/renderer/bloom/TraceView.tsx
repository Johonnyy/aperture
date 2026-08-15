import { useEffect, useRef } from 'react'

import type { BloomRunEvent } from '../../shared/bloom'
import { Chip } from '../infra/parts'
import { useStore } from '../store'

/**
 * What a run did, live or afterwards — one renderer for both.
 *
 * That is not a convenience. The same records arrive over SSE while a run is going
 * and over the trace endpoint once it has finished, which is exactly why Bloom
 * returns them identically and why main normalises both into one shape. A live view
 * and a history view that drifted apart would be two descriptions of the same
 * events, and one of them would be wrong.
 *
 * **Honest about what is live.** Text arrives sentence by sentence, not token by
 * token — Bloom will not trade its cost ledger for a smoother cursor — so there is
 * no typing caret here. Every `step_finished` arrives at the *end*, together,
 * because that is when the runtime makes it available; staggering them to look
 * live would be a lie the user eventually notices.
 *
 * Two states are labelled rather than hidden: a run stopped by a ceiling has a
 * **truncated** answer, and a stopped run's cost under-reports by exactly one model
 * call, so totals read "at least".
 */
export function TraceView({ runId }: { runId: string }): React.JSX.Element {
  const run = useStore((s) => s.bloomRuns[runId])
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [run?.events.length])

  if (!run) {
    return <p className="font-mono text-meta text-muted">Waiting for the run to start…</p>
  }

  const answer = run.events
    .filter((e) => e.kind === 'text')
    .map((e) => String(e.payload.text ?? ''))
    .join(' ')
    .trim()

  const finished = run.events.find((e) => e.kind === 'run_finished')
  const stoppedBy = finished?.payload.stopped_by as string | undefined
  const cost = run.events.reduce((sum, e) => sum + (e.costUsd ?? 0), 0)

  return (
    <div className="flex flex-col gap-3">
      {/* The stream and the run are different facts. This one says contact was lost,
          and pointedly does not claim the run ended. */}
      {run.streamLost && !run.done && (
        <p className="rounded-field border border-warn/50 px-3 py-2 text-xs text-warn">
          {run.streamLost} The run may still be going — reopen it from the history to
          see how it ended.
        </p>
      )}

      {answer && (
        <div className="flex flex-col gap-1">
          <span className="text-meta font-semibold tracking-wide text-muted uppercase">
            Answer
          </span>
          <p className="rounded-field border border-line bg-ground px-3 py-2 text-sm whitespace-pre-wrap text-ink">
            {answer}
          </p>
          {stoppedBy && (
            <p className="text-meta text-warn">
              Truncated — this run hit its {stoppedBy.includes('Cost') ? 'cost' : 'step'}{' '}
              ceiling before finishing.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-meta font-semibold tracking-wide text-muted uppercase">Steps</span>
        <ul className="flex flex-col gap-1.5 font-mono text-meta">
          {run.events.map((event, index) => (
            <Line key={`${event.id}-${index}`} event={event} />
          ))}
          <div ref={endRef} />
        </ul>
      </div>

      {run.done && (
        <p className="text-meta text-muted">
          {run.done.status}
          {cost > 0 && ` · at least $${cost.toFixed(4)}`}
          {run.done.error && ` · ${run.done.error}`}
        </p>
      )}
    </div>
  )
}

const DOT: Record<string, string> = {
  run_started: 'bg-muted',
  text: 'bg-muted',
  tool_started: 'animate-pulse-dot bg-accent',
  tool_finished: 'bg-ok',
  step_finished: 'bg-muted',
  run_finished: 'bg-ok',
  stream_lost: 'bg-danger',
  stream_resumed: 'bg-warn',
}

function Line({ event }: { event: BloomRunEvent }): React.JSX.Element | null {
  // The answer is rendered whole above; repeating each sentence here would double it.
  if (event.kind === 'text') return null

  const dot = event.ok === false ? 'bg-danger' : (DOT[event.kind] ?? 'bg-muted')

  return (
    <li className="flex items-start gap-2 leading-snug">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <span className={event.ok === false ? 'text-danger' : 'text-ink/80'}>{label(event)}</span>
        {detail(event) && (
          <pre className="mt-1 rounded-control bg-ground px-2 py-1.5 whitespace-pre-wrap text-muted">
            {detail(event)}
          </pre>
        )}
      </div>
      {event.kind === 'step_finished' && (
        <Chip>
          {(event.tokensIn ?? 0) + (event.tokensOut ?? 0)} tok
          {event.costUsd ? ` · $${event.costUsd.toFixed(4)}` : ''}
        </Chip>
      )}
    </li>
  )
}

function label(event: BloomRunEvent): string {
  switch (event.kind) {
    case 'run_started':
      return `started · ${event.payload.agent_slug ?? 'agent'} · ${event.payload.model_tier ?? ''}`
    case 'tool_started':
      return `${event.toolName ?? 'tool'} …`
    case 'tool_finished':
      return `${event.toolName ?? 'tool'} ${event.ok === false ? 'failed' : 'ok'}${
        event.latencyMs === null ? '' : ` · ${event.latencyMs}ms`
      }`
    case 'step_finished':
      return `step ${event.stepIndex ?? '?'} · ${event.payload.model ?? ''}`
    case 'run_finished':
      return `finished · ${event.payload.status ?? ''}`
    case 'stream_lost':
      return 'lost contact with this run'
    case 'stream_resumed':
      return 'reconnected'
    default:
      // An event kind this build does not know. Showing it beats omitting a step
      // from a trace someone is reading to work out what happened.
      return event.kind
  }
}

function detail(event: BloomRunEvent): string | null {
  if (event.kind === 'tool_started') return (event.payload.args as string) || null
  if (event.kind === 'tool_finished') return (event.payload.result as string) || null
  if (event.kind === 'stream_lost') return (event.payload.detail as string) || null
  if (event.kind === 'run_finished') return (event.payload.error as string) || null
  return null
}
