/**
 * Speaking to a Web Server DAT inside the user's own `.toe`.
 *
 * **Aperture is the wire, not the meaning.** The envelope below is the entire contract
 * between this repo and a TouchDesigner project: a command name and an opaque bag of
 * arguments out, `{status, result}` or `{status, message}` back. What `switch_scene`
 * does, which scenes exist, what `pulse_to_beat` means — all of it lives in one Python
 * callback the user writes and can change without touching this file.
 *
 * **No Electron import**, like `bloom/client.ts` and `amber/connection.ts`, so this
 * bundles standalone and `verify:touchdesigner` can drive it against a stub. The
 * fiddly part of an HTTP contract is the envelope handling, and envelopes do not need
 * a network to test.
 *
 * **No new dependency**: `fetch` and `AbortSignal.timeout` are globals in Electron's
 * Node 20 main process. See `bloom/client.ts` for the full argument.
 *
 * ## The distinction this file exists to preserve
 *
 * "Nothing answered" and "the project answered and said no" are completely different
 * things to do next — restart TouchDesigner versus fix the scene name — so they are
 * different `kind`s rather than one merged error string. A body that is not the
 * project's envelope is `transport` *regardless of HTTP status*: something else
 * serving that port is not TouchDesigner speaking, the same call `bloom/client.ts`
 * makes about a 502 from Caddy.
 */

import { describeFetchError } from '../../net/fetch-error'

/** TouchDesigner's Web Server DAT does not pick a port for you; this is only our default. */
export const TD_DEFAULT_PORT = 9980

/** Headroom so our sentence beats the registry's cutoff rather than racing it. */
const TIMEOUT_HEADROOM_MS = 500
const MIN_FETCH_TIMEOUT_MS = 1000

export type TdResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; kind: 'transport' | 'project'; error: string }

/**
 * Always **127.0.0.1**, never `localhost`.
 *
 * Modern Windows and macOS resolve `localhost` to `::1` first. A Web Server DAT binds
 * IPv4 by default, so `localhost` produces an instant, opaque connection refusal
 * against a project that is running perfectly. This is a function rather than a
 * template at the call site so verify can assert the literal.
 */
export function bridgeUrl(port: number): string {
  return `http://127.0.0.1:${port}/`
}

/**
 * A port from user-editable JSON is not a number until it has been checked.
 *
 * Applied on read as well as write: `touchdesigner.json` can be hand-edited, and a
 * broken port should cost one request rather than a boot. Same stance `nicknames.ts`
 * takes about a hand-broken entry.
 */
export function normalizePort(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 65535) return TD_DEFAULT_PORT
  return n
}

/** The request envelope. `args` is opaque — we never inspect what the project expects. */
export function bridgeBody(command: string, args: unknown): { command: string; args: Record<string, unknown> } {
  const safe = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  return { command, args: safe }
}

export function fetchTimeoutFor(actionTimeoutMs: number): number {
  return Math.max(MIN_FETCH_TIMEOUT_MS, actionTimeoutMs - TIMEOUT_HEADROOM_MS)
}

/**
 * Read the project's answer, or decide it was not the project answering.
 *
 * Separate from `sendCommand` so every envelope shape is testable without a socket.
 */
export function parseBridgeResponse(status: number, text: string): TdResult {
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      kind: 'transport',
      error:
        `Something answered on that port with HTTP ${status}, but not in TouchDesigner's voice. ` +
        `Check the port — another program may be serving it.`,
    }
  }

  const body = parsed as { status?: unknown; result?: unknown; message?: unknown }

  if (body.status === 'ok') {
    const result = body.result && typeof body.result === 'object' && !Array.isArray(body.result)
      ? (body.result as Record<string, unknown>)
      : {}
    return { ok: true, result }
  }

  if (body.status === 'error') {
    const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : ''
    return {
      ok: false,
      kind: 'project',
      error: message || 'The TouchDesigner project refused that command but gave no reason.',
    }
  }

  return {
    ok: false,
    kind: 'transport',
    error:
      `Something answered on that port with HTTP ${status}, but without a status field. ` +
      `The Web Server DAT callback should reply {"status": "ok", ...} or {"status": "error", "message": ...}.`,
  }
}

/** One command, one place an error becomes a sentence. Never throws. */
export async function sendCommand(
  port: number,
  command: string,
  args: unknown,
  timeoutMs: number,
): Promise<TdResult> {
  const fetchTimeout = fetchTimeoutFor(timeoutMs)

  let response: Response
  try {
    response = await fetch(bridgeUrl(port), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(bridgeBody(command, args)),
      signal: AbortSignal.timeout(fetchTimeout),
    })
  } catch (err) {
    return {
      ok: false,
      kind: 'transport',
      error: describeFetchError(err, { subject: 'TouchDesigner', timeoutMs: fetchTimeout }),
    }
  }

  const text = await response.text().catch(() => '')
  return parseBridgeResponse(response.status, text)
}
