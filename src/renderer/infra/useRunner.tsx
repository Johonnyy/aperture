import { useCallback, useState } from 'react'

import { OperationLog } from '../ssh/OperationLog'
import { useStore } from '../store'

export type Params = Record<string, string>

interface Pending {
  opId: string
  title: string
  actionId: string
  params: Params
  /** A rehearsal offers a confirm button; the real run does not. */
  rehearsal: boolean
}

/**
 * Rehearse, read, confirm.
 *
 * Every mutation runs the underlying script's own `--dry-run` first and renders its
 * output; only then is there a button to run it for real. That sequence is what makes
 * a GUI over root shell scripts defensible — Aperture's job is to compose the flags,
 * and the script's own account of what it is about to do is the proof it composed
 * them correctly. Read the plan, then approve the plan.
 *
 * Both phases narrate through the same `op` event stream and the same `OperationLog`
 * the key install uses, so a fifteen-minute `install.sh` is live and copyable rather
 * than a spinner.
 */
export function useRunner(
  serverId: string,
  sudoPassword: () => string | undefined,
  onFinished?: () => void,
): {
  dialog: React.JSX.Element | null
  run: (actionId: string, title: string, params?: Params) => void
  busy: boolean
} {
  const [pending, setPending] = useState<Pending | null>(null)
  const startOp = useStore((s) => s.startOp)
  const finishOp = useStore((s) => s.finishOp)

  const invoke = useCallback(
    (actionId: string, title: string, params: Params, rehearsal: boolean) => {
      const opId = crypto.randomUUID()
      startOp(opId)
      setPending({ opId, title, actionId, params, rehearsal })
      void window.aperture.infra
        .run(opId, serverId, actionId, params, {
          dryRun: rehearsal,
          sudoPassword: sudoPassword(),
        })
        // The promise settles the log, not the event — a dropped `op-done` must not
        // leave the dialog spinning with no way out.
        .then((res) => finishOp(opId, res))
        .catch((err: Error) => finishOp(opId, { ok: false, error: err.message }))
    },
    [serverId, sudoPassword, startOp, finishOp],
  )

  const run = useCallback(
    (actionId: string, title: string, params: Params = {}) => invoke(actionId, title, params, true),
    [invoke],
  )

  const close = useCallback(() => {
    const wasReal = pending && !pending.rehearsal
    setPending(null)
    if (wasReal) onFinished?.()
  }, [pending, onFinished])

  const dialog = pending ? (
    <OperationLog
      key={pending.opId}
      opId={pending.opId}
      title={pending.rehearsal ? `Rehearsal — ${pending.title}` : pending.title}
      confirm={
        pending.rehearsal
          ? {
              label: 'Run for real',
              onConfirm: () => invoke(pending.actionId, pending.title, pending.params, false),
            }
          : undefined
      }
      onClose={close}
    />
  ) : null

  return { dialog, run, busy: pending !== null }
}
