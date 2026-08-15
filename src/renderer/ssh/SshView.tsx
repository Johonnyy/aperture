import { useState } from 'react'

import type { ServerConfig } from '../../shared/types'
import { InfraView } from '../infra/InfraView'
import { KeyManager } from './KeyManager'
import { ServerList } from './ServerList'
import { Terminal } from './Terminal'

/**
 * Servers: the list, the keys, per-box infrastructure management, and any open
 * shells.
 *
 * Open terminals stay **mounted** and are hidden rather than unmounted when you look
 * at something else. Unmounting one disposes the xterm instance and ends the SSH
 * connection, so the previous behaviour meant glancing at the server list cost you
 * your session, your scrollback and whatever was running. `App` keeps this whole view
 * mounted for the same reason.
 */
export function SshView(): React.JSX.Element {
  const [shells, setShells] = useState<ServerConfig[]>([])
  /** Which shell is on screen; null means the list (or the infra view). */
  const [active, setActive] = useState<string | null>(null)
  const [manage, setManage] = useState<ServerConfig | null>(null)
  /**
   * A command to type into a newly opened shell. Typed, not run: `sudo nano` on the
   * secrets file is a reasonable thing to hand someone and an unreasonable thing to
   * execute on their behalf.
   */
  const [prefill, setPrefill] = useState<Record<string, string>>({})

  const openTerminal = (server: ServerConfig, command?: string): void => {
    setShells((open) => (open.some((s) => s.id === server.id) ? open : [...open, server]))
    if (command) setPrefill((p) => ({ ...p, [server.id]: command }))
    setActive(server.id)
  }

  const closeTerminal = (id: string): void => {
    setShells((open) => open.filter((s) => s.id !== id))
    setActive((current) => (current === id ? null : current))
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {shells.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
          <TabButton active={active === null} onClick={() => setActive(null)}>
            Servers
          </TabButton>
          {shells.map((server) => (
            <TabButton
              key={server.id}
              active={active === server.id}
              onClick={() => setActive(server.id)}
            >
              {server.name}
            </TabButton>
          ))}
        </div>
      )}

      {active === null &&
        (manage ? (
          <InfraView
            server={manage}
            onBack={() => setManage(null)}
            onOpenTerminal={(command) => openTerminal(manage, command)}
          />
        ) : (
          <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 overflow-y-auto px-6 py-8">
            <ServerList onOpenTerminal={openTerminal} onManage={setManage} />
            <KeyManager />
          </section>
        ))}

      {shells.map((server) => (
        <Terminal
          key={server.id}
          server={server}
          hidden={active !== server.id}
          initialCommand={prefill[server.id]}
          onClose={() => closeTerminal(server.id)}
        />
      ))}
    </div>
  )
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={[
        'rounded-control px-2.5 py-1 text-meta transition-colors',
        active ? 'bg-accent/15 text-accent-hi' : 'text-muted hover:bg-ink/5 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
