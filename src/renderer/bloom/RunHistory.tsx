import { useCallback, useEffect, useState } from 'react'

import type { RunSummary } from '../../shared/bloom'
import { Chip, SmallButton } from '../infra/parts'
import { useStore } from '../store'
import { TraceView } from './TraceView'

/**
 * What has run, and what it did.
 *
 * Used twice — per agent, and globally as the Activity tab — because they are the
 * same list with a different filter. The global one is a single call rather than a
 * fan-out over each agent: pages fetched per agent cannot be ordered against each
 * other without fetching all of them.
 *
 * **`origin` is the row worth reading.** `test_run` is you; `mcp` is *Amber*
 * delegating, with `caller` naming which peer asked. That column is the one place in
 * this app where the whole ecosystem is visible at once — a task you can see her
 * hand off, and the answer she got back.
 *
 * Opening a row fetches its trace and renders it through the same `TraceView` a live
 * run uses, so there is one description of what happened rather than two.
 */
export function RunHistory({ agentId }: { agentId?: string }): React.JSX.Element {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [originFilter, setOriginFilter] = useState<'' | 'mcp' | 'test_run'>('')
  const hydrateRun = useStore((s) => s.hydrateRun)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = agentId
      ? await window.aperture.bloom.agentRuns(agentId, { limit: 50 })
      : await window.aperture.bloom.runs({ limit: 50, origin: originFilter || undefined })
    if (result.ok) {
      setRuns(result.value)
      setError(null)
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [agentId, originFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Load a run's trace into the same store bucket a live run fills.
   *
   * `hydrateRun` merges rather than replaces, which matters here: this run may still
   * be going, with a live stream already writing into that bucket.
   */
  const openRun = async (run: RunSummary): Promise<void> => {
    if (open === run.id) {
      setOpen(null)
      return
    }
    setOpen(run.id)
    const result = await window.aperture.bloom.trace(run.agentConfigId, run.id, 0)
    if (result.ok && result.value) {
      hydrateRun(
        run.id,
        run.agentConfigId,
        result.value.events,
        run.status === 'running'
          ? null
          : { status: run.status, error: run.error ?? undefined },
      )
      // Still going: attach to it, so the rest arrives live rather than needing a
      // refresh. Idempotent, so reopening the same row costs nothing.
      if (run.status === 'running') void window.aperture.bloom.watchRun(run.id)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted">
          {agentId
            ? 'Every run of this agent, newest first.'
            : 'Every run across every agent, newest first.'}
        </p>
        {!agentId && (
          <>
            <FilterButton active={originFilter === ''} onClick={() => setOriginFilter('')}>
              All
            </FilterButton>
            <FilterButton active={originFilter === 'mcp'} onClick={() => setOriginFilter('mcp')}>
              From Amber
            </FilterButton>
            <FilterButton
              active={originFilter === 'test_run'}
              onClick={() => setOriginFilter('test_run')}
            >
              From here
            </FilterButton>
          </>
        )}
        <SmallButton onClick={() => void refresh()}>
          {loading ? 'Reading…' : 'Refresh'}
        </SmallButton>
      </div>

      {error && <p className="text-meta text-danger">{error}</p>}

      {!loading && runs.length === 0 && (
        <p className="text-sm text-muted">
          Nothing has run yet. Test an agent, or ask Amber to delegate to one.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {runs.map((run) => (
          <li key={run.id} className="rounded-panel border border-line bg-raised/50 p-3">
            <button
              type="button"
              onClick={() => void openRun(run)}
              className="flex w-full flex-wrap items-center gap-2 text-left"
            >
              <StatusChip run={run} />
              <span className="font-mono text-meta text-ink">{run.agentSlug ?? '(deleted)'}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{run.prompt}</span>
              <span className="shrink-0 text-micro text-muted">{originLabel(run)}</span>
              <span className="shrink-0 font-mono text-micro text-muted">
                {when(run.startedAt)}
              </span>
            </button>

            {open === run.id && (
              <div className="mt-3 border-t border-line pt-3">
                {/* Abandoned is not a failure the agent had — it is Bloom having
                    restarted underneath it, and saying so beats a bare word. */}
                {run.status === 'abandoned' && (
                  <p className="mb-2 text-meta text-warn">
                    Bloom restarted while this run was going, so it was closed out.
                    Whether the work completed is unknown.
                  </p>
                )}
                <TraceView runId={run.id} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusChip({ run }: { run: RunSummary }): React.JSX.Element {
  const tone =
    run.status === 'succeeded'
      ? 'ok'
      : run.status === 'failed'
        ? 'danger'
        : run.status === 'running'
          ? 'muted'
          : 'warn'
  return <Chip tone={tone}>{run.status}</Chip>
}

/** Plain language, because "mcp" is not what a person wants to read. */
function originLabel(run: RunSummary): string {
  if (run.origin !== 'mcp') return 'you'
  return run.caller ? `via ${run.caller}` : 'delegated'
}

function when(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function FilterButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded-control px-2 py-0.5 text-micro transition-colors',
        active ? 'bg-accent/15 text-accent-hi' : 'text-muted hover:bg-ink/5 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
