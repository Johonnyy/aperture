import { useEffect, useState, type KeyboardEvent } from 'react'

import type { KeyRecord, ServerConfig } from '../../shared/types'
import { useStore } from '../store'
import { OperationLog } from './OperationLog'

interface Props {
  onOpenTerminal: (server: ServerConfig) => void
  /** Open the amber-infra management view for this box. */
  onManage: (server: ServerConfig) => void
}

const EMPTY = { name: '', host: '', port: 22, username: '' }

export function ServerList({ onOpenTerminal, onManage }: Props): React.JSX.Element {
  const [servers, setServers] = useState<ServerConfig[]>([])
  const [keys, setKeys] = useState<KeyRecord[]>([])
  const [draft, setDraft] = useState({ ...EMPTY })
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, string>>({})
  /** Which server's install panel is open. Only one at a time. */
  const [installFor, setInstallFor] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setServers(await window.aperture.ssh.listServers())
    setKeys((await window.aperture.ssh.listKeys()).keys)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const add = async (): Promise<void> => {
    if (!draft.name.trim() || !draft.host.trim() || !draft.username.trim()) return
    await window.aperture.ssh.addServer({
      ...draft,
      name: draft.name.trim(),
      host: draft.host.trim(),
      username: draft.username.trim(),
      port: Number(draft.port) || 22,
      keyId: null,
    })
    setDraft({ ...EMPTY })
    setAdding(false)
    await refresh()
  }

  const test = async (server: ServerConfig): Promise<void> => {
    setBusy(server.id)
    const res = await window.aperture.ssh.testConnection(server.id)
    setResult((r) => ({ ...r, [server.id]: res.ok ? (res.output ?? 'OK') : `✗ ${res.error}` }))
    setBusy(null)
    await refresh() // a first connect may have pinned a fingerprint
  }

  const remove = async (server: ServerConfig): Promise<void> => {
    if (!window.confirm(`Remove ${server.name}? The stored key itself is kept.`)) return
    await window.aperture.ssh.removeServer(server.id)
    await refresh()
  }

  const field =
    'rounded-[10px] border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-amber-deep'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Servers</h2>
          <p className="text-xs text-muted">
            Amber can run commands on these — she sees them by name.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="rounded-[10px] border border-line px-3 py-1.5 text-xs transition hover:border-amber-deep"
        >
          {adding ? 'Cancel' : 'Add server'}
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-raised/50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              className={field}
              placeholder="Name (amber-vps)"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <input
              className={field}
              placeholder="Host (1.2.3.4)"
              value={draft.host}
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            />
            <input
              className={field}
              placeholder="Username"
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            />
            <input
              className={field}
              type="number"
              placeholder="Port"
              value={draft.port}
              onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })}
            />
          </div>
          <button
            type="button"
            onClick={() => void add()}
            className="self-start rounded-[10px] border border-amber-deep bg-amber/15 px-3 py-1.5 text-xs text-amber-hi hover:bg-amber/25"
          >
            Save
          </button>
        </div>
      )}

      {servers.length === 0 && !adding && (
        <p className="text-sm text-muted">
          No servers yet. Add one, then install a key so Amber can reach it.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {servers.map((server) => (
          <li key={server.id} className="rounded-[14px] border border-line bg-raised/50 p-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {server.name}
                  {server.keyId ? (
                    <span className="ml-2 text-[10px] text-ok">key auth</span>
                  ) : (
                    <span className="ml-2 text-[10px] text-amber">no key</span>
                  )}
                </p>
                <p className="truncate font-mono text-[11px] text-muted">
                  {server.username}@{server.host}:{server.port}
                </p>
                {server.fingerprint && (
                  <p className="truncate font-mono text-[10px] text-muted">
                    {server.fingerprint}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-1.5">
                <SmallButton onClick={() => void test(server)} disabled={busy === server.id}>
                  Test
                </SmallButton>
                <SmallButton
                  onClick={() =>
                    setInstallFor((id) => (id === server.id ? null : server.id))
                  }
                  disabled={busy === server.id}
                >
                  {server.keyId ? 'Reinstall key' : 'Install key'}
                </SmallButton>
                <SmallButton
                  onClick={() => onManage(server)}
                  disabled={!server.keyId}
                  title="Install, update and roll back apps through amber-infra"
                >
                  Manage
                </SmallButton>
                <SmallButton
                  onClick={() => onOpenTerminal(server)}
                  disabled={!server.keyId}
                >
                  Terminal
                </SmallButton>
                <SmallButton onClick={() => void remove(server)} danger>
                  ✕
                </SmallButton>
              </div>
            </div>

            {installFor === server.id && (
              <InstallPanel
                server={server}
                keys={keys}
                onCancel={() => setInstallFor(null)}
                onGenerated={refresh}
                onDone={async (message) => {
                  setResult((r) => ({ ...r, [server.id]: message }))
                  setInstallFor(null)
                  await refresh()
                }}
              />
            )}

            {result[server.id] && (
              <pre className="mt-2 overflow-x-auto rounded-[8px] bg-ground px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-muted">
                {result[server.id]}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The one-time password handoff that installs a key.
 *
 * Inline rather than a dialog: `window.prompt` does not exist in Electron (it
 * returns null, so the old flow silently did nothing), and a modal for a two-field
 * form would be heavier than the task. The password is held only in this
 * component's state and goes out of scope the moment the panel closes — it is
 * never written to the server config.
 */
function InstallPanel({
  server,
  keys,
  onCancel,
  onDone,
  onGenerated,
}: {
  server: ServerConfig
  keys: KeyRecord[]
  onCancel: () => void
  onDone: (message: string) => Promise<void>
  onGenerated: () => Promise<void>
}): React.JSX.Element {
  const [keyId, setKeyId] = useState(keys[0]?.id ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set while an install is running, so its live log can be shown. */
  const [opId, setOpId] = useState<string | null>(null)
  const startOp = useStore((s) => s.startOp)
  const finishOp = useStore((s) => s.finishOp)

  // A key generated after this panel opened should become the selection.
  useEffect(() => {
    if (!keyId && keys[0]) setKeyId(keys[0].id)
  }, [keys, keyId])

  const submit = async (): Promise<void> => {
    if (!keyId || !password || busy) return
    const id = crypto.randomUUID()
    startOp(id)
    setOpId(id) // opens the log before the work starts, so nothing is missed
    setBusy(true)
    setError(null)

    let res: { ok: boolean; error?: string }
    try {
      res = await window.aperture.ssh.installKey(id, server.id, keyId, password)
    } catch (err) {
      // A rejected invoke (handler threw, or main died) must still settle the log.
      res = { ok: false, error: (err as Error).message }
    }

    setPassword('')
    setBusy(false)
    // The promise, not the event stream, is what ends the operation.
    finishOp(id, res)
    if (!res.ok) setError(res.error ?? 'Install failed.')
  }

  /** Closing the log is what commits the outcome — the result is read there. */
  const closeLog = async (): Promise<void> => {
    const id = opId
    setOpId(null)
    if (!id) return
    if (!error) await onDone('✓ key installed and verified — this server now uses key auth')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') void submit()
    if (e.key === 'Escape') onCancel()
  }

  if (keys.length === 0) {
    // Generate inline rather than sending the user off to the key manager and back.
    // Installing a key is the only reason to be here, so needing one is a step in
    // this flow, not a prerequisite to go satisfy elsewhere.
    return (
      <div className="mt-3 flex items-center gap-3 rounded-[10px] border border-line bg-ground px-3 py-2.5">
        <p className="flex-1 text-xs text-muted">
          No key yet — one is needed before it can be installed on {server.name}.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            void window.aperture.ssh
              .generateKey('aperture')
              .then(() => onGenerated())
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false))
          }}
          className="rounded-[8px] border border-amber-deep bg-amber/15 px-2.5 py-1 text-[11px] text-amber-hi transition hover:bg-amber/25 disabled:opacity-40"
        >
          {busy ? 'Generating…' : 'Generate key'}
        </button>
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-[10px] border border-line bg-ground p-3">
      <p className="text-xs text-muted">
        Sign in once with the account password so the public key can be added to{' '}
        <code className="text-ink/70">~/.ssh/authorized_keys</code>. It is used for this
        step only and never stored.
      </p>

      <div className="flex gap-2">
        {keys.length > 1 && (
          <select
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            className="rounded-[8px] border border-line bg-raised px-2 py-1.5 text-xs text-ink outline-none focus:border-amber-deep"
          >
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        )}

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Password for ${server.username}@${server.host}`}
          disabled={busy}
          className="flex-1 rounded-[8px] border border-line bg-raised px-2.5 py-1.5 text-xs text-ink outline-none focus:border-amber-deep disabled:opacity-50"
        />

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!password || busy}
          className="rounded-[8px] border border-amber-deep bg-amber/15 px-3 py-1.5 text-[11px] text-amber-hi transition hover:bg-amber/25 disabled:opacity-40"
        >
          {busy ? 'Installing…' : 'Install'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-[8px] border border-line px-3 py-1.5 text-[11px] text-muted transition hover:border-amber-deep hover:text-ink disabled:opacity-40"
        >
          Cancel
        </button>
      </div>

      {error && <p className="text-[11px] text-danger">{error}</p>}

      {opId && (
        <OperationLog
          opId={opId}
          title={`Installing key on ${server.name}`}
          onClose={() => void closeLog()}
        />
      )}
    </div>
  )
}

function SmallButton({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'rounded-[8px] border px-2 py-1 text-[11px] transition disabled:opacity-40',
        danger
          ? 'border-line text-danger hover:border-danger/50'
          : 'border-line text-ink hover:border-amber-deep',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
