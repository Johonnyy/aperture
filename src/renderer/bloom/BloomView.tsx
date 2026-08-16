import { useCallback, useEffect, useState } from 'react'

import type { AgentConfig } from '../../shared/bloom'
import { SmallButton } from '../infra/parts'
import { useStore } from '../store'
import { AgentEditor } from './AgentEditor'
import { AgentList } from './AgentList'
import { BuildAgent } from './BuildAgent'
import { ConnectionLibrary } from './ConnectionLibrary'
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

type Tab = 'agents' | 'build' | 'connections' | 'activity' | 'usage'

/**
 * The sections of one agent.
 *
 * Everything below the editor used to be stacked on a single scrolling page, which
 * was fine while there were three cards and stopped being fine once Connections
 * grew a picker. Settings stays first because a new agent lands there.
 */
type DetailTab = 'settings' | 'connections' | 'test' | 'runs'

export function BloomView(): React.JSX.Element {
  const link = useStore((s) => s.bloomLink)
  const setBloomLink = useStore((s) => s.setBloomLink)

  const [tab, setTab] = useState<Tab>('agents')
  const [detail, setDetail] = useState<DetailTab>('settings')
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
        <TabButton active={tab === 'build'} onClick={() => setTab('build')}>
          Build
        </TabButton>
        <TabButton active={tab === 'connections'} onClick={() => setTab('connections')}>
          Connections
        </TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
          Activity
        </TabButton>
        <TabButton active={tab === 'usage'} onClick={() => setTab('usage')}>
          Usage
        </TabButton>
      </div>

      {/* Its own tab rather than a button on the agent list: a build is a run
          that takes minutes and produces a checklist to work through, which is a
          place you stay rather than a dialog you dismiss. */}
      {tab === 'build' && <BuildAgent onBuilt={() => void refresh()} />}

      {tab === 'agents' &&
        (editing ? (
          <>
            {/* The strip only appears for an agent that exists: connecting an
                account and running a task both need an id, and a draft has none
                yet. A new agent is one form, and that is the whole point of it. */}
            {editing !== 'new' && (
              <div className="flex shrink-0 items-center gap-1">
                <TabButton active={detail === 'settings'} onClick={() => setDetail('settings')}>
                  Settings
                </TabButton>
                <TabButton
                  active={detail === 'connections'}
                  onClick={() => setDetail('connections')}
                >
                  Connections
                  {editing.connections.length > 0 && (
                    <span className="ml-1.5 text-micro text-muted">
                      {editing.connections.length}
                    </span>
                  )}
                </TabButton>
                <TabButton active={detail === 'test'} onClick={() => setDetail('test')}>
                  Test run
                </TabButton>
                <TabButton active={detail === 'runs'} onClick={() => setDetail('runs')}>
                  Runs
                </TabButton>
              </div>
            )}

            {(editing === 'new' || detail === 'settings') && (
              <AgentEditor
                agent={editing === 'new' ? null : editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null)
                  void refresh()
                }}
              />
            )}

            {editing !== 'new' && detail === 'connections' && <Connections agent={editing} />}
            {editing !== 'new' && detail === 'test' && <TestRun agent={editing} />}
            {editing !== 'new' && detail === 'runs' && <RunHistory agentId={editing.id} />}
          </>
        ) : (
          <AgentList
            agents={agents}
            loading={loading}
            onRefresh={() => void refresh()}
            onNew={() => setEditing('new')}
            onEdit={(agent) => {
              setDetail('settings')
              setEditing(agent)
            }}
          />
        ))}

      {tab === 'connections' && <ConnectionLibrary />}
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
