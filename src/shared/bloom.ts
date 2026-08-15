/**
 * Bloom's vocabulary: the link Aperture holds to it, and the shapes its API speaks.
 *
 * A fifth shared file rather than more of `types.ts`, because that file is the IPC
 * vocabulary and this is one backend's domain. `protocol.ts` was not an option — it
 * is a translation of Amber's `app/protocol.py` and adding anything local to it
 * would break the rule that says the Python module is the source of truth.
 *
 * Compiled by both tsconfig projects, so nothing here may touch `window`,
 * `localStorage` or any DOM type.
 *
 * The API shapes are a mirror of Bloom's `docs/openapi.json`, and that file is the
 * source of truth in the same way Amber's protocol module is: if the two disagree,
 * this one is wrong. Bloom evolves them additively, so an unknown field is dropped
 * rather than treated as an error.
 */

// --- the link ---------------------------------------------------------------

/**
 * Docker's own vocabulary for a container that exists, in any condition.
 *
 * Membership, never `!== 'missing'`: this list used to be that test, and one
 * unexpected string from the far end silently reported a container on a box that
 * had none. Lifted out of `renderer/infra/AppCard.tsx` when Bloom needed the same
 * predicate — two copies of this is the same bug with a delay fuse.
 */
export const CONTAINER_STATES = [
  'running',
  'restarting',
  'paused',
  'exited',
  'created',
  'dead',
  'removing',
]

export function containerExists(state: string): boolean {
  return CONTAINER_STATES.includes(state.trim())
}

/**
 * Where Aperture stands with Bloom.
 *
 * The tab's visibility keys off holding a *record* — anything but `unlinked` — not
 * off Bloom being up. Hiding the tab when the container stops would make an outage
 * look like an uninstall and put the fix somewhere the user can no longer reach.
 * Container state is informational; the panel says what is wrong, the tab stays.
 *
 * `probing` is carried on events and held in the renderer, and is deliberately
 * never persisted: a crash mid-probe must not leave a file claiming a probe is
 * still running.
 */
export type BloomLinkState =
  | 'unlinked'
  | 'probing'
  | 'linked'
  | 'unreachable'
  | 'unauthorized'

/**
 * Flat on purpose. `JsonStore` merges one level over its defaults, so a nested
 * object written by an older build arrives partial, casts as complete, and `strict`
 * never sees it. `Settings` is flat for the same reason.
 */
export interface BloomLink {
  /** The SSH server it was discovered on. Null for a manually entered link. */
  serverId: string | null
  /** No trailing slash. Empty until linked. */
  baseUrl: string
  state: BloomLinkState
  /** Docker's state at the last SSH probe. Informational — it gates nothing. */
  container: string | null
  lastProbedAt: number | null
  lastCheckedAt: number | null
  /** Why it isn't `linked`, when it isn't. A sentence, not a code. */
  detail: string | null
  /**
   * Whether a token is actually readable from the vault right now.
   *
   * Derived on every read, never persisted. A stored `true` against a vault that
   * cannot decrypt — the documented different-OS-account case — would be a tab that
   * can never work and never explains why.
   */
  hasToken: boolean
}

export const EMPTY_BLOOM_LINK: BloomLink = {
  serverId: null,
  baseUrl: '',
  state: 'unlinked',
  container: null,
  lastProbedAt: null,
  lastCheckedAt: null,
  detail: null,
  hasToken: false,
}

// --- errors -----------------------------------------------------------------

/**
 * Bloom's own error codes, plus one of ours.
 *
 * `transport` means the request never reached Bloom — DNS, TCP, TLS, timeout, or a
 * gateway answering in its own voice. It is not a Bloom code and must never be
 * invented from a status alone, because the distinction is what decides whether the
 * *link* is demoted or only the call failed.
 */
export type BloomErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'unavailable'
  | 'transport'

// --- agents -----------------------------------------------------------------

export interface AgentConfig {
  id: string
  slug: string
  name: string
  systemPrompt: string
  modelTier: string
  /**
   * Attached connection ids, in broker order.
   *
   * Ids only. What each one *is* comes from `bloom.agentConnections(id)` — an
   * agent row says what it has, not a second copy of the library.
   */
  connections: string[]
  /** Null means "use Bloom's own ceiling". A config may lower it, never raise it. */
  maxSteps: number | null
  maxCostUsd: number | null
  createdAt: string
  updatedAt: string
}

