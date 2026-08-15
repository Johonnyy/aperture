import type { BloomRunEvent } from '../../shared/bloom'
import type { BloomTarget } from './client'
import { createSseParser, streamEvent, toRunEvent } from './wire'

/**
 * Watching a Bloom run as it happens.
 *
 * **Main owns this, and that is forced rather than preferred.** A renderer
 * `EventSource` cannot set an `Authorization` header, so streaming from there would
 * mean handing the admin token across the contextBridge — which the whole preload
 * contract exists to prevent. Main holding the cursor also means a dev reload or a
 * closed window replays cleanly instead of losing events with no resume point.
 *
 * Three hazards shape everything below, and each is invisible in development:
 *
 * **The finished-run replay loop.** Bloom closes the stream after `run_finished`, so
 * "reconnect whenever the connection ends" reconnects to a finished run, replays its
 * whole log, and is closed again — forever. Three things together prevent it and you
 * need all three: `sawTerminal` suppresses the reconnect, an attempt cap bounds the
 * damage if it is somehow wrong, and jitter stops several streams stampeding in
 * lockstep. In dev, runs are short and the loop is over before you notice; in
 * production it reads as "Bloom is slow".
 *
 * **Idle, not total.** The timeout here is a *rolling* one, reset on every chunk.
 * `AbortSignal.timeout` is right for a request and catastrophic for a stream — it is
 * already used in `client.ts`, which makes it the natural thing to copy, and it
 * would kill every run that outlives it. Without any idle timeout, a half-open
 * connection (a closed laptop lid) leaves a run "running" forever with no error.
 *
 * **A dying stream is not a failing run.** The run continues server-side and its
 * outcome stays readable from the trace endpoint. So this emits `stream_lost` rather
 * than synthesising a `run_finished` — the stream is a view, the run is the fact.
 */

/** Bloom pings every 15s, so silence is diagnostic. Slack for a loaded box. */
const IDLE_TIMEOUT_MS = 45_000

/** ~63s of retries. A run stream is bounded work, unlike Amber's socket. */
const MAX_ATTEMPTS = 6
const BASE_RETRY_MS = 1_000
const MAX_RETRY_MS = 30_000

/**
 * Enough for a few runs side by side without letting a leak grow unbounded. Only
 * *finished* streams are evicted — an in-flight one is never dropped to make room.
 */
const MAX_STREAMS = 4

export interface RunStreamHandlers {
  onEvent: (runId: string, event: BloomRunEvent) => void
}

interface RunStream {
  runId: string
  controller: AbortController
  /** The resume cursor. `Last-Event-ID` on every reconnect. */
  lastEventId: string | null
  attempt: number
  /** Set once `run_finished` arrives. Suppresses every further reconnect. */
  sawTerminal: boolean
  closed: boolean
  idleTimer: ReturnType<typeof setTimeout> | null
  retryTimer: ReturnType<typeof setTimeout> | null
}

const streams = new Map<string, RunStream>()

function backoff(attempt: number): number {
  const base = Math.min(BASE_RETRY_MS * 2 ** (attempt - 1), MAX_RETRY_MS)
  // Amber's socket has no jitter and is right not to — there is one of it. Here
  // several streams can retry together, and un-jittered backoff makes them stampede.
  return Math.round(base * (0.8 + Math.random() * 0.4))
}

function clearTimers(stream: RunStream): void {
  if (stream.idleTimer) clearTimeout(stream.idleTimer)
  if (stream.retryTimer) clearTimeout(stream.retryTimer)
  stream.idleTimer = null
  stream.retryTimer = null
}

/** Drop finished streams once there are too many. Never evicts a live one. */
function evictFinished(): void {
  if (streams.size <= MAX_STREAMS) return
  for (const [id, stream] of streams) {
    if (streams.size <= MAX_STREAMS) break
    if (stream.sawTerminal || stream.closed) {
      clearTimers(stream)
      streams.delete(id)
    }
  }
}

/**
 * Start watching a run. Idempotent per run id — a second call is a no-op, so the
 * renderer can ask twice without opening two connections to the same trace.
 */
export function openRunStream(
  target: BloomTarget,
  runId: string,
  handlers: RunStreamHandlers,
): void {
  if (streams.has(runId)) return

  const stream: RunStream = {
    runId,
    controller: new AbortController(),
    lastEventId: null,
    attempt: 0,
    sawTerminal: false,
    closed: false,
    idleTimer: null,
    retryTimer: null,
  }
  streams.set(runId, stream)
  evictFinished()
  void connect(target, stream, handlers)
}

export function closeRunStream(runId: string): boolean {
  const stream = streams.get(runId)
  if (!stream) return false
  stream.closed = true
  clearTimers(stream)
  stream.controller.abort()
  streams.delete(runId)
  return true
}

export function closeAllRunStreams(): void {
  for (const runId of [...streams.keys()]) closeRunStream(runId)
}

/** Run ids currently being watched. For diagnostics and for tests. */
export function activeRunStreams(): string[] {
  return [...streams.keys()]
}

