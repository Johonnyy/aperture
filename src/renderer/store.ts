import { create } from 'zustand'

import { EMPTY_BLOOM_LINK, type BloomLink, type BloomRunEvent } from '../shared/bloom'
import type {
  ActivityOrigin,
  ConfirmRequestFrame,
  MemoryFact,
  ModelFrame,
  PushFrame,
  ServerFrame,
  StatusFrame,
  VoiceFrame,
} from '../shared/protocol'
import type {
  ApertureEvent,
  AuditEntry,
  ConnectionStatus,
  OpLogEntry,
  PendingApproval,
  Settings,
  TraceEntry,
} from '../shared/types'

/** A narrated long-running operation. `done` is null while it is still running. */
export interface OpLog {
  entries: OpLogEntry[]
  done: { ok: boolean; error?: string } | null
}
import { DEFAULT_SETTINGS } from '../shared/types'

export interface Message {
  id: string
  role: 'user' | 'amber'
  /**
   * Sentences, joined with a space, from `audio_chunk`.
   *
   * This is the *speech* view of the reply and it is lossy on purpose — the splitter
   * upstream deals in sentences, so the model's newlines never reach it. Kept as the
   * fallback for an Amber that predates `delta`.
   */
  text: string
  /**
   * The same reply with the model's own whitespace intact, from `delta`.
   *
   * Preferred for rendering whenever it is non-empty: it is the only one of the two
   * that can carry a heading, a list or a code fence.
   */
  raw: string
  ts: number
  /** True while the reply is still arriving. */
  streaming?: boolean
  /** The turn was cut short — this is as much as was said. */
  interrupted?: boolean
}

/**
 * One tool call Amber made, from the `activity` frame.
 *
 * `running` starts true and is cleared by the matching `end`. A call still running
 * when `turn_complete` lands was interrupted: Amber sends no closing frame on the
 * cancellation path (the socket may be gone, and it is on the barge-in latency
 * path), so the client settles it from what it already knows — it sent the
 * `interrupt` itself.
 */
export interface Activity {
  id: string
  name: string
  origin: ActivityOrigin
  input?: Record<string, unknown>
  readOnly?: boolean
  result?: string
  ok?: boolean
  ms?: number
  ts: number
  running: boolean
  interrupted?: boolean
  /**
   * A Bloom run this call started, once main has matched one to it.
   *
   * How a build kicked off by voice becomes watchable without leaving the chat: the
   * card grows the same live run timeline the Bloom tab draws.
   */
  runId?: string
}

/**
 * The chat, as one ordered list.
 *
 * Messages and tool calls share an array rather than living in two, because their
 * *interleaving* is the information — "she said this, then looked that up, then said
 * this" is the thing a transcript of either half alone cannot express.
 */
/** What one turn cost. From the additive fields on `turn_complete`. */
export interface TurnStats {
  steps: number
  tokens_in: number
  tokens_out: number
  cost_usd: number
  model: string
}

export type TimelineItem =
  | ({ kind: 'message' } & Message)
  | ({ kind: 'activity' } & Activity)

/** The most recent message, skipping any tool calls that landed after it. */
export function lastMessage(timeline: TimelineItem[]): Message | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i]
    if (item.kind === 'message') return item
  }
  return null
}

/** The reply still being streamed, if there is one. */
function streamingReply(timeline: TimelineItem[]): Message | null {
  const last = lastMessage(timeline)
  return last?.role === 'amber' && last.streaming ? last : null
}

/** Replace one item in place, keeping order. */
function patch(
  timeline: TimelineItem[],
  id: string,
  change: Partial<Message> & Partial<Activity>,
): TimelineItem[] {
  return timeline.map((item) =>
    item.id === id ? ({ ...item, ...change } as TimelineItem) : item,
  )
}

/**
 * One Bloom run, live or replayed from history.
 *
 * Mirrors `OpLog` down to the nullable `done`, and for the same reason — but note
 * `streamLost` is deliberately *not* `done`. A stream dying and a run failing are
 * different facts: the run continues server-side and its outcome stays readable from
 * the trace endpoint. Conflating them is the classic bug here, and it is the same
 * distinction `finishOp` already draws between the narration and the result.
 */
