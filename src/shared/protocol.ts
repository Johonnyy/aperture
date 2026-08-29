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
  /**
   * What the turn cost. Attached together or not at all — absent on the canned
   * reprompt path and on any install with cost tracking off.
   *
   * These are newly *reportable* rather than newly measured: `AgentRunner.stream`
   * always built them and always discarded them, so an Amber older than that fix
   * sends none of these keys and its spend genuinely is unknown.
   */
  steps?: number
  tokens_in?: number
  tokens_out?: number
  cost_usd?: number
  /** The model that actually answered — the keyword table can move between turns. */
  model?: string
  /**
   * Where the turn's *time* went. `total_ms` is always present; the rest appear only
   * when this turn did that thing — a typed turn does no STT, the canned reprompt
   * path never reaches the model.
   *
   * **There is deliberately no `tools_ms`.** Every tool call already arrived as an
   * `activity` pair carrying its own `ms`, so the server measuring it again would be
   * two sources for one number. The waterfall is drawn from both halves.
   */
  timings?: {
    total_ms: number
    stt_ms?: number
    /** Turn start to the first *text* — a turn that ran three tools first waited. */
    first_token_ms?: number
    /** Summed across sentences, not a window: synthesis interleaves with generation. */
    tts_ms?: number
  }
  /** When each model call ran. ISO strings, straight off the runtime's own steps. */
  step_spans?: { started_at: string; finished_at: string; model: string }[]
}

/** One remembered fact, as much of it as rides on the wire. */
export interface MemoryFact {
  id: number
  content: string
  /** How settled Amber considers it. `durable` is identity-level knowledge. */
  tier: 'session' | 'short' | 'durable'
  category?: string | null
  /** 0..1. How sure she is it is true. */
  confidence?: number
  /** How many turns have actually drawn on it — whether it has earned its keep. */
  use_count?: number
  last_used_at?: string | null
  /**
   * `explicit` was told to her outright ("remember that…"); `extracted` was inferred
   * from something said in passing; `consolidated` was merged by the maintenance
   * pass. Worth showing — the three deserve different confidence from a reader.
   */
  source?: 'extracted' | 'explicit' | 'consolidated'
  /**
   * When it was first learned. The only clock a **never-used** fact has — and that is
   * exactly the fact a decay countdown is about, since the deadline is measured from
   * `last_used_at` when there is one and `created_at` when there isn't.
   */
  created_at?: string
  /** `active` unless this came from an archive or lineage read. */
  status?: 'active' | 'superseded' | 'forgotten'
  /** The fact that replaced this one. The revision history, finally readable. */
  superseded_by?: number | null
}

/**
 * What Amber remembers. Advisory — it never affects the loop.
 *
 * One shape, two questions, told apart by `scope`. Unprompted before a reply it is
 * `turn`: the facts *this* turn is drawing on. In answer to a `memory_query` it is
 * `browse`: everything she knows. A panel must not let the second overwrite the
 * first, or the highlighting of what is in use right now is lost.
 */
export interface MemoryFrame {
  type: 'memory'
  items: string[]
  /** Absent on an Amber that predates the richer records. */
  facts?: MemoryFact[]
  /**
   * Absent means `turn` — the original meaning, unchanged.
   *
   * `lineage` is one fact's revision history, oldest first; `archive` is what Amber
   * no longer believes. Both read columns that have always been written and never
   * read, and both ride this frame so an older client just sees a fact list.
   */
  scope?: 'turn' | 'browse' | 'lineage' | 'archive'
  /** Active facts in total, so a browse can say what it is a slice of. */
  total?: number
  /** Settles a `memory_action`. Present even when it was refused. */
  ack?: { action: string; id: number; ok: boolean; content?: string }
}

/**
 * What this install can reach, and which of its optional halves are switched on.
 *
 * Sent after `model` on the handshake. Everything in it always existed inside Amber
 * and was simply never told to anyone, so a client had to infer a peer's existence
 * from a tool name it happened to watch go past — and could not distinguish "no
 * peers configured" from "the sync store is down" at all.
 *
 * Every section is optional: they are gathered independently server-side and one
 * that fails is omitted rather than failing the frame.
 */
