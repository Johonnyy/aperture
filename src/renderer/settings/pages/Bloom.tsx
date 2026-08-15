import { useState } from 'react'

import { useStore } from '../../store'
import { Field, Note, field } from '../parts'

/**
 * Linking Bloom by hand.
 *
 * The usual path is the Servers tab, which reads the admin key off the box over SSH —
 * that is where the sudo password already lives, transiently, and it is the only place
 * it should. This is the escape hatch: a local instance during development, or a Bloom
 * no configured server reaches.
 *
 * The key goes straight into the OS keychain in main and never comes back across the
 * bridge, so there is nothing to display and no way to reveal it — only to replace it
 * or forget it.
 *
 * Once something *is* linked the form folds away behind a disclosure. It used to render
 * unconditionally, which put an empty address-and-key form directly under the live link
 * — reading as Bloom's configuration living in two places, when it is one link reached
 * two ways.
 */
export function Bloom(): React.JSX.Element {
  const link = useStore((s) => s.bloomLink)
  const setBloomLink = useStore((s) => s.setBloomLink)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linkNow = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await window.aperture.bloom.linkManually(url, token)
    setBusy(false)
    if (result.link) setBloomLink(result.link)
    if (result.ok) {
      setUrl('')
      setToken('')
    } else {
      setError(result.error ?? 'Could not link Bloom.')
    }
  }

  const unlink = async (): Promise<void> => {
    if (!window.confirm('Forget this Bloom? Its admin key is deleted from this machine.'))
      return
    setBloomLink(await window.aperture.bloom.unlink())
  }

  const form = (
    <div className="flex flex-col gap-3">
      {error && <p className="text-xs text-danger">{error}</p>}

      <Field
        label="Address"
        hint={
          <>
            Plain http is allowed only for localhost — the admin key grants full control,
            and sending it unencrypted to a public host is refused.
          </>
        }
      >
        <input
          className={field}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8010"
        />
      </Field>

      <Field
        label="Admin key"
        hint={
          <>
            Stored in the OS keychain, never in a settings file. It is not readable back
            from here once saved.
          </>
        }
      >
        <input
          className={field}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="from BLOOM_ADMIN_KEYS"
        />
      </Field>

      <div>
        <button
          type="button"
          disabled={busy || !url.trim() || !token.trim()}
          onClick={() => void linkNow()}
          className="rounded-field border border-accent-deep bg-accent/15 px-4 py-2 text-sm text-accent-hi transition hover:bg-accent/25 disabled:opacity-40"
        >
          {busy ? 'Linking…' : 'Link Bloom'}
        </button>
      </div>
    </div>
  )

  if (link.state === 'unlinked') {
    return (
      <>
        <Note>
          Not linked. The usual way is the Servers tab, which reads the key off the box
          for you — this is for a local instance, or one no server reaches.
        </Note>
        {form}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-meta text-muted">
          {link.baseUrl} · {link.state}
        </span>
        <button
          type="button"
          onClick={() => void unlink()}
          className="rounded-field border border-line px-3 py-1.5 text-sm text-muted transition hover:border-danger/50 hover:text-danger"
        >
          Forget
        </button>
      </div>

      <details className="border-t border-line pt-2">
        <summary className="cursor-pointer text-meta text-muted">
          Link a different Bloom manually
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <Note>
            For a local instance, or one no configured server reaches. Replaces the link
            above — there is only ever one.
          </Note>
          {form}
        </div>
      </details>
    </>
  )
}
