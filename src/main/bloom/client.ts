import type {
  AgentConfig,
  AgentConfigInput,
  BloomErrorCode,
  BloomKeywords,
  Build,
  BuildStarted,
  Connection,
  ConnectionKinds,
  ConnectionSecretInput,
  OAuthStart,
  ProbeResult,
  RunSummary,
  RunTrace,
  TestRunStarted,
  UsageReport,
} from '../../shared/bloom'
import { describeFetchError } from '../net/fetch-error'
import {
  fromAgentInput,
  fromConnectionDraft,
  toAgentConfig,
  toAgentConfigs,
  toBuild,
  toBuildStarted,
  toBuilds,
  toConnection,
  toConnectionKinds,
  toConnections,
  toKeywords,
  toOAuthStart,
  toProbeResult,
  toRunEvents,
  toRunSummaries,
  toRunSummary,
  toTestRunStarted,
  toUsage,
} from './wire'

/**
 * Talking to Bloom over HTTP.
 *
 * **No new dependency.** Electron 33 runs Node 20 in main, so `fetch`,
 * `AbortSignal.timeout` and `ReadableStream` are global. The two runtime
 * dependencies this repo has both carry a comment justifying them by native
 * bindings Vite cannot trace; neither justification applies to an HTTP client, and
 * a global needs no import, so `externalizeDepsPlugin` has nothing to decide.
 *
 * **No Electron imports either**, like `amber/connection.ts` — so this can be
 * esbuilt and driven headlessly against a stub server. Credentials arrive as a
 * parameter; the vault is `link.ts`'s business.
 *
 * One caveat worth recording rather than solving: `fetch` here is Node's undici,
 * not Chromium's stack, so it ignores Electron's session proxy and certificate
 * settings and has no `setCertificateVerifyProc` escape hatch. Bloom sits behind
 * Caddy with real certificates, so this is fine; a self-signed instance would fail
 * with an opaque verification error. Everything goes through `request()`, so
 * swapping to `net.fetch` from Electron is a one-line change if that ever matters.
 */

export interface BloomTarget {
  /** No trailing slash. */
  baseUrl: string
  token: string
}

export type BloomResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: BloomErrorCode; status?: number }

/** Bloom's own envelope. Every error it authors has exactly this shape. */
interface ErrorEnvelope {
  error?: string
  message?: string
}

const BLOOM_CODES = new Set<string>([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'unprocessable',
  'unavailable',
])

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * One request, one place where an error becomes a sentence.
 *
 * Never throws. The distinction between a `transport` code and one of Bloom's is
 * load-bearing and is decided only here: `unauthorized` demotes the whole link,
 * `transport` marks it unreachable, and anything else is a single call failing while
 * the link stays fine. Inventing a Bloom code from a bare status would collapse all
 * three — which is why a body that is not Bloom's envelope becomes `transport`
 * regardless of what the status says. A 502 from Caddy is not Bloom speaking.
 */
