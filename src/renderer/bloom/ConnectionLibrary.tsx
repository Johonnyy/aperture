import { useCallback, useEffect, useRef, useState } from 'react'

import type { Connection, ConnectionKinds } from '../../shared/bloom'
import { Chip, SmallButton } from '../infra/parts'
import { ConnectionCredentials, credentialsLabel } from './ConnectionCredentials'

/**
 * Every connection this Bloom holds, across all agents.
 *
 * The agent-level panel answers "what can this agent reach". This one answers the
 * questions that are about the credential itself: who uses it, does it still work,
 * and what happens if it goes away. Those are only answerable *because* connections
 * stopped being owned by an agent — previously each one belonged to exactly one
 * config and vanished with it, so there was nothing to list.
 *
 * Deleting is the one place this view has to be careful. A shared connection
 * removed without warning silently strips capability from agents nobody was looking
 * at, so Bloom refuses with a 409 naming them and that refusal is rendered as a
 * confirmation rather than an error.
 */
export function ConnectionLibrary({
  focus,
}: {
  /**
   * A connection name to scroll to and mark, arriving from the build checklist.
   *
   * The checklist can start a consent flow and nothing else, so when that fails for
   * want of a client id and secret it sends you here. Landing on an unhighlighted
   * list of every connection this Bloom holds would make you find the row again,
   * which is the same dead end one step further along.
   */
  focus?: string | null
} = {}): React.JSX.Element {
  const [connections, setConnections] = useState<Connection[]>([])
  const [kinds, setKinds] = useState<ConnectionKinds | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [probe, setProbe] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const focusRef = useRef<HTMLLIElement | null>(null)

  /**
   * The focus we have already acted on.
   *
   * Opening the form is a one-shot per arrival, not a property of the render: every
   * refresh re-runs the effect below, and without this a form the user closed would
   * spring back open the moment anything reloaded the list.
   */
  const openedFor = useRef<string | null>(null)

  // After the list has rendered, not on mount: `connections` arrives from a fetch, so
  // on mount there is no row to scroll to yet.
  useEffect(() => {
    if (!focus) return
    if (focusRef.current) focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (openedFor.current === focus) return
    // You are only ever sent here because something needs filling in — the build
    // checklist's Connect could not run for want of a client id and secret. Landing
    // on the right row with the form still shut is the same dead end one step along.
    const match = connections.find((c) => c.name === focus)
    if (match) {
      openedFor.current = focus
      setEditing(match.id)
    }
  }, [focus, connections])

  const refresh = useCallback(async () => {
    setLoading(true)
    const [result, k] = await Promise.all([
      window.aperture.bloom.connections(),
      window.aperture.bloom.connectionKinds(),
    ])
    if (result.ok) {
      setConnections(result.value)
      setError(null)
    } else {
      setError(result.error)
    }
    // A failed kinds call is survivable: it only costs the credentials form its
    // provider hints, so it must not blank the list or report an error over one.
    if (k.ok) setKinds(k.value)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // This list can start a browser flow now, so it has to re-read when one finishes.
  // The event says only that *something* completed; the answer comes from Bloom.
  useEffect(() => {
    return window.aperture.amber.onEvent((event) => {
      if (event.kind === 'bloom-oauth') void refresh()
    })
  }, [refresh])

  const test = async (connection: Connection): Promise<void> => {
    setBusy(connection.id)
    const result = await window.aperture.bloom.testConnection(connection.id)
    setBusy(null)
    if (!result.ok) setError(result.error)
    else setProbe((p) => ({ ...p, [connection.id]: result.value.detail }))
  }

  /**
   * Delete, asking first when it is still in use.
   *
   * The unforced call is what produces the list of agents, so the confirmation can
   * name them. Guessing locally from `agentIds` would work today and drift the
   * moment two windows are open.
   */
  const remove = async (connection: Connection): Promise<void> => {
    setBusy(connection.id)
    const first = await window.aperture.bloom.deleteConnection(connection.id)
    setBusy(null)
    if (first.ok) {
      await refresh()
      return
    }
    if (first.code !== 'conflict') {
      setError(first.error)
      return
    }
    if (!window.confirm(`${first.error}\n\nDelete it anyway?`)) return
    setBusy(connection.id)
    const forced = await window.aperture.bloom.deleteConnection(connection.id, true)
    setBusy(null)
    if (!forced.ok) setError(forced.error)
    else await refresh()
  }

  /** Authorise, for a connection that now has an app registration to do it with. */
  const connect = async (connection: Connection): Promise<void> => {
    setBusy(connection.id)
    const result = await window.aperture.bloom.startOAuth(connection.id)
    setBusy(null)
    if (!result.ok) setError(result.error)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted">
          Every account, key and server Bloom holds. One connection can serve any
          number of agents — approving it once is enough.
        </p>
        <SmallButton onClick={() => void refresh()}>{loading ? 'Reading…' : 'Refresh'}</SmallButton>
      </div>

      {error && (
        <p className="rounded-field border border-danger/40 px-3 py-2 text-meta text-danger">
          {error}
        </p>
      )}

      {!loading && connections.length === 0 && (
        <p className="rounded-field border border-line bg-ground p-3 text-xs text-muted">
          No connections yet. Add one from any agent&rsquo;s Connections tab — it will
          appear here, ready for the others.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {connections.map((connection) => (
          <li
            key={connection.id}
            ref={connection.name === focus ? focusRef : undefined}
            className={[
              'flex flex-col gap-2 rounded-field border bg-ground p-2.5',
              connection.name === focus ? 'border-accent-deep' : 'border-line',
            ].join(' ')}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body text-ink">{connection.label || connection.name}</span>
                  <Chip
                    tone={
                      connection.status === 'active'
                        ? 'ok'
                        : connection.status === 'revoked'
                          ? 'muted'
                          : 'warn'
                    }
                  >
                    {connection.status}
                  </Chip>
                  <Chip tone="muted">{connection.kind}</Chip>
                  <Chip tone={connection.agentIds.length ? 'ok' : 'muted'}>
                    {connection.agentIds.length === 0
                      ? 'unused'
                      : `${connection.agentIds.length} agent${
                          connection.agentIds.length === 1 ? '' : 's'
                        }`}
                  </Chip>
                </div>
                <p className="mt-1 truncate font-mono text-micro text-muted">
                  {probe[connection.id] ?? connection.tools.slice(0, 6).join(' ')}
                </p>
              </div>

              <div className="flex shrink-0 gap-1.5">
                <SmallButton disabled={busy === connection.id} onClick={() => void test(connection)}>
                  {busy === connection.id ? '…' : 'Test'}
                </SmallButton>
                {/* One button for every kind, and shown whether or not something is
                    already stored. It used to be two, each hidden until a secret
                    existed — so the connection that most needed it, one Bloom built
                    for you and nobody has filled in, offered nothing at all. */}
                <SmallButton
                  onClick={() => setEditing((e) => (e === connection.id ? null : connection.id))}
                >
                  {editing === connection.id ? 'Close' : credentialsLabel(connection)}
                </SmallButton>
                {connection.kind === 'oauth' && (
                  <SmallButton
                    disabled={busy === connection.id}
                    onClick={() => void connect(connection)}
                  >
                    {connection.status === 'active' ? 'Reconnect' : 'Connect'}
                  </SmallButton>
                )}
                <SmallButton danger onClick={() => void remove(connection)}>
                  Delete
                </SmallButton>
              </div>
            </div>

            {editing === connection.id && (
              <ConnectionCredentials
                connection={connection}
                provider={kinds?.providers.find((p) => p.name === connection.provider)}
                publicUrl={kinds?.publicUrl}
                onSaved={refresh}
                onError={setError}
                onConnect={
                  connection.kind === 'oauth' && connection.status !== 'active'
                    ? () => connect(connection)
                    : undefined
                }
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