export interface StatusFrame {
  type: 'status'
  session?: {
    id: string
    /**
     * Which commit is answering. Versioning is commit-based ecosystem-wide — no
     * release tags, one image per commit — so the SHA *is* the version, and this is
     * the only way a connected client learns it without SSH. `unknown` on a local run
     * or an image CI did not build; render that as "cannot say" rather than hiding the
     * row, since "no version shown" and "running something nobody can identify" are
     * different facts.
     */
    commit?: string
    turns: number
    max_turns: number
    /** Messages the brain is carrying — what silently grows until replies cost more. */
    history: number
    client_tools: string[]
  }
  limits?: { turns: number; window_s: number }
  peers?: {
    enabled: boolean
    last_ok?: string | null
    last_error?: string | null
    discovered?: number
    /** Never carries a credential — Amber projects these field by field. */
    known: { name: string; base_url?: string; version?: string; tools?: number }[]
  }
  sync?: {
    enabled: boolean
    last_ok?: string | null
    last_error?: string | null
    pending?: number
  }
  memory?: {
    facts?: number
    /** Counts that have always been one keyword argument away and never asked for. */
    forgotten?: number
    superseded?: number
    /**
     * Amber's fact lifecycle, so a countdown isn't computed from hardcoded numbers
     * that go quietly wrong on an install that tuned them.
     */
    policy?: {
      short_ttl_days: number
      session_ttl_hours: number
      promote_uses: number
      /** A short fact used this often stops decaying — but is still not durable. */
      decay_immune_uses: number
      /** Decay happens on the maintenance pass, not the instant a deadline passes. */
      pass_interval_s: number
    }
  }
  features?: Record<string, boolean>
  /**
   * The fleet as it stands at the handshake — the same `DeviceRecord` projection
   * `device_list` carries, and empty when `feature_device_control` is off.
   *
   * It rides this frame rather than adding a fifth handshake frame (the four-frame
   * handshake is asserted by a test server-side). It matters because a client only
   * starts receiving `device_list` broadcasts once it has *announced*: the registry
   * iterates registered devices, so this is the one and only fleet a pure controller
   * would ever see. Seed from here, then let `device_list` replace it wholesale.
   */
  devices?: DeviceRecord[]
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
  /**
   * Present when this is a **device action** rather than a tool we declared via
   * `register_tools`: `name` is then the dotted `{extensionId}.{action}` key this
   * device announced, and `device_id` is us.
   *
   * Route on this key, never on the shape of `name`. The two name sets genuinely
   * cannot overlap — Amber's sanitizer strips `.` and forces a `client_` prefix —
   * but that rule lives in her repo and could change without us noticing. One
   * explicit field cannot drift.
   */
  device_id?: string
}

/** How Amber sounds. Every field is the *effective* value, post-validation. */
export interface VoiceSettings {
  model: string
  voice: string
  /** Container of the synthesized bytes — the same value `audio_chunk` carries. */
  format: string
  /** 0.25–4.0. See `nativeSpeedModels` for what it means on a given model. */
  speed: number
  /** Prose direction for the voice. Only the `gpt-4o-*` models act on it. */
  instructions: string
}

/** What this Amber accepts. Sent so a picker needn't ship its own copy. */
export interface VoiceOptions {
  voices: string[]
  models: string[]
  formats: string[]
  /** `[min, max]`. */
  speed_range: [number, number]
  /** Models where `speed` reaches the API; elsewhere it becomes a pacing instruction. */
  native_speed_models: string[]
  /** Models that accept `instructions` at all. */
  instruction_models: string[]
}

/**
 * The voice settings in effect on this connection.
 *
 * Sent once immediately after `ready`, and again as the acknowledgment of every
 * `set_voice`. It is the *only* truth about what the next sentence will sound like:
 * Amber validates and clamps a patch, so echoing back what you sent would be a lie
 * whenever it didn't survive. `locked` means `AMBER_FEATURE_VOICE_CONTROL` is off
 * and `set_voice` is being ignored — show the values, disable the controls.
 */
export interface VoiceFrame {
  type: 'voice'
  settings: VoiceSettings
  options?: VoiceOptions
  locked?: true
}

