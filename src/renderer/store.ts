import { create } from 'zustand'

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

  ingest: (event: ApertureEvent) => void
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

  setSettings: (settings) => set({ settings }),
  setAudit: (audit) => set({ audit }),
  clearError: () => set({ lastError: null }),

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
        case 'frame':
          return reduceFrame(s, event.frame)
        case 'audio':
          return {} // playback is handled by the audio queue, not the store
        default:
          return {}
      }
    }),
}))

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
