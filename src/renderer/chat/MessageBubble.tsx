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
 *
 * A reply is one *segment*, not one turn: the store opens a new bubble after every
 * tool call, so "let me check that" and "all done" are two messages with the cards
 * they bracket in between.
 *
 * `live` is the last-item check the caret needs. `streaming` alone would be enough —
 * the store settles every open bubble at every ending — but the caret is the one
 * piece of state a stale flag turns into a standing lie ("more is coming") on every
 * reply in the log, so it is worth confirming against the timeline as well.
 */
export function MessageBubble({
  message,
  live = false,
}: {
  message: Message
  live?: boolean
}): React.JSX.Element {
  const user = message.role === 'user'
  const body = message.raw || message.text
  const streaming = Boolean(message.streaming) && live

  return (
    <div className={cn('flex', user ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-panel border px-4 py-2.5 text-lead leading-relaxed',
          user
            ? 'border-user/25 bg-user/10 text-ink'
            : 'border-line bg-raised text-ink',
          streaming && 'border-accent/40',
        )}
      >
        {user ? (
          <p className="whitespace-pre-wrap">{body}</p>
        ) : (
          // The caret is a pseudo-element on the last block inside (see
          // `.reply-caret` in styles.css), not a node after it. A sibling span sits
          // *below* the markdown — a block element ends the line — which reads as
          // "another paragraph is coming" rather than "this sentence is still being
          // written", and that is exactly the wrong thing for a caret to say.
          <Markdown className={cn(streaming && 'reply-caret')}>{body}</Markdown>
        )}
        {message.interrupted && (
          <p className="mt-1.5 text-meta text-warn">Stopped.</p>
        )}
      </div>
    </div>
  )
}