/** One way of describing the model you want, and where it currently points. */
export interface ModelKeyword {
  /** Lowercase, no slash — `coding`, `fast`, `sql`. */
  name: string
  /** The OpenRouter id it resolves to right now. */
  model: string
  /** What it would resolve to untouched. Null for a keyword this install invented. */
  default_model: string | null
  /** What the keyword is *for*. Empty for a custom one. */
  description: string
  /** Invented on this install rather than shipped with Amber. */
  custom: boolean
  /** `model` differs from `default_model`, so a reset is a meaningful offer. */
  overridden: boolean
  /**
   * The sync store has this row, so every other app resolves the keyword the same
   * way. False while a change is still queued — an unreachable store is a normal
   * state, not an error, and this is the difference between "shared" and "mine".
   */
  shared: boolean
}

/** How this Amber stands with the ecosystem's shared keyword table. */
export interface ModelSyncStatus {
  /** A sync store is configured and `AMBER_FEATURE_MODEL_SYNC` is on. */
  enabled: boolean
  /** ISO-8601 of the last successful reconciliation, or null. */
  last_ok?: string | null
  /** Why the last attempt failed, or null. Present alongside a stale `last_ok`. */
  last_error?: string | null
  /** Local changes not yet accepted by the store. */
  pending?: number
}

/** Which brain answers on this connection. */
export interface ModelSettings {
  /** The keyword in effect — this connection's, or the server's default. */
  keyword: string
  /** What it resolves to. The only field that names an actual model. */
  model: string
  /** `AMBER_LLM_TIER`. Shown as "Amber's own choice". */
  default_keyword: string
  /**
   * Whether this *connection* picked the keyword.
   *
   * Not cosmetic: `chosen: false` with `keyword: 'balanced'` means "following the
   * server", and it should keep following if the box's config changes. The resolved
   * values are identical in both states, so nothing else can tell them apart.
   */
  chosen: boolean
}

/** Every keyword this Amber knows. Sent so a picker needn't ship its own copy. */
export interface ModelOptions {
  default_keyword: string
  keywords: ModelKeyword[]
  /** Which keyword each kind of model call uses. Only `brain` is per-connection. */
  roles: { brain: string; memory: string; maintenance: string }
  /** Whether re-pointing a keyword here reaches the rest of the ecosystem. */
  sync?: ModelSyncStatus
}

/**
 * The brain in effect on this connection, and the catalogue behind it.
 *
 * Sent once right after `voice`, and again as the acknowledgment of every
 * `set_model` — the same discipline, for the same reason: Amber validates what it is
 * handed and drops what fails, so this frame rather than the request is the truth
 * about which model answers the next turn. `locked` means
 * `AMBER_FEATURE_MODEL_CONTROL` is off; show the values, disable the controls.
 */
export interface ModelFrame {
  type: 'model'
  settings: ModelSettings
  options?: ModelOptions
  locked?: true
}

/** Which of Amber's four brokers served a tool call. */
export type ActivityOrigin =
  /** Amber's own in-process tools. */
  | 'own'
  /** A tool *this device* declared with `register_tools`. */
  | 'client'
  /** `expect_reply` — a back-channel flag, not work. */
  | 'signal'
  /** A peer MCP server, e.g. `peer:bloom`. */
  | `peer:${string}`

/**
 * One tool call, reported as it starts and again as it finishes.
 *
 * **Not `tool_call`.** That frame is a *request* — Amber asking this client to run
 * one of its own tools, and blocking until a `tool_result` comes back. This one is a
 * *report* about work Amber is doing herself, and nothing is owed in reply. The two
 * would be easy to merge and the UI would then look like it had an unanswered
 * obligation on every web search.
 *
 * Render on `start` and patch on `end`, correlating by `id` — do not wait for a
 * completed pair. A peer call may legitimately run for minutes, so waiting would
 * hide exactly the calls worth watching for exactly as long as they were
 * interesting.
 *
 * **An interrupted call never gets its `end`.** Amber deliberately emits nothing on
 * the cancellation path: it also runs when the connection is closing, so the socket
 * may already be gone, and it sits between the user interrupting and Amber listening
 * again. Treat a call still open at `turn_complete` as interrupted — this client is
 * the one that sent the `interrupt`, so it already knows.
 */
