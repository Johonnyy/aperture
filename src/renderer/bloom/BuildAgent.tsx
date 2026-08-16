import { useCallback, useEffect, useState } from 'react'

import type { Build, Connection } from '../../shared/bloom'
import { Chip, SmallButton } from '../infra/parts'
import { useStore } from '../store'
import { SetupChecklist } from './SetupChecklist'
import { TraceView } from './TraceView'

/**
 * Describing an agent instead of configuring one.
 *
 * You type what you want — "a Spotify agent that can play and search music" — and
 * Bloom researches the service, prefers an MCP server over anything it would have
 * to build itself, picks a model keyword from the work, creates the agent and its
 * connections, and hands back the steps you still have to do.
 *
 * **Nothing here is a new transport.** A build *is* a run on Bloom's side, so this
 * starts one, gets a `runId` back, and renders the same `TraceView` the test-run
 * panel uses — including its live SSE tail and its resume-after-a-dropped-socket
 * behaviour. That reuse is the entire payoff of Bloom modelling a build as a run.
 *
 * The two halves settle at different times, which is why they are separate state:
 * the trace is live, and the build row is only worth re-reading once the run has
 * finished. Polling it during the run would tell us nothing the trace does not.
 */
export function BuildAgent({
  onBuilt,
}: {
  /** Refresh the agent list — a build usually adds one. */
  onBuilt: () => void
}): React.JSX.Element {
  const [brief, setBrief] = useState('')
  const [buildId, setBuildId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [build, setBuild] = useState<Build | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useStore((s) => (runId ? s.bloomRuns[runId] : undefined))
  const inFlight = runId !== null && !run?.done

  const refreshBuild = useCallback(
    async (id: string) => {
      const result = await window.aperture.bloom.build(id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const value = result.value
      setBuild(value)
      if (value?.agentConfigId) {
        const attached = await window.aperture.bloom.agentConnections(value.agentConfigId)
        if (attached.ok) setConnections(attached.value)
        onBuilt()
      }
    },
    [onBuilt],
  )

  // Read the outcome once the run has ended. The trace is the live view; the build
  // row is the durable one, and it is only complete when the run is.
  useEffect(() => {
    if (buildId && run?.done) void refreshBuild(buildId)
  }, [buildId, run?.done, refreshBuild])

  const start = async (): Promise<void> => {
    const text = brief.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    setBuild(null)
    setConnections([])
    const result = await window.aperture.bloom.startBuild(text)
    setBusy(false)
    if (!result.ok) {
      // 503 is the interesting one: it means the builder is not configured rather
      // than that anything went wrong, and the message names which key is missing.
      setError(result.error)
      return
    }
    setBuildId(result.value.buildId)
    setRunId(result.value.runId)
  }

  const stop = async (): Promise<void> => {
    if (!runId) return
    const result = await window.aperture.bloom.cancelRun(runId)
    if (!result.ok && result.code !== 'conflict') setError(result.error)
  }

  const connect = async (connectionName: string): Promise<void> => {
    const match = connections.find((c) => c.name === connectionName)
    if (!match) return
    const result = await window.aperture.bloom.startOAuth(match.id)
    if (!result.ok) setError(result.error)
  }

  // The provider redirects back through Bloom, which fires an `aperture://` deep
  // link carrying a provider and a status — both attacker-reachable. So the only
  // thing acted on is that *something* completed; the answer comes from Bloom,
  // which recorded the real outcome. Same posture as `Connections.tsx`.
  useEffect(() => {
    return window.aperture.amber.onEvent((event) => {
      if (event.kind === 'bloom-oauth' && buildId) void refreshBuild(buildId)
    })
  }, [buildId, refreshBuild])

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-3 rounded-panel border border-line bg-raised/50 p-3">
        <div>
          <h3 className="text-sm font-medium">Describe an agent</h3>
          <p className="text-xs text-muted">
            Bloom looks the service up, prefers an existing MCP server, and writes the
            configuration. It never holds a credential — you finish the setup below.
          </p>
        </div>

        {error && (
          <p className="rounded-field border border-danger/40 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder="A Spotify agent that can play and search music."
          className="w-full resize-y rounded-field border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-accent-deep"
        />

        <div className="flex items-center gap-2">
          <SmallButton
            primary
            disabled={busy || inFlight || brief.trim().length < 3}
            title={
              inFlight
                ? 'A build is already going.'
                : brief.trim().length < 3
                  ? 'Describe what the agent should do.'
                  : undefined
            }
            onClick={() => void start()}
          >
            {busy ? 'Starting…' : 'Build it'}
          </SmallButton>
          {inFlight && (
            <SmallButton danger onClick={() => void stop()}>
              Stop
            </SmallButton>
          )}
          {/* Said plainly, because it is 4-40x a normal run and the number
              surprises people who have only seen test runs. */}
          <span className="text-xs text-muted">
            A build takes a minute or two and costs more than a run.
          </span>
        </div>

        {runId && <TraceView runId={runId} />}
      </section>

      {build && <BuildResult build={build} connections={connections} onChanged={setBuild} onConnect={connect} />}
    </div>
  )
}

/** What came out: the agent, why, and what is left to do. */
function BuildResult({
  build,
  connections,
  onChanged,
  onConnect,
}: {
  build: Build
  connections: Connection[]
  onChanged: (build: Build) => void
  onConnect: (connectionName: string) => void
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 rounded-panel border border-line bg-raised/50 p-3">
      <header className="flex items-center gap-2">
        <h3 className="text-sm font-medium">
          {build.agentSlug || 'Nothing was created'}
        </h3>
        <Chip
          tone={
            build.status === 'ready' ? 'ok' : build.status === 'failed' ? 'danger' : 'warn'
          }
        >
          {build.status.replace('_', ' ')}
        </Chip>
      </header>

      {/* On a failed build this is the *point*: "no usable MCP server and no
          manifest" is a deliberate outcome, and the summary is where the builder
          says what it found and what a human would have to add. */}
      {build.summary && (
        <p className="whitespace-pre-wrap text-xs text-muted">{build.summary}</p>
      )}
      {build.error && build.status === 'failed' && (
        <p className="font-mono text-micro text-danger">{build.error}</p>
      )}

      {build.status !== 'failed' && (
        <SetupChecklist
          build={build}
          connections={connections}
          onChanged={onChanged}
          onConnect={onConnect}
        />
      )}
    </section>
  )
}
