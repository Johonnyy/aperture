import { useEffect, useState } from 'react'

import { BloomView } from './bloom/BloomView'
import { ChatView } from './chat/ChatView'
import { DevicesView } from './devices/DevicesView'
import { ConfirmDialog } from './chat/ConfirmDialog'
import { PushTray } from './chat/PushTray'
import { useAmberConnection } from './chat/useAmberConnection'
import { KeysView } from './keys/KeysView'
import { Sidebar, useSidebarCollapsed, type View } from './nav/Sidebar'
import { TitleBar } from './nav/TitleBar'
import { SettingsView } from './settings/SettingsView'
import { SshView } from './ssh/SshView'
import { StatusPanel } from './status/StatusPanel'
import { useStore } from './store'
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

  const bloomLinked = useStore((s) => s.bloomLink.state) !== 'unlinked'
  // Only an explicit unlink can hide the tab, so this is a narrow guard rather than
  // a general one — but without it, unlinking while looking at Bloom leaves `<main>`
  // rendering nothing but the Status Panel. Deliberately keyed on `unlinked` alone:
  // an unreachable Bloom keeps its tab, or a flaky network would eject you mid-edit.
  useEffect(() => {
    if (view === 'bloom' && !bloomLinked) setView('chat')
  }, [view, bloomLinked])

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
          {/* Mounted-but-hidden like Chat and Servers, not unmounted like Settings:
              a run in flight has a scroll position and expanded tool cards that must
              survive a glance at the chat. */}
          <div className={view === 'bloom' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
            {bloomLinked && <BloomView />}
          </div>
          {/* Unmounted like Keys and Settings, not kept alive like Chat: it holds no
              connection and no scroll worth preserving, and it should re-read the live
              device list on every visit rather than showing what was true last time. */}
          {view === 'devices' && <DevicesView />}
          {view === 'keys' && <KeysView />}
          {view === 'settings' && <SettingsView />}

          {/* Global on purpose: a build kicked off by voice must stay visible while
              you are in Settings. Sections narrow themselves per view instead. */}
          <StatusPanel view={view} />
        </main>
      </div>

      {/* Both at the root, and deliberately outside the view switch: a reminder that
          fires while you are in Settings is exactly the case these exist for, and a
          turn blocked on approval must not be hidden by whichever tab is open. */}
      <PushTray />
      <ConfirmDialog />
    </div>
  )
}