export interface ActivityFrame {
  type: 'activity'
  /** Correlates the `start` with its `end`. */
  id: string
  phase: 'start' | 'end'
  /** The name the model called, prefixed by convention — see `ActivityOrigin`. */
  name: string
  origin: ActivityOrigin
  /** Arguments, each string value clamped for display. `start` only. */
  input?: Record<string, unknown>
  /** Whether the tool only reads. Absent when Amber didn't say. `start` only. */
  read_only?: boolean
  /** The result, clamped to a preview. The model got the whole thing. `end` only. */
  result?: string
  /** Amber's own heuristic (the result didn't start with "Error"). `end` only. */
  ok?: boolean
  /** Wall-clock duration in ms. `end` only. */
  ms?: number
}

/**
 * Raw reply text as the model produced it, before the sentence splitter.
 *
 * The text peer of `audio_chunk`. Sentences are the *speech* view of a reply and
 * arrive whole, so concatenating them means guessing the whitespace between —
 * newlines, headings, lists and fences are gone by the time they'd reach the DOM.
 * This is the same reply with the model's own whitespace intact, and it is what
 * makes rendering markdown possible.
 *
 * **Render one or the other, never both.** Prefer deltas when any arrive; fall back
 * to joining `audio_chunk.text` otherwise, which is what keeps this additive against
 * an Amber that predates it.
 *
 * Two notes on pacing, because the obvious assumption is wrong. Synthesis applies
 * backpressure all the way up the stream, so text does *not* race ahead of speech —
 * it leads by about one sentence and then waits. And on a barge-in the last
 * sentence's text is on the wire while its audio never was, so anything past the
 * final `audio_chunk` is written-but-unspoken.
 */
export interface DeltaFrame {
  type: 'delta'
  text: string
}

/** What sort of unprompted thing a `PushFrame` is. Route on this, not on `text`. */
export type PushKind =
  /** A reminder whose time arrived. `ref.reminder_id` points at the row. */
  | 'reminder'
  /** A note Amber's maintenance pass wrote about how conversations are going. */
  | 'reflection'
  /** Generic, submitted by another service through Amber's `POST /push`. */
  | 'notice'
  /** Something finished at a peer — a Bloom build, say. */
  | 'peer_event'

/**
 * Amber, unprompted — the only frame in this protocol she originates herself.
 *
 * Every other server frame answers something we did. This one doesn't, and three
 * consequences follow that no other frame has.
 *
 * **It is durable.** `memory`, `activity` and `delta` describe a turn in progress, so
 * missing one costs nothing that outlives the turn. A push is held in an outbox until a
 * client exists, because a reminder due while the app was closed still has to arrive.
 * Pending ones are delivered right after the handshake.
 *
 * **Delivery is at-least-once and `id` is stable.** If Amber sends one and restarts
 * before recording that she did, the same `id` arrives again on the next connect. So
 * **dedupe on `id`** — treating each frame as a new event will show duplicates.
 *
 * **It never arrives mid-turn.** Amber holds pushes until the connection is idle, so
 * one can't land between an `audio_chunk` and its bytes. Nothing to handle; it just
 * means a push can lag a due time by a few seconds while she's talking.
 */
export interface PushFrame {
  type: 'push'
  /** Stable across redeliveries. Dedupe on this. */
  id: string
  kind: PushKind
  text: string
  /** Short heading, when the sender gave one. */
  title?: string
  /** When Amber queued it — which may be well before it was delivered. */
  created_at?: string
  /** The row behind it, so an ack can act on the thing rather than dismiss a card. */
  ref?: { reminder_id?: number; reflection_id?: number; [key: string]: unknown }
}

/**
 * Amber is about to run a tool that needs a person to say yes, and is blocked until
 * one does.
 *
 * A *request*, like `tool_call` — we owe exactly one `confirm_response` carrying this
 * `id`. Unlike `tool_call` the obligation is a human's, so this belongs in front of
 * someone rather than in a log.
 *
 * **Silence is a refusal.** Not answering doesn't leave the turn hanging: Amber times
 * out and tells the model the call wasn't approved. So a dialog that is dismissed, or
 * a window that was never looked at, fails safe — but it also means an answer given
 * long after the fact is discarded rather than belatedly running something.
 */
