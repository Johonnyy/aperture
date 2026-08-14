import { useState } from 'react'

import { ChatView } from './chat/ChatView'
import { useAmberConnection } from './chat/useAmberConnection'
import { Sidebar, type View } from './nav/Sidebar'
import { SettingsView } from './settings/SettingsView'
import { SshView } from './ssh/SshView'
import { StatusPanel } from './status/StatusPanel'

export function App(): React.JSX.Element {
  // Mounted once, at the root — a second instance would double-subscribe to the
  // event stream and play every sentence twice.
  const amber = useAmberConnection()
  const [view, setView] = useState<View>('chat')

  return (
    <div className="flex h-full">
      <Sidebar view={view} onNavigate={setView} />

      <main className="flex min-h-0 min-w-0 flex-1">
        {/* Chat stays mounted across views — unmounting it would tear down the
            audio queue mid-sentence and lose the scroll position. */}
        <div className={view === 'chat' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
          <ChatView amber={amber} />
        </div>
        {view === 'ssh' && <SshView />}
        {view === 'settings' && <SettingsView />}

        <StatusPanel />
      </main>
    </div>
  )
}
