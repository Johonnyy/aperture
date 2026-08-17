import { useEffect, useState } from 'react'

import { cn } from '../cn'
import { useStore } from '../store'
import { Meter } from '../viz/primitives'

/**
 * How Amber is doing — the loop's missing reader.
 *
 * signals → maintenance → reflections has run unattended since it was built and
 * reported to nobody: tool latency fed a single LLM prompt, the self-review notes
 * needed an MCP key to read, and `reflections.dismissed` had no writer at all. Three
 * tabs over one frame, because they are three views of the same question.
 *
 * **Promote is the verb that matters.** A note becomes an ordinary durable fact,
 * subject to the same curation as any other — which is what makes
 * `AMBER_FEATURE_SELF_NOTES` safe to leave off. You get the value of Amber noticing
 * her own patterns without the model editing its own instructions, which is exactly
 * the line that flag was drawn to protect.
 */
type Topic = 'tools' | 'reflections' | 'evals'

const TABS: { id: Topic; label: string }[] = [
  { id: 'tools', label: 'Tools' },
  { id: 'reflections', label: 'Noticed' },
  { id: 'evals', label: 'Cases' },
]

export function ReviewPanel(): React.JSX.Element {
  const [topic, setTopic] = useState<Topic>('tools')
  const review = useStore((s) => s.review)
  const connected = useStore((s) => s.connection.state) === 'open'

  // Ask on mount and whenever the tab changes. Amber owns the numbers; nothing here
  // keeps an optimistic copy, so the panel renders her reply rather than its guess.
  useEffect(() => {
    if (connected) void window.aperture.amber.reviewQuery(topic)
  }, [topic, connected, review.ack])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTopic(tab.id)}
            className={cn(
              'rounded-control border px-2 py-0.5 text-nano transition',
              topic === tab.id
                ? 'border-accent-deep bg-accent/15 text-accent-hi'
                : 'border-line text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {topic === 'tools' && <Tools />}
      {topic === 'reflections' && <Reflections />}
      {topic === 'evals' && <Cases />}
    </div>
  )
}

function Tools(): React.JSX.Element {
  const rows = useStore((s) => s.review.tools)
  if (!rows.length) return <Empty>No tool calls recorded yet.</Empty>

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => {
        // Worst first server-side, and the tone follows the rate rather than the
        // volume — a tool that fails every time it is used matters more than one that
        // is merely busy.
        const tone =
          row.ok_rate >= 0.95 ? 'text-ok' : row.ok_rate >= 0.8 ? 'text-warn' : 'text-danger'
        return (
          <li key={row.name} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-meta text-ink/85">{row.name}</span>
              <span className={cn('shrink-0 font-mono text-nano tabular-nums', tone)}>
                {Math.round(row.ok_rate * 100)}%
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-nano text-muted tabular-nums">
                ×{row.calls}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('w-16 shrink-0', tone)}>
                <Meter value={row.ok_rate} max={1} />
              </span>
              {/* p95 rather than an average: the tail is what a degraded tool
                  actually feels like, and a mean hides it behind the fast calls. */}
              <span className="font-mono text-nano text-muted tabular-nums">
                p50 {ms(row.p50_ms)} · p95 {ms(row.p95_ms)}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Reflections(): React.JSX.Element {
  const notes = useStore((s) => s.review.reflections)
  if (!notes.length) return <Empty>Amber hasn&rsquo;t noticed anything yet.</Empty>

  return (
    <ul className="flex flex-col gap-2">
      {notes.map((note) => (
        <li key={note.id} className="rounded-field border border-line px-2 py-1.5">
          <p className="text-meta text-ink/85">{note.note}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void window.aperture.amber.reviewAction('reflections', 'promote', note.id)
              }
              title="Keep this as something Amber knows about herself"
              className="rounded-control border border-ok/50 bg-ok/10 px-2 py-0.5 text-nano text-ok transition hover:bg-ok/20"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() =>
                void window.aperture.amber.reviewAction('reflections', 'dismiss', note.id)
              }
              className="rounded-control border border-line px-2 py-0.5 text-nano text-muted transition hover:text-ink"
            >
              Dismiss
            </button>
            {note.period_start && (
              <span className="ml-auto shrink-0 text-nano text-muted">
                {since(note.period_start)}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function Cases(): React.JSX.Element {
  const cases = useStore((s) => s.review.evals)
  if (!cases.length) {
    return <Empty>No saved cases. Use &ldquo;wrong?&rdquo; on a turn that misfired.</Empty>
  }

  return (
    <ul className="flex flex-col gap-2">
      {cases.map((c) => (
        <li key={c.id} className="rounded-field border border-line px-2 py-1.5">
          <p className="text-meta text-ink/85">{c.query}</p>
          <p className="mt-0.5 font-mono text-nano text-muted">
            want {c.expect_tool ?? '—'} · got {c.got_tool ?? 'nothing'}
          </p>
          {c.note && <p className="mt-0.5 text-nano text-muted">{c.note}</p>}
          <button
            type="button"
            onClick={() => void window.aperture.amber.reviewAction('evals', 'archive', c.id)}
            className="mt-1.5 rounded-control border border-line px-2 py-0.5 text-nano text-muted transition hover:text-ink"
          >
            Archive
          </button>
        </li>
      ))}
    </ul>
  )
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-meta text-muted">{children}</p>
}

function ms(value: number): string {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`
}

/** "3 days ago", roughly. The window a note was drawn from, not a precise stamp. */
function since(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}
