import { useState } from 'react'

import type { MemoryFact } from '../../shared/protocol'
import type { TurnMark } from '../store'

/**
 * Why she said that.
 *
 * A reply arrives with no account of where it came from. Amber sends the facts she
 * drew on (the `memory` frame, with ids) and every tool call she made (`activity`,
 * with results) — but they arrive as separate frames and nothing has ever joined them
 * back to the answer they produced. So "why did you think that?" has been a question
 * you could only ask *her*, and get another generated answer to.
 *
 * This is the join, and it is entirely client-side: both halves are already in the
 * store for the live session. Explaining *yesterday's* turn is a different problem —
 * the exchange log has no session id, no link to the facts a turn used (the ids are
 * discarded at the end of the turn) and no record of tool calls at all — so it needs
 * schema, and is deliberately not attempted here.
 *
 * The **"wrong?"** button is the other half of the same idea. The moment you would
 * write an eval case is the moment you are looking at a turn that misfired, which is
 * exactly here — and it is why CLAUDE.md has asked for eval cases since the beginning
 * and none has ever been written.
 */
export function Provenance({
  query,
  reply,
  facts,
  tools,
}: {
  query: string
  reply: string
  facts: MemoryFact[]
  tools: TurnMark['tools']
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  if (facts.length === 0 && tools.length === 0) return null

  const save = (): void => {
    void window.aperture.amber.captureEval({
      query,
      // What she actually reached for, so the case records the mistake as well as
      // the expectation. The expected tool is left blank — only a person knows it,
      // and a guess here would bake a wrong assertion into the case.
      got_tool: tools[0]?.name,
      reply,
    })
    setSaved(true)
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-2 px-1 text-nano text-muted">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-control transition hover:text-ink"
        >
          {summary(facts.length, tools.length)}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saved}
          title="Save this turn as a regression case"
          className="ml-auto shrink-0 rounded-control transition hover:text-warn disabled:text-muted"
        >
          {saved ? 'saved' : 'wrong?'}
        </button>
      </div>

      {open && (
        <div className="mt-1 flex flex-col gap-1 rounded-field border border-line px-2 py-1.5">
          {facts.map((fact) => (
            <p key={fact.id} className="text-nano text-muted">
              <span className="text-accent">knew</span> {fact.content}
            </p>
          ))}
          {tools.map((tool, i) => (
            <p key={`${tool.name}-${i}`} className="truncate text-nano text-muted">
              <span className="text-accent">ran</span>{' '}
              <span className="font-mono">{tool.name}</span>
              {tool.result && <span> — {tool.result.slice(0, 120)}</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function summary(facts: number, tools: number): string {
  const parts: string[] = []
  if (facts) parts.push(`${facts} fact${facts === 1 ? '' : 's'}`)
  if (tools) parts.push(`${tools} tool${tools === 1 ? '' : 's'}`)
  return `drew on ${parts.join(' · ')}`
}
