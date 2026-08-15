import { useCallback, useEffect, useState } from 'react'

import type { AgentConfig } from '../../shared/bloom'
import { SmallButton } from '../infra/parts'
import { useStore } from '../store'
import { AgentEditor } from './AgentEditor'
import { AgentList } from './AgentList'
import { Connections } from './Connections'
import { RunHistory } from './RunHistory'
import { TestRun } from './TestRun'
import { Usage } from './Usage'

/**
 * The Bloom tab.
 *
 * Where an agent is *defined* rather than built: a prompt, a model tier, a set of
 * peer servers, and the accounts it may use. Everything here is one HTTP call away,
 * which is the whole difference from the Servers tab next door — that one narrates
 * shell scripts over SSH, this one edits rows.
 *
 * The link's state decides what the body says, never whether the tab exists. A
 * stopped or unreachable Bloom renders an explanation here rather than vanishing
 * from the sidebar, because a tab that disappears takes the fix with it.
 */

type Tab = 'agents' | 'activity' | 'usage'

export function BloomView(): React.JSX.Element {
  const link = useStore((s) => s.bloomLink)
  const setBloomLink = useStore((s) => s.setBloomLink)

  const [tab, setTab] = useState<Tab>('agents')
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [editing, setEditing] = useState<AgentConfig | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await window.aperture.bloom.agents()
    if (result.ok) {
      setAgents(result.value)
      setError(null)
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const recheck = async (): Promise<void> => {
    setBloomLink(await window.aperture.bloom.verify())
    await refresh()
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto px-6 py-6">
      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lead">Bloom</h2>
          <p className="truncate text-xs text-muted">
            {link.baseUrl || 'not linked'}
            {link.serverId ? '' : link.baseUrl ? ' · linked by hand' : ''}
          </p>
        </div>
        <LinkDot state={link.state} />
        <SmallButton onClick={() => void recheck()}>Re-check</SmallButton>
      </header>

      {/* The link's own trouble comes first: nothing below it will work until it is
          resolved, and saying so once beats every panel failing separately. */}
      {link.state !== 'linked' && link.detail && (
        <p className="rounded-field border border-danger/40 px-3 py-2 text-xs text-danger">
          {link.detail}
        </p>
      )}
      {error && link.state === 'linked' && (
        <p className="rounded-field border border-danger/40 px-3 py-2 text-xs text-danger">{error}</p>
      )}

      <div className="flex shrink-0 items-center gap-1 border-b border-line pb-2">
        <TabButton active={tab === 'agents'} onClick={() => setTab('agents')}>
          Agents
        </TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
          Activity
        </TabButton>
        <TabButton active={tab === 'usage'} onClick={() => setTab('usage')}>
          Usage
        </TabButton>
      </div>

      {tab === 'agents' &&
        (editing ? (
          <>
            <AgentEditor
              agent={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null)
                void refresh()
              }}
            />
            {/* Only for an agent that exists: connecting an account and running a
                task both need an id, and a draft has none yet. */}
            {editing !== 'new' && (
              <>
                <Connections agent={editing} />
                <TestRun agent={editing} />
                <div className="rounded-panel border border-line bg-raised/50 p-3">
                  <h3 className="mb-2 text-sm font-medium">Recent runs</h3>
                  <RunHistory agentId={editing.id} />
                </div>
              </>
            )}
          </>
        ) : (
          <AgentList
            agents={agents}
            loading={loading}
            onRefresh={() => void refresh()}
            onNew={() => setEditing('new')}
            onEdit={setEditing}
          />
        ))}

      {tab === 'activity' && <RunHistory />}
      {tab === 'usage' && <Usage />}
    </section>
  )
}

/** Presence, then health — the same vocabulary the sidebar row's own dot uses. */
function LinkDot({ state }: { state: string }): React.JSX.Element {
  const tone =
    state === 'linked'
      ? 'bg-ok'
      : state === 'probing'
        ? 'animate-pulse-dot bg-accent'
        : state === 'unauthorized'
          ? 'bg-danger'
          : 'bg-warn'
  return (
    <span
      title={state}
      className={`h-2 w-2 shrink-0 rounded-full ${tone}`}
      aria-label={`Bloom is ${state}`}
    />
  )
}

/** The inner strip, matching the one in the Servers tab. */
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