/**
 * What a create or patch may set. Everything optional; a patch omits what it leaves.
 *
 * Note what is absent: nothing about what the agent can reach. Bloom refuses an
 * unknown field outright rather than ignoring it, so sending the old `mcpServers`
 * is a 422 naming the field rather than an agent that silently reaches nothing.
 */
export interface AgentConfigInput {
  slug?: string
  name?: string
  systemPrompt?: string
  modelTier?: string
  maxSteps?: number | null
  maxCostUsd?: number | null
}

/** Bloom's named tiers. A literal `vendor/model` id is also accepted. */
export const MODEL_TIERS = ['cheap', 'balanced', 'strong']

/** Bloom's own rule, mirrored so a bad slug is caught before the round trip. */
export const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

// --- runs -------------------------------------------------------------------

export type RunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  /** The Bloom process restarted mid-run. Say that, rather than the bare word. */
  | 'abandoned'

/** `test_run` is you. `mcp` is another agent — `caller` names which. */
export type RunOrigin = 'mcp' | 'test_run'

export interface RunSummary {
  id: string
  agentConfigId: string
  /** Joined by Bloom. Null when the config has since been deleted. */
  agentSlug: string | null
  conversationId: string
  depth: number
  origin: RunOrigin
  caller: string
  status: RunStatus
  prompt: string
  resultText: string | null
  /** Set when a ceiling stopped the run, which means the answer is truncated. */
  stoppedBy: string | null
  /** A floor, not a total — see `USAGE_CAVEAT`. */
  totalCostUsd: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

/**
 * One entry in a run's trace.
 *
 * The first six kinds are Bloom's. The last two are ours, and the distinction they
 * carry is load-bearing: a stream dying is not a run failing. The run continues on
 * the server and its outcome is still readable from the trace endpoint — the stream
 * is a view, the run is the fact.
 */
export type BloomRunEventKind =
  | 'run_started'
  | 'text'
  | 'tool_started'
  | 'tool_finished'
  | 'step_finished'
  | 'run_finished'
  | 'stream_lost'
  | 'stream_resumed'

export interface BloomRunEvent {
  /** Bloom's autoincrement id, which is also the SSE resume cursor. */
  id: number
  runId: string
  kind: BloomRunEventKind
  at: string
  stepIndex: number | null
  toolName: string | null
  ok: boolean | null
  latencyMs: number | null
  tokensIn: number | null
  tokensOut: number | null
  costUsd: number | null
  payload: Record<string, unknown>
}

export interface RunTrace {
  run: RunSummary
  events: BloomRunEvent[]
}

export interface TestRunStarted {
  runId: string
  status: string
  /** Relative to the base URL — join, don't use directly. */
  streamUrl: string
  traceUrl: string
}

// --- connections ------------------------------------------------------------
//
// One vocabulary for everything an agent can act through. There used to be two —
// a free-text `mcpServers` list on the agent row and a set of OAuth connections
// *owned* by it — so a peer could not carry a credential, a credential could not
// be shared, and an API key was not expressible at all.
//
// A connection is a library entry. Creating one from an agent's page attaches it;
// the row itself belongs to no one, and deleting an agent deletes none of them.

export type ConnectionStatus =
  | 'pending'
  | 'active'
  | 'expired'
  | 'needs_reauth'
  | 'revoked'

/** Where a connection's secret comes from. `mcp` is a peer server, not a credential. */
export type ConnectionKind = 'oauth' | 'api_key' | 'mcp'

export interface Connection {
  id: string
  kind: ConnectionKind
  /** Manifest name for oauth/api_key. Null for a peer, which has a URL instead. */
  provider: string | null
  /** Stable handle. For `mcp` this is also the tool namespace: `<name>__<tool>`. */
  name: string
  label: string
  status: ConnectionStatus
  /** Non-secret settings: `url` for a peer, `client_id` for an OAuth app. */
  config: Record<string, unknown>
  /**
   * Whether a secret is stored — never the value, which no Bloom route returns.
   * `hasSecret` is the user's credential; `hasClientSecret` is the app's.
   */
  hasSecret: boolean
  hasClientSecret: boolean
  scopes: string[]
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
  /** Which agents currently use it — what makes deleting one an informed choice. */
  agentIds: string[]
  /**
   * What attaching this actually gives an agent. For a provider it is the exact
   * scope-filtered set the runner would register; for a peer, the namespace glob
   * until `testConnection` connects and returns the real list.
   */
  tools: string[]
}

/** What creating a connection takes. Secrets are write-only and never come back. */
export interface ConnectionDraft {
  kind: ConnectionKind
  provider?: string | null
  name?: string
  label?: string
  config?: Record<string, unknown>
  scopes?: string[]
  secret?: string
  clientId?: string
  clientSecret?: string
  attachTo?: string[]
}

export interface ProviderInfo {
  name: string
  displayName: string
  /** Which kinds of connection can hold a credential for this provider. */
  auth: ConnectionKind[]
  /**
   * Whether *this deployment* carries client credentials for the provider.
   *
   * A hint, not a gate. It used to be one: client credentials lived only in the
   * process environment, so connecting a provider meant editing `secrets.yaml` on
   * the box and restarting — a deployment operation standing in front of something
   * a user should be able to do from a form. A connection may now carry its own,
   * and those win. This only says whether the form can prefill instead of asking.
   */
  hasDeploymentDefault: boolean
  /** Names, never values. They are public — committed in the provider's manifest. */
  clientIdEnv: string
  clientSecretEnv: string
  scopesDefault: string[]
  /** Present when the provider accepts a pasted key: what to call the box, and help. */
  apiKey: { label: string; help: string } | null
  operations: string[]
  docsUrl: string
}

/** A kind this build offers, and why not when it does not. */
export interface KindAvailability {
  kind: ConnectionKind
  available: boolean
  reason: string
}

/** Built from the wire so a picker cannot ship a list that drifts from the server. */
export interface ConnectionKinds {
  kinds: KindAvailability[]
  providers: ProviderInfo[]
  /** Peers the sync store knows about, to prefill a URL. Never used at run time. */
  discoveredPeers: { name: string; baseUrl: string }[]
}

/** What a test told us, and — importantly — which test it was. */
export interface ProbeResult {
  ok: boolean
  /** `token` = it decrypts. `request` = the provider accepted it. `session` = a peer answered. */
  checked: 'token' | 'request' | 'session'
  status: number | null
  detail: string
  tools: string[]
}

export interface OAuthStart {
  authorizeUrl: string
  state: string
  expiresAt: string
  scopes: string[]
  redirectUri: string
}

/** Bloom's rule for a connection name, mirrored so a bad one is caught early. */
export const CONNECTION_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,23}$/