export interface BloomRun {
  events: BloomRunEvent[]
  /** Null while it is still going. */
  done: { status: string; error?: string } | null
  /** Why we stopped watching, when we did. Never implies the run stopped. */
  streamLost: string | null
  /** The highest event id seen, so a replay after a reconnect cannot double-render. */
  lastId: number
  agentId: string | null
}

interface State {
  connection: ConnectionStatus
  settings: Settings
  /** Messages and tool calls, in the order they happened. */
  timeline: TimelineItem[]
  memoryItems: string[]
  /** The same facts with their tier, confidence and usage — from a `turn` frame. */
  memoryFacts: MemoryFact[]
  /** Everything Amber knows, from a `browse`. Kept apart from what is in use now. */
  memoryBrowse: MemoryFact[]
  /** Active facts in total, so a browse can say what it is a slice of. */
  memoryTotal: number | null
  /** The outcome of the last forget/restore/correct, for an undo affordance. */
  memoryAck: { action: string; id: number; ok: boolean; content?: string } | null
  /** What this Amber can reach and which halves of it are on. Null before handshake. */
  status: StatusFrame | null
  /**
   * What each completed turn cost, oldest first.
   *
   * Only present on an Amber that reports it — which, until the run state stopped
   * being discarded, was none of them.
   */
  turnStats: TurnStats[]
  trace: TraceEntry[]
  audit: AuditEntry[]
  pendingApprovals: PendingApproval[]
  /**
   * Unprompted messages from Amber — a fired reminder, a maintenance note, a build
   * that finished. Newest first, and deduped on `id`: delivery is at-least-once, so
   * the same push can legitimately arrive twice across a reconnect.
   */
  pushes: PushFrame[]
  /**
   * The tool call Amber is blocked on, waiting for a yes or no. At most one — she
   * runs tool calls sequentially, so a second cannot arrive while this is open.
   *
   * Distinct from `pendingApprovals`, which is the SSH bridge's own queue. Same word,
   * different mechanism, and conflating them would put a shell command and a peer
   * agent's request through one UI that suits neither.
   */
  confirmRequest: ConfirmRequestFrame | null
  /** Keyed by operation id; see `OpLog`. */
  ops: Record<string, OpLog>
  thinking: boolean
  /** Amber asked something and wants an answer — keep the mic open. */
  awaitingResponse: boolean
  /**
   * How Amber is actually speaking, straight from the `voice` frame.
   *
   * Deliberately separate from `settings.tts*`, which are only ever a *request*:
   * Amber clamps and validates, and an old build may not know the frame at all. Null
   * until the handshake lands, which is what the Settings page reads as "this Amber
   * doesn't support voice control".
   */
  voice: VoiceFrame | null
  /**
   * Which brain is answering, straight from the `model` frame.
   *
   * Separate from `settings.llmKeyword` for the same reason `voice` is separate from
   * `settings.tts*`: that is a *request*, this is what Amber is actually doing. Null
   * until the handshake lands, which the Settings page reads as "this Amber predates
   * model control".
   */
  model: ModelFrame | null
  lastError: { message: string; code?: string } | null
  /** Where we stand with Bloom. Drives whether its sidebar row exists at all. */
  bloomLink: BloomLink
  /** Keyed by run id; several runs can be in flight at once. */
  bloomRuns: Record<string, BloomRun>

  ingest: (event: ApertureEvent) => void
  setBloomLink: (link: BloomLink) => void
  /** Fill a bucket from a historical trace. A merge, never a reset — see `ingest`. */
  hydrateRun: (
    runId: string,
    agentId: string,
    events: BloomRunEvent[],
    done: { status: string; error?: string } | null,
  ) => void
  setSettings: (settings: Settings) => void
  setAudit: (entries: AuditEntry[]) => void
  addUserMessage: (text: string) => void
  clearError: () => void
  /** Drop one push from the list once the user has dealt with it. */
  dismissPush: (id: string) => void
  /** Clear the open approval. Called after answering, and on disconnect. */
  clearConfirmRequest: () => void
  /** Open a log before the work starts, so no early step can be missed. */
  startOp: (opId: string) => void
  /**
   * Settle an operation from the caller's own result.
   *
   * The IPC promise is the authority on whether an operation ended — the `op-done`
   * event is only live narration. Relying on the event alone meant a dropped or
   * never-sent one left the dialog spinning forever with no way out, which is the
   * exact failure this whole log was built to eliminate.
   */
  finishOp: (opId: string, result: { ok: boolean; error?: string }) => void
}

