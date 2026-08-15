import { useCallback, useEffect, useState } from 'react'

import { USAGE_CAVEAT, type UsageReport } from '../../shared/bloom'
import { SmallButton } from '../infra/parts'

/**
 * What Bloom has spent.
 *
 * Three sources in one document, because none of them can answer the question
 * alone: model spend comes from the runtime's own ledger, tool calls from the MCP
 * layer, and run counts from Bloom itself — neither library knows what a *run* is.
 *
 * **Every total here is a floor, and says so.** When a stop condition fires, the
 * runtime makes one further model call that it does not report, so a run stopped by
 * a ceiling under-reports by exactly one completion. That is upstream behaviour, and
 * a number presented as exact would be quietly wrong in precisely the cases a person
 * is most likely to be investigating.
 *
 * `tools: null` is not zero. It means Bloom's MCP server is not mounted — nobody
 * *could* have called it — which is a different fact from nobody having done so.
 */
export function Usage(): React.JSX.Element {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [since, setSince] = useState<'' | '24h' | '7d' | '30d'>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await window.aperture.bloom.usage(sinceIso(since))
    if (result.ok) {
      setReport(result.value)
      setError(null)
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [since])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted">
          Spend, tool calls and run counts, straight from Bloom's own tables.
        </p>
        {(['', '24h', '7d', '30d'] as const).map((window_) => (
          <RangeButton key={window_} active={since === window_} onClick={() => setSince(window_)}>
            {window_ === '' ? 'All time' : window_}
          </RangeButton>
        ))}
        <SmallButton onClick={() => void refresh()}>
          {loading ? 'Reading…' : 'Refresh'}
        </SmallButton>
      </div>

      {error && <p className="text-meta text-danger">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Runs" value={String(report.runs.runs)} />
            <Stat
              label="Spend"
              value={`at least $${report.models.totalCostUsd.toFixed(4)}`}
            />
            <Stat
              label="Succeeded"
              value={`${report.runs.succeeded} of ${report.runs.runs}`}
            />
            <Stat
              label="Tokens"
              value={`${report.models.tokensIn + report.models.tokensOut}`}
            />
          </div>

          {report.runs.byAgent.length > 0 && (
            <Section title="By agent">
              {report.runs.byAgent.map((row) => (
                <Row key={row.agent} left={row.agent} right={`${row.runs} · $${row.costUsd.toFixed(4)}`} />
              ))}
            </Section>
          )}

          {report.models.byModel.length > 0 && (
            <Section title="By model">
              {report.models.byModel.map((row) => (
                <Row
                  key={row.model}
                  left={row.model}
                  right={`${row.calls} · $${row.costUsd.toFixed(4)}`}
                />
              ))}
            </Section>
          )}

          {report.tools === null ? (
            <p className="text-xs text-muted">
              Bloom's MCP server is not mounted, so nothing could have called it. No
              tool figures to show — which is different from none having happened.
            </p>
          ) : (
            <Section title="Tools">
              <Row
                left="calls"
                right={`${report.tools.totals.calls} · ${report.tools.totals.errors} failed`}
              />
              {report.tools.byCaller.map((row) => (
                <Row key={row.caller} left={row.caller} right={String(row.calls)} />
              ))}
            </Section>
          )}

          <p className="text-micro text-muted">{report.caveat || USAGE_CAVEAT}</p>
        </>
      )}
    </div>
  )
}

function sinceIso(window_: '' | '24h' | '7d' | '30d'): string | undefined {
  if (!window_) return undefined
  const hours = window_ === '24h' ? 24 : window_ === '7d' ? 24 * 7 : 24 * 30
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-field border border-line bg-ground px-3 py-2">
      <div className="text-meta text-muted">{label}</div>
      <div className="font-mono text-body text-ink">{value}</div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta font-semibold tracking-wide text-muted uppercase">{title}</span>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  )
}

function Row({ left, right }: { left: string; right: string }): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 font-mono text-meta">
      <span className="min-w-0 flex-1 truncate text-ink/80">{left}</span>
      <span className="shrink-0 text-muted">{right}</span>
    </li>
  )
}

function RangeButton({
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
