import { useState } from 'react'

import {
  clientIdOf,
  type Connection,
  type ConnectionSecretInput,
  type ProviderInfo,
} from '../../shared/bloom'
import { Field, SmallButton } from '../infra/parts'

/**
 * Fill in what a connection needs to work: an app registration, a key, a token.
 *
 * **This is the form that was missing, and its absence had a specific shape.** A
 * connection could only ever be given client credentials in the *create* dialog — so
 * a connection Aperture did not create, which is every connection the builder makes
 * for you, could never be given one. Asking Bloom to authorise it answered "Spotify
 * has no client credentials… or set BLOOM_OAUTH_SPOTIFY_CLIENT_ID and
 * BLOOM_OAUTH_SPOTIFY_CLIENT_SECRET on the server", and that really was the only
 * remaining route: an env file on the box behind SSH. The library's one nod at this,
 * a "Rotate app secret" button, was gated on a secret already being stored, so it
 * was invisible in exactly the case that needed it — and it could not set the client
 * *id* at all.
 *
 * That is design principle 2 failing at its sharpest: dropping to a terminal to make
 * something work is a bug in Aperture, not a documentation gap. Credentials belong
 * where the thing they authorise lives, which is the Bloom tab — not the Servers tab
 * next door, which is for operating a box rather than for using the ecosystem.
 *
 * One component for all three kinds, because "what does this connection need from
 * me" is one question with three answers, and two copies of it would drift.
 *
 * Nothing is ever displayed back. Bloom returns no secret on any route, so the
 * fields start empty and say whether something is stored rather than showing it. A
 * blank secret box means *leave the stored one alone* — never "clear it".
 */
