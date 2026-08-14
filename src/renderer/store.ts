import { create } from 'zustand'

import type { ServerFrame } from '../shared/protocol'
import type {
  ApertureEvent,
  AuditEntry,
  ConnectionStatus,
  PendingApproval,
  Settings,
  TraceEntry,
} from '../shared/types'
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
  thinking: boolean
  /** Amber asked something and wants an answer — keep the mic open. */
  awaitingResponse: boolean
  lastError: { message: string; code?: string } | null

  ingest: (event: ApertureEvent) => void
  setSettings: (settings: Settings) => void
  setAudit: (entries: AuditEntry[]) => void
  addUserMessage: (text: string) => void
  clearError: () => void
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
  thinking: false,
  awaitingResponse: false,
  lastError: null,

  setSettings: (settings) => set({ settings }),
  setAudit: (audit) => set({ audit }),
  clearError: () => set({ lastError: null }),

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