export interface ConfirmRequestFrame {
  type: 'confirm_request'
  /** Correlates with the `confirm_response` we send back. */
  id: string
  /** The tool name as the model called it, prefixed by convention. */
  name: string
  /** Who is asking — same vocabulary as `activity`, so we can say "Bloom wants to…". */
  origin: ActivityOrigin
  /** The arguments the model produced. Show these; they are what is being approved. */
  input?: Record<string, unknown>
}

/** Per-tool reliability over a window. One row per tool, worst first. */
export interface ToolHealth {
  name: string
  calls: number
  errors: number
  /** 0..1. Calls with a recorded failure count against it; unknown outcomes don't. */
  ok_rate: number
  /** Nearest-rank, matching what the MCP usage layer reports for its own table. */
  p50_ms: number
  p95_ms: number
  max_ms: number
}

/** One self-review note from the maintenance pass. */
export interface Reflection {
  id: number
  note: string
  created_at: string
  /** The telemetry window it was drawn from — written since day one, shown nowhere. */
  period_start?: string | null
  period_end?: string | null
  kind?: string
  dismissed?: number
}

/** A turn that went wrong, kept so it can be replayed. */
export interface EvalCase {
  id: number
  query: string
  expect_tool?: string | null
  got_tool?: string | null
  note?: string | null
  reply?: string | null
  created_at: string
  status: string
}

/**
 * How Amber is doing. Answers a `review_query`.
 *
 * One frame for three panels, shaped like `memory` because it is the same kind of
 * thing: a browse with a couple of verbs on what comes back. Everything in it has
 * always been recorded and shown to nobody — tool latency fed one LLM prompt, the
 * reflections needed an MCP key to read, and eval cases had nowhere to live.
 *
 * Advisory: a client that ignores it loses three panels, not a turn.
 */
export interface ReviewFrame {
  type: 'review'
  topic: 'tools' | 'reflections' | 'evals'
  items: ToolHealth[] | Reflection[] | EvalCase[]
  /** Window start for `tools`, so the board can say what it is a slice of. */
  since?: string
  /** Settles a `review_action`. Present even when it was refused. */
  ack?: { action: string; id: number; ok: boolean; detail?: string }
}

/**
 * One thing a device says it can do.
 *
 * `action` is the dotted `{extensionId}.{action}` key — the same string that comes
 * back as `ToolCallFrame.name` when Amber asks for it.
 *
 * **`destructive` is the load-bearing field.** It is declared once, here, by the
 * device that implements the action, and it drives two separate gates: Amber offers
 * a destructive action only through her confirmation-gated `device_power` tool, and
 * we prompt locally before running one. Neither side holds a list of dangerous
 * action names, so a new destructive capability is gated the day it ships.
 */
export interface DeviceCapability {
  action: string
  description?: string
  destructive?: boolean
  input_schema?: Record<string, unknown>
  /** How the declaring device would like this drawn. Amber carries it opaquely; a
   *  client that doesn't understand it infers from `input_schema` instead. */
  control?: Record<string, unknown>
}

/** A device Amber can currently reach. Never carries a session id — see `DeviceListFrame`. */
export interface DeviceRecord {
  device_id: string
  name: string
  platform: string
  version?: string
  capabilities: DeviceCapability[]
  /** Epoch seconds, server clock. */
  last_seen?: number
}

/**
 * Who is reachable right now, and what each can do.
 *
 * Arrives in answer to our own `device_announce`, and unprompted when the set changes
 * — Amber holds the broadcast until a connection is between turns, so a device that
 * appears mid-sentence shows up a moment late rather than corrupting the audio stream.
 * Advisory: ignoring it costs a panel, not a turn.
 *
 * Deliberately carries **no session id**. A session id is a resume credential, and
 * this frame goes to every client, so one here would hand over another conversation.
 */
export interface DeviceListFrame {
  type: 'device_list'
  devices: DeviceRecord[]
}

