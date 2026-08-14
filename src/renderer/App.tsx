import { useState } from 'react'

import { ChatView } from './chat/ChatView'
import { useAmberConnection } from './chat/useAmberConnection'
import { SettingsView } from './settings/SettingsView'
import { SshView } from './ssh/SshView'
import { StatusPanel } from './status/StatusPanel'
import { useStore } from './store'

type Tab = 'chat' | 'ssh' | 'settings'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'ssh', label: 'Servers' },
  { id: 'settings', label: 'Settings' },
]

export function App(): React.JSX.Element {
  // Mounted once, at the root — a second instance would double-subscribe to the
  // event stream and play every sentence twice.
  const amber = useAmberConnection()
  const [tab, setTab] = useState<Tab>('chat')
  const connState = useStore((s) => s.connection.state)

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-line bg-raised/60 px-4 py-2">
        <span className="mr-3 text-sm font-semibold tracking-wide text-amber">
          APERTURE
        </span>

        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              'rounded-[10px] px-3 py-1.5 text-sm transition',
              tab === id ? 'bg-amber/15 text-amber-hi' : 'text-muted hover:text-ink',
            ].join(' ')}
          >
            {label}
          </button>
        ))}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() =>
            void (connState === 'open'
              ? window.aperture.amber.disconnect()
              : window.aperture.amber.connect())
          }
          className="rounded-[10px] border border-line px-3 py-1.5 text-xs text-muted transition hover:border-amber-deep hover:text-ink"
        >
          {connState === 'open' ? 'Disconnect' : 'Connect'}
        </button>
      </header>

      <main className="flex min-h-0 flex-1">
        {/* Chat stays mounted across tabs — unmounting it would tear down the audio
            queue mid-sentence and lose the scroll position. */}
        <div className={tab === 'chat' ? 'flex min-h-0 flex-1' : 'hidden'}>
          <ChatView amber={amber} />
        </div>
        {tab === 'ssh' && <SshView />}
        {tab === 'settings' && <SettingsView />}
        <StatusPanel />
      </main>
    </div>
  )
}
