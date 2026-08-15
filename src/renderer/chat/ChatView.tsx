import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { useStore } from '../store'
import type { useAmberConnection } from './useAmberConnection'

type Amber = ReturnType<typeof useAmberConnection>

export function ChatView({ amber }: { amber: Amber }): React.JSX.Element {
  const messages = useStore((s) => s.messages)
  const thinking = useStore((s) => s.thinking)
  const awaiting = useStore((s) => s.awaitingResponse)
  const connected = useStore((s) => s.connection.state === 'open')
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const submit = (): void => {
    if (!draft.trim() || !connected) return
    void amber.sendText(draft)
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
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 && (
          <div className="mt-20 text-center text-muted">
            <p className="text-lg text-ink/70">Talk to Amber.</p>
            <p className="mt-2 text-sm">
              Type below, or hold the mic to speak. Watch the turn unfold in the
              status panel.
            </p>
          </div>
        )}

        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={[
                  'max-w-[80%] rounded-panel border px-4 py-2.5 text-lead leading-relaxed whitespace-pre-wrap',
                  m.role === 'user'
                    ? 'border-user/25 bg-user/10 text-ink'
                    : 'border-line bg-raised text-ink',
                  m.streaming ? 'border-accent/40' : '',
                ].join(' ')}
              >
                {m.text}
              </div>
            </div>
          ))}

          {thinking && (
            <div className="flex items-center gap-2 text-sm text-accent">
              <span className="animate-pulse-dot">●</span> thinking…
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-line bg-raised/60 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-3">
          {/* Never disabled. Composing a message while the socket is down is
              perfectly reasonable — only *sending* needs a connection, and a dead
              input box gives no clue why it's dead. */}
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
            onPointerDown={() => void amber.startRecording()}
            onPointerUp={() => void amber.stopRecording()}
            onPointerLeave={() => amber.recording && void amber.stopRecording()}
            className={[
              'h-11 w-11 shrink-0 rounded-full border text-lg transition disabled:opacity-40',
              amber.recording
                ? 'border-danger bg-danger/20 text-danger'
                : 'border-line bg-ground text-accent hover:border-accent-deep',
            ].join(' ')}
          >
            ●
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={!connected || !draft.trim()}
            className="h-11 shrink-0 rounded-panel border border-accent-deep bg-accent/15 px-4 text-sm font-medium text-accent-hi transition hover:bg-accent/25 disabled:opacity-40"
          >
            Send
          </button>

          {(amber.speaking || thinking) && (
            <button
              type="button"
              onClick={() => void amber.interrupt()}
              className="h-11 shrink-0 rounded-panel border border-danger/50 px-4 text-sm text-danger transition hover:bg-danger/10"
            >
              Stop
            </button>
          )}
        </div>

        {!connected && (
          <p className="mx-auto mt-2 flex max-w-3xl items-center gap-2 text-xs text-muted">
            Not connected to Amber, so nothing can be sent yet.
            <button
              type="button"
              onClick={() => void window.aperture.amber.connect()}
              className="rounded-control border border-line px-2 py-0.5 text-meta text-ink transition hover:border-accent-deep"
            >
              Connect
            </button>
          </p>
        )}

        {awaiting && (
          <p className="mx-auto mt-2 max-w-3xl text-xs text-accent">
            Amber is waiting on your reply — the mic stays open.
          </p>
        )}
      </div>
    </section>
  )
}
