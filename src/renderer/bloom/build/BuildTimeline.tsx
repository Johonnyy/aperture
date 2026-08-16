import * as Collapsible from '@radix-ui/react-collapsible'
import { AlertTriangle, Check, ChevronRight, Loader2, X } from 'lucide-react'
import { useState } from 'react'

import type { BloomRunEvent } from '../../../shared/bloom'
import { cn } from '../../cn'
import { useStore } from '../../store'
import { CostStrip } from './CostStrip'
import { PhaseRail } from './PhaseRail'
import { labelOf, phaseOf, phaseStates, PHASES, type PhaseId } from './phases'

/**
 * What a run is doing, live or afterwards — one renderer for both.
 *
 * That is inherited from the flat `TraceView` this replaces, and it is not a
 * convenience. The same records arrive over SSE while a run is going and over the
 * trace endpoint once it has finished, which is why Bloom returns them identically.
 * A live view and a history view that drifted apart would be two descriptions of the
 * same events, and one of them would be wrong.
 */
export function BuildTimeline({ runId }: { runId: string }): React.JSX.Element {
  const run = useStore((s) => s.bloomRuns[runId])

  if (!run) {
    return (
      <p className="flex items-center gap-2 text-meta text-muted">
        <Loader2 className="size-3 animate-spin" />
        Waiting for the run to start…
      </p>
    )
  }

  const tools = run.events.filter((e) => e.kind === 'tool_started')
  const finishes = new Map(
    run.events
      .filter((e) => e.kind === 'tool_finished')
      .map((e) => [e.payload.tool_call_id ?? e.toolName, e] as const),
  )
  const steps = run.events.filter((e) => e.kind === 'step_finished')
  const started = run.events.find((e) => e.kind === 'run_started')
  const finished = run.events.find((e) => e.kind === 'run_finished')
  const stoppedBy = finished?.payload.stopped_by as string | undefined

  const states = phaseStates(
    tools.map((t) => t.toolName),
    Boolean(run.done),
  )

  // The agent's name is only knowable from the arguments of the call that created
  // it, so the header fills in partway through rather than being known up front.
  const created = tools.find((t) => t.toolName === 'bloom_create_agent')
  const name = argOf(created, 'name') ?? argOf(created, 'slug')
  const keyword = argOf(created, 'model_keyword')

  return (
    <div className="flex flex-col gap-3">
      <Header
        name={name ?? String(started?.payload.agent_slug ?? 'agent')}
        keyword={keyword}
        run={run}
        toolCount={tools.length}
      />

      {run.streamLost && !run.done && (
        // The stream and the run are different facts. This says contact was lost and
        // pointedly does not claim the run ended.
        <p className="flex items-start gap-2 rounded-field border border-warn/50 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {run.streamLost} The run may still be going — reopen it from the history to
            see how it ended.
          </span>
        </p>
      )}

      <PhaseRail states={states} />

      <div className="flex flex-col gap-2">
        {PHASES.map((phase) => (
          <PhaseGroup
            key={phase.id}
            id={phase.id}
            label={phase.label}
            tools={tools.filter((t) => phaseOf(t.toolName) === phase.id)}
            finishes={finishes}
          />
        ))}
        <PhaseGroup
          id="work"
          label="Other"
          tools={tools.filter((t) => phaseOf(t.toolName) === 'work')}
          finishes={finishes}
        />
      </div>

      <CostStrip steps={steps} stopped={Boolean(stoppedBy)} />

      {stoppedBy && (
        <p className="text-meta text-warn">
          Truncated — this run hit its {stoppedBy.includes('Cost') ? 'cost' : 'step'}{' '}
          ceiling before finishing.
        </p>
      )}
      {run.done?.error && <p className="text-meta text-danger">{run.done.error}</p>}
    </div>
  )
}