export async function request<T>(
  target: BloomTarget,
  path: string,
  init: {
    method?: string
    body?: unknown
    timeoutMs?: number
    query?: Record<string, string | number | undefined>
  } = {},
): Promise<BloomResult<T>> {
  let url: URL
  try {
    // Path-relative, so a trailing slash on baseUrl is harmless either way.
    url = new URL(path.replace(/^\//, ''), `${target.baseUrl.replace(/\/+$/, '')}/`)
  } catch {
    return {
      ok: false,
      code: 'transport',
      error: `Not a valid Bloom address: ${target.baseUrl || '(empty)'}`,
    }
  }
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${target.token}`,
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    return {
      ok: false,
      code: 'transport',
      error: describeFetchError(err, {
        subject: 'Bloom',
        timeoutMs: init.timeoutMs,
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      }),
    }
  }

  if (response.status === 204) return { ok: true, value: undefined as T }

  const text = await response.text().catch(() => '')
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (response.ok) return { ok: true, value: parsed as T }

  const envelope = (parsed ?? {}) as ErrorEnvelope
  if (envelope.error && BLOOM_CODES.has(envelope.error) && envelope.message) {
    return {
      ok: false,
      code: envelope.error as BloomErrorCode,
      error: envelope.message,
      status: response.status,
    }
  }
  // Not Bloom's envelope, so not Bloom answering — a proxy, a gateway, or an
  // unauthenticated redirect to something else entirely.
  return {
    ok: false,
    code: 'transport',
    error: `Bloom's address answered with HTTP ${response.status}, but not in Bloom's voice. Something else may be serving it.`,
    status: response.status,
  }
}

export interface HealthReport {
  status: string
  service: string
  version: string
  database?: string
  agents?: number
}

/**
 * The cheapest possible "is it there, and does our token work".
 *
 * Shallow rather than `?deep=true`: this runs unattended at startup, and whether
 * Bloom's database opened is a question for the panel, not for deciding the link.
 */
export async function health(target: BloomTarget): Promise<BloomResult<HealthReport>> {
  return request<HealthReport>(target, '/health', { timeoutMs: 4_000 })
}

/**
 * Whether our token is actually accepted.
 *
 * `/health` is deliberately unauthenticated in Bloom — a load balancer has to reach
 * it — so it proves reachability and nothing about credentials. Listing agents is
 * the cheapest authenticated read, and its failure mode is exactly the one worth
 * distinguishing: 401 means the token is wrong, not that Bloom is down.
 */
export async function verifyToken(target: BloomTarget): Promise<BloomResult<unknown[]>> {
  return request<unknown[]>(target, '/admin/agents', { timeoutMs: 6_000 })
}

// --- the management surface -------------------------------------------------
//
// One function per endpoint, each mapping Bloom's spelling into ours on the way
// through. Nothing below decides anything about the *link* — that mapping lives in
// `link.ts::noteResult`, in one place, so a 404 on one agent can never be mistaken
// for the backend being down.

function map<T, U>(result: BloomResult<T>, fn: (value: T) => U): BloomResult<U> {
  return result.ok ? { ok: true, value: fn(result.value) } : result
}

export async function listAgents(target: BloomTarget): Promise<BloomResult<AgentConfig[]>> {
  return map(await request<unknown>(target, '/admin/agents'), toAgentConfigs)
}

export async function getAgent(
  target: BloomTarget,
  id: string,
): Promise<BloomResult<AgentConfig | null>> {
  return map(await request<unknown>(target, `/admin/agents/${encodeURIComponent(id)}`), toAgentConfig)
}

export async function createAgent(
  target: BloomTarget,
  input: AgentConfigInput,
): Promise<BloomResult<AgentConfig | null>> {
  const result = await request<unknown>(target, '/admin/agents', {
    method: 'POST',
    body: fromAgentInput(input as Record<string, unknown>),
  })
  return map(result, toAgentConfig)
}

export async function updateAgent(
  target: BloomTarget,
  id: string,
  input: AgentConfigInput,
): Promise<BloomResult<AgentConfig | null>> {
  const result = await request<unknown>(target, `/admin/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: fromAgentInput(input as Record<string, unknown>),
  })
  return map(result, toAgentConfig)
}

export async function deleteAgent(target: BloomTarget, id: string): Promise<BloomResult<void>> {
  return request<void>(target, `/admin/agents/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function startTestRun(
  target: BloomTarget,
  agentId: string,
  input: string,
): Promise<BloomResult<TestRunStarted | null>> {
  const result = await request<unknown>(
    target,
    `/admin/agents/${encodeURIComponent(agentId)}/test-run`,
    { method: 'POST', body: { input } },
  )
  return map(result, toTestRunStarted)
}

/**
 * Ask a run to stop.
 *
 * Bloom answers 202 and the *outcome* arrives on the trace as a normal
 * `run_finished`, so nothing here waits for it — a caller watching the stream needs
 * no special case for stopping.
 */
export async function cancelRun(target: BloomTarget, runId: string): Promise<BloomResult<unknown>> {
  return request<unknown>(target, `/admin/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  })
}

