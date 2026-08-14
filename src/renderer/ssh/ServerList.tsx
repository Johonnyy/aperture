import { useEffect, useState } from 'react'

import type { KeyRecord, ServerConfig } from '../../shared/types'

interface Props {
  onOpenTerminal: (server: ServerConfig) => void
}

const EMPTY = { name: '', host: '', port: 22, username: '', keyId: null as string | null }

export function ServerList({ onOpenTerminal }: Props): React.JSX.Element {
  const [servers, setServers] = useState<ServerConfig[]>([])
  const [keys, setKeys] = useState<KeyRecord[]>([])
  const [draft, setDraft] = useState({ ...EMPTY })
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, string>>({})

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

  const install = async (server: ServerConfig): Promise<void> => {
    const keyId = keys[0]?.id
    if (!keyId) {
      setResult((r) => ({ ...r, [server.id]: 'Generate a key first (Keys tab).' }))
      return
    }
    // Password auth is used for this one call and never stored — after this the
    // server switches to key auth permanently.
    const password = window.prompt(
      `Password for ${server.username}@${server.host}\n\nUsed once to install the key, never stored.`,
    )
    if (password === null) return

    setBusy(server.id)
    const res = await window.aperture.ssh.installKey(server.id, keyId, password)
    setResult((r) => ({
      ...r,
      [server.id]: res.ok ? '✓ key installed and verified' : `✗ ${res.error}`,
    }))
    setBusy(null)
    await refresh()
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
          No servers yet. Add one, generate a key, then install it.
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
                {!server.keyId && (
                  <SmallButton
                    onClick={() => void install(server)}
                    disabled={busy === server.id}
                  >
                    Install key
                  </SmallButton>
                )}
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

function SmallButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