export const CONNECTION_KINDS: ConnectionKind[] = ['oauth', 'api_key', 'mcp']

/** What each kind is, in the words the picker shows. */
export const KIND_LABELS: Record<ConnectionKind, { title: string; blurb: string }> = {
  oauth: {
    title: 'Connected account',
    blurb: 'Approve in the browser. Bloom keeps the token fresh.',
  },
  api_key: {
    title: 'API key',
    blurb: 'Paste a key. Same tools, no browser step.',
  },
  mcp: {
    title: 'MCP server',
    blurb: 'A URL. Every tool that server exposes, namespaced.',
  },
}

// --- usage ------------------------------------------------------------------

export interface UsageReport {
  since: string | null
  runs: {
    runs: number
    costUsd: number
    succeeded: number
    failed: number
    cancelled: number
    running: number
    byAgent: Array<{ agent: string; runs: number; costUsd: number }>
  }
  models: {
    calls: number
    tokensIn: number
    tokensOut: number
    totalCostUsd: number
    byModel: Array<{ model: string; tier: string | null; calls: number; costUsd: number }>
  }
  /** Null — not zero — when Bloom's MCP server is not mounted. */
  tools: {
    totals: { calls: number; errors: number }
    byTool: Array<{ name: string; calls: number; errors: number }>
    byCaller: Array<{ caller: string; calls: number; errors: number }>
  } | null
  caveat: string
}

/**
 * Why every total Bloom reports is a floor.
 *
 * When a stop condition fires, `agent-runtime` makes one further completion that
 * appends no step, so its tokens reach neither the run's cost nor the usage tables.
 * Upstream behaviour, surfaced rather than hidden — label totals "at least".
 */
export const USAGE_CAVEAT =
  'A run stopped by a step or cost ceiling makes one further model call that the ' +
  'runtime does not report, so spend is a floor rather than a total.'
