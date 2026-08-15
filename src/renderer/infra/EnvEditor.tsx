import { useState } from 'react'

import type { EnvVar } from '../../shared/types'
import { Chip, Field, SmallButton } from './parts'
import type { Params } from './useRunner'

/**
 * Editing an app's environment.
 *
 * Two rules shape the whole thing:
 *
 * 1. **Secrets are write-only.** `status.sh` never emits the value of anything whose
 *    name ends `_KEY`, `_TOKEN`, `_SECRET` and so on, so there is nothing here to
 *    read back and nothing to leak into a screenshot. You do not need to see an API
 *    key to replace it. Non-secret settings — a timezone, a database path, a public
 *    URL — are shown and edited normally, because hiding those would be theatre.
 * 2. **Writing is not applying.** `secrets.yaml` is the source; the container reads a
 *    rendered `.env`. A saved value changes nothing until the app is reconciled, and
 *    the header says so rather than letting you assume otherwise.
 *
 * Ordering is by what is blocking you: placeholders first — those are the ones that
 * are currently mounted as the literal word CHANGEME — then unset, then secrets, then
 * everything else.
 */
export function EnvEditor({
  app,
  vars,
  run,
  disabled,
}: {
  app: string
  vars: EnvVar[]
  run: (actionId: string, title: string, params?: Params) => void
  disabled: boolean
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')

  const pending = vars.filter((v) => (v.placeholder || !v.set) && !v.derived).length
  const sorted = [...vars].sort(rank)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-meta text-muted">
          Edits go to secrets.yaml. Reconcile the app to render them into its .env and
          restart.
        </span>
        <div className="flex-1" />
        {pending > 0 && <Chip tone="warn">{pending} still unset</Chip>}
        <SmallButton onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel' : 'Add variable'}
        </SmallButton>
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
              run('setVar', `Add ${newName} to ${app}`, {
                app,
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

      <ul className="flex flex-col gap-1.5">
        {sorted.map((v) => (
          <Row key={v.name} app={app} v={v} run={run} disabled={disabled} />
        ))}
      </ul>
    </div>
  )
}

function Row({
  app,
  v,
  run,
  disabled,
}: {
  app: string
  v: EnvVar
  run: (actionId: string, title: string, params?: Params) => void
  disabled: boolean
}): React.JSX.Element {
  // Secrets start blank on purpose: there is nothing to prefill, and a masked
  // placeholder that looked like a value would invite saving it back unchanged.
  const [draft, setDraft] = useState(v.secret ? '' : (v.value ?? ''))
  const target = { app, key: v.name }
  // Derived rows are read-only. Letting you type into one would be offering an edit
  // that the next install silently discards.
  const changed =
    !v.derived && (v.secret ? draft.length > 0 : draft !== (v.value ?? ''))

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span
        className={[
          'w-56 shrink-0 truncate font-mono text-meta',
          v.derived ? 'text-muted' : v.placeholder ? 'text-accent' : 'text-ink/80',
        ].join(' ')}
        title={v.name}
      >
        {v.name}
      </span>

      <Field
        type={v.secret ? 'password' : 'text'}
        value={draft}
        onChange={setDraft}
        placeholder={
          v.derived
            ? 'install.sh computes this on every install'
            : v.placeholder
            ? 'still CHANGEME — set a real value'
            : v.secret
              ? v.set
                ? 'set · type to replace'
                : 'not set'
              : ''
        }
        onEnter={() =>
          changed && run('setVar', `Set ${v.name}`, { ...target, value: draft })
        }
      />

      {v.derived && <Chip>set by install.sh</Chip>}
      {v.placeholder && !v.derived && <Chip tone="warn">placeholder</Chip>}
      {v.secret && !v.placeholder && !v.derived && (
        <Chip tone={v.set ? 'ok' : 'warn'}>secret</Chip>
      )}

      <SmallButton
        disabled={disabled || !changed}
        onClick={() => run('setVar', `Set ${v.name}`, { ...target, value: draft })}
      >
        Save
      </SmallButton>
      <SmallButton
        danger
        disabled={disabled || v.derived}
        title="Remove this key from secrets.yaml"
        onClick={() => run('unsetVar', `Remove ${v.name}`, target)}
      >
        ✕
      </SmallButton>
    </li>
  )
}

/** Placeholders and unset values first — they are what is actually blocking you. */
function rank(a: EnvVar, b: EnvVar): number {
  const weight = (v: EnvVar): number =>
    v.derived ? 4 : v.placeholder ? 0 : !v.set ? 1 : v.secret ? 2 : 3
  return weight(a) - weight(b) || a.name.localeCompare(b.name)
}

/** Mirrors status.sh's suffix rule, so a new key is masked as you type it. */
function looksSecret(name: string): boolean {
  return /(_KEY|_KEYS|_TOKEN|_SECRET|_PASSWORD|_PASS)$/.test(name)
}
