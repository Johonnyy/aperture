import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'

import type { ServerConfig } from '../../shared/types'

/**
 * An interactive shell, fed by `ssh2`'s `.shell({ pty })` stream over IPC.
 *
 * The xterm instance is created once per mount and disposed on unmount along with
 * the remote shell — leaving either behind would leak a live SSH connection.
 */
export function Terminal({
  server,
  onClose,
}: {
  server: ServerConfig
  onClose: () => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new XTerm({
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#14110d',
        foreground: '#f2e9da',
        cursor: '#ffb347',
        selectionBackground: '#322a1f',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    let shellId: string | null = null
    let disposed = false

    const unsubscribe = window.aperture.ssh.onShellData((message) => {
      if (!shellId || message.id !== shellId) return
      if (message.closed) {
        setClosed(true)
        term.write('\r\n\x1b[2m— connection closed —\x1b[0m\r\n')
        return
      }
      if (message.data) term.write(message.data)
    })

    void window.aperture.ssh.openShell(server.id).then((res) => {
      if (disposed) {
        // Unmounted while connecting — close the shell we just opened rather than
        // orphaning it.
        if (res.shellId) window.aperture.ssh.closeShell(res.shellId)
        return
      }
      if (!res.ok || !res.shellId) {
        setError(res.error ?? 'Could not open a shell.')
        return
      }
      shellId = res.shellId
      window.aperture.ssh.resizeShell(shellId, term.cols, term.rows)
      term.focus()
    })

    const onData = term.onData((data) => {
      if (shellId) window.aperture.ssh.writeShell(shellId, data)
    })

    const onResize = (): void => {
      fit.fit()
      if (shellId) window.aperture.ssh.resizeShell(shellId, term.cols, term.rows)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      unsubscribe()
      onData.dispose()
      if (shellId) window.aperture.ssh.closeShell(shellId)
      term.dispose()
    }
  }, [server.id])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <span className="font-mono text-xs text-muted">
          {server.username}@{server.host}
        </span>
        {closed && <span className="text-[11px] text-muted">closed</span>}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded-[8px] border border-line px-2 py-1 text-[11px] transition hover:border-amber-deep"
        >
          Close
        </button>
      </div>

      {error && (
        <p className="border-b border-line px-4 py-2 text-xs text-danger">{error}</p>
      )}

      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden px-2 py-2" />
    </div>
  )
}
