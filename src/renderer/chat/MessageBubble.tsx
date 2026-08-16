import { cn } from '../cn'
import type { Message } from '../store'
import { Markdown } from './Markdown'

/**
 * One side of the conversation.
 *
 * Amber's replies render as markdown from `raw` — the text view of the reply, with
 * her own whitespace intact. `text` is the sentence-joined fallback for an Amber
 * that predates the `delta` frame, and it is why this picks rather than concatenates:
 * the two are the *same words twice*, so rendering both would print the reply twice.
 */
export function MessageBubble({ message }: { message: Message }): React.JSX.Element {
  const user = message.role === 'user'
  const body = message.raw || message.text

  return (
    <div className={cn('flex', user ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-panel border px-4 py-2.5 text-lead leading-relaxed',
          user
            ? 'border-user/25 bg-user/10 text-ink'
            : 'border-line bg-raised text-ink',
          message.streaming && 'border-accent/40',
        )}
      >
        {user ? (
          <p className="whitespace-pre-wrap">{body}</p>
        ) : (
          <>
            <Markdown>{body}</Markdown>
            {message.streaming && <Caret />}
          </>
        )}
        {message.interrupted && (
          <p className="mt-1.5 text-meta text-warn">Stopped.</p>
        )}
      </div>
    </div>
  )
}

/** A blinking block while text is still arriving. */
function Caret(): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1em] w-[0.5ch] translate-y-[0.15em] animate-pulse-dot bg-accent align-baseline"
    />
  )
}
