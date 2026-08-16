import { Search, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { MemoryFact } from '../../shared/protocol'
import { cn } from '../cn'
import { useStore } from '../store'
import { Meter } from '../viz/primitives'

/**
 * What Amber remembers, and the ability to change it.
 *
 * Memory used to happen *to* the user. The automatic writer captured whatever was
 * said and the model could correct itself when asked, but there was no frame a click
 * could travel on — so a wrong fact stayed wrong in every future prompt unless you
 * thought to say so out loud.
 *
 * Two sets, kept apart. **In use** is what this turn actually drew on, which is the
 * set worth watching because it is what is costing tokens right now. **All** is the
 * browse, reachable through the search box. Merging them would lose the distinction
 * entirely, and the first one is the interesting half.
 */
export function MemoryPanel(): React.JSX.Element {
  const facts = useStore((s) => s.memoryFacts)
  const items = useStore((s) => s.memoryItems)
  const browse = useStore((s) => s.memoryBrowse)
  const total = useStore((s) => s.memoryTotal)
  const ack = useStore((s) => s.memoryAck)
  const [query, setQuery] = useState('')
  const [browsing, setBrowsing] = useState(false)

  // Refresh the browse whenever an action lands, so a forget disappears from the
  // list it was clicked in rather than lingering until the next search.
  useEffect(() => {
    if (browsing) void window.aperture.amber.memoryQuery(query || null)
  }, [browsing, query, ack])

  const shown = browsing ? browse : facts
  // An Amber that predates the richer records sends `items` and no `facts`. Render
  // what there is rather than an empty panel that looks broken.
  const legacy = facts.length === 0 && items.length > 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Search className="size-3 shrink-0 text-muted" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setBrowsing(true)
          }}
          onFocus={() => setBrowsing(true)}
          placeholder="Search everything she remembers…"
          className="min-w-0 flex-1 border-0 bg-transparent text-meta text-ink outline-none placeholder:text-muted"
        />
        {browsing && (
          <button
            type="button"
            onClick={() => {
              setBrowsing(false)
              setQuery('')
            }}
            className="shrink-0 text-nano text-muted uppercase hover:text-ink"
          >
            in use
          </button>
        )}
      </div>

      {ack && !ack.ok && (
        <p className="text-nano text-danger">That didn&apos;t take — try again.</p>
      )}
      {ack?.ok && ack.action === 'forget' && <UndoRow ack={ack} />}

      {legacy && (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item} className="text-meta text-muted">
              · {item}
            </li>
          ))}
        </ul>
      )}

      {!legacy && shown.length === 0 && (
        <p className="text-meta text-muted">
          {browsing ? 'Nothing matches.' : 'Nothing drawn on this turn.'}
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {shown.map((fact) => (
          <FactRow key={fact.id} fact={fact} />
        ))}
      </ul>

      {browsing && total !== null && (
        <p className="text-nano text-muted">
          {shown.length} of {total} remembered
        </p>
      )}
    </div>
  )
}

const TIER: Record<string, string> = {
  durable: 'border-ok/40 text-ok',
  short: 'border-line text-muted',
  session: 'border-line text-muted',
}

function FactRow({ fact }: { fact: MemoryFact }): React.JSX.Element {
  return (
    <li className="group flex items-start gap-1.5 rounded-control px-1 py-1 hover:bg-raised">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-meta break-words text-ink/85">{fact.content}</span>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'shrink-0 rounded-control border px-1 text-nano tracking-wide uppercase',
              TIER[fact.tier] ?? 'border-line text-muted',
            )}
          >
            {fact.tier}
          </span>
          {/* Told to her outright, versus inferred from something said in passing.
              The two deserve different confidence from a reader. */}
          {fact.source === 'explicit' && (
            <span className="shrink-0 text-nano text-muted uppercase">told</span>
          )}
          {fact.use_count !== undefined && fact.use_count > 0 && (
            <span className="shrink-0 font-mono text-nano text-muted tabular-nums">
              ×{fact.use_count}
            </span>
          )}
          {fact.confidence !== undefined && (
            <span className="w-8 shrink-0 text-muted" title={`confidence ${fact.confidence}`}>
              <Meter value={fact.confidence} max={1} />
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        title="Forget this"
        onClick={() => void window.aperture.amber.memoryAction('forget', fact.id)}
        className="shrink-0 rounded-control p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
      >
        <Trash2 className="size-3" />
      </button>
    </li>
  )
}

/**
 * The undo.
 *
 * Honest rather than decorative: Amber's delete is soft — the row is kept and only
 * its status flips — so restoring really does bring back the same fact rather than
 * writing a lookalike.
 */
function UndoRow({
  ack,
}: {
  ack: { id: number; content?: string }
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 rounded-control border border-line bg-raised px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-nano text-muted">
        Forgot “{ack.content}”
      </span>
      <button
        type="button"
        onClick={() => void window.aperture.amber.memoryAction('restore', ack.id)}
        className="flex shrink-0 items-center gap-1 text-nano text-accent-hi uppercase hover:text-accent"
      >
        <Undo2 className="size-3" /> undo
      </button>
    </div>
  )
}