async function connect(
  target: BloomTarget,
  stream: RunStream,
  handlers: RunStreamHandlers,
): Promise<void> {
  if (stream.closed || stream.sawTerminal) return

  const url = new URL(`admin/runs/${encodeURIComponent(stream.runId)}/events`, `${target.baseUrl.replace(/\/+$/, '')}/`)

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    Authorization: `Bearer ${target.token}`,
    // Proxies that buffer would defeat the whole point of a stream.
    'Cache-Control': 'no-cache',
  }
  // Resume exactly where we stopped. Bloom replays from the cursor and then tails,
  // so nothing is missed and — with the dedup in the reducer — nothing doubles.
  if (stream.lastEventId) headers['Last-Event-ID'] = stream.lastEventId

  const touch = (): void => {
    if (stream.idleTimer) clearTimeout(stream.idleTimer)
    stream.idleTimer = setTimeout(() => {
      // Silence past the ping interval means the connection is gone even though the
      // socket has not said so. Abort and let the retry path decide.
      stream.controller.abort()
    }, IDLE_TIMEOUT_MS)
  }

  try {
    const response = await fetch(url, { headers, signal: stream.controller.signal })

    if (response.status === 401 || response.status === 403) {
      // Not a transport problem, and retrying cannot fix it.
      finish(stream, handlers, 'Bloom rejected the stored admin key while watching this run.')
      return
    }
    if (!response.ok || !response.body) {
      // A 404 here usually means the run was pruned, which no amount of retrying
      // recovers either.
      if (response.status === 404) {
        finish(stream, handlers, 'Bloom no longer has this run.')
        return
      }
      throw new Error(`HTTP ${response.status}`)
    }

    if (stream.attempt > 0) {
      handlers.onEvent(
        stream.runId,
        streamEvent(stream.runId, 'stream_resumed', 'Reconnected to the run.'),
      )
    }

    const parser = createSseParser()
    // `stream: true` so a multi-byte character split across chunks is not mangled —
    // the same reason `execStream` uses a StringDecoder rather than toString().
    const decoder = new TextDecoder()
    touch()

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      touch()
      for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
        // Reset the backoff on a *received event*, not on connect: a server that
        // accepts and instantly drops would otherwise reset it forever.
        stream.attempt = 0
        if (frame.id) stream.lastEventId = frame.id
        dispatch(stream, handlers, frame.event, frame.data)
        if (stream.sawTerminal) break
      }
      if (stream.sawTerminal || stream.closed) break
    }

    for (const frame of parser.flush()) {
      if (stream.sawTerminal || stream.closed) break
      if (frame.id) stream.lastEventId = frame.id
      dispatch(stream, handlers, frame.event, frame.data)
    }

    clearTimers(stream)

    if (stream.sawTerminal || stream.closed) {
      streams.delete(stream.runId)
      return
    }
    // The body ended without a terminal event: the connection dropped mid-run.
    retry(target, stream, handlers, 'The connection to Bloom closed before the run ended.')
  } catch (err) {
    clearTimers(stream)
    if (stream.closed) {
      streams.delete(stream.runId)
      return
    }
    if (stream.sawTerminal) {
      streams.delete(stream.runId)
      return
    }
    retry(target, stream, handlers, describe(err))
  }
}

function dispatch(
  stream: RunStream,
  handlers: RunStreamHandlers,
  kind: string,
  data: string,
): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    // A frame we cannot read is dropped rather than crashing the stream, the same
    // way an unparseable WebSocket message is. The run is unaffected.
    return
  }
  const event = toRunEvent(parsed, stream.runId)
  if (!event) return
  if (event.kind === 'run_finished') stream.sawTerminal = true
  handlers.onEvent(stream.runId, event)
}

function retry(
  target: BloomTarget,
  stream: RunStream,
  handlers: RunStreamHandlers,
  reason: string,
): void {
  stream.attempt += 1
  if (stream.attempt > MAX_ATTEMPTS) {
    finish(stream, handlers, `${reason} Gave up after ${MAX_ATTEMPTS} attempts.`)
    return
  }
  // A fresh controller: the old one is aborted and cannot be reused.
  stream.controller = new AbortController()
  stream.retryTimer = setTimeout(() => {
    void connect(target, stream, handlers)
  }, backoff(stream.attempt))
}

/**
 * Stop watching, and say why — **without** claiming the run ended.
 *
 * `stream_lost` and `run_finished` are different facts and the UI must not conflate
 * them: the run is very likely still going, and the trace endpoint remains the
 * authoritative answer.
 */
function finish(stream: RunStream, handlers: RunStreamHandlers, detail: string): void {
  clearTimers(stream)
  streams.delete(stream.runId)
  handlers.onEvent(stream.runId, streamEvent(stream.runId, 'stream_lost', detail))
}

function describe(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'AbortError') return 'Bloom stopped sending for 45 seconds.'
  const message = (err as Error)?.message ?? String(err)
  return `Lost contact with the run: ${message}`
}
