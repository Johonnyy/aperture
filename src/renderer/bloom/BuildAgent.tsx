import { useCallback, useEffect, useState } from 'react'

import type { Build, Connection } from '../../shared/bloom'
import { Markdown } from '../chat/Markdown'
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
  onOpenConnection,
}: {
  /** Refresh the agent list — a build usually adds one. */
  onBuilt: () => void
  /**
   * Show this connection in the Connections tab.
   *
   * The checklist can only *start* a consent flow, and the commonest reason that
   * fails is a connection with no client id and secret yet — which is a form two
   * tabs away. Without this the step is a dead end: a button that cannot work and
   * no route to the thing that would make it work.
   */
  onOpenConnection?: (connectionName: string) => void
}): React.JSX.Element {
  const [brief, setBrief] = useState('')
  const [buildId, setBuildId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [build, setBuild] = useState<Build | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Why authorising failed, per connection name. Rendered beside its own button. */
  const [oauthErrors, setOauthErrors] = useState<Record<string, string>>({})

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

  /**
   * Start the consent flow, and report the failure *where the button is*.
   *
   * Both halves of this used to go wrong silently. A name with no matching
   * connection returned with no message at all, and a real failure from Bloom —
   * "Spotify has no client credentials" — was written to the page-level `error`,
   * which renders at the top of this tab inside the "Describe an agent" panel. On a
   * finished build the checklist is well below the fold, so the button looked dead
   * while the reason sat off-screen.
   *
   * The error is keyed by connection name rather than kept as one string: a build
   * can list more than one connection to authorise, and a single slot would let the
   * second one's failure silently replace the first's.
   */
  const connect = async (connectionName: string): Promise<void> => {
    const note = (message: string): void =>
      setOauthErrors((prev) => ({ ...prev, [connectionName]: message }))

    const match = connections.find((c) => c.name === connectionName)
    if (!match) {
      note(
        `This build names a connection called "${connectionName}", and Bloom has no ` +
          'connection by that name. Open the Connections tab to see what it does have.',
      )
      return
    }
    const result = await window.aperture.bloom.startOAuth(match.id)
    if (result.ok) {
      setOauthErrors((prev) => {
        const { [connectionName]: _cleared, ...rest } = prev
        return rest
      })
      return
    }
    note(result.error)
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

      {build && (
        <BuildResult
          build={build}
          connections={connections}
          onChanged={setBuild}
          onConnect={connect}
          oauthErrors={oauthErrors}
          onOpenConnection={onOpenConnection}
        />
      )}
    </div>
  )
}

/** What came out: the agent, why, and what is left to do. */
function BuildResult({
  build,
  connections,
  onChanged,
  onConnect,
  oauthErrors,
  onOpenConnection,
}: {
  build: Build
  connections: Connection[]
  onChanged: (build: Build) => void
  onConnect: (connectionName: string) => void
  oauthErrors: Record<string, string>
  onOpenConnection?: (connectionName: string) => void
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

      {/* What the agent can actually do, from the connections that got attached.
          This is the durable record rather than the narration, which is the whole
          reason it can be drawn as a grid: the live trace's prose has already been
          flattened by the sentence splitter, but `tools` is structured data. */}
      {connections.length > 0 && <Capabilities connections={connections} />}

      {/* On a failed build this is the *point*: "no usable MCP server and no
          manifest" is a deliberate outcome, and the summary is where the builder
          says what it found and what a human would have to add.

          Through the markdown renderer because Bloom stores `summary` with its
          newlines intact — unlike the streamed narration, whose structure is gone
          by the time it arrives. */}
      {build.summary && (
        <div className="text-xs text-muted">
          <Markdown>{build.summary}</Markdown>
        </div>
      )}
      {build.error && build.status === 'failed' && (
        <p className="font-mono text-micro text-danger">{build.error}</p>
      )}

      {build.status !== 'failed' && (
        <SetupChecklist
          build={build}
          oauthErrors={oauthErrors}
          onOpenConnection={onOpenConnection}
          connections={connections}
          onChanged={onChanged}
          onConnect={onConnect}
        />
      )}
    </section>
  )
}

/**
 * What the new agent can do, and what it needs before it can do it.
 *
 * `tools` is the exact scope-filtered set the runner would register, so this is not
 * a summary of the build — it is the capability list itself. A pending connection is
 * shown as pending rather than hidden: an agent with four tools and no consent yet
 * is a normal, temporary state, and the checklist below says how to finish it.
 */
function Capabilities({ connections }: { connections: Connection[] }): React.JSX.Element {
  const TONE: Record<string, string> = {
    active: 'bg-ok',
    pending: 'bg-warn',
    expired: 'bg-warn',
    needs_reauth: 'bg-warn',
    revoked: 'bg-danger',
  }

  return (
    <div className="flex flex-col gap-2">
      {connections.map((connection) => (
        <div key={connection.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`size-1.5 shrink-0 rounded-full ${TONE[connection.status] ?? 'bg-muted'}`}
            />
            <span className="text-meta text-ink">
              {connection.label || connection.name}
            </span>
            <span className="text-nano tracking-wide text-muted uppercase">
              {connection.kind.replace('_', ' ')} · {connection.status.replace('_', ' ')}
            </span>
          </div>
          {connection.tools.length > 0 && (
            <ul className="flex flex-wrap gap-1 pl-3">
              {connection.tools.map((tool) => (
                <li
                  key={tool}
                  className="rounded-control border border-line px-1.5 py-0.5 font-mono text-nano text-muted"
                >
                  {tool}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
