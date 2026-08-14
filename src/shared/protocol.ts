/**
 * Amber's WebSocket wire contract, mirrored in TypeScript.
 *
 * This file is a translation of `amber/app/protocol.py`. That module is the source
 * of truth — if the two ever disagree, this one is wrong. Amber treats the protocol
 * as versioned public API and evolves it only additively (new optional fields, new
 * frame types), so an older client keeps working; the same applies in reverse here.
 *
 * Two frame kinds travel over the socket:
 *
 * - **Binary frames** are raw audio. Client -> server is one complete recorded
 *   utterance (the frame boundary *is* the utterance boundary — there is no chunking
 *   and no end-of-utterance marker). Server -> client is one synthesized sentence,
 *   and each one is immediately preceded by an `audio_chunk` JSON frame describing
 *   it. Pairing them is the receiver's job; see `AmberConnection`.
 * - **Text frames** are JSON, discriminated on `type`.
 */

// --- server -> client -------------------------------------------------------

/** Machine-readable tag on an `error` frame, so clients react without parsing prose. */
export type ErrorCode =
  | 'rate_limited'
  | 'payload_too_large'
  | 'session_limit'
  | 'internal'

/** Handshake accepted. Always the first frame on a connection. */
export interface ReadyFrame {
  type: 'ready'
  /** Present in practice always; echo it back as `?session_id=` to resume. */
  session_id?: string
  /** True when this connection picked up an existing session's history. */
  resumed?: boolean
}

/** What Amber took as the user's turn — STT output, or a typed turn echoed back. */
export interface TranscriptFrame {
  type: 'transcript'
  text: string
}

/**
 * Amber is generating. Sent `true` before the turn and `false` from a `finally`
 * after it — which makes `active: false` the *reliable* end-of-turn signal, since
 * an interrupted turn emits it but never reaches `turn_complete`.
 */
export interface ThinkingFrame {
  type: 'thinking'
  active: boolean
}

/**
 * Metadata for the binary frame that immediately follows.
 *
 * Note the wire key is `format`, not `audio_format` (the Python builder's keyword
 * argument differs from the key it emits — `protocol.py:98-110`).
 */
export interface AudioChunkFrame {
  type: 'audio_chunk'
  /** 0-based sentence position within this turn. */
  index: number
  /** The sentence being spoken — useful for captions and the live trace. */
  text: string
  /** Container of the bytes, e.g. `"mp3"`. */
  format: string
}

/**
 * The full response has been sent.
 *
 * `awaiting_response` is present **only when true** — never `false`. It's typed as
 * `?: true` so `=== false` can't be written by accident. It means Amber asked
 * something it expects an answer to: keep the mic open and send the next utterance
 * as a continuation. Per-turn, never sticky.
 */
export interface TurnCompleteFrame {
  type: 'turn_complete'
  sentences: number
  awaiting_response?: true
}

/** The facts Amber is drawing on this turn. Advisory — it never affects the loop. */
export interface MemoryFrame {
  type: 'memory'
  items: string[]
}

/**
 * Amber asks this client to run one of the tools it declared via `register_tools`.
 * Can interleave with audio frames mid-turn. `name` carries the `client_` prefix
 * Amber added server-side.
 */
export interface ToolCallFrame {
  type: 'tool_call'
  /** Correlation id — opaque (`c1`, `c2`, …). Echo it verbatim; never parse it. */
  id: string
  name: string
  input: Record<string, unknown>
}

/** Something went wrong this turn. The connection stays open. */
export interface ErrorFrame {
  type: 'error'
  message: string
  code?: ErrorCode
}

export type ServerFrame =
  | ReadyFrame
  | TranscriptFrame
  | ThinkingFrame
  | AudioChunkFrame
  | TurnCompleteFrame
  | MemoryFrame
  | ToolCallFrame
  | ErrorFrame

// --- client -> server -------------------------------------------------------

/** A tool this device can run, offered to Amber. */
export interface ToolSpec {
  /**
   * Amber sanitizes this to `[a-zA-Z0-9_-]`, prefixes it with `client_` unless it
   * already starts with it, and truncates to 64 chars. Declare the bare name and
   * expect the prefixed one back on a `tool_call`.
   */
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

export type ClientFrame =
  /** Stop speaking. No acknowledgment comes back, and the cancelled turn emits no
   *  `turn_complete` — only `thinking: false`. */
  | { type: 'interrupt' }
  /** A typed turn. Peer of a binary utterance: same guardrails, same barge-in, only
   *  STT is skipped. */
  | { type: 'user_text'; text: string }
  /** Declare this device's tools. **Replaces** the whole set, capped at 16 server
   *  side. No acknowledgment. Specs survive a reconnect, so always re-send on
   *  `ready` or a stale build's tools stay advertised to the model. */
  | { type: 'register_tools'; tools: ToolSpec[] }
  /** Answer a `tool_call`. `id` **must** be a string or Amber drops it silently;
   *  `content` **must** be a string (it goes through Python `str()`, so an object
   *  would reach the model as a Python dict repr). Must arrive within
   *  `client_tool_timeout_s` (30s) — after that it is discarded with no notice. */
  | { type: 'tool_result'; id: string; content: string; is_error?: boolean }

// --- narrowing helpers ------------------------------------------------------

const SERVER_FRAME_TYPES = new Set<ServerFrame['type']>([
  'ready',
  'transcript',
  'thinking',
  'audio_chunk',
  'turn_complete',
  'memory',
  'tool_call',
  'error',
])

/**
 * True if `value` is a frame type we know. Unknown types are *expected* — Amber
 * adds frames additively — so callers should log and ignore rather than throw.
 */
export function isServerFrame(value: unknown): value is ServerFrame {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && SERVER_FRAME_TYPES.has(type as ServerFrame['type'])
}
