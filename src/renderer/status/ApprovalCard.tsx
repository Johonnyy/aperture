import { useEffect, useState } from 'react'

import type { PendingApproval } from '../../shared/types'

/**
 * A command Amber wants to run on a real machine, waiting on a human.
 *
 * The only blocking thing in the panel, which is why it sits outside the accordion:
 * a decision with a timer on it must not be collapsible. The countdown is live
 * because it is real — the bridge gives up on its own, and a button that silently
 * stopped working would be worse than one that visibly ran out.
 */
export function ApprovalCard({
  approval,
}: {
  approval: PendingApproval
}): React.JSX.Element {
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
    <div className="rounded-field border border-accent/40 bg-accent/10 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-accent-hi">Amber wants to run</span>
        <span className="ml-auto font-mono text-meta text-accent tabular-nums">
          {Math.ceil(remaining / 1000)}s
        </span>
      </div>
      <p className="mt-1 text-meta text-muted">on {approval.server}</p>
      <pre className="mt-1.5 overflow-x-auto rounded-control bg-ground px-2 py-1.5 font-mono text-meta whitespace-pre-wrap text-ink">
        {approval.command}
      </pre>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void window.aperture.bridge.approve(approval.id)}
          className="rounded-control border border-ok/50 bg-ok/10 px-3 py-1 text-meta text-ok transition hover:bg-ok/20"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => void window.aperture.bridge.deny(approval.id)}
          className="rounded-control border border-line px-3 py-1 text-meta text-muted transition hover:border-danger/50 hover:text-danger"
        >
          Deny
        </button>
      </div>
    </div>
  )
}