/**
 * The outcome of a `device_control_request` — the non-agentic path.
 *
 * No model call happened. This is the tap-a-button route, and it exists so a volume
 * slider doesn't cost an LLM round trip; it lands on the same dispatch Amber's own
 * `device_control` tool does, so clicking and asking can never drift apart.
 */
export interface DeviceControlResponseFrame {
  type: 'device_control_response'
  /** Echoes the `id` we sent on the request. */
  id: string
  ok: boolean
  device_id?: string
  action?: string
  /** What the device said it did. Present on success. */
  result?: string
  /** Machine-readable failure. Present instead of `result` when `ok` is false. */
  error?: DeviceError
}

export type DeviceError =
  | 'disabled'
  | 'unknown_device'
  | 'device_offline'
  | 'unsupported_action'
  | 'timeout'
  | 'action_failed'

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
  | ActivityFrame
  | DeltaFrame
  | StatusFrame
  | VoiceFrame
  | ModelFrame
  | PushFrame
  | ConfirmRequestFrame
  | ReviewFrame
  | DeviceListFrame
  | DeviceControlResponseFrame
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
  /**
   * Change how Amber sounds, for this connection only. A **patch**: send just the
   * keys you want to change, and `null` for a field that should go back to the
   * server's own configured default. Anything Amber doesn't recognise is dropped
   * silently and out-of-range values are clamped, so never assume it took — read the
   * `voice` frame that comes back. Held on the session, not persisted, so re-send on
   * every `ready`, like `register_tools`.
   */
  | {
      type: 'set_voice'
      voice?: string | null
      model?: string | null
      format?: string | null
      speed?: number | null
      instructions?: string | null
    }
  /**
   * Choose the brain, and/or say what a keyword means.
   *
   * Two scopes in one frame, deliberately separate. `keyword` is **this connection**
   * — held on Amber's session like the voice, so re-send it on every `ready`; `null`
   * hands the choice back to the server's `AMBER_LLM_TIER`. `map` is **the whole
   * install** and outlives the socket: it is written to Amber's database and pushed
   * to the sync store, so every app in the ecosystem resolves the keyword the same
   * way. A `null` value in the map resets that keyword to Amber's built-in default.
   *
   * The map is applied before the keyword, so one frame can invent a keyword and
   * select it. Anything invalid is dropped silently — read the `model` frame that
   * comes back rather than assuming a value took.
   */
  | {
      type: 'set_model'
      keyword?: string | null
      map?: Record<string, string | null>
    }
  /**
   * Curate one remembered fact.
   *
   * Lands on the same store functions Amber's own `forget_fact` / `correct_fact`
   * tools call, so a fact forgotten by asking and one forgotten by clicking end up
   * as the same row in the same state. Deletion is **soft** server-side, which is
   * what makes `restore` a real undo rather than a button that lies.
   *
   * `correct` supersedes rather than overwrites: the old row survives, marked and
   * pointing at its replacement. Answered with a `memory` frame carrying `ack` —
   * including on refusal, so a panel is never left guessing whether a click landed.
   */
  | {
      type: 'memory_action'
      action: 'forget' | 'restore' | 'correct'
      id: number
      /** Required for `correct`, ignored otherwise. */
      content?: string
    }
  /**
   * Browse or search everything Amber remembers.
   *
   * Distinct from the per-turn `memory` frame, which is only what *this* turn drew
   * on. Without this a fact could only be deleted on a turn that happened to
   * retrieve it. Answered with a `memory` frame carrying `scope: 'browse'`.
   */
  | {
      type: 'memory_query'
      q?: string | null
      limit?: number
      /** `lineage` needs `id`; `archive` takes none. Absent means the usual browse. */
      scope?: 'lineage' | 'archive'
      id?: number
    }
  /**
   * Acknowledge a `push`. Optional — Amber settles the outbox on a successful send,
   * so a client that never acks still receives everything exactly once in practice.
   *
   * `action` is what the person did. `complete` is the one that changes anything
   * beyond the notification: it resolves the push's `ref` and calls the same store
   * function `complete_reminder` does, so a reminder ticked off here and one ticked
   * off by asking Amber are the same row. No acknowledgment comes back.
   */
  | { type: 'push_ack'; id: string; action?: 'seen' | 'dismiss' | 'complete' }
  /**
   * Answer a `confirm_request`. `id` **must** be the one from the request or Amber
   * drops it silently, and it must arrive within `confirm_timeout_s` (60s) — after
   * that the call has already been refused and a late yes does nothing.
   *
   * Not answering is equivalent to `approved: false`. Send it anyway when the user
   * actually declines: a refusal tells the model not to raise it again, where a
   * timeout tells it to ask.
   */
  | { type: 'confirm_response'; id: string; approved: boolean }
  /**
   * Ask how Amber is doing. Answered with a `review` frame carrying the same topic.
   * `since` is an ISO timestamp for the `tools` window; omitted, the server uses its
   * configured default.
   */
  | {
      type: 'review_query'
      topic: 'tools' | 'reflections' | 'evals'
      since?: string
      limit?: number
    }
  /**
   * Act on one reviewed item. `promote` turns a reflection into a durable fact — which
   * is the whole reason `AMBER_FEATURE_SELF_NOTES` can stay off: the note is kept
   * because *a person* chose to keep it, not because the model edited its own prompt.
   * Answered with a `review` frame carrying `ack`.
   */
  | {
      type: 'review_action'
      topic: 'tools' | 'reflections' | 'evals'
      action: 'promote' | 'dismiss' | 'archive'
      id: number
    }
  /**
   * Save the turn you are looking at as a regression case.
   *
   * Carries the whole case rather than a pointer into Amber's exchange log: that table
   * has no session id and pairs user with assistant positionally, so a reference into
   * it could quietly come to mean a different conversation. Answered with a `review`
   * frame for the `evals` topic.
   */
  | {
      type: 'eval_capture'
      query: string
      expect_tool?: string
      got_tool?: string
      note?: string
      reply?: string
    }
  /**
   * Declare this machine as a device Amber can address by name.
   *
   * Distinct from `register_tools`, and the difference is the whole point.
   * `register_tools` says "here are tools to offer the model on *this* conversation";
   * this says "here is a machine, it persists, and another client may drive it". So
   * these names are **not** sanitized or `client_`-prefixed and are **not** counted
   * against the 16-tool cap — they arrive back as a `tool_call` carrying `device_id`.
   *
   * Idempotent: re-announcing replaces the record, which is why there is no separate
   * refresh frame. Amber holds the registration on the connection, not the session, so
   * re-send this on every `ready` exactly like `register_tools`.
   */
  | {
      type: 'device_announce'
      /** Stable across restarts. Ours lives in `device.json`, minted once. */
      device_id: string
      name: string
      platform: string
      version?: string
      capabilities: DeviceCapability[]
    }
  /**
   * Drive a device directly — no model call, no latency, no tokens.
   *
   * The non-agentic half of device control: what a tap on the Devices panel sends.
   * It reaches the same dispatch Amber's own `device_control` tool does, the way
   * `memory_action` reaches the same store functions her `forget_fact` tool does, so
   * there is one implementation of "tell a device to do something" rather than two
   * that can drift.
   *
   * Answered with `device_control_response` carrying this `id`. A destructive action
   * is **not** routed through `confirm_request` here — a tap is already deliberate, and
   * re-asking for something just clicked trains people to approve without reading. The
   * confirmation lives on the conversational path, and locally on the target device.
   */
  | {
      type: 'device_control_request'
      /** Ours to mint; echoed back on the response. */
      id: string
      device_id: string
      /** The dotted `{extensionId}.{action}` key, as announced. */
      action: string
      args?: Record<string, unknown>
    }

// --- narrowing helpers ------------------------------------------------------

const SERVER_FRAME_TYPES = new Set<ServerFrame['type']>([
  'ready',
  'transcript',
  'thinking',
  'audio_chunk',
  'turn_complete',
  'memory',
  'tool_call',
  'activity',
  'delta',
  'status',
  'voice',
  'model',
  // Miss an entry here and the frame is dropped at the socket with no error anywhere
  // — `isServerFrame` is the gate, and an unlisted type simply isn't one.
  'push',
  'confirm_request',
  'review',
  'device_list',
  'device_control_response',
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
