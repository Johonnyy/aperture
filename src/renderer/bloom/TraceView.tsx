import { Markdown } from '../chat/Markdown'
import { useStore } from '../store'
import { BuildTimeline } from './build/BuildTimeline'

/**
 * What a run did, live or afterwards — one renderer for both.
 *
 * That is not a convenience. The same records arrive over SSE while a run is going
 * and over the trace endpoint once it has finished, which is exactly why Bloom
 * returns them identically and why main normalises both into one shape. A live view
 * and a history view that drifted apart would be two descriptions of the same
 * events, and one of them would be wrong. It is also why this file still exists as
 * the single entry point after the redesign: `BuildAgent`, `TestRun` and
 * `RunHistory` all come through here, so none of them can be improved alone.
 *
 * **Honest about what is live.** Text arrives sentence by sentence, not token by
 * token — Bloom will not trade its cost ledger for a smoother cursor — so there is
 * no typing caret here. Every `step_finished` arrives at the *end*, together,
 * because that is when the runtime makes it available; staggering them to look live
 * would be a lie the user eventually notices, which is why `CostStrip` draws them
 * all at once.
 *
 * The answer goes through the markdown renderer, with one caveat worth stating: the
 * sentences are joined with a space, so a heading or a table the model wrote is
 * already flattened before it gets here. Inline formatting survives; block structure
 * does not. For a *build* that is why `BuildResult` reads the durable build row
 * instead — Bloom stores `summary` with its newlines intact.
 */
export function TraceView({ runId }: { runId: string }): React.JSX.Element {
  const run = useStore((s) => s.bloomRuns[runId])

  if (!run) {
    return <p className="text-meta text-muted">Waiting for the run to start…</p>
  }

  const answer = run.events
    .filter((e) => e.kind === 'text')
    .map((e) => String(e.payload.text ?? ''))
    .join(' ')
    .trim()

  return (
    <div className="flex flex-col gap-4">
      {answer && (
        <div className="flex flex-col gap-1">
          <span className="text-meta font-semibold tracking-wide text-muted uppercase">
            Answer
          </span>
          <div className="rounded-field border border-line bg-ground px-3 py-2 text-sm text-ink">
            <Markdown>{answer}</Markdown>
          </div>
        </div>
      )}

      <BuildTimeline runId={runId} />
    </div>
  )
}
