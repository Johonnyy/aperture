import * as Accordion from '@radix-ui/react-accordion'
import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '../cn'
import { useStore } from '../store'
import { Dot, Ring } from '../viz/primitives'
import { ApprovalCard } from './ApprovalCard'
import { MemoryPanel } from './MemoryPanel'
import { RunningPanel } from './RunningPanel'
import { SpendPanel } from './SpendPanel'
import { SystemPanel } from './SystemPanel'
import { WireLog } from './WireLog'

/**
 * The right-hand panel: an instrument stack, not a log.
 *
 * It used to be a four-hundred-line monospace trace with one entry per frame, which
 * meant `sentence 0`, `sentence 1`, `thinking: true` drowned everything that
 * mattered. The information a person actually wants from it — is the socket up, what
 * is running, what does Amber think she knows about me, what is this costing — was
 * either buried in that column or not on the wire at all.
 *
 * **Sections declare their own relevance.** The panel renders on every view, so a
 * build kicked off by voice stays visible while you are in Settings; but Memory and
 * Spend are about a conversation, and on the Servers tab they collapse to a summary
 * rather than sitting open and empty. The trace survives as the bottom section,
 * collapsed, filterable — useful when something is wrong and out of the way when it
 * is not.
 */

const WIDTH_KEY = 'aperture.status.width'
const OPEN_KEY = 'aperture.status.open'
const MIN_WIDTH = 300
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 380

export function StatusPanel({ view }: { view: string }): React.JSX.Element {
  const connection = useStore((s) => s.connection)
  const lastError = useStore((s) => s.lastError)
  const clearError = useStore((s) => s.clearError)
  const approvals = useStore((s) => s.pendingApprovals)
  const [width, setWidth] = useState(() => readWidth())
  const [open, setOpen] = useState<string[]>(() => readOpen())

  const onWidth = useCallback((next: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next))
    setWidth(clamped)
    localStorage.setItem(WIDTH_KEY, String(clamped))
  }, [])

  const onOpen = useCallback((next: string[]) => {
    setOpen(next)
    localStorage.setItem(OPEN_KEY, JSON.stringify(next))
  }, [])

  const chatty = view === 'chat'

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-l border-line bg-raised/40"
    >
      <Grip onWidth={onWidth} />

      <Summary connection={connection} />

      {lastError && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-field border border-danger/50 px-2 py-1.5">
          <p className="min-w-0 flex-1 text-xs break-words text-danger">
            {lastError.message}
          </p>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 text-nano text-muted uppercase hover:text-ink"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Outside the accordion on purpose: it blocks, and a blocking thing must not
          be collapsible. */}
      {approvals.map((approval) => (
        <div key={approval.id} className="px-3 pb-2">
          <ApprovalCard approval={approval} />
        </div>
      ))}

      <Accordion.Root
        type="multiple"
        value={open}
        onValueChange={onOpen}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
      >
        <Section id="running" label="Running">
          <RunningPanel />
        </Section>

        <Section id="memory" label="Memory" muted={!chatty}>
          {chatty ? <MemoryPanel /> : <MemorySummary />}
        </Section>

        <Section id="system" label="System">
          <SystemPanel />
        </Section>

        <Section id="spend" label="Spend" muted={!chatty}>
          <SpendPanel />
        </Section>

        <Section id="wire" label="Wire log">
          <WireLog />
        </Section>
      </Accordion.Root>
    </aside>
  )
}

/** Always visible, whatever is collapsed: the three things worth a glance. */
function Summary({
  connection,
}: {
  connection: ReturnType<typeof useStore.getState>['connection']
}): React.JSX.Element {
  const runs = useStore((s) => s.bloomRuns)
  const spend = useStore((s) =>
    s.turnStats.reduce((sum, t) => sum + t.cost_usd, 0),
  )
  const live = Object.values(runs).filter((r) => !r.done).length

  const STATE = {
    idle: { tone: 'muted', label: 'idle' },
    connecting: { tone: 'warn', label: 'connecting' },
    open: { tone: 'ok', label: 'connected' },
    reconnecting: { tone: 'warn', label: 'reconnecting' },
    error: { tone: 'danger', label: 'error' },
  } as const
  const state = STATE[connection.state] ?? STATE.idle

  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      {connection.retryInMs ? (
        // A countdown is a cycle, not a load — so an arc rather than a bar.
        <span className="text-warn">
          <Ring value={1 - Math.min(1, connection.retryInMs / 30_000)} />
        </span>
      ) : (
        <Dot tone={state.tone} pulse={connection.state === 'connecting'} />
      )}
      <span className="text-meta text-ink">{state.label}</span>
      {connection.sessionId && (
        <span className="min-w-0 flex-1 truncate font-mono text-nano text-muted">
          {connection.sessionId}
        </span>
      )}
      <span className={cn('flex-1', connection.sessionId && 'hidden')} />
      {live > 0 && (
        <span className="shrink-0 text-nano text-accent-hi uppercase">
          {live} running
        </span>
      )}
      {spend > 0 && (
        <span className="shrink-0 font-mono text-nano text-muted tabular-nums">
          ${spend.toFixed(3)}
        </span>
      )}
    </div>
  )
}

function MemorySummary(): React.JSX.Element {
  const count = useStore((s) => s.status?.memory?.facts ?? null)
  return (
    <p className="text-meta text-muted">
      {count === null
        ? 'Open the Amber tab to manage memory.'
        : `${count} fact${count === 1 ? '' : 's'} remembered.`}
    </p>
  )
}

function Section({
  id,
  label,
  children,
  muted,
}: {
  id: string
  label: string
  children: React.ReactNode
  muted?: boolean
}): React.JSX.Element {
  return (
    <Accordion.Item value={id} className="border-0 border-b border-line last:border-0">
      <Accordion.Header>
        <Accordion.Trigger className="group flex w-full items-center gap-2 py-2 text-left">
          <ChevronRight className="size-3 text-muted transition-transform group-data-[state=open]:rotate-90" />
          <span
            className={cn(
              'text-nano tracking-wide uppercase',
              muted ? 'text-muted' : 'text-ink/70',
            )}
          >
            {label}
          </span>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="pb-3">{children}</Accordion.Content>
    </Accordion.Item>
  )
}

/** Drag the panel wider. Pointer capture, so it survives leaving the 4px strip. */
function Grip({ onWidth }: { onWidth: (next: number) => void }): React.JSX.Element {
  const dragging = useRef(false)

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      if (dragging.current) onWidth(window.innerWidth - e.clientX)
    }
    const up = (): void => {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [onWidth])

  return (
    <div
      onPointerDown={() => {
        dragging.current = true
        document.body.style.cursor = 'col-resize'
      }}
      className="absolute top-0 bottom-0 -left-1 z-10 w-2 cursor-col-resize"
      aria-hidden
    />
  )
}

function readWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH
    ? raw
    : DEFAULT_WIDTH
}

function readOpen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '')
    if (Array.isArray(raw)) return raw.filter((v) => typeof v === 'string')
  } catch {
    // First run, or someone edited localStorage. Fall through to the default.
  }
  return ['running', 'memory']
}
