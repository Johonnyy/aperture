import * as Collapsible from '@radix-ui/react-collapsible'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, Eye, Loader2 } from 'lucide-react'

import { cn } from '../cn'
import type { Activity } from '../store'
import { describe, isBloomBuild, originLabel } from './activity-meta'

/**
 * One tool call, as it happens.
 *
 * Collapsed to a single row by design. A turn can make ten calls, and ten expanded
 * cards would push the reply — the thing actually being read — off the screen. The
 * row carries what is worth knowing at a glance (what, where, how long, did it
 * work); the detail is one click away and stays there between turns.
 */
export function ActivityCard({
  activity,
  children,
}: {
  activity: Activity
  /** The live Bloom run, when this call started one. */
  children?: React.ReactNode
}): React.JSX.Element {
  const meta = describe(activity.name, activity.origin)
  const Icon = meta.icon
  const [open, setOpen] = useState(false)

  const summary = activity.input ? meta.summary?.(activity.input) : undefined
  const failed = activity.ok === false
  const hasDetail =
    Boolean(children) ||
    Boolean(activity.result) ||
    Object.keys(activity.input ?? {}).length > 0

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={cn(
        'rounded-field border bg-raised/50 transition',
        failed ? 'border-danger/40' : 'border-line',
        activity.running && 'border-accent/40',
      )}
    >
      <Collapsible.Trigger
        disabled={!hasDetail}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-2 text-left',
          hasDetail && 'cursor-pointer hover:bg-raised',
        )}
      >
        <StatusGlyph activity={activity} Icon={Icon} />

        <span className="shrink-0 text-body text-ink">
          {activity.running ? meta.active : meta.done}
        </span>

        {summary && (
          <span className="min-w-0 flex-1 truncate text-body text-muted">{summary}</span>
        )}
        <span className={cn('flex-1', summary && 'hidden')} />

        {activity.readOnly && (
          // Worth showing: a card for a lookup should not read like a card for
          // something that changed state.
          <Eye className="size-3 shrink-0 text-muted" aria-label="read only" />
        )}

        <OriginBadge origin={activity.origin} />
        <Duration activity={activity} />

        {hasDetail && (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted transition-transform',
              open && 'rotate-90',
            )}
          />
        )}
      </Collapsible.Trigger>

      <AnimatePresence initial={false}>
        {open && (
          <Collapsible.Content forceMount asChild>
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-3 border-0 border-t border-line px-3 py-2.5">
                {activity.input && Object.keys(activity.input).length > 0 && (
                  <Args input={activity.input} />
                )}
                {children}
                {activity.result && <Result text={activity.result} failed={failed} />}
              </div>
            </motion.div>
          </Collapsible.Content>
        )}
      </AnimatePresence>
    </Collapsible.Root>
  )
}

function StatusGlyph({
  activity,
  Icon,
}: {
  activity: Activity
  Icon: React.ComponentType<{ className?: string }>
}): React.JSX.Element {
  if (activity.running) {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
  }
  if (activity.interrupted) {
    return <AlertTriangle className="size-3.5 shrink-0 text-warn" />
  }
  return (
    <Icon
      className={cn(
        'size-3.5 shrink-0',
        activity.ok === false ? 'text-danger' : 'text-ok',
      )}
    />
  )
}

function OriginBadge({ origin }: { origin: Activity['origin'] }): React.JSX.Element | null {
  // Amber's own tools are the unmarked default — badging every one of them would
  // make the badge mean nothing, and the interesting cases are the other three.
  if (origin === 'own' || origin === 'signal') return null
  return (
    <span
      className={cn(
        'shrink-0 rounded-control border px-1.5 py-0.5 text-nano tracking-wide uppercase',
        origin === 'client'
          ? 'border-line text-muted'
          : 'border-accent-deep text-accent-hi',
      )}
    >
      {originLabel(origin)}
    </span>
  )
}

/**
 * How long this has taken, counting up while it runs.
 *
 * The counter is the point rather than decoration: a peer call may legitimately run
 * for minutes, and a card with no visible progress is indistinguishable from one
 * that has hung.
 */
function Duration({ activity }: { activity: Activity }): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!activity.running) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [activity.running])

  if (activity.interrupted) {
    return <span className="shrink-0 text-nano text-warn">stopped</span>
  }
  const ms = activity.running ? now - activity.ts : activity.ms
  if (ms === undefined) return null
  return (
    <span className="shrink-0 font-mono text-nano text-muted tabular-nums">
      {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
    </span>
  )
}

/** Arguments as a key/value grid — the shape is the readable part, not the JSON. */
function Args({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-meta">
      {Object.entries(input).map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-muted">{key}</dt>
          <dd className="min-w-0 break-words whitespace-pre-wrap text-ink/80">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Result({
  text,
  failed,
}: {
  text: string
  failed: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-nano tracking-wide text-muted uppercase">Result</span>
      <p
        className={cn(
          'max-h-64 overflow-y-auto rounded-control bg-ground px-2 py-1.5 text-meta whitespace-pre-wrap',
          failed ? 'text-danger' : 'text-ink/80',
        )}
      >
        {text}
      </p>
    </div>
  )
}

export { isBloomBuild }
