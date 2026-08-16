import { Loader2 } from 'lucide-react'

import { BuildTimeline } from '../bloom/build/BuildTimeline'

/**
 * A Bloom build, rendered inside the chat card that started it.
 *
 * The gap this closes: asking Amber to build an agent used to show `● thinking…` for
 * one to two minutes and nothing else, while Bloom was the whole time emitting a
 * structured, resumable trace that the Bloom tab already knew how to draw. Amber was
 * the only link that dropped it. Now the card grows the same timeline, so the answer
 * to "what is it doing" never involves leaving this page.
 *
 * `runId` arrives a beat after the call starts — main has to find the run Bloom just
 * opened — so the waiting state is normal rather than exceptional.
 */
export function RunInline({ runId }: { runId?: string }): React.JSX.Element {
  if (!runId) {
    return (
      <p className="flex items-center gap-2 text-meta text-muted">
        <Loader2 className="size-3 animate-spin" />
        Finding the build…
      </p>
    )
  }
  return <BuildTimeline runId={runId} />
}
