import { useState } from 'react'

import type { Build, Connection, SetupStep } from '../../shared/bloom'
import { Chip, SmallButton } from '../infra/parts'

/**
 * What a human still has to do before a built agent works.
 *
 * **This is why the steps are typed rather than prose.** The builder cannot finish
 * its own job — registering an OAuth application is a person at a developer portal,
 * and pasting a key is a person with a password manager — so the last thing it
 * produces is this list. A paragraph saying "go and connect Spotify" is something
 * the user has to translate into clicks; a step of kind `connect_oauth` naming a
 * connection is something we render as the Connect button that already exists.
 *
 * So each kind maps onto a control the app already has, and `manual` is the honest
 * fallback for everything else. An unknown kind arrives here already coerced to
 * `manual` by `wire.ts::toSetupStep`, matching Bloom's own coercion — losing a
 * button is much better than losing the step.
 *
 * **Ticking a step is bookkeeping, not verification.** Bloom records that you say
 * you did it; the connection's own status is what actually decides whether the
 * agent can work, and that is shown beside it rather than inferred from the tick.
 */
export function SetupChecklist({
  build,
  connections,
  onChanged,
  onConnect,
  oauthErrors,
  onOpenConnection,
  onEditCredentials,
}: {
  build: Build
  /** The agent's connections, so a step can show what really happened. */
  connections: Connection[]
  onChanged: (build: Build) => void
  /** Runs the existing OAuth flow. Owned by the parent, which already has it. */
  onConnect?: (connectionName: string) => void
  /** Why authorising failed, per connection name — shown beside its own button. */
  oauthErrors?: Record<string, string>
  /** Show this connection in the Connections tab, where its client app is set. */
  onOpenConnection?: (connectionName: string) => void
  /**
   * Open the credentials form on that connection, when the list is on this page.
   *
   * Given, a `set_client_credentials` or `paste_api_key` step becomes the control
   * that completes it, like `connect_oauth` already was. Absent — on the Build tab,
   * where the connection list is a tab away — the step keeps its prose and the
   * "Open in Connections" link is the route.
   */
  onEditCredentials?: (connectionName: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const done = new Set(build.done)

  const tick = async (index: number): Promise<void> => {
    setBusy(index)
    const result = await window.aperture.bloom.markStepDone(build.id, index)
    if (result.ok && result.value) {
      onChanged(result.value)
      setError(null)
    } else if (!result.ok) {
      setError(result.error)
    }
    setBusy(null)
  }

  if (build.checklist.length === 0) {
    return (
      <p className="text-xs text-muted">
        {build.status === 'ready'
          ? 'Nothing to set up — this agent needs no connected account.'
          : 'The builder finished without listing any setup steps. Check the agent’s connections below.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Setup</h4>
        <Chip tone={build.status === 'ready' ? 'ok' : 'warn'}>
          {done.size}/{build.checklist.length} done
        </Chip>
        {build.status === 'ready' && <Chip tone="ok">live</Chip>}
      </header>

      {error && (
        <p className="rounded-field border border-danger/40 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {build.checklist.map((step, index) => (
          <Step
            key={index}
            step={step}
            index={index}
            done={done.has(index)}
            busy={busy === index}
            connection={connections.find((c) => c.name === step.connectionName)}
            oauthError={step.connectionName ? oauthErrors?.[step.connectionName] : undefined}
            onOpenConnection={onOpenConnection}
            onTick={() => void tick(index)}
            onConnect={onConnect}
            onEditCredentials={onEditCredentials}
          />
        ))}
      </ol>
    </div>
  )
}

/** One step, rendered as the control that completes it. */
function Step({
  step,
  index,
  done,
  busy,
  connection,
  onTick,
  onConnect,
  oauthError,
  onOpenConnection,
  onEditCredentials,
}: {
  step: SetupStep
  index: number
  done: boolean
  busy: boolean
  connection?: Connection
  onTick: () => void
  onConnect?: (connectionName: string) => void
  oauthError?: string
  onOpenConnection?: (connectionName: string) => void
  onEditCredentials?: (connectionName: string) => void
}): React.JSX.Element {
  return (
    <li
      className={[
        'flex flex-col gap-1.5 rounded-panel border p-2.5',
        done ? 'border-line/60 bg-raised/30 opacity-60' : 'border-line bg-raised/50',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 font-mono text-micro text-muted">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${done ? 'line-through' : ''}`}>{step.title}</p>
          {step.detail && <p className="mt-0.5 text-xs text-muted">{step.detail}</p>}
          {step.doneWhen && (
            <p className="mt-0.5 text-xs text-muted">Done when {step.doneWhen}.</p>
          )}
          {/* The connection's real status, which a tick does not change. It is the
              thing that actually decides whether the agent can work. */}
          {connection && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <span className="font-mono">{connection.name}</span>
              <Chip tone={connection.status === 'active' ? 'ok' : 'warn'}>
                {connection.status}
              </Chip>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Action
          step={step}
          connection={connection}
          onConnect={onConnect}
          onEditCredentials={onEditCredentials}
        />
        <SmallButton onClick={onTick} disabled={busy || done}>
          {done ? 'Done' : busy ? '…' : 'Mark done'}
        </SmallButton>
        {/* Always a next step.
            Authorising is the one action this app can take for you, and the usual
            reason it cannot is a connection with no client id and secret — a form in
            another tab. Offering the route unconditionally (not only on failure)
            means the step is never a dead end, and it costs one quiet button. */}
        {step.connectionName && onOpenConnection && (
          <button
            type="button"
            onClick={() => onOpenConnection(step.connectionName as string)}
            className="text-micro text-muted underline underline-offset-2 hover:text-accent-hi"
          >
            Open {step.connectionName} in Connections
          </button>
        )}
      </div>

      {/* Beside the button that produced it. This used to be set on the page-level
          error at the top of the Build tab, which on a finished build is far above
          the fold — so the button read as dead while the reason sat off-screen. */}
      {oauthError && (
        <p className="ml-6 rounded-field border border-danger/40 px-2.5 py-1.5 text-xs text-danger">
          {oauthError}
        </p>
      )}
    </li>
  )
}

/**
 * The affordance for one kind of step.
 *
 * Two kinds now have a real in-app action. `connect_oauth` runs the browser flow;
 * `set_client_credentials` and `paste_api_key` open the form that stores what the
 * flow needs — which used to be prose pointing at a panel that had no such control,
 * so the only real route was an environment variable on the box. Registering the
 * app at the provider is still yours: that is a person at a developer portal, which
 * is what `step.url` opens.
 */
function Action({
  step,
  connection,
  onConnect,
  onEditCredentials,
}: {
  step: SetupStep
  connection?: Connection
  onConnect?: (connectionName: string) => void
  onEditCredentials?: (connectionName: string) => void
}): React.JSX.Element | null {
  const needsCredentials =
    step.kind === 'set_client_credentials' || step.kind === 'paste_api_key'

  // Before the `step.url` branch, and *beside* it rather than instead of it: one of
  // these steps usually carries a developer portal URL, and the page is where you
  // obtain the credential while the button is where you put it. Either alone leaves
  // half the step undone.
  if (needsCredentials && step.connectionName && onEditCredentials) {
    const stored =
      step.kind === 'paste_api_key' ? connection?.hasSecret : connection?.hasClientSecret
    return (
      <>
        <SmallButton primary onClick={() => onEditCredentials(step.connectionName)}>
          {stored ? 'Replace' : 'Enter'}{' '}
          {step.kind === 'paste_api_key' ? 'key' : 'client id and secret'}
        </SmallButton>
        {step.url && <OpenPage url={step.url} />}
      </>
    )
  }

  if (step.kind === 'connect_oauth' && step.connectionName && onConnect) {
    return (
      <SmallButton
        primary
        onClick={() => onConnect(step.connectionName)}
        disabled={connection?.status === 'active'}
        title="Opens the provider's consent page in your browser"
      >
        {connection?.status === 'active' ? 'Connected' : `Connect ${step.connectionName}`}
      </SmallButton>
    )
  }

  if (step.url) return <OpenPage url={step.url} />

  if (needsCredentials) {
    // No `onEditCredentials`: this is the Build tab, a tab away from the connection
    // list. The "Open in Connections" link beside this is the route.
    return (
      <span className="text-xs text-muted">
        Open it in Connections and press{' '}
        {step.kind === 'paste_api_key' ? 'Set key' : 'Set app'}.
      </span>
    )
  }

  if (step.kind === 'set_env' && step.envName) {
    return (
      <span className="font-mono text-xs text-muted">
        {step.envName} — set it in the Servers tab
      </span>
    )
  }

  return null
}

/**
 * A plain anchor, not an IPC call: `window.ts` installs a `setWindowOpenHandler`
 * that sends every `target="_blank"` to the system browser and denies in-shell
 * navigation, so this already does the right thing and needs no new bridge. `rel` is
 * belt and braces — the handler denies the navigation anyway, but the URL came from
 * a model reading a web page.
 */
function OpenPage({ url }: { url: string }): React.JSX.Element {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      className="rounded-control border border-line px-2 py-1 text-meta text-ink transition hover:border-accent-deep"
    >
      Open page
    </a>
  )
}
