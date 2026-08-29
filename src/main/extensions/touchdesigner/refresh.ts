/**
 * Keeping the cached scene list current, without ever polling.
 *
 * Every refresh here is *occasioned* — a command ran, a project opened, someone pressed
 * a button in Settings. Nothing runs on a timer, because a scene list that is one action
 * out of date costs a corrected turn while a background poll costs a request every
 * interval forever, on a machine where TouchDesigner is usually closed.
 *
 * The one exception is the burst after `process.launch`, and it is bounded and
 * cancellable: TouchDesigner takes seconds to open a project, so a single probe would
 * almost always miss. Four attempts, backing off, stopping at the first success — and a
 * later launch cancels an earlier burst, so a launch at a broken project cannot leave a
 * loop running behind it.
 */

import { sendCommand } from './bridge'
import { getTdConfig, notifyScenesChanged, setScenes } from './config'
import { extractScenes } from './scenes'

/** Backing off rather than retrying flat: the first attempt is the unlikely one. */
const PROBE_DELAYS_MS = [2000, 5000, 10000, 20000]
const PROBE_TIMEOUT_MS = 3000

let probeTimer: NodeJS.Timeout | null = null
let probeGeneration = 0

export interface RefreshOutcome {
  ok: boolean
  changed: boolean
  scenes: string[]
  /** Present when the read failed, already phrased as something to act on. */
  error?: string
}

/**
 * Ask the project what scenes it has and record the answer.
 *
 * Does **not** announce; the caller decides when, because a handler must put its
 * `tool_result` on the wire before a `device_announce` goes out behind it.
 */
export async function refreshScenes(timeoutMs: number = PROBE_TIMEOUT_MS): Promise<RefreshOutcome> {
  const { bridgePort } = getTdConfig()
  const result = await sendCommand(bridgePort, 'list_scenes', {}, timeoutMs)
  if (!result.ok) return { ok: false, changed: false, scenes: getTdConfig().cachedScenes, error: result.error }

  const scenes = extractScenes(result.result)
  if (scenes === null) {
    return {
      ok: false,
      changed: false,
      scenes: getTdConfig().cachedScenes,
      error:
        'The project answered but did not report a scene list. Its list_scenes command should ' +
        'return {"status": "ok", "result": {"scenes": [...]}}.',
    }
  }

  const changed = setScenes(scenes)
  return { ok: true, changed, scenes }
}

/** Refresh and announce if anything moved. Safe to call from anywhere but a hot path. */
export async function refreshAndAnnounce(timeoutMs?: number): Promise<RefreshOutcome> {
  const outcome = await refreshScenes(timeoutMs)
  if (outcome.changed) notifyScenesChanged()
  return outcome
}

export function cancelScenesProbe(): void {
  if (probeTimer) clearTimeout(probeTimer)
  probeTimer = null
  probeGeneration += 1
}

/**
 * The post-launch burst. Cancels any burst already running, then walks the backoff.
 *
 * The generation counter is what makes cancellation real: an in-flight `await` cannot be
 * aborted, so a stale attempt still completes — it just declines to schedule the next one.
 */
export function scheduleScenesProbe(): void {
  cancelScenesProbe()
  const generation = probeGeneration

  const attempt = (index: number): void => {
    if (index >= PROBE_DELAYS_MS.length) return
    probeTimer = setTimeout(() => {
      probeTimer = null
      if (generation !== probeGeneration) return
      void refreshAndAnnounce()
        .then((outcome) => {
          if (generation !== probeGeneration) return
          if (!outcome.ok) attempt(index + 1)
        })
        .catch(() => {
          if (generation === probeGeneration) attempt(index + 1)
        })
    }, PROBE_DELAYS_MS[index])
  }

  attempt(0)
}
