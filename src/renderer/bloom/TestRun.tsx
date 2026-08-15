import { useState } from 'react'

import type { AgentConfig } from '../../shared/bloom'
import { SmallButton } from '../infra/parts'
import { useStore } from '../store'
import { TraceView } from './TraceView'

/**
 * Handing an agent a task and watching it work.
 *
 * Bloom answers the start request with a run id *before* the run finishes — the
 * whole reason that endpoint is 202 rather than synchronous — and main opens the
 * stream on that id straight away. Because Bloom replays a run's log from the start
 * before tailing it, there is no race: attaching a moment late loses nothing.
 *
 * Stop is two things on the server (cancel the run, close the stream) and one button
 * here. The outcome still arrives as an ordinary terminal event, so nothing in the
 * trace below needs a special case for it.
 */
export function TestRun({ agent }: { agent: AgentConfig }): React.JSX.Element {
  const [input, setInput] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useStore((s) => (runId ? s.bloomRuns[runId] : undefined))
  const inFlight = runId !== null && !run?.done

  const start = async (): Promise<void> => {
    const task = input.trim()
    if (!task) return
    setBusy(true)
    setError(null)
    const result = await window.aperture.bloom.testRun(agent.id, task)
    setBusy(false)
    if (result.ok) setRunId(result.value.runId)
    else setError(result.error)
  }

  const stop = async (): Promise<void> => {
    if (!runId) return
    const result = await window.aperture.bloom.cancelRun(runId)
    // A 409 here means it finished while the click was in flight — not worth an
    // error banner, since the trace below already says so.
    if (!result.ok && result.code !== 'conflict') setError(result.error)
  }

  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-raised/50 p-3">
      <div>
        <h3 className="text-sm font-medium">Test {agent.slug}</h3>
        <p className="text-xs text-muted">
          The same path Amber uses when she delegates — this run appears in the
          history beside hers.
        </p>
      </div>

      {error && <p className="text-meta text-danger">{error}</p>}

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={3}
        placeholder="Put on something mellow."
        className="w-full resize-y rounded-field border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-accent-deep"
      />

      <div className="flex items-center gap-2">
        <SmallButton
          primary
          disabled={busy || inFlight || !input.trim()}
          title={inFlight ? 'A run is already going.' : !input.trim() ? 'Type a task first.' : undefined}
          onClick={() => void start()}
        >
          {busy ? 'Starting…' : 'Run'}
        </SmallButton>
        {inFlight && (
          <SmallButton danger onClick={() => void stop()}>
            Stop
          </SmallButton>
        )}
        {runId && (
          <span className="font-mono text-micro text-muted">{runId.slice(0, 8)}</span>
        )}
      </div>

      {runId && <TraceView runId={runId} />}
    </div>
  )
}
