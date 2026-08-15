import { create } from 'zustand'

import { EMPTY_BLOOM_LINK, type BloomLink, type BloomRunEvent } from '../shared/bloom'
import type { ServerFrame } from '../shared/protocol'
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
  text: string
  ts: number
  /** True while sentences are still arriving for this reply. */
  streaming?: boolean
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
  messages: Message[]
  memoryItems: string[]
  trace: TraceEntry[]
  audit: AuditEntry[]
  pendingApprovals: PendingApproval[]
  /** Keyed by operation id; see `OpLog`. */
  ops: Record<string, OpLog>
  thinking: boolean
  /** Amber asked something and wants an answer — keep the mic open. */
  awaitingResponse: boolean
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
  messages: [],
  memoryItems: [],
  trace: [],
  audit: [],
  pendingApprovals: [],
  ops: {},
  thinking: false,
  awaitingResponse: false,
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
      messages: [
        ...s.messages,
        { id: nextId(), role: 'user', text, ts: Date.now() },
      ],
    })),

  ingest: (event) =>
    set((s) => {
      switch (event.kind) {
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
 * **Both, from one reducer**, exactly as `reduceFrame` returns `{ messages, trace }`.
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

    case 'transcript':
      // Amber echoes the transcript for typed turns too, and we already rendered
      // those optimistically — so only add one when it's something we didn't send.
      if (s.messages.at(-1)?.role === 'user' && s.messages.at(-1)?.text === frame.text) {
        return { trace: push(trace('info', 'transcript', frame.text)) }
      }
      return {
        messages: [
          ...s.messages,
          { id: nextId(), role: 'user', text: frame.text, ts: Date.now() },
        ],
        trace: push(trace('info', 'transcript', frame.text)),
      }

    case 'thinking':
      return {
        thinking: frame.active,
        trace: push(trace('info', `thinking: ${frame.active}`)),
      }

    case 'audio_chunk': {
      // Each sentence appends to the in-flight reply, so the bubble grows as Amber
      // speaks rather than appearing all at once at the end.
      const last = s.messages.at(-1)
      const messages =
        last?.role === 'amber' && last.streaming
          ? s.messages.map((m) =>
              m.id === last.id ? { ...m, text: `${m.text} ${frame.text}`.trim() } : m,
            )
          : [
              ...s.messages,
              {
                id: nextId(),
                role: 'amber' as const,
                text: frame.text,
                ts: Date.now(),
                streaming: true,
              },
            ]
      return { messages, trace: push(trace('info', `sentence ${frame.index}`, frame.text)) }
    }

    case 'turn_complete':
      return {
        awaitingResponse: frame.awaiting_response === true,
        messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        trace: push(
          trace(
            'info',
            `turn complete (${frame.sentences} sentence${frame.sentences === 1 ? '' : 's'})`,
            frame.awaiting_response ? 'awaiting your reply' : undefined,
          ),
        ),
      }

    case 'memory':
      return {
        memoryItems: frame.items,
        trace: push(trace('info', `memory (${frame.items.length})`, frame.items.join(' · '))),
      }

    case 'tool_call':
      return {
        trace: push(trace('info', `tool_call ${frame.name}`, JSON.stringify(frame.input))),
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
