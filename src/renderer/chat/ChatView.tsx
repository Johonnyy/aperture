import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { useStore } from '../store'
import { ActivityCard, isBloomBuild } from './ActivityCard'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { RunInline } from './RunInline'
import type { useAmberConnection } from './useAmberConnection'

type Amber = ReturnType<typeof useAmberConnection>

/** How close to the bottom still counts as "following along". */
const STICK_PX = 120

export function ChatView({ amber }: { amber: Amber }): React.JSX.Element {
  const timeline = useStore((s) => s.timeline)
  const thinking = useStore((s) => s.thinking)
  const awaiting = useStore((s) => s.awaitingResponse)
  const connected = useStore((s) => s.connection.state === 'open')
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)

  // Follow the conversation, but stop fighting the reader. The old view scrolled
  // unconditionally on every frame, which was tolerable when a turn was a bubble and
  // is not now that it is a bubble plus a stack of tool cards — scrolling back to
  // read a result would have been yanked away on the next one.
  useEffect(() => {
    if (stick) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [timeline, thinking, stick])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setStick(distance < STICK_PX)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
      >
        {timeline.length === 0 && <EmptyState />}

        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <AnimatePresence initial={false}>
            {timeline.map((item) => (
              <motion.div
                key={item.id}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {item.kind === 'message' ? (
                  <MessageBubble message={item} />
                ) : (
                  <ActivityCard activity={item}>
                    {isBloomBuild(item.name) && <RunInline runId={item.runId} />}
                  </ActivityCard>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Only before the first token — once text or a tool card is on screen,
              that *is* the thinking indicator, and two of them read as a stall. */}
          {thinking && !hasOpenWork(timeline) && <ThinkingDots />}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-line bg-raised/60 px-6 py-4">
        <Composer
          connected={connected}
          recording={amber.recording}
          busy={amber.speaking || thinking}
          onSend={(text) => void amber.sendText(text)}
          onStartRecording={() => void amber.startRecording()}
          onStopRecording={() => void amber.stopRecording()}
          onInterrupt={() => void amber.interrupt()}
        />

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

/** Whether anything of this turn is already visible. */
function hasOpenWork(timeline: ReturnType<typeof useStore.getState>['timeline']): boolean {
  const last = timeline.at(-1)
  if (!last) return false
  if (last.kind === 'activity') return last.running
  return last.role === 'amber' && Boolean(last.streaming)
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="mt-20 text-center text-muted">
      <p className="text-lg text-ink/70">Talk to Amber.</p>
      <p className="mt-2 text-sm">
        Type below, or hold the mic to speak. Everything she does — searches, memory,
        agents she hands work to — shows up right here as it happens.
      </p>
    </div>
  )
}

function ThinkingDots(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-accent">
      <span className="animate-pulse-dot">●</span> thinking…
    </div>
  )
}
