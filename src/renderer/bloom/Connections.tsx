import { useCallback, useEffect, useState } from 'react'

import {
  CONNECTION_NAME_PATTERN,
  KIND_LABELS,
  type AgentConfig,
  type Connection,
  type ConnectionDraft,
  type ConnectionKind,
  type ConnectionKinds,
} from '../../shared/bloom'
import { Chip, Field, SmallButton } from '../infra/parts'
import { AgentSetup } from './AgentSetup'

/**
 * What an agent can act through.
 *
 * **Connection-first, not provider-first.** This panel used to list every provider
 * Bloom shipped a manifest for and put a Connect button beside each — which meant
 * the only thing you could add was an OAuth account for a provider someone had
 * already written a manifest for, and adding one greyed itself out unless the
 * *server* had client credentials in `secrets.yaml`. Now the list is what this
 * agent actually has, and "Add connection" opens a picker built from the wire.
 *
 * **Everything here is a library entry.** Creating one from this page attaches it;
 * the connection itself belongs to no agent, any other agent can attach the same
 * one, and deleting this agent deletes none of them. "Attach existing" is the other
 * half of that, and the reason approving Spotify once is enough.
 *
 * The OAuth flow still leaves the app: Bloom hosts the callback because it has a
 * public address and a desktop app does not, and the authorize URL opens in the
 * *system* browser because providers increasingly refuse embedded webviews.
 *
 * No secret value is ever returned by Bloom, and none is ever displayed.
 */