const TRACE_CAP = 400
// Enough for a long session's chart without letting it grow forever.
const TURN_STATS_CAP = 200
// Unprompted messages are read and dismissed rather than scrolled, so this is a
// backstop against an unattended app accumulating forever, not a real limit.
const PUSH_CAP = 100

let seq = 0
const nextId = (): string => `${Date.now()}-${++seq}`

function trace(
  level: TraceEntry['level'],
  label: string,
  detail?: string,
): TraceEntry {
  return { id: nextId(), ts: Date.now(), level, label, detail }
}

export const useStore = create<State>((set) => ({
  connection: { state: 'idle', sessionId: null, resumed: false },
  settings: DEFAULT_SETTINGS,
  timeline: [],
  memoryFacts: [],
  memoryBrowse: [],
  memoryTotal: null,
  memoryAck: null,
  status: null,
  turnStats: [],
  memoryItems: [],
  trace: [],
  audit: [],
  pendingApprovals: [],
  pushes: [],
  confirmRequest: null,
  ops: {},
  thinking: false,
  awaitingResponse: false,
  voice: null,
  model: null,
  lastError: null,
  // Seeded from argv before first paint (see preload), then corrected by the record
  // on disk a moment later. The default matters: `unlinked` means no sidebar row, so
  // an app with no Bloom never flashes one.
  bloomLink: {
    ...EMPTY_BLOOM_LINK,
    state: window.aperture?.bloom?.linkedAtLaunch ? 'linked' : 'unlinked',
  },
  bloomRuns: {},

  setSettings: (settings) => set({ settings }),
  setAudit: (audit) => set({ audit }),
  setBloomLink: (bloomLink) => set({ bloomLink }),
  clearError: () => set({ lastError: null }),
  dismissPush: (id) => set((s) => ({ pushes: s.pushes.filter((p) => p.id !== id) })),
  clearConfirmRequest: () => set({ confirmRequest: null }),

  /**
   * Fill a run's bucket from a historical trace.
   *
   * A **merge**, not a reset: main opens a live stream before the `test-run` promise
   * resolves, so events can already be in the bucket when this runs. Dedup is by
   * event id, which is also what makes a post-reconnect replay harmless.
   */
  hydrateRun: (runId, agentId, events, done) =>
    set((s) => {
      const existing = s.bloomRuns[runId]
      const merged = new Map<number, BloomRunEvent>()
      for (const event of [...(existing?.events ?? []), ...events]) {
        // Synthetic stream events carry negative ids and must not collide, so they
        // are keyed by position rather than by id.
        merged.set(event.id > 0 ? event.id : -(merged.size + 1_000_000), event)
      }
      const ordered = [...merged.values()].sort((a, b) => a.id - b.id)
      return {
        bloomRuns: {
          ...s.bloomRuns,
          [runId]: {
            events: ordered,
            done: done ?? existing?.done ?? null,
            streamLost: existing?.streamLost ?? null,
            lastId: ordered.reduce((max, e) => Math.max(max, e.id), 0),
            agentId,
          },
        },
      }
    }),

  startOp: (opId) =>
    set((s) => ({ ops: { ...s.ops, [opId]: { entries: [], done: null } } })),

  finishOp: (opId, result) =>
    set((s) => {
      const existing = s.ops[opId]
      // An `op-done` event may have beaten the promise here; first writer wins so
      // the richer server-side error isn't overwritten by the generic one.
      if (existing?.done) return {}
      const entries = existing?.entries ?? []
      return {
        ops: {
          ...s.ops,
          [opId]: {
            // If nothing narrated at all, say so rather than showing an empty log —
            // "no steps reported" is itself a diagnosis.
            entries: entries.length
              ? entries
              : [
                  {
                    id: `${opId}-fallback`,
                    ts: Date.now(),
                    level: result.ok ? ('ok' as const) : ('error' as const),
                    message: result.ok
                      ? 'Finished, but reported no steps.'
                      : 'Failed before reporting any steps.',
                    detail:
                      'The operation returned without narrating anything. If this ' +
                      'persists, the main process may be running an older build — ' +
                      'restart the dev server.',
                  },
                ],
            done: result,
          },
        },
      }
    }),

  addUserMessage: (text) =>
    set((s) => ({
      timeline: [
        ...s.timeline,
        {
          kind: 'message',
          id: nextId(),
          role: 'user',
          text,
          raw: text,
          ts: Date.now(),
        },
      ],
    })),

  ingest: (event) =>
    set((s) => {
      switch (event.kind) {
        case 'activity-run':
          // The card grows a live build timeline. Nothing else about it changes.
          return { timeline: patch(s.timeline, event.callId, { runId: event.runId }) }

        case 'connection': {
          const was = s.connection.state
          const now = event.status.state
          const entries =
            was === now ? s.trace : [...s.trace, trace('info', `connection: ${now}`, event.status.detail)]
          return { connection: event.status, trace: entries.slice(-TRACE_CAP) }
        }
        case 'trace':
          return { trace: [...s.trace, event.entry].slice(-TRACE_CAP) }
        case 'audit':
          return { audit: [event.entry, ...s.audit] }
        case 'approvals':
          return { pendingApprovals: event.pending }
        case 'op':
          return {
            ops: {
              ...s.ops,
              [event.opId]: {
                entries: [...(s.ops[event.opId]?.entries ?? []), event.entry],
                done: s.ops[event.opId]?.done ?? null,
              },
            },
          }
        case 'op-done':
          return {
            ops: {
              ...s.ops,
              [event.opId]: {
                entries: s.ops[event.opId]?.entries ?? [],
                done: { ok: event.ok, error: event.error },
              },
            },
          }
        case 'bloom-link':
          return { bloomLink: event.link }
        case 'bloom-run':
          return reduceBloomRun(s, event.runId, event.event)
        case 'frame':
          return reduceFrame(s, event.frame)
        case 'audio':
          return {} // playback is handled by the audio queue, not the store
        default:
          return {}
      }
    }),
}))

