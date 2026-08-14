import { useState } from 'react'

import type { ServerConfig } from '../../shared/types'
import { KeyManager } from './KeyManager'
import { ServerList } from './ServerList'
import { Terminal } from './Terminal'

export function SshView(): React.JSX.Element {
  const [terminalFor, setTerminalFor] = useState<ServerConfig | null>(null)

  if (terminalFor) {
    return <Terminal server={terminalFor} onClose={() => setTerminalFor(null)} />
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 overflow-y-auto px-6 py-8">
      <ServerList onOpenTerminal={setTerminalFor} />
      <KeyManager />
    </section>
  )
}
