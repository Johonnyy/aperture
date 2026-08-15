import { shell } from 'electron'

import type {
  AgentConfig,
  AgentConfigInput,
  BloomErrorCode,
  ConnectionInfo,
  ProviderInfo,
  RunSummary,
  RunTrace,
  UsageReport,
} from '../../shared/bloom'
import * as api from './client'
import { currentTarget, noteResult, type Emit } from './link'
import { closeRunStream, openRunStream } from './run-stream'

/**
 * The service layer between IPC and Bloom.
 *
 * Every function here does the same three things, which is why they live together
 * rather than being inlined into `ipc.ts`: resolve the current credentials, make the
 * call, and hand the outcome to `noteResult` so the link's state follows reality.
 * That last step is the one worth centralising — miss it in one handler and the
 * sidebar keeps claiming Bloom is fine while every request fails.
 *
 * Results are widened into the house `{ ok, ..., error? }` shape, with `code`
 * carried through. The code matters here in a way it does not for the SSH handlers:
 * the renderer genuinely has to tell a pruned run (`not_found`) from a Bloom that is
 * restarting (`unavailable`) from a slug that is taken (`conflict`).
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code: BloomErrorCode }

function unlinked<T>(): Result<T> {
  return {
    ok: false,
    code: 'unavailable',
    error: 'Bloom is not linked. Link it from the Servers tab, or in Settings.',
  }
}

/** Resolve credentials, call, and let the outcome move the link's state. */
async function call<T>(
  emit: Emit,
  fn: (target: api.BloomTarget) => Promise<api.BloomResult<T>>,
): Promise<Result<T>> {
  const target = currentTarget()
  if (!target) return unlinked<T>()
  const result = await fn(target)
  noteResult(emit, result)
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: result.error, code: result.code }
}

// --- agents -----------------------------------------------------------------

export const listAgents = (emit: Emit): Promise<Result<AgentConfig[]>> =>
  call(emit, (t) => api.listAgents(t))

export const createAgent = (emit: Emit, input: AgentConfigInput): Promise<Result<AgentConfig | null>> =>
  call(emit, (t) => api.createAgent(t, input))

export const updateAgent = (
  emit: Emit,
  id: string,
  input: AgentConfigInput,
): Promise<Result<AgentConfig | null>> => call(emit, (t) => api.updateAgent(t, id, input))

export const deleteAgent = (emit: Emit, id: string): Promise<Result<void>> =>
  call(emit, (t) => api.deleteAgent(t, id))

// --- runs -------------------------------------------------------------------

/**
 * Start a run and immediately begin watching it.
 *
 * Bloom answers 202 with the run id *before* the run finishes, which is the whole
 * reason that endpoint is not synchronous — it is what lets a live panel attach. The
 * stream is opened here rather than by the renderer because only main can set an
 * `Authorization` header, and because Bloom replays from the beginning before
 * tailing, opening it a moment "late" loses nothing.
 */
export async function startTestRun(
  emit: Emit,
  agentId: string,
  input: string,
): Promise<Result<{ runId: string }>> {
  const started = await call(emit, (t) => api.startTestRun(t, agentId, input))
  if (!started.ok) return started
  const runId = started.value?.runId
  if (!runId) {
    return { ok: false, code: 'transport', error: 'Bloom started a run but did not name it.' }
  }
  watchRun(emit, runId)
  return { ok: true, value: { runId } }
}

/**
 * Attach to a run already in flight — reopening the tab, or resuming after a reload.
 * Idempotent, so asking twice costs nothing.
 */
export function watchRun(emit: Emit, runId: string): boolean {
  const target = currentTarget()
  if (!target) return false
  openRunStream(target, runId, {
    onEvent: (id, event) => emit({ kind: 'bloom-run', runId: id, event }),
  })
  return true
}

/**
 * Stop a run. Two calls, deliberately: ask Bloom to cancel, and close our stream.
 *
 * The cancellation's *outcome* still arrives as a normal `run_finished` on the trace,
 * so a client watching the stream needs no special case — which is why the stream is
 * closed only after the request, not instead of it.
 */
export async function cancelRun(emit: Emit, runId: string): Promise<Result<unknown>> {
  const result = await call(emit, (t) => api.cancelRun(t, runId))
  if (result.ok) closeRunStream(runId)
  return result
}

export const listRuns = (
  emit: Emit,
  params: { limit?: number; offset?: number; status?: string; origin?: string },
): Promise<Result<RunSummary[]>> => call(emit, (t) => api.listRuns(t, params))

export const listAgentRuns = (
  emit: Emit,
  agentId: string,
  params: { limit?: number; offset?: number },
): Promise<Result<RunSummary[]>> => call(emit, (t) => api.listAgentRuns(t, agentId, params))

export const runTrace = (
  emit: Emit,
  agentId: string,
  runId: string,
  after: number,
): Promise<Result<RunTrace | null>> => call(emit, (t) => api.runTrace(t, agentId, runId, after))

// --- connected accounts -----------------------------------------------------

export const listProviders = (emit: Emit): Promise<Result<ProviderInfo[]>> =>
  call(emit, (t) => api.listProviders(t))

export const listConnections = (emit: Emit, agentId: string): Promise<Result<ConnectionInfo[]>> =>
  call(emit, (t) => api.listConnections(t, agentId))

/**
 * Begin an OAuth flow and hand the browser the authorize URL.
 *
 * `shell.openExternal`, never a `BrowserWindow`: providers increasingly refuse
 * embedded webviews outright, and the system browser already has the user's session.
 * The URL is opened from main so the renderer never has to be trusted with it.
 */
export async function startOAuth(
  emit: Emit,
  agentId: string,
  provider: string,
  scopes?: string[],
): Promise<Result<{ opened: boolean }>> {
  const started = await call(emit, (t) => api.startOAuth(t, agentId, provider, scopes))
  if (!started.ok) return started
  const url = started.value?.authorizeUrl
  if (!url) {
    return { ok: false, code: 'transport', error: 'Bloom returned no authorization URL.' }
  }
  await shell.openExternal(url)
  return { ok: true, value: { opened: true } }
}

export const disconnectProvider = (
  emit: Emit,
  agentId: string,
  provider: string,
): Promise<Result<void>> => call(emit, (t) => api.disconnectProvider(t, agentId, provider))

// --- usage ------------------------------------------------------------------

export const usage = (emit: Emit, since?: string): Promise<Result<UsageReport | null>> =>
  call(emit, (t) => api.usage(t, since))
