import { useEffect, useRef, useState } from 'react'

import type { ConnState, PendingApproval } from '../../shared/types'
import { useStore } from '../store'

const STATE_STYLE: Record<ConnState, { dot: string; label: string }> = {
  idle: { dot: 'bg-muted', label: 'Disconnected' },
  connecting: { dot: 'bg-amber animate-pulse-dot', label: 'Connecting' },
  open: { dot: 'bg-ok', label: 'Connected' },
  reconnecting: { dot: 'bg-amber animate-pulse-dot', label: 'Reconnecting' },
  error: { dot: 'bg-danger', label: 'Error' },
}

/** These two are the user's problem to fix; `internal` is Amber's. */
const ACTIONABLE = new Set(['rate_limited', 'session_limit', 'payload_too_large'])

export function StatusPanel(): React.JSX.Element {
  const connection = useStore((s) => s.connection)
  const trace = useStore((s) => s.trace)
  const memoryItems = useStore((s) => s.memoryItems)
  const lastError = useStore((s) => s.lastError)
  const clearError = useStore((s) => s.clearError)
  const pending = useStore((s) => s.pendingApprovals)
  const audit = useStore((s) => s.audit)

  const traceEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    traceEndRef.current?.scrollIntoView({ block: 'end' })
  }, [trace])

  const style = STATE_STYLE[connection.state]

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-raised/40">
      {/* --- connection --- */}
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${style.dot}`} />
          <span className="text-sm font-medium">{style.label}</span>
          {connection.resumed && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">
              resumed
            </span>
          )}
        </div>

        {connection.sessionId && (
          <p className="mt-1.5 truncate font-mono text-[11px] text-muted">
            session {connection.sessionId}
          </p>
        )}
        {connection.detail && (
          <p className="mt-1 text-[11px] text-muted">{connection.detail}</p>
        )}
        {connection.state === 'reconnecting' && connection.retryInMs && (
          <p className="mt-1 text-[11px] text-amber">
            retrying in {Math.round(connection.retryInMs / 1000)}s (attempt{' '}
            {connection.attempt})
          </p>
        )}
      </div>

      {lastError && (
        <div
          className={`flex items-start gap-2 border-b border-line px-4 py-2.5 text-xs ${
            lastError.code && ACTIONABLE.has(lastError.code) ? 'text-amber' : 'text-danger'
          }`}
        >
          <div className="flex-1">
            {lastError.code && <span className="font-mono">[{lastError.code}] </span>}
            {lastError.message}
          </div>
          <button type="button" onClick={clearError} className="text-muted hover:text-ink">
            ✕
          </button>
        </div>
      )}

      {/* --- approvals: the one thing here that's blocking a turn --- */}
      {pending.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} />
      ))}

      {/* --- memory --- */}
      {memoryItems.length > 0 && (
        <div className="border-b border-line px-4 py-3">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
            Drawing on
          </h2>
          <ul className="flex flex-col gap-1">
            {memoryItems.map((item, i) => (
              <li key={i} className="text-[12px] leading-snug text-ink/80">
                · {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- live trace --- */}
      <div className="flex min-h-0 flex-1 flex-col">
        <h2 className="px-4 pt-3 pb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
          Live trace
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {trace.length === 0 ? (
            <p className="text-[12px] text-muted">
              Frames appear here as Amber works through a turn.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 font-mono text-[11px]">
              {trace.map((entry) => (
                <li key={entry.id} className="leading-snug">
                  <span className="text-muted">
                    {new Date(entry.ts).toLocaleTimeString(undefined, { hour12: false })}{' '}
                  </span>
                  <span
                    className={
                      entry.level === 'error'
                        ? 'text-danger'
                        : entry.level === 'warn'
                          ? 'text-amber'
                          : 'text-ink/80'
                    }
                  >
                    {entry.label}
                  </span>
                  {entry.detail && (
                    <span className="block pl-4 break-words text-muted">{entry.detail}</span>
                  )}
                </li>
              ))}
              <div ref={traceEndRef} />
            </ul>
          )}
        </div>
      </div>

      <p className="border-t border-line px-4 py-2 text-[10px] leading-snug text-muted">
        Shows frames Amber sends over the wire. Her own server-side tool calls happen
        inside the agent loop and aren&apos;t visible here.
      </p>

      {/* --- audit log --- */}
      {audit.length > 0 && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
            Command log ({audit.length})
          </summary>
          <ul className="max-h-64 overflow-y-auto px-4 pb-3">
            {audit.map((entry) => (
              <li key={`${entry.id}-${entry.ts}`} className="border-b border-line/50 py-1.5">
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className={OUTCOME_STYLE[entry.outcome]}>{entry.outcome}</span>
                  <span className="text-muted">{entry.server}</span>
                  <span className="ml-auto text-muted">
                    {new Date(entry.ts).toLocaleTimeString(undefined, { hour12: false })}
                  </span>
                </div>
                <p className="font-mono text-[11px] break-words text-ink/80">
                  {entry.command}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  )
}

const OUTCOME_STYLE: Record<string, string> = {
  approved: 'text-ok',
  auto: 'text-ok',
  denied: 'text-muted',
  timeout: 'text-amber',
  error: 'text-danger',
}

/**
 * A command Amber wants to run, waiting on you.
 *
 * The countdown is not decoration: past the deadline the bridge answers Amber
 * itself, so the window to act is real and worth showing.
 */
function ApprovalCard({ approval }: { approval: PendingApproval }): React.JSX.Element {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, approval.expiresAt - Date.now()),
  )

  useEffect(() => {
    const timer = setInterval(
      () => setRemaining(Math.max(0, approval.expiresAt - Date.now())),
      250,
    )
    return () => clearInterval(timer)
  }, [approval.expiresAt])

  return (
    <div className="border-b border-amber/40 bg-amber/10 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-amber-hi">Amber wants to run</span>
        <span className="ml-auto font-mono text-[11px] text-amber">
          {Math.ceil(remaining / 1000)}s
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted">on {approval.server}</p>
      <pre className="mt-1.5 overflow-x-auto rounded-[8px] bg-ground px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-ink">
        {approval.command}
      </pre>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void window.aperture.bridge.approve(approval.id)}
          className="rounded-[8px] border border-ok/50 bg-ok/10 px-3 py-1 text-[11px] text-ok transition hover:bg-ok/20"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => void window.aperture.bridge.deny(approval.id)}
          className="rounded-[8px] border border-line px-3 py-1 text-[11px] text-muted transition hover:border-danger/50 hover:text-danger"
        >
          Deny
        </button>
      </div>
    </div>
  )
}
