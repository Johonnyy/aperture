import { useCallback, useEffect, useState } from 'react'

import type { AgentConfig, Build, Connection } from '../../shared/bloom'
import { SetupChecklist } from './SetupChecklist'

/**
 * An agent's outstanding setup, shown where you would go looking for it later.
 *
 * The Build tab shows a checklist in the minute after a build. This shows the same
 * one a week later, on the agent's own Connections page — which is where somebody
 * ends up when an agent is not working and they are trying to find out why.
 * Without it the list is reachable only by remembering a build id.
 *
 * Renders nothing at all unless this agent has a build still waiting on something.
 * A finished agent should not carry a permanent panel about work already done.
 */
export function AgentSetup({
  agent,
  connections,
  onConnect,
  onEditCredentials,
}: {
  agent: AgentConfig
  connections: Connection[]
  onConnect?: (connectionName: string) => void
  /** Opens the credentials form on that connection, in the list right below. */
  onEditCredentials?: (connectionName: string) => void
}): React.JSX.Element | null {
  const [build, setBuild] = useState<Build | null>(null)

  const load = useCallback(async () => {
    // Asking for the unfinished ones only: a `ready` build has nothing to say here,
    // and filtering server-side keeps this to one small request.
    const result = await window.aperture.bloom.builds({ status: 'needs_setup', limit: 50 })
    if (!result.ok) return
    setBuild(result.value.find((b) => b.agentConfigId === agent.id) ?? null)
  }, [agent.id])

  useEffect(() => {
    void load()
  }, [load])

  // A connection may have been connected since the build ran, in which case the
  // build is stale rather than the checklist wrong — reconcile on the same event
  // `Connections` re-reads on.
  useEffect(() => {
    return window.aperture.amber.onEvent((event) => {
      if (event.kind === 'bloom-oauth') void load()
    })
  }, [load])

  if (!build) return null

  return (
    <section className="flex flex-col gap-2 rounded-panel border border-warn/40 bg-raised/50 p-3">
      <p className="text-xs text-muted">
        This agent was built from a description and is not finished yet.
      </p>
      <SetupChecklist
        build={build}
        connections={connections}
        onChanged={setBuild}
        onConnect={onConnect}
        onEditCredentials={onEditCredentials}
      />
    </section>
  )
}