export function ConnectionCredentials({
  connection,
  provider,
  publicUrl,
  onSaved,
  onError,
  onConnect,
}: {
  connection: Connection
  /** For the deployment-default hint and the key's real name. Absent is survivable. */
  provider?: ProviderInfo
  /** Bloom's public origin, to tell "no browser flow" from "no callback address". */
  publicUrl?: string
  onSaved: () => void | Promise<void>
  onError: (message: string) => void
  /**
   * Start the browser flow. Rendered as "Save and connect" for an OAuth connection
   * that is not live yet — pasting a client id and secret is never the goal in
   * itself, and making the user find the Connect button afterwards is the same dead
   * end one step along.
   */
  onConnect?: () => void | Promise<void>
}): React.JSX.Element {
  const storedClientId = clientIdOf(connection)
  const [clientId, setClientId] = useState(storedClientId)
  const [clientSecret, setClientSecret] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  const isOAuth = connection.kind === 'oauth'

  /**
   * Only what changed.
   *
   * `client_id` rides on inequality rather than on being non-empty, which is what
   * makes clearing it possible: an empty string is a real value meaning "go back to
   * this deployment's default", and a state you can only leave is not a state.
   */
  const body = (): ConnectionSecretInput => {
    if (!isOAuth) {
      // Blank means *leave the stored one alone*, so it sends nothing. Bloom refuses
      // an empty secret outright rather than storing something that would look
      // exactly like a credential.
      const value = secret.trim()
      return value ? { secret: value } : {}
    }
    const out: ConnectionSecretInput = {}
    if (clientId.trim() !== storedClientId) out.client_id = clientId.trim()
    if (clientSecret) out.client_secret = clientSecret
    return out
  }

  const pending = Object.keys(body()).length > 0

  const save = async (thenConnect = false): Promise<boolean> => {
    setBusy(true)
    // A no-op save is allowed to reach `onConnect`: pressing "Save and connect" with
    // credentials already stored should still connect, not refuse.
    if (pending) {
      const result = await window.aperture.bloom.setConnectionSecret(connection.id, body())
      if (!result.ok) {
        setBusy(false)
        onError(result.error)
        return false
      }
    }
    setBusy(false)
    setClientSecret('')
    setSecret('')
    await onSaved()
    if (thenConnect && onConnect) await onConnect()
    return true
  }

  return (
    <div className="flex flex-col gap-2 rounded-field border border-accent-deep/40 bg-ground p-2.5">
      {isOAuth ? (
        <>
          <p className="text-micro text-muted">
            {appHint(connection, provider)}
            {provider?.docsUrl && (
              <>
                {' '}
                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline hover:text-accent-hi"
                >
                  Developer portal
                </a>
              </>
            )}
          </p>
          <RedirectUri uri={provider?.redirectUri ?? ''} publicUrl={publicUrl} />
          <Labelled label="Client ID">
            <Field
              value={clientId}
              onChange={setClientId}
              placeholder={storedClientId ? 'client id' : 'blank uses this Bloom’s own app'}
              onEnter={() => void save()}
            />
          </Labelled>
          <Labelled
            label="Client secret"
            note={
              connection.hasClientSecret
                ? 'One is stored. Type a new one only to replace it.'
                : 'Not set yet.'
            }
          >
            <Field
              value={clientSecret}
              onChange={setClientSecret}
              type="password"
              placeholder={connection.hasClientSecret ? 'unchanged' : 'client secret'}
              onEnter={() => void save()}
            />
          </Labelled>
        </>
      ) : (
        <Labelled
          label={
            connection.kind === 'mcp' ? 'Token' : (provider?.apiKey?.label ?? 'API key')
          }
          note={
            connection.kind === 'mcp'
              ? 'The bearer token this server expects. Blank for one that needs none.'
              : (provider?.apiKey?.help ??
                (connection.hasSecret ? 'One is stored — this replaces it.' : 'Not set yet.'))
          }
        >
          <Field
            value={secret}
            onChange={setSecret}
            type="password"
            placeholder={connection.hasSecret ? 'replace the stored one' : 'paste it'}
            onEnter={() => void save()}
          />
        </Labelled>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SmallButton
          primary={!onConnect}
          disabled={busy || (!pending && !onConnect)}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save'}
        </SmallButton>
        {onConnect && (
          <SmallButton
            primary
            disabled={busy}
            title="Stores these, then opens the provider's consent page in your browser"
            onClick={() => void save(true)}
          >
            Save and connect
          </SmallButton>
        )}
        <span className="text-micro text-muted">
          Nothing is ever shown back — Bloom returns no secret on any route.
        </span>
      </div>
    </div>
  )
}

/**
 * Why there is no callback address to show, in the words of the actual cause.
 *
 * Three causes, and the first draft of this collapsed them into one sentence that
 * blamed `BLOOM_PUBLIC_URL` — which is wrong two times out of three and sends you to
 * edit an env var that is already correct. They are distinguishable, so they are
 * distinguished:
 *
 * * `undefined` — Aperture never got the provider list. Nothing is known about the
 *   server's configuration, so nothing is claimed about it.
 * * `''` — the server answered without a public URL. Genuinely ambiguous between a
 *   missing `BLOOM_PUBLIC_URL` and a Bloom predating the field, and an older build
 *   is the likelier of the two right after a change lands, so both are named.
 * * set — the server has an origin but no callback for this provider, which is what
 *   an older Bloom looks like once the origin is configured.
 *
 * The route shape is spelled out rather than assembled into a copyable value. It is
 * the same information, but a string presented for copying is one that gets pasted
 * into a developer console and compared byte for byte, and this one is a guess.
 */
function missingCallback(publicUrl?: string): string {
  const shape = 'It is <bloom origin>/admin/oauth/<provider>/callback.'
  if (publicUrl === undefined) {
    return `Aperture could not read this Bloom's provider list, so it cannot show the callback address to register. ${shape}`
  }
  if (publicUrl === '') {
    return `This Bloom reported no public URL — either BLOOM_PUBLIC_URL is unset on the server, or it is running a build from before it reported one. ${shape}`
  }
  return `This Bloom reported no callback address for this provider, which usually means it is running a build from before it reported one. It will be ${publicUrl.replace(/\/$/, '')}/admin/oauth/<provider>/callback — confirm against the server before registering it.`
}

/**
 * The callback address, to copy into the provider's console.
 *
 * **The step that has to happen before the credentials below are worth anything**,
 * and the one nothing in this app used to say out loud. Registering an app asks for
 * a redirect URI; the answer is Bloom's, not Aperture's, because a desktop app has
 * no stable public address and a provider will not redirect to one. It was
 * discoverable only by reading Bloom's source, or by completing a flow that cannot
 * complete until it is registered.
 *
 * Shown rather than typed, and copied rather than retyped, because it is compared
 * **exactly** — at the authorize step and again at the token exchange. A trailing
 * slash or `http` for `https` is a failure at the last hop of a flow that looked
 * like it was working.
 */
export function RedirectUri({
  uri,
  publicUrl,
}: {
  uri: string
  publicUrl?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  if (!uri) {
    return (
      <p className="rounded-field border border-warn/40 px-2.5 py-1.5 text-micro text-warn">
        {missingCallback(publicUrl)}
      </p>
    )
  }

  return (
    <Labelled
      label="Redirect URI"
      note="Register this with the provider first — it is compared exactly, so copy it rather than typing it."
    >
      <code className="min-w-0 flex-1 truncate rounded-control border border-line bg-raised px-2.5 py-1 font-mono text-meta text-muted">
        {uri}
      </code>
      <SmallButton
        onClick={() => {
          void navigator.clipboard.writeText(uri).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </SmallButton>
    </Labelled>
  )
}

/**
 * Whether you have to register an application, or merely may.
 *
 * Three cases, not two: without the provider list — one failed `connectionKinds`
 * call — we know neither, and claiming this Bloom already has an app registered
 * would tell someone to leave the boxes blank when blank is exactly what does not
 * work. Saying less is the safe direction.
 */
function appHint(connection: Connection, provider?: ProviderInfo): string {
  const service = provider?.displayName || connection.label || connection.name
  if (!provider) {
    return `Paste the client id and secret of the application you registered with ${service}.`
  }
  if (provider.hasDeploymentDefault) {
    return `This Bloom already has an app registered for ${service}. Leave both blank to use it, or paste your own to override it for this connection.`
  }
  return `Register an application with ${service} and paste its credentials here. They are encrypted and stored on this connection — nothing has to be set on the server.`
}

/**
 * What the button that opens this form says.
 *
 * An OAuth connection's "app credentials" are the developer registration, not the
 * user's account — calling both "key" is how someone ends up pasting an access token
 * into a client secret box. Exported so the two lists that render this form cannot
 * disagree about what the control is called.
 */
export function credentialsLabel(connection: Connection): string {
  if (connection.kind === 'oauth') return connection.hasClientSecret ? 'App' : 'Set app'
  if (connection.kind === 'mcp') return connection.hasSecret ? 'Token' : 'Set token'
  return connection.hasSecret ? 'Key' : 'Set key'
}

function Labelled({
  label,
  note,
  children,
}: {
  label: string
  note?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 shrink-0 text-meta text-muted">{label}</span>
        {children}
      </div>
      {note && <span className="pl-26 text-micro text-muted">{note}</span>}
    </div>
  )
}