/**
 * One Bloom run event: into its own bucket, and — sparsely — into the shared trace.
 *
 * **Both, from one reducer**, exactly as `reduceFrame` returns `{ timeline, trace }`.
 * Emitting a second event from main to narrate would double the traffic and put the
 * mapping in the wrong process.
 *
 * The Status Panel's `trace` is reused rather than given a Bloom-shaped twin.
 * `TraceEntry` describes itself as "an ephemeral view of a turn unfolding", which a
 * Bloom run is; a second array would mean a second cap, a second autoscroll and an
 * argument about which half gets the height. And interleaving is the *point* —
 * Amber is eventually what kicks off a run, and two columns would put cause and
 * effect side by side.
 *
 * Which is why the mapping is sparse: `text` and `step_finished` contribute nothing.
 * A chatty run would otherwise drown Amber's own narration in the same column.
 */
function reduceBloomRun(s: State, runId: string, event: BloomRunEvent): Partial<State> {
  const existing = s.bloomRuns[runId]

  // A replay after a reconnect re-sends everything from the cursor. Bloom's
  // `Last-Event-ID` handling is exact, but one comparison removes an entire class of
  // double-rendered tool calls if it ever is not.
  if (existing && event.id > 0 && event.id <= existing.lastId) return {}

  const events = [...(existing?.events ?? []), event]
  const done =
    event.kind === 'run_finished'
      ? {
          status: String(event.payload.status ?? 'succeeded'),
          error: (event.payload.error as string | undefined) ?? undefined,
        }
      : (existing?.done ?? null)

  const next: BloomRun = {
    events,
    done,
    // A lost stream never sets `done` — the run is very likely still going.
    streamLost: event.kind === 'stream_lost' ? String(event.payload.detail ?? 'Lost contact.') : null,
    lastId: Math.max(existing?.lastId ?? 0, event.id),
    agentId: existing?.agentId ?? null,
  }

  const line = traceLineFor(event)
  return {
    bloomRuns: { ...s.bloomRuns, [runId]: next },
    ...(line ? { trace: [...s.trace, line].slice(-TRACE_CAP) } : {}),
  }
}

