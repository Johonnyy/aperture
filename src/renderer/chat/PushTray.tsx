import { useStore } from '../store'
import type { PushFrame, PushKind } from '../../shared/protocol'

/**
 * What Amber said without being asked.
 *
 * These stack in a corner rather than interrupting, because none of them is blocking —
 * that is exactly what separates a `push` from a `confirm_request`. A fired reminder
 * has already been recorded and will still be in `list_reminders` tomorrow, so losing
 * one to a missed click costs nothing.
 *
 * A reminder gets a **Done** button, and it is not cosmetic: it acknowledges with
 * `complete`, which finishes the same row Amber would update if you had simply told
 * her you'd done it. Dismissing, by contrast, only clears the card — the reminder
 * stays open, which is the honest reading of waving a notification away.
 */
export function PushTray(): React.JSX.Element | null {
  const pushes = useStore((s) => s.pushes)
  const dismiss = useStore((s) => s.dismissPush)

  if (pushes.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-80 flex-col gap-2">
      {/* Newest nearest the bottom edge, where the eye already is. */}
      {pushes.slice(0, 4).map((push) => (
        <PushCard key={push.id} push={push} onDismiss={() => dismiss(push.id)} />
      ))}
    </div>
  )
}

function PushCard({
  push,
  onDismiss,
}: {
  push: PushFrame
  onDismiss: () => void
}): React.JSX.Element {
  const reminderId = push.ref?.reminder_id

  const complete = (): void => {
    void window.aperture.amber.pushAck(push.id, 'complete')
    onDismiss()
  }

  const dismiss = (): void => {
    void window.aperture.amber.pushAck(push.id, 'dismiss')
    onDismiss()
  }

  return (
    <div className="pointer-events-auto rounded-field border border-line bg-surface px-3 py-2.5 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="text-meta font-medium text-accent-hi">{LABELS[push.kind]}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="ml-auto text-meta text-muted transition hover:text-ink"
        >
          ×
        </button>
      </div>
      {push.title && <p className="mt-1 text-sm text-ink">{push.title}</p>}
      <p className="mt-1 text-sm text-ink">{push.text}</p>
      {typeof reminderId === 'number' && (
        <button
          type="button"
          onClick={complete}
          className="mt-2 rounded-control border border-ok/50 bg-ok/10 px-3 py-1 text-meta text-ok transition hover:bg-ok/20"
        >
          Done
        </button>
      )}
    </div>
  )
}

const LABELS: Record<PushKind, string> = {
  reminder: 'Reminder',
  reflection: 'Amber noticed',
  notice: 'Notice',
  peer_event: 'Finished',
}
