import { useEffect, useState } from 'react'

import type { ProviderInfo } from '../../shared/bloom'
import { matchFor } from '../../shared/credentials'
import type { CredentialSummary, InfraApp } from '../../shared/types'
import { Chip, Field, SmallButton } from './parts'
import type { Params } from './useRunner'

/**
 * Client credentials for connected services, discovered rather than enumerated.
 *
 * Adding a provider to Bloom is one TOML in `app/providers/` and nothing else
 * anywhere — no Python, no new tools. That promise was quietly broken at the
 * deployment layer: Spotify's client id and secret were listed by name in
 * `bloom/manifest.yaml`, so every connection you ever wanted needed an entry there
 * first and an amber-infra release to carry it.
 *
 * Now the manifest declares only the *pattern* (`dynamic_keys`, prefix
 * `BLOOM_OAUTH_`), and the live list comes from the app itself:
 * `GET /admin/oauth/providers` reports each provider's `client_id_env` and
 * `client_secret_env`. So a provider added this afternoon shows up here with the right
 * two variable names, and nothing in amber-infra or Aperture had to hear about it.
 *
 * Writing them still goes through the Servers tab rather than the Bloom tab, because
 * it needs root on the box: the values land in `secrets.yaml` (the master copy, the
 * one in the backups) and reach the container on the next reconcile. The Bloom tab
 * talks HTTP to Bloom and has no privileged path, which is a property worth keeping.
 */
export function Connections({
  app,
  run,
  credentials,
  onCredentialSaved,
  disabled,
}: {
  app: InfraApp
  run: (actionId: string, title: string, params?: Params) => void
  credentials: CredentialSummary[]
  onCredentialSaved: () => void
  disabled: boolean
}): React.JSX.Element | null {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Only for an app whose manifest says its keys are discovered, and only for the
  // discovery this build knows how to run. An app declaring a different one gets
  // nothing here rather than a wrong guess.
  const dynamic = (app.manifest?.dynamicKeys ?? []).find(
    (d) => d.discover === 'bloom-oauth-providers',
  )

  useEffect(() => {
    if (!dynamic) return
    let cancelled = false
    void window.aperture.bloom.providers().then((res) => {
      if (cancelled) return
      if (res.ok) setProviders(res.value)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [dynamic])

  if (!dynamic) return null

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-field border border-line bg-ground p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-meta text-muted">{dynamic.label}</span>
        <Chip>{dynamic.prefix}*</Chip>
      </div>

      {error && (
        <p className="text-micro text-muted">
          Could not ask {app.name} which services it supports ({error}). Link it on the
          Bloom tab, or add the two variables by hand in Advanced mode.
        </p>
      )}

      {providers?.length === 0 && (
        <p className="text-micro text-muted">
          {app.name} ships no provider manifests yet. Add one to its{' '}
          <code>app/providers/</code> directory and it will appear here — nothing needs
          to change in amber-infra or in Aperture.
        </p>
      )}

      {providers?.map((provider) => (
        <Provider
          key={provider.name}
          app={app}
          provider={provider}
          run={run}
          credentials={credentials}
          onCredentialSaved={onCredentialSaved}
          disabled={disabled}
        />
      ))}

      {providers && providers.length > 0 && (
        <p className="text-micro text-muted">
          Saved into secrets.yaml. Reconcile or restart {app.name} to hand them to the
          running container.
        </p>
      )}
    </div>
  )
}

function Provider({
  app,
  provider,
  run,
  credentials,
  onCredentialSaved,
  disabled,
}: {
  app: InfraApp
  provider: ProviderInfo
  run: (actionId: string, title: string, params?: Params) => void
  credentials: CredentialSummary[]
  onCredentialSaved: () => void
  disabled: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  // The credential ids follow from the provider's name, so one saved Spotify key fills
  // this on every box and in every app that asks for the same service.
  const idCred = `${provider.name}-client-id`
  const secretCred = `${provider.name}-client-secret`
  const savedId = matchFor(idCred, credentials).find((c) => c.readable)
  const savedSecret = matchFor(secretCred, credentials).find((c) => c.readable)
  const canFill = Boolean(savedId && savedSecret)

  // Reported by Bloom itself: whether the *running deployment* has them, not whether a
  // manifest exists. An older Bloom does not report the variable names at all, and
  // then there is nothing safe to write.
  const known = Boolean(provider.clientIdEnv && provider.clientSecretEnv)

  const fills = JSON.stringify([
    { key: provider.clientIdEnv, uid: savedId?.uid ?? '' },
    { key: provider.clientSecretEnv, uid: savedSecret?.uid ?? '' },
  ])

  const saveToVault = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.aperture.keys.save({
        credentialId: idCred,
        label: `${provider.displayName} client ID`,
        value: id,
      })
      await window.aperture.keys.save({
        credentialId: secretCred,
        label: `${provider.displayName} client secret`,
        value: secret,
      })
      setId('')
      setSecret('')
      setOpen(false)
      onCredentialSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-meta">
        <span className={provider.configured ? 'text-ok' : 'text-warn'}>
          {provider.configured ? '✓' : '!'}
        </span>
        <span>{provider.displayName}</span>
        {provider.configured ? (
          <Chip tone="ok">connected credentials set</Chip>
        ) : canFill ? (
          <Chip tone="ok">saved key</Chip>
        ) : (
          <Chip tone="warn">needs client credentials</Chip>
        )}
        {known && (
          <span className="truncate font-mono text-micro text-muted">
            {provider.clientIdEnv}
          </span>
        )}
        {provider.docsUrl && (
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-micro text-muted underline hover:text-accent-hi"
          >
            where to get one
          </a>
        )}

        {!provider.configured && known && canFill && (
          <SmallButton
            primary
            disabled={disabled}
            title={`Write ${provider.clientIdEnv} and ${provider.clientSecretEnv} into secrets.yaml from your saved credentials`}
            onClick={() =>
              run('fillCredentials', `Set ${provider.displayName} credentials`, {
                app: app.name,
                fills,
              })
            }
          >
            Use saved key
          </SmallButton>
        )}
        {!provider.configured && known && (
          <SmallButton onClick={() => setOpen((o) => !o)}>
            {open ? 'Cancel' : canFill ? 'Replace…' : 'Enter…'}
          </SmallButton>
        )}
        {!known && (
          <span className="text-micro text-muted">
            this Bloom does not report which variables it reads — update it
          </span>
        )}
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2 pl-5">
          <Field value={id} onChange={setId} placeholder={`${provider.displayName} client ID`} />
          <Field
            value={secret}
            onChange={setSecret}
            placeholder={`${provider.displayName} client secret`}
            type="password"
          />
          <SmallButton primary disabled={busy || !id || !secret} onClick={() => void saveToVault()}>
            {busy ? 'Saving…' : 'Save to Keys'}
          </SmallButton>
          <span className="text-micro text-muted">
            Saved once, then written to the box with the button above.
          </span>
        </div>
      )}
    </div>
  )
}