/** The sparse half of the mapping above. Returns null for anything not worth a line. */
function traceLineFor(event: BloomRunEvent): TraceEntry | null {
  switch (event.kind) {
    case 'run_started':
      return trace('info', `bloom: run started — ${event.payload.agent_slug ?? 'agent'}`)
    case 'tool_started':
      return trace('info', `bloom: ${event.toolName ?? 'tool'}…`)
    case 'tool_finished':
      return trace(
        event.ok === false ? 'error' : 'info',
        `bloom: ${event.toolName ?? 'tool'} ${event.ok === false ? 'failed' : 'ok'}`,
        event.latencyMs === null ? undefined : `${event.latencyMs}ms`,
      )
    case 'run_finished':
      return trace(
        event.payload.status === 'succeeded' ? 'info' : 'warn',
        `bloom: run ${event.payload.status ?? 'finished'}`,
        (event.payload.error as string | undefined) ?? undefined,
      )
    case 'stream_lost':
      return trace('error', 'bloom: lost contact with a run', String(event.payload.detail ?? ''))
    default:
      // `text` and `step_finished` deliberately contribute nothing.
      return null
  }
}

function reduceFrame(s: State, frame: ServerFrame): Partial<State> {
  const push = (entry: TraceEntry): TraceEntry[] => [...s.trace, entry].slice(-TRACE_CAP)

  switch (frame.type) {
    case 'ready':
      return {
        trace: push(
          trace('info', frame.resumed ? 'session resumed' : 'session started', frame.session_id),
        ),
      }

    case 'transcript': {
      // Amber echoes the transcript for typed turns too, and we already rendered
      // those optimistically — so only add one when it's something we didn't send.
      //
      // Against the *last message*, not the last timeline item: a tool call from the
      // previous turn can sit between, and comparing against that would defeat the
      // dedupe and double every typed turn.
      const previous = lastMessage(s.timeline)
      if (previous?.role === 'user' && previous.text === frame.text) {
        return { trace: push(trace('info', 'transcript', frame.text)) }
      }
      return {
        timeline: [
          ...s.timeline,
          {
            kind: 'message',
            id: nextId(),
            role: 'user',
            text: frame.text,
            raw: frame.text,
            ts: Date.now(),
          },
        ],
        trace: push(trace('info', 'transcript', frame.text)),
      }
    }

    case 'thinking':
      return {
        thinking: frame.active,
        trace: push(trace('info', `thinking: ${frame.active}`)),
      }

    case 'delta': {
      // The reply's text view. Appended verbatim — no trimming, no joining — because
      // the whitespace *is* what this frame exists to preserve.
      const open = streamingReply(s.timeline)
      return {
        timeline: open
          ? patch(s.timeline, open.id, { raw: open.raw + frame.text })
          : [
              ...s.timeline,
              {
                kind: 'message',
                id: nextId(),
                role: 'amber',
                text: '',
                raw: frame.text,
                ts: Date.now(),
                streaming: true,
              },
            ],
        // Deliberately no trace line. One per token would bury everything else in
        // the column within a sentence.
      }
    }

    case 'audio_chunk': {
      // Sentences still accumulate, as the fallback for an Amber with no `delta`
      // frame. When deltas *are* arriving this is the spoken-progress marker and the
      // renderer ignores `text` entirely.
      const open = streamingReply(s.timeline)
      return {
        timeline: open
          ? patch(s.timeline, open.id, {
              text: `${open.text} ${frame.text}`.trim(),
            })
          : [
              ...s.timeline,
              {
                kind: 'message',
                id: nextId(),
                role: 'amber',
                text: frame.text,
                raw: '',
                ts: Date.now(),
                streaming: true,
              },
            ],
        trace: push(trace('info', `sentence ${frame.index}`, frame.text)),
      }
    }

    case 'turn_complete':
      return {
        awaitingResponse: frame.awaiting_response === true,
        // Absent on the canned path and on any install with cost tracking off, so
        // this stays a list of turns that actually reported rather than a list with
        // zeroes in it.
        turnStats:
          frame.cost_usd === undefined
            ? s.turnStats
            : [
                ...s.turnStats,
                {
                  steps: frame.steps ?? 0,
                  tokens_in: frame.tokens_in ?? 0,
                  tokens_out: frame.tokens_out ?? 0,
                  cost_usd: frame.cost_usd,
                  model: frame.model ?? '',
                },
              ].slice(-TURN_STATS_CAP),
        // Settle everything the turn left open. A tool call still running here was
        // interrupted — Amber sends no closing frame on the cancellation path, so
        // this is where the client applies what it already knows.
        timeline: s.timeline.map((item) => {
          if (item.kind === 'message' && item.streaming) {
            return { ...item, streaming: false }
          }
          if (item.kind === 'activity' && item.running) {
            return { ...item, running: false, interrupted: true }
          }
          return item
        }),
        trace: push(
          trace(
            'info',
            `turn complete (${frame.sentences} sentence${frame.sentences === 1 ? '' : 's'})`,
            frame.awaiting_response ? 'awaiting your reply' : undefined,
          ),
        ),
      }

    case 'activity': {
      if (frame.phase === 'start') {
        return {
          timeline: [
            ...s.timeline,
            {
              kind: 'activity',
              id: frame.id,
              name: frame.name,
              origin: frame.origin,
              input: frame.input,
              readOnly: frame.read_only,
              ts: Date.now(),
              running: true,
            },
          ],
          trace: push(
            trace('info', `${frame.name}…`, JSON.stringify(frame.input ?? {})),
          ),
        }
      }
      return {
        timeline: patch(s.timeline, frame.id, {
          running: false,
          ok: frame.ok,
          ms: frame.ms,
          result: frame.result,
        }),
        trace: push(
          trace(
            frame.ok === false ? 'error' : 'info',
            `${frame.name} ${frame.ok === false ? 'failed' : 'ok'}`,
            frame.ms === undefined ? undefined : `${frame.ms}ms`,
          ),
        ),
      }
    }

    case 'memory': {
      // Two questions through one frame. A browse must never overwrite what the
      // turn is drawing on, or the panel loses the highlighting that says which
      // facts are actually in play right now.
      if (frame.scope === 'browse') {
        return {
          memoryBrowse: frame.facts ?? [],
          memoryTotal: frame.total ?? null,
          memoryAck: frame.ack ?? null,
          trace: push(trace('info', `memory browse (${frame.facts?.length ?? 0})`)),
        }
      }
      return {
        memoryItems: frame.items,
        memoryFacts: frame.facts ?? [],
        trace: push(
          trace('info', `memory (${frame.items.length})`, frame.items.join(' · ')),
        ),
      }
    }

    case 'status':
      // Whole-record, never a delta — a dropped frame cannot leave a panel showing
      // a peer as reachable long after it stopped being.
      return { status: frame, trace: push(trace('info', 'status')) }

    case 'tool_call':
      return {
        trace: push(trace('info', `tool_call ${frame.name}`, JSON.stringify(frame.input))),
      }

    case 'voice':
      return {
        // The options block only rides on some of these frames in principle; keep the
        // last catalogue we were given so a picker can't empty itself mid-session.
        voice: { ...frame, options: frame.options ?? s.voice?.options },
        trace: push(
          trace(
            'info',
            'voice',
            `${frame.settings.voice} · ${frame.settings.model} · ${frame.settings.speed}x`,
          ),
        ),
      }

    case 'model':
      return {
        // Keep the last catalogue for the same reason as `voice`: a frame that
        // omitted it must not empty a picker mid-session.
        model: { ...frame, options: frame.options ?? s.model?.options },
        trace: push(
          trace('info', 'model', `${frame.settings.keyword} → ${frame.settings.model}`),
        ),
      }

    case 'push': {
      // Deduped on `id` because delivery is at-least-once: if Amber sends one and
      // restarts before recording that she did, the same push arrives again on the
      // next connect. Without this the user sees the reminder twice and concludes
      // reminders are broken.
      if (s.pushes.some((p) => p.id === frame.id)) return {}
      return {
        pushes: [frame, ...s.pushes].slice(0, PUSH_CAP),
        trace: push(trace('info', `push (${frame.kind})`, frame.text)),
      }
    }

    case 'confirm_request':
      return {
        confirmRequest: frame,
        trace: push(trace('info', `approval needed: ${frame.name}`, frame.origin)),
      }

    case 'error':
      return {
        lastError: { message: frame.message, code: frame.code },
        trace: push(trace('error', `error${frame.code ? ` (${frame.code})` : ''}`, frame.message)),
      }

    default:
      return {}
  }
}
