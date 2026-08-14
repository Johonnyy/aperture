import { useEffect, useState } from 'react'

import type { KeyRecord } from '../../shared/types'

export function KeyManager(): React.JSX.Element {
  const [keys, setKeys] = useState<KeyRecord[]>([])
  const [available, setAvailable] = useState(true)
  const [label, setLabel] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const res = await window.aperture.ssh.listKeys()
    setKeys(res.keys)
    setAvailable(res.available)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const generate = async (): Promise<void> => {
    await window.aperture.ssh.generateKey(label.trim() || 'aperture')
    setLabel('')
    await refresh()
  }

  const remove = async (key: KeyRecord): Promise<void> => {
    if (!window.confirm(`Delete "${key.label}"? Servers using it will stop authenticating.`))
      return
    setKeys(await window.aperture.ssh.deleteKey(key.id))
  }

  const copy = async (key: KeyRecord): Promise<void> => {
    await navigator.clipboard.writeText(key.publicKey)
    setCopied(key.id)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">Keys</h2>
        <p className="text-xs text-muted">
          Ed25519, generated in-process. Private halves are encrypted by the OS and
          never written to disk in the clear.
        </p>
      </div>

      {!available && (
        <p className="rounded-[10px] border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          OS encryption is unavailable, so keys can&apos;t be stored safely. On Linux
          this usually means no keyring is running.
        </p>
      )}

      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="flex-1 rounded-[10px] border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-amber-deep"
        />
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!available}
          className="rounded-[10px] border border-amber-deep bg-amber/15 px-3 py-2 text-xs text-amber-hi transition hover:bg-amber/25 disabled:opacity-40"
        >
          Generate
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {keys.map((key) => (
          <li key={key.id} className="rounded-[14px] border border-line bg-raised/50 p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm">{key.label}</span>
              <span className="text-[10px] text-muted">
                {new Date(key.createdAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                onClick={() => void copy(key)}
                className="rounded-[8px] border border-line px-2 py-1 text-[11px] transition hover:border-amber-deep"
              >
                {copied === key.id ? 'Copied' : 'Copy public'}
              </button>
              <button
                type="button"
                onClick={() => void remove(key)}
                className="rounded-[8px] border border-line px-2 py-1 text-[11px] text-danger transition hover:border-danger/50"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 truncate font-mono text-[10px] text-muted">{key.publicKey}</p>
          </li>
        ))}
      </ul>

      <p className="text-[11px] leading-snug text-muted">
        Keys are bound to this Windows account — the vault won&apos;t survive a profile
        migration or move to another machine. Copy the public half if you need it
        elsewhere; the private half can&apos;t be exported.
      </p>
    </div>
  )
}
