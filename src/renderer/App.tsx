import { useState } from 'react'

import { ChatView } from './chat/ChatView'
import { useAmberConnection } from './chat/useAmberConnection'
import { Sidebar, useSidebarCollapsed, type View } from './nav/Sidebar'
import { TitleBar } from './nav/TitleBar'
import { SettingsView } from './settings/SettingsView'
import { SshView } from './ssh/SshView'
import { StatusPanel } from './status/StatusPanel'
import { useThemeSync } from './theme'

export function App(): React.JSX.Element {
  // Mounted once, at the root — a second instance would double-subscribe to the
  // event stream and play every sentence twice.
  const amber = useAmberConnection()
  useThemeSync()
  const [view, setView] = useState<View>('chat')
  // Owned here because the toggle lives in the title bar and the width it drives
  // lives in the sidebar.
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()

  return (
    <div className="flex h-full flex-col">
      <TitleBar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />

      <div className="flex min-h-0 flex-1">
        <Sidebar view={view} onNavigate={setView} collapsed={collapsed} />

        <main className="flex min-h-0 min-w-0 flex-1">
          {/* Chat stays mounted across views — unmounting it would tear down the
              audio queue mid-sentence and lose the scroll position. */}
          <div className={view === 'chat' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
            <ChatView amber={amber} />
          </div>
          {/* Same reason as Chat, more sharply: unmounting Servers would dispose every
              open xterm and end the SSH connections behind them, so glancing at the
              chat would cost you your shells. */}
          <div className={view === 'ssh' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
            <SshView />
          </div>
          {view === 'settings' && <SettingsView />}

          <StatusPanel />
        </main>
      </div>
    </div>
  )
}
