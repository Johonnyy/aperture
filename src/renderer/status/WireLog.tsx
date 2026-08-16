import { useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../cn'
import { useStore } from '../store'

/**
 * The raw trace, kept — but demoted and filterable.
 *
 * This used to be the whole panel, and its problem was never that the information
 * was wrong. It was that every frame pushed a line, so the useful ones sat between
 * `sentence 0`, `sentence 1` and `thinking: true`, with no way to narrow it and no
 * way to search it. Now the panels above answer the ordinary questions and this
 * answers "what actually went over the wire", which is a question you only ask when
 * something is already strange.
 *
 * **Still one interleaved column**, deliberately. Amber is what kicks off a Bloom
 * run, so splitting them into two lists would put cause and effect side by side and
 * make the ordering — the one thing a log is for — unreadable. Filtering is the fix;
 * a second array is not.
 */

const SOURCES = ['amber', 'bloom', 'bridge'] as const

export function WireLog(): React.JSX.Element {
  const trace = useStore((s) => s.trace)
  const [hidden, setHidden] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return trace.filter((entry) => {
      const source = sourceOf(entry.label, entry.source)
      if (hidden.includes(source)) return false
      if (!needle) return true
      return (
        entry.label.toLowerCase().includes(needle) ||
        (entry.detail ?? '').toLowerCase().includes(needle)
      )
    })
  }, [trace, hidden, query])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [shown.length])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {SOURCES.map((source) => {
          const off = hidden.includes(source)
          return (
            <button
              key={source}
              type="button"
              onClick={() =>
                setHidden((prev) =>
                  off ? prev.filter((s) => s !== source) : [...prev, source],
                )
              }
              className={cn(
                'rounded-control border px-1.5 py-0.5 text-nano uppercase transition',
                off
                  ? 'border-line text-muted line-through'
                  : 'border-accent-deep text-accent-hi',
              )}
            >
              {source}
            </button>
          )
        })}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter…"
          className="min-w-0 flex-1 border-0 bg-transparent text-nano text-ink outline-none placeholder:text-muted"
        />
      </div>

      <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto font-mono text-nano">
        {shown.map((entry) => (
          <li key={entry.id}>
            <span className="text-muted">
              {new Date(entry.ts).toLocaleTimeString()}{' '}
            </span>
            <span
              className={
                entry.level === 'error'
                  ? 'text-danger'
                  : entry.level === 'warn'
                    ? 'text-accent'
                    : 'text-ink/80'
              }
            >
              {entry.label}
            </span>
            {entry.detail && (
              <span className="block pl-4 break-words text-muted">{entry.detail}</span>
            )}
          </li>
        ))}
        <div ref={endRef} />
      </ul>

      {shown.length === 0 && (
        <p className="text-meta text-muted">Nothing matches that filter.</p>
      )}
    </div>
  )
}

/**
 * Which producer a line came from.
 *
 * `source` is the field; the prefix sniff is the fallback for lines written before
 * it existed, which is most of them. Worth keeping rather than backfilling every
 * call site: the prefix is already load-bearing in the label a person reads.
 */
function sourceOf(label: string, source?: string): string {
  if (source) return source
  if (label.startsWith('bloom:')) return 'bloom'
  if (label.startsWith('declared ') || label.startsWith('exec ') || label.startsWith('exit ')) {
    return 'bridge'
  }
  return 'amber'
}