function Header({
  name,
  keyword,
  run,
  toolCount,
}: {
  name: string
  keyword?: string
  run: { done: { status: string } | null }
  toolCount: number
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-lead font-semibold text-ink">{name}</span>
      {keyword && (
        <span className="rounded-control border border-line px-1.5 py-0.5 text-nano tracking-wide text-muted uppercase">
          {keyword}
        </span>
      )}
      <StatusPill status={run.done?.status} />
      <span className="flex-1" />
      <span className="font-mono text-nano text-muted tabular-nums">
        {toolCount} call{toolCount === 1 ? '' : 's'}
      </span>
    </div>
  )
}

function StatusPill({ status }: { status?: string }): React.JSX.Element {
  if (!status) {
    return (
      <span className="flex items-center gap-1 rounded-control border border-accent-deep bg-accent/15 px-1.5 py-0.5 text-nano tracking-wide text-accent-hi uppercase">
        <Loader2 className="size-2.5 animate-spin" /> running
      </span>
    )
  }
  const ok = status === 'succeeded'
  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded-control border px-1.5 py-0.5 text-nano tracking-wide uppercase',
        ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-danger/40 bg-danger/10 text-danger',
      )}
    >
      {ok ? <Check className="size-2.5" /> : <X className="size-2.5" />}
      {status}
    </span>
  )
}

/** One phase's calls, collapsed to a heading until you want them. */
function PhaseGroup({
  id,
  label,
  tools,
  finishes,
}: {
  id: PhaseId | 'work'
  label: string
  tools: BloomRunEvent[]
  finishes: Map<unknown, BloomRunEvent>
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (tools.length === 0) return null

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="flex w-full items-center gap-2 py-1 text-left">
        <ChevronRight
          className={cn('size-3 text-muted transition-transform', open && 'rotate-90')}
        />
        <span className="text-nano tracking-wide text-muted uppercase">{label}</span>
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-nano text-muted tabular-nums">
          {tools.length}
        </span>
      </Collapsible.Trigger>

      <Collapsible.Content>
        <ul className="flex flex-col gap-1 pt-1 pl-5">
          {tools.map((tool) => (
            <ToolRow
              key={`${id}-${tool.id}`}
              tool={tool}
              end={finishes.get(tool.payload.tool_call_id ?? tool.toolName)}
            />
          ))}
        </ul>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

function ToolRow({
  tool,
  end,
}: {
  tool: BloomRunEvent
  end?: BloomRunEvent
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const failed = end?.ok === false
  const result = end?.payload.result as string | undefined
  const args = tool.payload.args as string | undefined

  return (
    <li>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className="flex w-full items-center gap-2 py-0.5 text-left">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              !end ? 'animate-pulse-dot bg-accent' : failed ? 'bg-danger' : 'bg-ok',
            )}
          />
          <span
            className={cn('min-w-0 flex-1 truncate text-meta', failed ? 'text-danger' : 'text-ink/80')}
          >
            {labelOf(tool.toolName)}
          </span>
          {end?.latencyMs != null && (
            <span className="shrink-0 font-mono text-nano text-muted tabular-nums">
              {end.latencyMs}ms
            </span>
          )}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div className="flex flex-col gap-1.5 py-1.5 pl-3.5">
            {args && <Pre label="Arguments" text={prettify(args)} />}
            {result && <Pre label="Result" text={result} failed={failed} />}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </li>
  )
}

function Pre({
  label,
  text,
  failed,
}: {
  label: string
  text: string
  failed?: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-nano tracking-wide text-muted uppercase">{label}</span>
      <pre
        className={cn(
          'max-h-48 overflow-auto rounded-control bg-ground px-2 py-1.5 text-meta whitespace-pre-wrap',
          failed ? 'text-danger' : 'text-muted',
        )}
      >
        {text}
      </pre>
    </div>
  )
}

/** Bloom sends arguments as a JSON *string*; indent it so it can be read. */
function prettify(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function argOf(event: BloomRunEvent | undefined, key: string): string | undefined {
  if (!event) return undefined
  try {
    const parsed = JSON.parse(String(event.payload.args ?? '{}')) as Record<string, unknown>
    const value = parsed[key]
    return typeof value === 'string' && value.trim() ? value : undefined
  } catch {
    return undefined
  }
}
