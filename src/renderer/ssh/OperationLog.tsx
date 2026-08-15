import { useEffect, useRef, useState } from 'react'

import type { OpLogLevel } from '../../shared/types'
import { useStore } from '../store'

/**
 * A live log for one long-running operation.
 *
 * This exists because "Installing…" with a spinner is a lie of omission: it hides
 * whether the password was wrong, the host was unreachable, sshd refused the key,
 * or the whole thing simply hung. Every step main takes shows up here as it
 * happens, and the log stays on screen after the result so it can be read.
 */
const LEVEL: Record<OpLogLevel, { dot: string; text: string }> = {
  info: { dot: 'bg-muted', text: 'text-ink/80' },
  ok: { dot: 'bg-ok', text: 'text-ok' },
  warn: { dot: 'bg-accent', text: 'text-accent' },
  error: { dot: 'bg-danger', text: 'text-danger' },
  debug: { dot: 'bg-line', text: 'text-muted' },
}

export function OperationLog({
  opId,
  title,
  confirm,
  onClose,
}: {
  opId: string
  title: string
  /**
   * Offered once a rehearsal has finished, so the thing you approve is the thing
   * whose plan you just read. Absent for operations that are already the real run.
   */
  confirm?: { label: string; onConfirm: () => void }
  onClose: () => void
}): React.JSX.Element {
  const op = useStore((s) => s.ops[opId])
  const verbose = useStore((s) => s.settings.verboseLogging)
  const endRef = useRef<HTMLDivElement>(null)
  const running = !op?.done
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [op?.entries.length])

  /**
   * Nothing may trap the user. Every step main takes is bounded well under a
   * minute, so an operation still running past that is wedged somewhere no timeout
   * covers — at which point being able to close and read what got logged matters
   * more than protecting an operation that is not coming back.
   */
  useEffect(() => {
    if (!running) {
      setStalled(false)
      return
    }
    const timer = setTimeout(() => setStalled(true), 60_000)
    return () => clearTimeout(timer)
  }, [running])

  /**
   * With verbose off the log is a progress indicator rather than a record, so it
   * gets out of the way once it succeeds. Failures always stay up: the reason a
   * thing failed is the entire point of showing this at all.
   */
  useEffect(() => {
    // A rehearsal that auto-dismissed would take the plan with it before it could be
    // read, which is the one thing the confirm step exists to prevent.
    if (verbose || running || confirm || !op?.done?.ok) return
    const timer = setTimeout(onClose, 900)
    return () => clearTimeout(timer)
  }, [verbose, running, confirm, op?.done?.ok, onClose])

  const dismissable = !running || stalled
  const entries = op?.entries ?? []

  useEffect(() => {
    if (!dismissable) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismissable, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-panel border border-line bg-raised elev-pop"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <span
            className={[
              'h-2 w-2 shrink-0 rounded-full',
              running
                ? 'animate-pulse-dot bg-accent'
                : op?.done?.ok
                  ? 'bg-ok'
                  : 'bg-danger',
            ].join(' ')}
          />
          <h2 className="flex-1 truncate text-sm font-medium">{title}</h2>
          {!verbose && (
            <span className="text-micro text-muted">
              verbose off — low-level detail hidden
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={!dismissable}
            title={dismissable ? 'Close' : 'Still running'}
            className="rounded-control px-2 py-1 text-xs text-muted transition hover:bg-ink/5 hover:text-ink disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {entries.length === 0 && (
            <p className="font-mono text-meta text-muted">Starting…</p>
          )}

          <ul className="flex flex-col gap-1.5">
            {entries.map((entry) => {
              const style = LEVEL[entry.level]
              return (
                <li key={entry.id} className="flex gap-2">
                  <span className="pt-[7px]">
                    <span className={`block h-1.5 w-1.5 rounded-full ${style.dot}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-micro text-muted">
                      {new Date(entry.ts).toLocaleTimeString(undefined, { hour12: false })}
                    </span>{' '}
                    <span className={`text-xs ${style.text}`}>{entry.message}</span>
                    {entry.detail && (
                      <pre className="mt-1 overflow-x-auto rounded-control bg-ground px-2 py-1.5 font-mono text-meta whitespace-pre-wrap text-muted">
                        {entry.detail}
                      </pre>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          <div ref={endRef} />
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
          <p className="flex-1 text-xs">
            {running && stalled ? (
              <span className="text-accent">
                Still running after a minute — every step is meant to time out well
                before this, so it is likely wedged. You can close this.
              </span>
            ) : running ? (
              <span className="text-muted">Working…</span>
            ) : op?.done?.ok ? (
              <span className="text-ok">Finished successfully.</span>
            ) : (
              <span className="text-danger">{op?.done?.error ?? 'Failed.'}</span>
            )}
          </p>

          <button
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(
                entries
                  .map(
                    (e) =>
                      `${new Date(e.ts).toISOString()} [${e.level}] ${e.message}` +
                      (e.detail ? `\n${e.detail}` : ''),
                  )
                  .join('\n'),
              )
            }
            className="rounded-control border border-line px-3 py-1.5 text-meta text-muted transition hover:border-accent-deep hover:text-ink"
          >
            Copy log
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={!dismissable}
            className={[
              'rounded-control border px-3 py-1.5 text-meta transition disabled:opacity-40',
              confirm && !running
                ? 'border-line text-muted hover:border-accent-deep hover:text-ink'
                : 'border-accent-deep bg-accent/15 text-accent-hi hover:bg-accent/25',
            ].join(' ')}
          >
            {confirm && !running ? 'Cancel' : 'Close'}
          </button>
          {confirm && !running && op?.done?.ok && (
            <button
              type="button"
              onClick={confirm.onConfirm}
              className="rounded-control border border-accent-deep bg-accent/15 px-3 py-1.5 text-meta text-accent-hi transition hover:bg-accent/25"
            >
              {confirm.label}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
