import { Mic, Send, Square } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'

import { cn } from '../cn'

/** The input row: type, hold to talk, send, stop. */
export function Composer({
  connected,
  recording,
  busy,
  onSend,
  onStartRecording,
  onStopRecording,
  onInterrupt,
}: {
  connected: boolean
  recording: boolean
  busy: boolean
  onSend: (text: string) => void
  onStartRecording: () => void
  onStopRecording: () => void
  onInterrupt: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')

  const submit = (): void => {
    if (!draft.trim() || !connected) return
    onSend(draft)
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends, Shift+Enter breaks the line — the convention every chat UI uses.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl items-end gap-3">
      {/* Never disabled. Composing a message while the socket is down is perfectly
          reasonable — only *sending* needs a connection, and a dead input box gives
          no clue why it's dead. */}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={connected ? 'Message Amber…' : 'Message Amber (not connected yet)'}
        className="max-h-40 min-h-[44px] flex-1 resize-y rounded-panel border border-line bg-ground px-4 py-3 text-lead text-ink outline-none placeholder:text-muted focus:border-accent-deep"
      />

      <button
        type="button"
        title="Hold to talk"
        disabled={!connected}
        onPointerDown={onStartRecording}
        onPointerUp={onStopRecording}
        onPointerLeave={() => recording && onStopRecording()}
        className={cn(
          'grid h-11 w-11 shrink-0 place-items-center rounded-full border transition disabled:opacity-40',
          recording
            ? 'animate-pulse-dot border-danger bg-danger/20 text-danger'
            : 'border-line bg-ground text-accent hover:border-accent-deep',
        )}
      >
        <Mic className="size-4" />
      </button>

      <button
        type="button"
        onClick={submit}
        disabled={!connected || !draft.trim()}
        className="grid h-11 shrink-0 place-items-center rounded-panel border border-accent-deep bg-accent/15 px-4 text-accent-hi transition hover:bg-accent/25 disabled:opacity-40"
      >
        <Send className="size-4" />
      </button>

      {busy && (
        <button
          type="button"
          onClick={onInterrupt}
          className="grid h-11 shrink-0 place-items-center rounded-panel border border-danger/50 px-4 text-danger transition hover:bg-danger/10"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      )}
    </div>
  )
}
