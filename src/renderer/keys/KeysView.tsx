import { useCallback, useEffect, useState } from 'react'

import type { CredentialSummary } from '../../shared/types'
import { Card, Chip, Field, SmallButton } from '../infra/parts'

/**
 * The credentials you own, entered once.
 *
 * This is a thing you manage, not a preference, which is why it is a sidebar entry
 * rather than a section of Settings. What it removes: the same OpenRouter key typed
 * into eight apps' env blocks by hand, each an opportunity to paste the wrong one and
 * find out days later.
 *
 * Note what this page cannot do: show you a value. There is no IPC channel that
 * returns one — a credential is decrypted in main at the moment an install needs it
 * and goes straight into the SSH heredoc. So "replace" is the only edit, which is
 * also the honest one, since you cannot verify a secret by squinting at it.
 */
export function KeysView(): React.JSX.Element {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([])
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await window.aperture.keys.list()
    setCredentials(res.credentials)
    setAvailable(res.available)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
        <div>
          <h2 className="text-sm font-medium">Keys</h2>
          <p className="text-xs text-muted">
            Credentials you already have from somewhere else — an OpenRouter key, a
            Spotify client secret. Saved once here, filled in automatically whenever an
            app asks for them.
          </p>
        </div>

        {!available && (
          // The same shape KeyManager uses for the SSH vault, for the same reason:
          // silently degrading to plaintext would be worse than saying so.
          <Card
            title="This machine cannot encrypt"
            hint="On Linux this usually means no keyring (gnome-keyring / kwallet) is running."
          >
            <p className="text-xs leading-relaxed text-muted">
              Credentials are stored with the OS keychain and nothing is written in the
              clear, so nothing can be saved until that is available. Apps can still be
              installed — you will just be asked for each value as you go, the way it
              worked before this page existed.
            </p>
          </Card>
        )}

        <AddCredential
          disabled={!available}
          onError={setError}
          onSaved={() => {
            setError(null)
            void refresh()
          }}
        />

        {error && <p className="text-meta text-danger">{error}</p>}

        {credentials.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {credentials.map((c) => (
              <Row key={c.uid} credential={c} onChanged={refresh} onError={setError} />
            ))}
          </ul>
        ) : (
          available && (
            <p className="text-meta text-muted">
              Nothing saved yet. Add a key here, or use the{' '}
              <span className="text-ink">use saved key</span> button on an app that needs
              one — both write to the same place.
            </p>
          )
        )}

        {/* Stated on the page rather than in a comment, because it changes what
            losing this file costs and the answer is reassuring. */}
        <p className="border-t border-line pt-3 text-micro leading-relaxed text-muted">
          Stored encrypted, tied to this computer and this OS account — a copy carried
          to another machine will list these but be unable to read them. That is safe to
          lose: every value you have filled into an app also lives in that box&apos;s
          <code className="mx-1">secrets.yaml</code>, which is what the backups hold. The
          cost of losing this vault is retyping, never re-authorising.
        </p>
      </div>
    </div>
  )
}

/**
 * Ids are lower-kebab and match the `credential:` field in an app's manifest. Offered
 * as a datalist rather than a free-text field alone: a typo here does not fail, it
 * just silently never matches anything, which is the failure mode this whole change
 * exists to stop.
 */
const KNOWN_IDS = [
  'openrouter-api-key',
  'openai-api-key',
  'anthropic-api-key',
  'github-token',
  'spotify-client-id',
  'spotify-client-secret',
]

function AddCredential({
  disabled,
  onSaved,
  onError,
}: {
  disabled: boolean
  onSaved: () => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [credentialId, setCredentialId] = useState('')
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (!credentialId.trim() || !value) return
    setBusy(true)
    try {
      await window.aperture.keys.save({
        credentialId: credentialId.trim(),
        label: label.trim() || credentialId.trim(),
        value,
      })
      setCredentialId('')
      setLabel('')
      setValue('')
      onSaved()
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Add a key" hint="The id is what an app's manifest asks for by name.">
      <datalist id="aperture-credential-ids">
        {KNOWN_IDS.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-2">
        <input
          list="aperture-credential-ids"
          value={credentialId}
          placeholder="openrouter-api-key"
          disabled={disabled}
          onChange={(e) => setCredentialId(e.target.value)}
          className="min-w-0 flex-1 rounded-control border border-line bg-raised px-2.5 py-1 font-mono text-meta text-ink outline-none focus:border-accent-deep disabled:opacity-40"
        />
        <Field value={label} onChange={setLabel} placeholder="a name for you (optional)" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Field value={value} onChange={setValue} placeholder="paste the value" type="password" />
        <SmallButton
          primary
          disabled={disabled || busy || !credentialId.trim() || !value}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save'}
        </SmallButton>
      </div>
    </Card>
  )
}

function Row({
  credential,
  onChanged,
  onError,
}: {
  credential: CredentialSummary
  onChanged: () => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [replacing, setReplacing] = useState(false)
  const [value, setValue] = useState('')

  const replace = async (): Promise<void> => {
    if (!value) return
    try {
      await window.aperture.keys.save({
        uid: credential.uid,
        credentialId: credential.credentialId,
        label: credential.label,
        value,
      })
      setValue('')
      setReplacing(false)
      onError(null)
      onChanged()
    } catch (err) {
      onError((err as Error).message)
    }
  }

  return (
    <li className="rounded-panel border border-line bg-raised/50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{credential.label}</p>
          <p className="truncate font-mono text-meta text-muted">{credential.credentialId}</p>
        </div>
        {/* `readable` is recomputed on every read, so this is the state right now
            rather than what was true when it was saved. */}
        {!credential.readable && (
          <span title="Saved by a different OS account, or on another machine">
            <Chip tone="warn">cannot be read here</Chip>
          </span>
        )}
        <SmallButton onClick={() => setReplacing((r) => !r)}>
          {replacing ? 'Cancel' : 'Replace'}
        </SmallButton>
        <SmallButton
          danger
          onClick={() => {
            void window.aperture.keys.remove(credential.uid).then(onChanged)
          }}
        >
          Remove
        </SmallButton>
      </div>

      {replacing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Field value={value} onChange={setValue} placeholder="paste the new value" type="password" />
          <SmallButton primary disabled={!value} onClick={() => void replace()}>
            Save
          </SmallButton>
          <span className="text-micro text-muted">
            Apps already holding the old value keep it until you reinstall them.
          </span>
        </div>
      )}
    </li>
  )
}
