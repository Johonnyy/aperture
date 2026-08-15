import { useCallback, useEffect, useState } from 'react'

import type { AgentConfig, ConnectionInfo, ProviderInfo } from '../../shared/bloom'
import { Chip, SmallButton } from '../infra/parts'

/**
 * The accounts an agent may act through.
 *
 * The flow leaves this app on purpose: Bloom hosts the callback because it has a
 * public address and a desktop app does not, so Aperture only starts the flow and
 * observes the result. The authorize URL opens in the *system* browser — providers
 * increasingly refuse embedded webviews outright, and the system browser already has
 * the user's session.
 *
 * **`configured` is the field that earns its place.** It distinguishes "Bloom ships a
 * manifest for this provider" from "this deployment has client credentials", and
 * those fail in completely different places: without credentials the Connect button
 * would die at the redirect with a provider-side error. Saying so here, and naming
 * where the fix lives, is the difference between a dead button and a route out.
 *
 * No token value is ever returned by Bloom, and none is ever displayed.
 */
export function Connections({ agent }: { agent: AgentConfig }): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [connections, setConnections] = useState<ConnectionInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [p, c] = await Promise.all([
      window.aperture.bloom.providers(),
      window.aperture.bloom.connections(agent.id),
    ])
    if (p.ok) setProviders(p.value)
    if (c.ok) setConnections(c.value)
    const failure = !p.ok ? p.error : !c.ok ? c.error : null
    setError(failure)
    setLoading(false)
  }, [agent.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Re-read when the browser hands control back.
   *
   * Note what this does *not* do: trust the URL. It carries a `provider` and a
   * `status`, both attacker-reachable, so the only thing acted on is the fact that
   * *something* completed — the answer comes from Bloom, which recorded it.
   *
   * The pull on mount covers a handoff that landed before this panel existed; the
   * subscription covers one that arrives while it is open.
   */
  useEffect(() => {
    void window.aperture.bloom.pendingOAuth().then((held) => {
      if (held) void refresh()
    })
    return window.aperture.amber.onEvent((event) => {
      if (event.kind === 'bloom-oauth') void refresh()
    })
  }, [refresh])

  /**
   * The browser comes back to Bloom, not here, so nothing in this app learns the
   * outcome directly. When the deep link lands, main re-emits and we re-read — and
   * this button is the manual equivalent, which the flow needs anyway: on macOS the
   * `aperture://` scheme only really registers from a packaged app, so without it
   * the whole thing is untestable under `npm run dev` there.
   */
  const connect = async (provider: string): Promise<void> => {
    setPending(provider)
    const result = await window.aperture.bloom.startOAuth(agent.id, provider)
    setPending(null)
    if (!result.ok) setError(result.error)
  }

  const disconnect = async (provider: string): Promise<void> => {
    if (!window.confirm(`Disconnect ${provider}? ${agent.slug} will lose access to it.`)) return
    const result = await window.aperture.bloom.disconnect(agent.id, provider)
    if (result.ok) await refresh()
    else setError(result.error)
  }

  const byProvider = new Map(connections.map((c) => [c.provider, c]))

  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-raised/50 p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Connected accounts</h3>
          <p className="text-xs text-muted">
            Bloom holds these credentials. They never reach Amber, this app, or the
            model — only the tools that call the provider.
          </p>
        </div>
        <SmallButton onClick={() => void refresh()}>
          {loading ? 'Reading…' : 'Re-check'}
        </SmallButton>
      </div>

      {error && <p className="text-meta text-danger">{error}</p>}

      {!loading && providers.length === 0 && (
        <p className="text-xs text-muted">Bloom has no provider manifests installed.</p>
      )}

      <ul className="flex flex-col gap-2">
        {providers.map((provider) => {
          const connection = byProvider.get(provider.name)
          const active = connection?.status === 'active'
          return (
            <li
              key={provider.name}
              className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-ground p-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body text-ink">{provider.displayName}</span>
                  {connection && (
                    <Chip tone={active ? 'ok' : connection.status === 'revoked' ? 'muted' : 'warn'}>
                      {connection.status}
                    </Chip>
                  )}
                  {!provider.configured && <Chip tone="warn">not configured</Chip>}
                </div>
                {!provider.configured ? (
                  <p className="mt-1 text-xs text-muted">
                    Bloom has a manifest for this, but no client credentials on this
                    deployment. Add them under <code>apps.bloom.env</code> in
                    secrets.yaml — the Servers tab edits that.
                  </p>
                ) : connection && connection.scopes.length > 0 ? (
                  <p className="mt-1 truncate font-mono text-micro text-muted">
                    {connection.scopes.join(' ')}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    {provider.operations.length} tool
                    {provider.operations.length === 1 ? '' : 's'} once connected
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-1.5">
                <SmallButton
                  disabled={!provider.configured || pending === provider.name}
                  title={
                    provider.configured
                      ? undefined
                      : 'No client credentials for this provider on this Bloom.'
                  }
                  onClick={() => void connect(provider.name)}
                >
                  {pending === provider.name
                    ? 'Opening…'
                    : active
                      ? 'Reconnect'
                      : 'Connect'}
                </SmallButton>
                {connection && connection.status !== 'revoked' && (
                  <SmallButton danger onClick={() => void disconnect(provider.name)}>
                    Disconnect
                  </SmallButton>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <p className="text-micro text-muted">
        Approving in the browser returns you here automatically. If it does not, press
        Re-check — the server already recorded the outcome either way.
      </p>
    </div>
  )
}
