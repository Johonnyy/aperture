import type { ApertureEvent } from '../../shared/types'
import { listRuns, watchRun } from './index'

type Emit = (event: ApertureEvent) => void

/**
 * Finding the Bloom run behind a tool call Amber just made.
 *
 * The problem this solves is a mismatch in how the two sides report. Bloom's
 * `build_agent` MCP tool awaits the entire build inline, so Amber learns the run id
 * only when everything is over — which is precisely when it stops being interesting.
 * Meanwhile Bloom has been emitting a full live trace the whole time, and Aperture
 * already has the client for it. Nothing was missing except the join.
 *
 * So: match after the fact. When Amber starts a peer call into Bloom, ask Bloom what
 * it has started running lately. This needs no change on either side — Bloom's
 * `GET /admin/runs?status=running` already exists, and the Bloom tab already opens
 * SSE streams the same way.
 *
 * **The window matters.** A run must have started *after* the tool call did, or a
 * long-running build kicked off from the Bloom tab five minutes ago would be adopted
 * by an unrelated question. `SKEW_MS` allows for the two clocks disagreeing slightly
 * — Bloom stamps `created_at` on its own box.
 */

/** How long to keep looking. A build takes minutes; its row appears in seconds. */
const WINDOW_MS = 10_000
/** Between attempts. Short enough to feel immediate, slow enough to be free. */
const INTERVAL_MS = 600
/** Tolerance for the two machines' clocks disagreeing. */
const SKEW_MS = 5_000

/** Calls already matched or given up on, so a retry can't double-attach. */
const settled = new Set<string>()

export function attachPeerRun(emit: Emit, callId: string, startedAt: number): void {
  if (settled.has(callId)) return
  settled.add(callId)

  const deadline = Date.now() + WINDOW_MS

  const poll = async (): Promise<void> => {
    if (Date.now() > deadline) {
      // Not an error worth surfacing. Plenty of peer calls into Bloom are not runs
      // at all — `list_agents` starts nothing — and a card with no timeline is a
      // perfectly good card.
      return
    }

    const result = await listRuns(emit, { status: 'running', origin: 'mcp', limit: 5 })
    if (result.ok) {
      const match = result.value.find(
        (run) => Date.parse(run.startedAt) >= startedAt - SKEW_MS,
      )
      if (match) {
        emit({ kind: 'activity-run', callId, runId: match.id })
        // Reuses the same stream the Bloom tab uses, so the run appears in both
        // places from one subscription rather than two descriptions of it.
        watchRun(emit, match.id)
        return
      }
    }

    setTimeout(() => void poll(), INTERVAL_MS)
  }

  void poll()
}

/** Forget everything, so a reconnect starts clean. Called when the socket drops. */
export function resetAttachments(): void {
  settled.clear()
}
