import { useEffect, useRef } from 'react'

import { useStore } from '../store'

/**
 * Amber is holding a turn open waiting to be told whether she may run something.
 *
 * A modal rather than a card in the status panel, which is where the SSH bridge's
 * `ApprovalCard` lives. The difference is what is waiting: that one is a queue the
 * bridge resolves on its own, while this one has a *turn* stopped behind it — Amber
 * has stopped mid-reply and will not continue until this is answered or times out.
 * Something the conversation is blocked on belongs in front of the person, not in a
 * panel they may not be looking at.
 *
 * **Not answering is a refusal**, and that shapes the whole design. There is no
 * countdown, because a timer would suggest the safe outcome is the one that happens
 * if you hurry; the safe outcome is the one that happens if you do nothing. Escape
 * declines rather than dismisses, so there is no way to close this that leaves Amber
 * believing she was approved.
 *
 * The arguments are shown because they are what is actually being approved. "Amber
 * wants to run update_server" is a different decision from seeing what it will do,
 * and approving the name alone is how a confirmation becomes a formality.
 */
export function ConfirmDialog(): React.JSX.Element | null {
  const request = useStore((s) => s.confirmRequest)
  const clear = useStore((s) => s.clearConfirmRequest)
  const denyRef = useRef<HTMLButtonElement>(null)

  // Focus lands on Deny, not Approve. A stray Enter should not authorise anything.
  useEffect(() => {
    if (request) denyRef.current?.focus()
  }, [request])

  useEffect(() => {
    if (!request) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void window.aperture.amber.confirm(request.id, false)
      clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, clear])

  if (!request) return null

  const answer = (approved: boolean): void => {
    void window.aperture.amber.confirm(request.id, approved)
    clear()
  }

  const args = request.input ?? {}
  const hasArgs = Object.keys(args).length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="w-full max-w-md rounded-panel border border-accent/40 bg-surface shadow-lg">
        <div className="border-b border-line px-4 py-3">
          <h2 id="confirm-title" className="text-sm font-medium text-ink">
            {describe(request.origin)} wants to run
          </h2>
          <p className="mt-0.5 font-mono text-meta text-accent">{request.name}</p>
        </div>

        {hasArgs && (
          <pre className="max-h-52 overflow-auto border-b border-line bg-ground px-4 py-2.5 font-mono text-meta whitespace-pre-wrap text-ink">
            {JSON.stringify(args, null, 2)}
          </pre>
        )}

        <div className="flex items-center gap-2 px-4 py-3">
          <p className="mr-auto text-meta text-muted">
            Nothing happens unless you approve.
          </p>
          <button
            ref={denyRef}
            type="button"
            onClick={() => answer(false)}
            className="rounded-control border border-line px-3 py-1 text-meta text-muted transition hover:border-danger/50 hover:text-danger"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => answer(true)}
            className="rounded-control border border-ok/50 bg-ok/10 px-3 py-1 text-meta text-ok transition hover:bg-ok/20"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}

/** Who is asking, in words. `origin` is the same vocabulary `activity` uses. */
function describe(origin: string): string {
  if (origin === 'own') return 'Amber'
  if (origin === 'client') return 'This device'
  if (origin.startsWith('peer:')) {
    const name = origin.slice(5)
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return 'Amber'
}
