import { useState } from 'react'

import { buildConfigView, looksSecret, type ConfigRow } from '../../shared/configuration'
import type { Readiness as ReadinessResult } from '../../shared/credentials'
import type { CredentialSummary, InfraApp } from '../../shared/types'
import { Chip, Field, SmallButton } from './parts'
import { SaveToVault } from './Readiness'
import type { Params } from './useRunner'

/**
 * Everything about one app's environment, in the order you would act on it.
 *
 * This replaces an env editor that was behind Advanced mode and listed only what
 * `secrets.yaml` already held. Both halves of that were the same omission: a key the
 * app *needs* and nothing has written does not appear in `secrets.yaml`, so the one
 * question worth asking — what is missing? — was the one question the screen could not
 * answer, and it could not answer it in a place most people never opened. The honest
 * summary of the old behaviour is that finding a missing key meant reading the app's
 * manifest over SSH, which design principle 2 says is a bug in Aperture.
 *
 * So: always visible, manifest-joined, and grouped by what you would do about it —
 * `shared/configuration.ts` owns that classification. Advanced mode still gates the
 * two machinery affordances (adding a key by hand, deleting one), because those are
 * about the shape of the file rather than the value in it.
 *
 * The rule the old editor got right and this keeps: **writing is not applying**.
 * `secrets.yaml` is the source, the container reads a rendered `.env`, and a saved
 * value changes nothing until the app is reconciled. Every save says so, and the
 * header offers the reconcile rather than leaving you to find it.
 */