/** Every agent's runs, newest first — the activity feed. */
export async function listRuns(
  target: BloomTarget,
  params: { limit?: number; offset?: number; status?: string; origin?: string } = {},
): Promise<BloomResult<RunSummary[]>> {
  return map(await request<unknown>(target, '/admin/runs', { query: params }), toRunSummaries)
}

export async function listAgentRuns(
  target: BloomTarget,
  agentId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<BloomResult<RunSummary[]>> {
  const result = await request<unknown>(
    target,
    `/admin/agents/${encodeURIComponent(agentId)}/runs`,
    { query: params },
  )
  return map(result, toRunSummaries)
}

/**
 * A finished run's trace.
 *
 * Normalised into exactly the shape the live stream produces, so one component
 * renders both and the renderer never learns two vocabularies for one thing.
 */
export async function runTrace(
  target: BloomTarget,
  agentId: string,
  runId: string,
  after = 0,
): Promise<BloomResult<RunTrace | null>> {
  const result = await request<{ run?: unknown; events?: unknown }>(
    target,
    `/admin/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/trace`,
    { query: { after } },
  )
  return map(result, (value) => {
    const run = toRunSummary(value?.run)
    return run ? { run, events: toRunEvents(value?.events, runId) } : null
  })
}

// --- connections -------------------------------------------------------------
//
// The library is global: these are not scoped to an agent. Only the last two are,
// and they attach and detach rather than create and destroy.

export async function connectionKinds(
  target: BloomTarget,
): Promise<BloomResult<ConnectionKinds>> {
  return map(await request<unknown>(target, '/admin/connections/kinds'), toConnectionKinds)
}

export async function listConnections(
  target: BloomTarget,
  filters: { kind?: string; provider?: string; status?: string } = {},
): Promise<BloomResult<Connection[]>> {
  const result = await request<unknown>(target, '/admin/connections', { query: filters })
  return map(result, toConnections)
}

export async function createConnection(
  target: BloomTarget,
  draft: Record<string, unknown>,
): Promise<BloomResult<Connection | null>> {
  const result = await request<unknown>(target, '/admin/connections', {
    method: 'POST',
    body: fromConnectionDraft(draft),
  })
  return map(result, toConnection)
}

export async function updateConnection(
  target: BloomTarget,
  connectionId: string,
  patch: Record<string, unknown>,
): Promise<BloomResult<Connection | null>> {
  const result = await request<unknown>(
    target,
    `/admin/connections/${encodeURIComponent(connectionId)}`,
    { method: 'PATCH', body: patch },
  )
  return map(result, toConnection)
}

export async function deleteConnection(
  target: BloomTarget,
  connectionId: string,
  force = false,
): Promise<BloomResult<void>> {
  return request<void>(target, `/admin/connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
    // Without this a still-attached connection answers 409 naming the agents that
    // would lose it — which the UI renders as a confirmation, not an error.
    query: force ? { force: 'true' } : {},
  })
}

export async function setConnectionSecret(
  target: BloomTarget,
  connectionId: string,
  body: ConnectionSecretInput,
): Promise<BloomResult<Connection | null>> {
  const result = await request<unknown>(
    target,
    `/admin/connections/${encodeURIComponent(connectionId)}/secret`,
    { method: 'POST', body },
  )
  return map(result, toConnection)
}

export async function revokeConnection(
  target: BloomTarget,
  connectionId: string,
): Promise<BloomResult<Connection | null>> {
  const result = await request<unknown>(
    target,
    `/admin/connections/${encodeURIComponent(connectionId)}/revoke`,
    { method: 'POST', body: {} },
  )
  return map(result, toConnection)
}

export async function testConnection(
  target: BloomTarget,
  connectionId: string,
): Promise<BloomResult<ProbeResult>> {
  const result = await request<unknown>(
    target,
    `/admin/connections/${encodeURIComponent(connectionId)}/test`,
    { method: 'POST', body: {} },
  )
  return map(result, toProbeResult)
}

export async function startOAuth(
  target: BloomTarget,
  connectionId: string,
  scopes?: string[],
): Promise<BloomResult<OAuthStart | null>> {
  const result = await request<unknown>(
    target,
    `/admin/connections/${encodeURIComponent(connectionId)}/oauth/start`,
    { method: 'POST', body: scopes ? { scopes } : {} },
  )
  return map(result, toOAuthStart)
}

export async function agentConnections(
  target: BloomTarget,
  agentId: string,
): Promise<BloomResult<Connection[]>> {
  const result = await request<unknown>(
    target,
    `/admin/agents/${encodeURIComponent(agentId)}/connections`,
  )
  return map(result, toConnections)
}

export async function attachConnection(
  target: BloomTarget,
  agentId: string,
  connectionId: string,
): Promise<BloomResult<Connection[]>> {
  const result = await request<unknown>(
    target,
    `/admin/agents/${encodeURIComponent(agentId)}/connections`,
    { method: 'POST', body: { connection_id: connectionId } },
  )
  return map(result, toConnections)
}

export async function detachConnection(
  target: BloomTarget,
  agentId: string,
  connectionId: string,
): Promise<BloomResult<void>> {
  return request<void>(
    target,
    `/admin/agents/${encodeURIComponent(agentId)}/connections/${encodeURIComponent(connectionId)}`,
    { method: 'DELETE' },
  )
}

export async function usage(
  target: BloomTarget,
  since?: string,
): Promise<BloomResult<UsageReport | null>> {
  return map(await request<unknown>(target, '/admin/usage', { query: { since } }), toUsage)
}


// --- the builder ------------------------------------------------------------
//
// A build is a run, so there is nothing here for watching one: `startBuild` hands
// back a `runId` and `run-stream.ts` takes it from there, unchanged. What these add
// is the durable half — the agent that came out and the steps still outstanding.

export async function startBuild(
  target: BloomTarget,
  brief: string,
): Promise<BloomResult<BuildStarted | null>> {
  const result = await request<unknown>(target, '/admin/builder/build', {
    method: 'POST',
    body: { brief },
    // A build is minutes of work, but this call only starts it: Bloom answers 202
    // with the id and runs it in the background, so the default timeout is right.
  })
  return map(result, toBuildStarted)
}

export async function listBuilds(
  target: BloomTarget,
  options: { limit?: number; offset?: number; status?: string } = {},
): Promise<BloomResult<Build[]>> {
  const result = await request<unknown>(target, '/admin/builds', {
    query: { limit: options.limit, offset: options.offset, status: options.status },
  })
  return map(result, toBuilds)
}

export async function getBuild(
  target: BloomTarget,
  buildId: string,
): Promise<BloomResult<Build | null>> {
  return map(
    await request<unknown>(target, `/admin/builds/${encodeURIComponent(buildId)}`),
    toBuild,
  )
}

export async function markStepDone(
  target: BloomTarget,
  buildId: string,
  index: number,
): Promise<BloomResult<Build | null>> {
  const result = await request<unknown>(
    target,
    `/admin/builds/${encodeURIComponent(buildId)}/steps/${index}/done`,
    { method: 'POST' },
  )
  return map(result, toBuild)
}

export async function deleteBuild(
  target: BloomTarget,
  buildId: string,
): Promise<BloomResult<void>> {
  return request<void>(target, `/admin/builds/${encodeURIComponent(buildId)}`, {
    method: 'DELETE',
  })
}

/**
 * What a keyword like `coding` resolves to on this Bloom.
 *
 * Read-only: the shared table is Amber's to edit. This exists so the agent editor
 * can offer the real vocabulary instead of a hardcoded three, and say which entries
 * this box has actually picked up from the sync store.
 */
export async function listKeywords(
  target: BloomTarget,
): Promise<BloomResult<BloomKeywords>> {
  return map(await request<unknown>(target, '/admin/models/keywords'), toKeywords)
}