export function Connections({ agent }: { agent: AgentConfig }): React.JSX.Element {
  const [attached, setAttached] = useState<Connection[]>([])
  const [library, setLibrary] = useState<Connection[]>([])
  const [kinds, setKinds] = useState<ConnectionKinds | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [probe, setProbe] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    const [mine, all, k] = await Promise.all([
      window.aperture.bloom.agentConnections(agent.id),
      window.aperture.bloom.connections(),
      window.aperture.bloom.connectionKinds(),
    ])
    if (mine.ok) setAttached(mine.value)
    if (all.ok) setLibrary(all.value)
    if (k.ok) setKinds(k.value)
    setError(!mine.ok ? mine.error : !all.ok ? all.error : !k.ok ? k.error : null)
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
   */
  useEffect(() => {
    void window.aperture.bloom.pendingOAuth().then((held) => {
      if (held) void refresh()
    })
    return window.aperture.amber.onEvent((event) => {
      if (event.kind === 'bloom-oauth') void refresh()
    })
  }, [refresh])

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id)
    const result = await fn()
    setBusy(null)
    if (!result.ok) setError(result.error ?? 'That did not work.')
    else await refresh()
    return result.ok
  }

  const connect = async (connection: Connection): Promise<void> => {
    setBusy(connection.id)
    const result = await window.aperture.bloom.startOAuth(connection.id)
    setBusy(null)
    if (!result.ok) setError(result.error)
  }

  const test = async (connection: Connection): Promise<void> => {
    setBusy(connection.id)
    const result = await window.aperture.bloom.testConnection(connection.id)
    setBusy(null)
    if (!result.ok) setError(result.error)
    else setProbe((p) => ({ ...p, [connection.id]: result.value.detail }))
  }

  const detach = async (connection: Connection): Promise<void> => {
    const others = connection.agentIds.filter((id) => id !== agent.id).length
    const note = others
      ? `${others} other agent${others === 1 ? '' : 's'} keep using it.`
      : 'It stays in the library, so you can attach it again.'
    if (!window.confirm(`Remove ${connection.label || connection.name} from ${agent.slug}? ${note}`))
      return
    await run(connection.id, () =>
      window.aperture.bloom.detachConnection(agent.id, connection.id),
    )
  }

  const unattached = library.filter((c) => !attached.some((a) => a.id === c.id))

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-field border border-danger/40 px-3 py-2 text-meta text-danger">
          {error}
        </p>
      )}

      {/* If this agent came out of the builder and is still waiting on a
          credential, the steps belong here — this is where somebody looks when an
          agent is not working. Renders nothing when there is nothing outstanding. */}
      <AgentSetup
        agent={agent}
        connections={attached}
        onConnect={(name) => {
          const match = attached.find((c) => c.name === name)
          if (match) void connect(match)
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted">
          Bloom holds these credentials. They never reach Amber, this app, or the
          model — only the tools that call the service.
        </p>
        <SmallButton primary onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel' : 'Add connection'}
        </SmallButton>
        <SmallButton
          disabled={unattached.length === 0}
          title={
            unattached.length
              ? 'Reuse a connection you have already set up'
              : 'Every connection you have is already attached'
          }
          onClick={() => setPicking((p) => !p)}
        >
          Attach existing
        </SmallButton>
      </div>

      {adding && kinds && (
        <AddConnection
          kinds={kinds}
          agentId={agent.id}
          onDone={async () => {
            setAdding(false)
            await refresh()
          }}
          onError={setError}
        />
      )}

      {picking && (
        <div className="flex flex-col gap-2 rounded-field border border-line bg-ground p-2.5">
          <p className="text-meta text-muted">
            Already set up. Attaching costs nothing and approves nothing again.
          </p>
          {unattached.map((connection) => (
            <div key={connection.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-body">
                {connection.label || connection.name}
              </span>
              <Chip tone="muted">{connection.kind}</Chip>
              <SmallButton
                disabled={busy === connection.id}
                onClick={async () => {
                  const ok = await run(connection.id, () =>
                    window.aperture.bloom.attachConnection(agent.id, connection.id),
                  )
                  if (ok) setPicking(false)
                }}
              >
                Attach
              </SmallButton>
            </div>
          ))}
        </div>
      )}

      {!loading && attached.length === 0 && !adding && (
        <p className="rounded-field border border-line bg-ground p-3 text-xs text-muted">
          Nothing connected yet. This agent can think and talk, but it cannot reach
          anything — add a connection to give it tools.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {attached.map((connection) => (
          <li
            key={connection.id}
            className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-ground p-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body text-ink">{connection.label || connection.name}</span>
                <Chip tone={statusTone(connection)}>{connection.status}</Chip>
                <Chip tone="muted">{connection.kind}</Chip>
                {connection.agentIds.length > 1 && (
                  <Chip tone="muted">
                    shared with {connection.agentIds.length - 1} other
                    {connection.agentIds.length === 2 ? '' : 's'}
                  </Chip>
                )}
              </div>
              <p className="mt-1 truncate font-mono text-micro text-muted">
                {probe[connection.id] ?? summarise(connection)}
              </p>
            </div>

            <div className="flex shrink-0 gap-1.5">
              <SmallButton disabled={busy === connection.id} onClick={() => void test(connection)}>
                {busy === connection.id ? '…' : 'Test'}
              </SmallButton>
              {connection.kind === 'oauth' && (
                <SmallButton disabled={busy === connection.id} onClick={() => void connect(connection)}>
                  {connection.status === 'active' ? 'Reconnect' : 'Connect'}
                </SmallButton>
              )}
              <SmallButton danger onClick={() => void detach(connection)}>
                Remove
              </SmallButton>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-micro text-muted">
        Approving in the browser returns you here automatically. If it does not, press
        Test — the server already recorded the outcome either way.
      </p>
    </div>
  )
}

function statusTone(connection: Connection): 'ok' | 'warn' | 'muted' {
  if (connection.status === 'active') return 'ok'
  if (connection.status === 'revoked') return 'muted'
  return 'warn'
}

/** One line saying what this gives the agent, without ever showing a secret. */
function summarise(connection: Connection): string {
  if (connection.status === 'pending') {
    return connection.kind === 'oauth'
      ? 'Not approved yet — press Connect.'
      : 'No key stored yet.'
  }
  const url = typeof connection.config.url === 'string' ? connection.config.url : ''
  if (connection.kind === 'mcp') return url
  return connection.tools.slice(0, 6).join(' ') || 'No tools available.'
}

/**
 * Pick a kind, then say what it needs. Inline, not a modal.
 *
 * The house style: there is exactly one modal in this app, and every "add X" flow
 * expands in place. The kind list comes from Bloom rather than being hardcoded, so
 * a build that cannot store secrets says why here instead of failing later.
 */
function AddConnection({
  kinds,
  agentId,
  onDone,
  onError,
}: {
  kinds: ConnectionKinds
  agentId: string
  onDone: () => void | Promise<void>
  onError: (message: string) => void
}): React.JSX.Element {
  const [kind, setKind] = useState<ConnectionKind | null>(null)
  const [provider, setProvider] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)

  const chosen = kinds.providers.find((p) => p.name === provider)
  const usable = kinds.providers.filter((p) => kind && p.auth.includes(kind))

  const create = async (): Promise<void> => {
    if (!kind) return
    const draft: ConnectionDraft = { kind, attachTo: [agentId] }
    if (kind === 'mcp') {
      draft.name = name.trim()
      draft.config = { url: url.trim() }
      if (secret.trim()) draft.secret = secret.trim()
    } else {
      draft.provider = provider
      if (name.trim()) draft.name = name.trim()
      if (kind === 'api_key' && secret.trim()) draft.secret = secret.trim()
      if (clientId.trim()) draft.clientId = clientId.trim()
      if (clientSecret.trim()) draft.clientSecret = clientSecret.trim()
    }

    setBusy(true)
    const created = await window.aperture.bloom.createConnection(draft)
    setBusy(false)
    if (!created.ok) {
      onError(created.error)
      return
    }
    // An OAuth connection is not usable until the browser comes back, so go
    // straight there rather than leaving a `pending` row and no explanation.
    if (kind === 'oauth' && created.value) {
      const started = await window.aperture.bloom.startOAuth(created.value.id)
      if (!started.ok) onError(started.error)
    }
    await onDone()
  }

  const nameOk = kind !== 'mcp' || CONNECTION_NAME_PATTERN.test(name.trim())
  const ready =
    kind === 'mcp' ? nameOk && url.trim() !== '' : provider !== '' && (kind !== 'api_key' || true)

  return (
    <div className="flex flex-col gap-2.5 rounded-field border border-accent-deep/40 bg-ground p-3">
      <div className="flex flex-wrap gap-1.5">
        {kinds.kinds.map((k) => (
          <button
            key={k.kind}
            type="button"
            disabled={!k.available}
            title={k.available ? undefined : k.reason}
            onClick={() => {
              setKind(k.kind)
              setProvider('')
            }}
            className={[
              'rounded-control border px-2.5 py-1.5 text-left text-meta transition-colors',
              !k.available
                ? 'cursor-not-allowed border-line text-muted opacity-50'
                : kind === k.kind
                  ? 'border-accent-deep bg-accent/15 text-accent-hi'
                  : 'border-line text-muted hover:text-ink',
            ].join(' ')}
          >
            <span className="block">{KIND_LABELS[k.kind].title}</span>
            <span className="block text-micro text-muted">{KIND_LABELS[k.kind].blurb}</span>
          </button>
        ))}
      </div>

      {kind === 'mcp' && (
        <>
          <Row label="Name" hint="Also the tool prefix: name__tool. Lowercase, no spaces.">
            <Field value={name} onChange={setName} placeholder="finance" />
          </Row>
          {name !== '' && !nameOk && (
            <p className="text-meta text-danger">
              Lowercase letters, digits, hyphen and underscore, starting with a letter.
              No double underscore.
            </p>
          )}
          <Row label="URL" hint="The server's base URL. Bloom appends /mcp itself.">
            <Field value={url} onChange={setUrl} placeholder="https://finance.johnny.dev" />
          </Row>
          <Row label="Token" hint="Optional. Leave blank for a server that needs none.">
            <Field value={secret} onChange={setSecret} type="password" placeholder="bearer token" />
          </Row>
          {kinds.discoveredPeers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-micro text-muted">Known:</span>
              {kinds.discoveredPeers.map((peer) => (
                <SmallButton
                  key={peer.name}
                  onClick={() => {
                    setName(peer.name)
                    setUrl(peer.baseUrl)
                  }}
                >
                  {peer.name}
                </SmallButton>
              ))}
            </div>
          )}
        </>
      )}

      {kind && kind !== 'mcp' && (
        <>
          <Row label="Service" hint="What Bloom ships a manifest for.">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="rounded-control border border-line bg-raised px-2.5 py-1 text-meta text-ink outline-none focus:border-accent-deep"
            >
              <option value="">choose…</option>
              {usable.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}
                </option>
              ))}
            </select>
            {chosen?.docsUrl && (
              <a
                href={chosen.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-micro text-muted underline hover:text-accent-hi"
              >
                docs
              </a>
            )}
          </Row>

          {kind === 'api_key' && chosen && (
            <Row label={chosen.apiKey?.label ?? 'Key'} hint={chosen.apiKey?.help}>
              <Field value={secret} onChange={setSecret} type="password" placeholder="paste it" />
            </Row>
          )}

          {kind === 'oauth' && chosen && (
            <>
              <p className="text-micro text-muted">
                {chosen.hasDeploymentDefault
                  ? 'This Bloom already has an app registered for ' +
                    chosen.displayName +
                    '. Leave these blank to use it.'
                  : 'Register an app with ' +
                    chosen.displayName +
                    ' and paste its credentials. They are stored encrypted, on the connection.'}
              </p>
              <Row label="Client ID" hint="From the app you registered with the provider.">
                <Field value={clientId} onChange={setClientId} placeholder="client id" />
              </Row>
              <Row label="Secret" hint="Encrypted at rest. Never returned by any API.">
                <Field
                  value={clientSecret}
                  onChange={setClientSecret}
                  type="password"
                  placeholder="client secret"
                />
              </Row>
            </>
          )}

          <Row label="Label" hint="Optional. Defaults to the service name.">
            <Field value={name} onChange={setName} placeholder="spotify" />
          </Row>
        </>
      )}

      {kind && (
        <div className="flex items-center gap-2">
          <SmallButton primary disabled={busy || !ready} onClick={() => void create()}>
            {busy ? 'Adding…' : kind === 'oauth' ? 'Add and approve' : 'Add'}
          </SmallButton>
          {kind === 'oauth' && (
            <span className="text-micro text-muted">Opens your browser to approve.</span>
          )}
        </div>
      )}
    </div>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-meta text-muted" title={hint}>
        {label}
      </span>
      {children}
    </div>
  )
}
