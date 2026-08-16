import { useEffect, useState } from 'react'

import { matchFor, readinessOf, type Readiness as ReadinessResult } from '../../shared/credentials'
import type { CredentialSummary, EnvVar, ManifestDoc } from '../../shared/types'
import { Chip, Field, SmallButton } from './parts'

/**
 * What this app still needs before it can be installed, and where each answer comes
 * from.
 *
 * This replaces reading a wall of env vars and knowing which ones mattered. The split
 * it renders is the manifest's: the box generates its own tokens, `install.sh` writes
 * the derived ones, and what is left is the short list only you can supply — with a
 * link to where you get it, and a one-click fill when the vault already has it.
 *
 * `readinessOf` and `matchFor` come from `shared/credentials` rather than being
 * reimplemented here. That module has no Electron imports precisely so both sides can
 * use it and `scripts/verify-credentials.mjs` can drive it; a second copy of "is this
 * ready" in the renderer is how a button and the truth drift apart.
 */
export function useCredentials(): {
  credentials: CredentialSummary[]
  available: boolean
  refresh: () => Promise<void>
} {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([])
  const [available, setAvailable] = useState(true)

  const refresh = async (): Promise<void> => {
    const res = await window.aperture.keys.list()
    setCredentials(res.credentials)
    setAvailable(res.available)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { credentials, available, refresh }
}

/** The fills an install should carry: `[{ key, uid }]`, values never included. */
export type Fills = Array<{ key: string; uid: string }>

export function readinessFor(
  manifest: ManifestDoc | null | undefined,
  env: EnvVar[],
  credentials: CredentialSummary[],
): ReadinessResult | null {
  if (!manifest) return null
  const values: Record<string, { set: boolean; placeholder: boolean }> = {}
  for (const v of env) values[v.name] = { set: v.set, placeholder: v.placeholder }
  return readinessOf(manifest.keys, values, credentials)
}

/** The uids an install will fill, chosen automatically when there is only one. */
export function fillsFor(readiness: ReadinessResult | null, chosen: Record<string, string>): Fills {
  if (!readiness) return []
  const fills: Fills = []
  for (const item of readiness.items) {
    if (!item.credential) continue
    const uid = chosen[item.name] ?? item.matches.find((m) => m.readable)?.uid
    if (uid) fills.push({ key: item.name, uid })
  }
  return fills
}

export function ReadinessList({
  readiness,
  credentials,
  chosen,
  onChoose,
  onSaved,
  configs,
  onConfig,
}: {
  readiness: ReadinessResult
  credentials: CredentialSummary[]
  chosen: Record<string, string>
  onChoose: (key: string, uid: string) => void
  onSaved: () => void
  /** Plain settings typed here, carried into the install. Never secrets. */
  configs: Record<string, string>
  onConfig: (key: string, value: string) => void
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1.5">
      {readiness.items.map((item) => (
        <li key={item.name} className="flex flex-wrap items-center gap-2 text-meta">
          <Mark state={item.state} />
          <span className="font-mono text-muted">{item.name}</span>

          {item.state === 'derived' && <span className="text-micro text-muted">set by install</span>}
          {item.state === 'generated' && (
            <span className="text-micro text-muted">
              generated on the box{item.kind === 'generated:fernet' ? ' (Fernet)' : ''}
            </span>
          )}
          {item.state === 'set' && <span className="text-micro text-muted">already set</span>}
          {item.state === 'default' && (
            // Shown rather than hidden: it is answered, but it is also the one class of
            // value you might reasonably want to change before installing.
            <ConfigValue item={item} configs={configs} onConfig={onConfig} />
          )}

          {item.state === 'from-vault' && (
            <>
              <span className="text-micro text-muted">{item.label}</span>
              <Chip tone="ok">saved key</Chip>
              {/* Only when the choice is real. One match fills silently; asking
                  which of one is a question with no information in it. */}
              {item.matches.length > 1 && (
                <select
                  value={chosen[item.name] ?? item.matches[0].uid}
                  onChange={(e) => onChoose(item.name, e.target.value)}
                  className="rounded-control border border-line bg-raised px-1.5 py-0.5 text-micro text-ink outline-none focus:border-accent-deep"
                >
                  {item.matches.map((m) => (
                    <option key={m.uid} value={m.uid}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          {item.state === 'needed' &&
            (item.credential ? (
              <NeedsValue item={item} credentials={credentials} onSaved={onSaved} />
            ) : (
              // A config key with no default. It has no credential, so the vault path
              // above does not apply and previously nothing rendered at all — the key
              // simply blocked the install with no way to answer it.
              <ConfigValue item={item} configs={configs} onConfig={onConfig} required />
            ))}
        </li>
      ))}
    </ul>
  )
}

/**
 * A plain, non-secret setting: a database path inside the container, a feature flag.
 *
 * Goes into the install as a parameter rather than into the credential vault. The
 * vault is for values that exist elsewhere in the world and must not be echoed; these
 * are configuration, and seeing `BLOOM_DB_PATH=/data/bloom.db` in the operation log is
 * useful rather than a leak.
 */
function ConfigValue({
  item,
  configs,
  onConfig,
  required,
}: {
  item: ReadinessResult['items'][number]
  configs: Record<string, string>
  onConfig: (key: string, value: string) => void
  required?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const current = configs[item.name] ?? ''
  const shown = current || item.default || ''

  return (
    <>
      {required && !current ? (
        <span className="text-micro text-warn">needs a value</span>
      ) : (
        <span className="truncate font-mono text-micro text-muted">{shown}</span>
      )}
      {current && item.default && current !== item.default && <Chip>changed</Chip>}
      <SmallButton onClick={() => setOpen((o) => !o)}>{open ? 'Done' : 'Change'}</SmallButton>
      {open && (
        <span className="flex w-full flex-wrap items-center gap-2 pl-5">
          <Field
            value={current || item.default || ''}
            onChange={(v) => onConfig(item.name, v)}
            placeholder={item.default ?? item.name}
          />
          <span className="text-micro text-muted">
            {item.default ? `default: ${item.default}` : 'no default — this one needs a value'}
          </span>
        </span>
      )}
    </>
  )
}

function Mark({ state }: { state: string }): React.JSX.Element {
  // `needed` is the only one that is a problem; `derived` is not even a task. Using
  // three glyphs rather than three colours keeps this readable when the row is dense.
  const glyph = state === 'needed' ? '!' : state === 'derived' ? '·' : '✓'
  const tone =
    state === 'needed' ? 'text-warn' : state === 'derived' ? 'text-muted' : 'text-ok'
  return <span className={`w-3 shrink-0 text-center ${tone}`}>{glyph}</span>
}

/**
 * A key nothing can fill yet.
 *
 * Offers the value inline rather than sending you to the Keys page and back, because
 * the moment you find out you need an OpenRouter key is the moment you have one in
 * the clipboard. It saves to the same vault either way, so it is entered once, ever.
 */
function NeedsValue({
  item,
  credentials,
  onSaved,
}: {
  item: ReadinessResult['items'][number]
  credentials: CredentialSummary[]
  onSaved: () => void
}): React.JSX.Element {
  // An entry exists but this machine cannot decrypt it — a different answer from
  // "you have never saved one", and a different fix.
  const unreadable = item.credential
    ? matchFor(item.credential, credentials).some((m) => !m.readable)
    : false

  return (
    <>
      {/* status.sh falls back to the key name when a manifest gives no label, and
          printing both rendered every unlabelled key twice. */}
      {item.label !== item.name && <span className="text-micro text-warn">{item.label}</span>}
      {!item.required && <Chip>optional</Chip>}
      {unreadable && <Chip tone="warn">saved on another machine</Chip>}
      {item.helpUrl && (
        <a
          href={item.helpUrl}
          target="_blank"
          rel="noreferrer"
          className="text-micro text-muted underline hover:text-accent-hi"
        >
          where to get one
        </a>
      )}
      {item.credential && (
        <SaveToVault credentialId={item.credential} label={item.label} onSaved={onSaved} />
      )}
    </>
  )
}

/**
 * Put a value in the credential vault, from wherever you happened to find out you
 * needed it.
 *
 * Split out of `NeedsValue` when the configuration list needed the same control: the
 * checklist offers it before an install, and the app's own configuration offers it
 * afterwards, and those must save to the same place under the same id or the "one
 * value, every app" promise quietly stops holding.
 *
 * Inline rather than a link to the Keys page, because the moment you find out you need
 * an OpenRouter key is the moment you have one in the clipboard.
 */
export function SaveToVault({
  credentialId,
  label,
  onSaved,
}: {
  credentialId: string
  label: string
  onSaved: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (!value) return
    try {
      await window.aperture.keys.save({ credentialId, label, value })
      setValue('')
      setOpen(false)
      setError(null)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <SmallButton
        title={`Save this once as ${credentialId}, for every app that asks for it`}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Cancel' : 'Enter…'}
      </SmallButton>
      {open && (
        <span className="flex w-full flex-wrap items-center gap-2 pl-5">
          <Field value={value} onChange={setValue} placeholder={`paste ${label}`} type="password" />
          <SmallButton primary disabled={!value} onClick={() => void save()}>
            Save to vault
          </SmallButton>
          <span className="text-micro text-muted">
            Saved once, for every app that asks for it.
          </span>
        </span>
      )}
      {error && <span className="text-micro text-danger">{error}</span>}
    </>
  )
}

/** "3 of 4 ready — needs OpenRouter API key". */
export function ReadinessSummary({ readiness }: { readiness: ReadinessResult }): React.JSX.Element {
  if (readiness.total === 0) return <Chip tone="ok">nothing to supply</Chip>
  const done = readiness.missing.length === 0
  return (
    <span className="flex items-center gap-2">
      <Chip tone={done ? 'ok' : 'warn'}>
        {readiness.ready} of {readiness.total} ready
      </Chip>
      {!done && (
        <span className="truncate text-micro text-muted">
          needs {readiness.missing.map((m) => m.label).join(', ')}
        </span>
      )}
    </span>
  )
}