export function Configuration({
  app,
  readiness,
  credentials,
  run,
  onCredentialSaved,
  onReconcile,
  advanced,
  disabled,
}: {
  app: InfraApp
  /** From the app's manifest. Null on a box whose status.sh predates them. */
  readiness: ReadinessResult | null
  credentials: CredentialSummary[]
  run: (actionId: string, title: string, params?: Params) => void
  onCredentialSaved: () => void
  /** Render secrets.yaml into the live `.env` and restart. Null when it cannot run. */
  onReconcile: (() => void) | null
  advanced: boolean
  disabled: boolean
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [showManaged, setShowManaged] = useState(false)

  const view = buildConfigView(app.env, app.envKeys, readiness)
  // Nothing has read a rendered `.env` yet, so "not applied" is true of every row and
  // says nothing. It is drift only once there is a container that could be stale.
  const deployed = app.envKeys.length > 0

  // Nothing to join and nothing to list. Worth saying out loud rather than rendering an
  // empty box: on a box predating manifests this is the expected state, and the fix is
  // a different button on a different card.
  if (view.rows.length === 0) {
    return (
      <p className="text-meta text-muted">
        Nothing under <code className="text-ink/70">apps.{app.name}.env</code>, and no
        manifest to say what this app needs — enter the sudo password and re-read, or
        update the box&apos;s amber-infra checkout.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {view.blocking.length > 0 ? (
          <Chip tone="warn">
            {view.blocking.length} required value{view.blocking.length === 1 ? '' : 's'} missing
          </Chip>
        ) : view.needed.length > 0 ? (
          <Chip>{view.needed.length} optional value{view.needed.length === 1 ? '' : 's'} unset</Chip>
        ) : (
          <Chip tone="ok">everything it needs is set</Chip>
        )}
        {/* The state with no other home. The value is right there in the editor and the
            container has never seen it — every other indicator on this card reads
            green while that is true. */}
        {view.pending.length > 0 && (
          <span
            title={view.pending.map((r) => r.name).join(', ')}
            className="flex items-center gap-2"
          >
            <Chip tone="warn">{view.pending.length} saved but not applied</Chip>
          </span>
        )}
        <div className="flex-1" />
        {onReconcile && (
          <SmallButton
            primary={view.pending.length > 0}
            disabled={disabled}
            title="Render secrets.yaml into the app's .env and restart it"
            onClick={onReconcile}
          >
            Reconcile
          </SmallButton>
        )}
        {advanced && (
          <SmallButton onClick={() => setAdding((a) => !a)}>
            {adding ? 'Cancel' : 'Add variable'}
          </SmallButton>
        )}
      </div>

      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-control border border-line p-2">
          <Field value={newName} onChange={setNewName} placeholder="AMBER_SEARCH_API_KEY" />
          <Field
            type={looksSecret(newName) ? 'password' : 'text'}
            value={newValue}
            onChange={setNewValue}
            placeholder="value"
          />
          <SmallButton
            disabled={disabled || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) || !newValue}
            onClick={() => {
              run('setVar', `Add ${newName} to ${app.name}`, {
                app: app.name,
                key: newName,
                value: newValue,
              })
              setNewName('')
              setNewValue('')
              setAdding(false)
            }}
          >
            Add
          </SmallButton>
        </div>
      )}

      <Group
        title="Needs a value"
        hint="Declared by this app, and nothing on the box will invent one for you."
        rows={view.needed}
      >
        {(row) => (
          <NeededRow
            key={row.name}
            app={app.name}
            row={row}
            credentials={credentials}
            run={run}
            onCredentialSaved={onCredentialSaved}
            disabled={disabled}
          />
        )}
      </Group>

      <Group
        title="Settings you can change"
        hint="Plain configuration, shown in the clear. Reconcile to make a change take effect."
        rows={view.settings}
      >
        {(row) => (
          <ValueRow
            key={row.name}
            app={app.name}
            row={row}
            run={run}
            disabled={disabled}
            advanced={advanced}
            deployed={deployed}
          />
        )}
      </Group>

      <Group
        title="Secrets"
        hint="Write-only. status.sh never reports the value, so there is nothing here to read back — you do not need to see a key to replace it."
        rows={view.secrets}
      >
        {(row) => (
          <ValueRow
            key={row.name}
            app={app.name}
            row={row}
            run={run}
            disabled={disabled}
            advanced={advanced}
            deployed={deployed}
          />
        )}
      </Group>

      {view.managed.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setShowManaged((s) => !s)}
            className="flex w-full items-center gap-2 text-left text-meta text-muted hover:text-ink"
          >
            <span>{showManaged ? '▾' : '▸'}</span>
            <span>Managed for you ({view.managed.length})</span>
            <span className="text-micro">
              — install.sh derives these, or the box generates them. Editing one is
              pointless: the next install overwrites it.
            </span>
          </button>
          {showManaged && (
            <ul className="flex flex-col gap-1.5 pl-4">
              {view.managed.map((row) => (
                <ManagedRow key={row.name} row={row} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Group({
  title,
  hint,
  rows,
  children,
}: {
  title: string
  hint: string
  rows: ConfigRow[]
  children: (row: ConfigRow) => React.ReactNode
}): React.JSX.Element | null {
  // An empty group is not a reassurance, it is a heading with nothing under it. The
  // header chips above already say whether anything is outstanding.
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-meta text-ink/70" title={hint}>
        {title}
      </p>
      <ul className="flex flex-col gap-1.5">{rows.map((row) => children(row))}</ul>
    </div>
  )
}

/**
 * A key the app declares and nothing has written.
 *
 * Three ways to answer it, offered in the order of least work: the vault already holds
 * one, the vault could hold one (so save it there, once, for every app that asks), or
 * type it straight into this app's stanza. The vault path is the ecosystem's design —
 * Amber's manifest names `openrouter-api-key` against `AMBER_OPENROUTER_API_KEY` and
 * Bloom's names it against `BLOOM_OPENROUTER_API_KEY`, so one saved value fills both.
 */
function NeededRow({
  app,
  row,
  credentials,
  run,
  onCredentialSaved,
  disabled,
}: {
  app: string
  row: ConfigRow
  credentials: CredentialSummary[]
  run: (actionId: string, title: string, params?: Params) => void
  onCredentialSaved: () => void
  disabled: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const matches = (row.item?.matches ?? []).filter((m) => m.readable)
  const [uid, setUid] = useState(matches[0]?.uid ?? '')
  const save = (): void => {
    if (draft) run('setVar', `Set ${row.name}`, { app, key: row.name, value: draft })
  }

  return (
    <li className="flex flex-col gap-1 rounded-field border border-line/70 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`w-56 shrink-0 truncate font-mono text-meta ${row.required ? 'text-warn' : 'text-ink/80'}`} title={row.name}>
          {row.name}
        </span>
        {row.required ? <Chip tone="warn">required</Chip> : <Chip>optional</Chip>}
        {/* The manifest's label only says something the name did not when they differ;
            status.sh falls back to the key name when a manifest gives no label. */}
        {row.item && row.item.label !== row.name && (
          <span className="text-micro text-muted">{row.item.label}</span>
        )}
        {row.env?.placeholder && <Chip tone="warn">still CHANGEME</Chip>}
        {row.fillable && <Chip tone="ok">saved key available</Chip>}
        {row.item?.helpUrl && (
          <a
            href={row.item.helpUrl}
            target="_blank"
            rel="noreferrer"
            className="text-micro text-muted underline hover:text-accent-hi"
          >
            where to get one
          </a>
        )}
      </div>

      {row.why && <p className="pl-1 text-micro text-muted">{row.why}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {row.fillable && (
          <>
            {matches.length > 1 && (
              <select
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                className="rounded-control border border-line bg-raised px-1.5 py-0.5 text-micro text-ink outline-none focus:border-accent-deep"
              >
                {matches.map((m) => (
                  <option key={m.uid} value={m.uid}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            <SmallButton
              primary
              disabled={disabled || !uid}
              title="Write the saved credential into this app's stanza. The value never reaches this window."
              onClick={() =>
                run('fillVar', `Fill ${row.name} from the saved credential`, {
                  app,
                  fills: JSON.stringify([{ key: row.name, uid }]),
                })
              }
            >
              Use saved key
            </SmallButton>
          </>
        )}

        {/* Offered even when the vault can fill it: a second OpenRouter key for one app
            is a legitimate thing to want, and the alternative is SSH. */}
        <Field
          type={row.secret ? 'password' : 'text'}
          value={draft}
          onChange={setDraft}
          placeholder={row.item?.default ? `default: ${row.item.default}` : `value for ${row.name}`}
          onEnter={save}
        />
        <SmallButton disabled={disabled || !draft} onClick={save}>
          Save
        </SmallButton>

        {/* Saving to the vault instead is the better answer when the value is one other
            apps will ask for too — hence a separate, quieter control. */}
        {row.item?.credential && (
          <SaveToVault
            credentialId={row.item.credential}
            label={row.item.label}
            onSaved={onCredentialSaved}
          />
        )}
      </div>
    </li>
  )
}

/** A value that is set: editable in the clear, or replaceable if it is a secret. */
function ValueRow({
  app,
  row,
  run,
  disabled,
  advanced,
  deployed,
}: {
  app: string
  row: ConfigRow
  run: (actionId: string, title: string, params?: Params) => void
  disabled: boolean
  advanced: boolean
  /** Something is running that could be reading a stale `.env`. */
  deployed: boolean
}): React.JSX.Element {
  // Secrets start blank on purpose: there is nothing to prefill, and a masked
  // placeholder that looked like a value would invite saving it back unchanged.
  const [draft, setDraft] = useState(row.secret ? '' : (row.env?.value ?? ''))
  const changed = row.secret ? draft.length > 0 : draft !== (row.env?.value ?? '')
  const save = (): void => {
    if (changed) run('setVar', `Set ${row.name}`, { app, key: row.name, value: draft })
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-56 shrink-0 truncate font-mono text-meta text-ink/80" title={row.why ?? row.name}>
        {row.name}
      </span>
      <Field
        type={row.secret ? 'password' : 'text'}
        value={draft}
        onChange={setDraft}
        placeholder={row.secret ? 'set · type to replace' : (row.item?.default ?? '')}
        onEnter={save}
      />
      {/* Per row, not just as a count in the header: which key is stale is the whole
          question, and "3 saved but not applied" does not answer it. */}
      {deployed && !row.live && <Chip tone="warn">not applied yet</Chip>}
      {row.item?.default && !row.secret && row.env?.value !== row.item.default && (
        <span className="text-micro text-muted" title={`manifest default: ${row.item.default}`}>
          changed from default
        </span>
      )}
      <SmallButton disabled={disabled || !changed} onClick={save}>
        Save
      </SmallButton>
      {advanced && (
        <SmallButton
          danger
          disabled={disabled}
          title="Remove this key from secrets.yaml"
          onClick={() => run('unsetVar', `Remove ${row.name}`, { app, key: row.name })}
        >
          ✕
        </SmallButton>
      )}
    </li>
  )
}

/** Derived or generated. Shown so it is accounted for, read-only so it is not chased. */
function ManagedRow({ row }: { row: ConfigRow }): React.JSX.Element {
  const kind = row.item?.kind ?? (row.env?.derived ? 'derived' : null)
  const who =
    kind === 'derived'
      ? 'install.sh writes this on every install'
      : kind === 'peer_map'
        ? 'the peer wiring writes this'
        : kind === 'peer_token'
          ? 'the peer wiring generates this'
          : kind?.startsWith('generated:')
            ? `generated on the box${kind === 'generated:fernet' ? ' (Fernet)' : ''}`
            : 'filled by the install'

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-56 shrink-0 truncate font-mono text-meta text-muted" title={row.name}>
        {row.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-micro text-muted">{who}</span>
      {!row.filled && !row.live && <Chip>not yet generated</Chip>}
      {row.filled && row.live && <Chip tone="ok">set</Chip>}
    </li>
  )
}
