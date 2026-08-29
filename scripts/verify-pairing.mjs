/**
 * The pairing rewrite, which has exactly one job and one way to get it wrong.
 *
 * Aperture's default URL is `ws://localhost:8000/ws`. A QR code carrying that hands a
 * phone the one address that cannot possibly work, and it fails as "Amber is down" —
 * a symptom pointing nowhere near the cause. Everything here is about the host swap
 * being right, and about the path surviving it: `/ws` is not `/ws/` to FastAPI's route
 * table, which is why this is string surgery rather than `new URL`.
 */

import { isLoopback, pairingPayload, withHost } from '../out/verify/pairing.mjs'

const failures = []
const fail = (msg) => failures.push(msg)
const eq = (actual, expected, what) => {
  if (actual !== expected) fail(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// --- the host swap ----------------------------------------------------------

eq(withHost('ws://localhost:8000/ws', '192.168.1.20'), 'ws://192.168.1.20:8000/ws', 'port and path kept')
eq(withHost('ws://localhost/ws', '192.168.1.20'), 'ws://192.168.1.20/ws', 'no port stays no port')
eq(withHost('wss://localhost:8443/ws', '192.168.1.20'), 'wss://192.168.1.20:8443/ws', 'wss preserved')

// The path is the whole reason this is not `new URL`: a trailing slash added here
// would produce `/ws/`, which `@app.websocket("/ws")` does not match.
if (withHost('ws://localhost:8000/ws', '10.0.0.5').endsWith('/ws/')) {
  fail('the path must not gain a trailing slash — FastAPI would not match it')
}
eq(withHost('ws://localhost:8000/', '10.0.0.5'), 'ws://10.0.0.5:8000/', 'a bare root path is left alone')
eq(withHost('ws://localhost:8000', '10.0.0.5'), 'ws://10.0.0.5:8000', 'no path stays no path')

// Nonsense in, same thing out — a caller must be able to hand this anything.
eq(withHost('not a url', '10.0.0.5'), 'not a url', 'unparseable input is returned unchanged')
eq(withHost('http://localhost:8000/ws', '10.0.0.5'), 'http://localhost:8000/ws', 'non-ws schemes untouched')

// --- what counts as unreachable ---------------------------------------------

for (const url of [
  'ws://localhost:8000/ws',
  'ws://LOCALHOST:8000/ws',
  'ws://127.0.0.1:8000/ws',
  'ws://[::1]:8000/ws',
  'wss://localhost/ws',
  'ws://localhost',
]) {
  if (!isLoopback(url)) fail(`${url} should be recognised as loopback`)
}

for (const url of [
  'ws://192.168.1.20:8000/ws',
  'wss://amber.johnny.dev/ws',
  // The prefix must not match a real host that merely starts the same way.
  'ws://localhost.example.com:8000/ws',
  'ws://127.0.0.100:8000/ws',
]) {
  if (isLoopback(url)) fail(`${url} must not be treated as loopback`)
}

// --- the payload -------------------------------------------------------------

{
  const parsed = JSON.parse(pairingPayload('ws://192.168.1.20:8000/ws', 'secret'))
  eq(parsed.v, 1, 'version')
  eq(parsed.url, 'ws://192.168.1.20:8000/ws', 'url')
  eq(parsed.token, 'secret', 'token')
}
{
  // Omitted, not empty. The mobile side reads a missing token as "Amber runs open";
  // an empty string would be sent as `?token=`, which is a failed comparison rather
  // than no comparison — so an open Amber would refuse the phone.
  const parsed = JSON.parse(pairingPayload('ws://192.168.1.20:8000/ws', ''))
  if ('token' in parsed) fail('an absent token must be omitted from the payload, not empty')
}

// --- the round trip the phone actually performs -------------------------------
//
// Mirrors `aperture-mobile/src/settings/pairing.ts:parsePairingCode`. If this ever
// stops matching, pairing fails at the one moment nobody can debug it — on a phone.
{
  const code = pairingPayload(withHost('ws://localhost:8000/ws', '192.168.1.20'), 'secret')
  const parsed = JSON.parse(code)
  if (parsed.v !== 1) fail('the phone refuses a version it does not know')
  if (typeof parsed.url !== 'string') fail('the phone requires a string url')
  if (isLoopback(parsed.url)) fail('the phone refuses a loopback pairing — this one would be rejected')
}

if (failures.length) {
  console.error(`verify-pairing: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  x ${f}`)
  process.exit(1)
}
console.log('verify-pairing: ok — host swapped, path intact, loopback caught, token omitted when absent')
