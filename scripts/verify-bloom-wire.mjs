/**
 * Bloom's wire formats: SSE framing, and the snake_case rows.
 *
 * The framing half is the highest value-per-line test in this feature. Every failure
 * it covers is one a live run would hit only occasionally and only under load — a
 * frame split at an awkward byte, a keepalive rendered as an event, an `id` that
 * resumes from the wrong place — and each looks like a bug in Bloom rather than in
 * the client.
 *
 * The adversarial section is the point: the same transcript is fed one byte at a
 * time, in one blob, and split at every single offset, and all three must produce
 * identical output. A parser that passes the first two and fails the third is the
 * normal kind of broken.
 *
 * Headless, like `verify-connection.mjs`, because `wire.ts` imports only types.
 */
import {
  createSseParser,
  fromConnectionDraft,
  toAgentConfig,
  toConnection,
  toConnectionKinds,
  toProbeResult,
  toRunEvent,
  toRunSummary,
  toUsage,
  streamEvent,
} from '../out/verify/bloom-wire.mjs'

let failures = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `${ok ? '  ok  ' : ' FAIL '} ${label}${
      ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
    }`,
  )
}

/** Feed a whole transcript in one push. */
function parseAll(text) {
  const parser = createSseParser()
  return [...parser.push(text), ...parser.flush()]
}

console.log('\nSSE framing\n')

check('a plain frame', parseAll('id: 1\nevent: text\ndata: {"a":1}\n\n'), [
  { id: '1', event: 'text', data: '{"a":1}' },
])

check(
  'a keepalive comment is not an event',
  parseAll(': ping\n\nid: 2\nevent: text\ndata: x\n\n'),
  [{ id: '2', event: 'text', data: 'x' }],
)

check('a lone keepalive yields nothing at all', parseAll(': ping\n\n'), [])

check(
  'multi-line data joins with newlines',
  parseAll('event: text\ndata: one\ndata: two\n\n'),
  [{ id: null, event: 'text', data: 'one\ntwo' }],
)

check(
  'exactly one leading space is stripped',
  parseAll('event: a\ndata:  two-spaces\n\n'),
  [{ id: null, event: 'a', data: ' two-spaces' }],
)

check('no space after the colon is the same value', parseAll('event: a\ndata:x\n\n'), [
  { id: null, event: 'a', data: 'x' },
])

check('a missing event name defaults to `message`', parseAll('data: x\n\n'), [
  { id: null, event: 'message', data: 'x' },
])

// The id persists across frames — that is how a resume cursor survives a frame that
// does not restate it, and getting this wrong silently rewinds the stream.
check(
  'the last id carries forward to a frame that omits one',
  parseAll('id: 7\ndata: a\n\ndata: b\n\n'),
  [
    { id: '7', event: 'message', data: 'a' },
    { id: '7', event: 'message', data: 'b' },
  ],
)

check('a blank line with no data is not an event', parseAll('\n\n\n'), [])

check('an unknown field is ignored, never fatal', parseAll('retry: 500\ndata: x\n\n'), [
  { id: null, event: 'message', data: 'x' },
])

check('a field line with no colon is a field with an empty value', parseAll('data\ndata: x\n\n'), [
  { id: null, event: 'message', data: '\nx' },
])

check('CRLF terminators work', parseAll('event: a\r\ndata: x\r\n\r\n'), [
  { id: null, event: 'a', data: 'x' },
])

check('a lone CR terminator works', parseAll('event: a\rdata: x\r\r'), [
  { id: null, event: 'a', data: 'x' },
])

check('a leading byte-order mark is stripped once', parseAll('﻿data: x\n\n'), [
  { id: null, event: 'message', data: 'x' },
])

check(
  'a final frame with no trailing blank line is still dispatched',
  parseAll('event: a\ndata: x'),
  [{ id: null, event: 'a', data: 'x' }],
)

console.log('\nadversarial splitting — the same transcript, fed three ways\n')

const TRANSCRIPT =
  'id: 1\nevent: run_started\ndata: {"kind":"run_started"}\n\n' +
  ': ping\n\n' +
  'id: 2\nevent: text\ndata: {"kind":"text",\ndata: "payload":"hi"}\n\n' +
  'id: 3\r\nevent: run_finished\r\ndata: {"kind":"run_finished"}\r\n\r\n'

const whole = parseAll(TRANSCRIPT)
check('the whole transcript in one push yields three frames', whole.length, 3)
check('and the last one is terminal', whole[2].event, 'run_finished')

const byteByByte = (() => {
  const parser = createSseParser()
  const out = []
  for (const ch of TRANSCRIPT) out.push(...parser.push(ch))
  out.push(...parser.flush())
  return out
})()
check('one byte at a time is identical', byteByByte, whole)

// Every possible split point. This is the one that catches a parser which happens to
// work because the test data was convenient.
let worstOffset = -1
for (let at = 1; at < TRANSCRIPT.length; at += 1) {
  const parser = createSseParser()
  const out = [
    ...parser.push(TRANSCRIPT.slice(0, at)),
    ...parser.push(TRANSCRIPT.slice(at)),
    ...parser.flush(),
  ]
  if (JSON.stringify(out) !== JSON.stringify(whole)) {
    worstOffset = at
    break
  }
}
check(`every one of the ${TRANSCRIPT.length - 1} split points agrees`, worstOffset, -1)

console.log('\nwire rows\n')

const eventRow = {
  id: 12,
  run_id: 'r1',
  seq: 3,
  kind: 'tool_finished',
  step_index: 1,
  tool_name: 'spotify_play',
  ok: true,
  latency_ms: 240,
  tokens_in: 10,
  tokens_out: 20,
  cost_usd: 0.002,
  payload: { result: 'done' },
  created_at: '2026-01-01T00:00:00+00:00',
}
const mapped = toRunEvent(eventRow)
check('an event row maps to our spelling', [mapped.id, mapped.runId, mapped.toolName, mapped.latencyMs], [12, 'r1', 'spotify_play', 240])
check('a null column stays null rather than becoming 0', toRunEvent({ kind: 'text', id: 1 }).latencyMs, null)
check('`ok: false` survives, rather than reading as absent', toRunEvent({ kind: 'x', ok: false }).ok, false)
check('a row with no kind is dropped', toRunEvent({ id: 1 }), null)

// Additive evolution: Bloom may grow event kinds, and an older Aperture omitting
// steps from a trace someone is reading is worse than one it cannot style.
check('an unknown kind is kept, not dropped', toRunEvent({ kind: 'future_thing', id: 9 }).kind, 'future_thing')

check(
  'a run row maps, including the joined slug',
  (() => {
    const r = toRunSummary({ id: 'r1', agent_slug: 'dj', status: 'succeeded', origin: 'mcp', total_cost_usd: 0.5 })
    return [r.id, r.agentSlug, r.status, r.origin, r.totalCostUsd]
  })(),
  ['r1', 'dj', 'succeeded', 'mcp', 0.5],
)

// A deleted config leaves history behind, and the feed must still render the row.
check('a null slug survives as null', toRunSummary({ id: 'r1', agent_slug: null }).agentSlug, null)

check(
  'an agent config maps its connection ids and nullable ceilings',
  (() => {
    const a = toAgentConfig({
      id: 'a1',
      slug: 'dj',
      system_prompt: 'p',
      connections: ['c1', 'c2'],
      max_steps: null,
    })
    return [a.slug, a.systemPrompt, a.connections, a.maxSteps]
  })(),
  ['dj', 'p', ['c1', 'c2'], null],
)

// --- connections ------------------------------------------------------------

// The property the whole rework turns on: no route returns a secret, so the wire
// carries booleans and the mapper must not invent anything richer.
check(
  'a connection maps without ever carrying a secret',
  (() => {
    const c = toConnection({
      id: 'c1',
      kind: 'api_key',
      provider: 'github',
      name: 'github',
      label: 'GitHub',
      status: 'active',
      config: { client_id: 'app-id' },
      has_secret: true,
      has_client_secret: false,
      scopes: ['repo'],
      agent_ids: ['a1'],
      tools: ['github_whoami'],
    })
    return [c.kind, c.hasSecret, c.hasClientSecret, c.config.client_id, c.agentIds, c.tools]
  })(),
  ['api_key', true, false, 'app-id', ['a1'], ['github_whoami']],
)

check(
  'a peer connection keeps a null provider rather than an empty string',
  toConnection({ id: 'c1', kind: 'mcp', provider: null, name: 'amber' }).provider,
  null,
)

check('a connection row with no id is dropped', toConnection({ kind: 'mcp' }), null)

// `checked` says which claim the tick is making — "it decrypts" and "the provider
// accepted it" are very different, and reporting the weaker as the stronger is how
// a green tick comes to mean nothing.
check(
  'a probe keeps which check it actually ran',
  (() => {
    const p = toProbeResult({ ok: true, checked: 'request', status: 200, detail: 'fine' })
    return [p.ok, p.checked, p.status]
  })(),
  [true, 'request', 200],
)

check(
  'an unknown probe check falls back to the weakest claim',
  toProbeResult({ ok: true, checked: 'invented' }).checked,
  'token',
)

check(
  'connection kinds drop anything this build does not know',
  (() => {
    const k = toConnectionKinds({
      kinds: [
        { kind: 'oauth', available: true, reason: '' },
        { kind: 'telepathy', available: true, reason: '' },
      ],
      providers: [{ name: 'github', auth: ['oauth', 'api_key', 'nonsense'] }],
      discovered_peers: [{ name: 'amber', base_url: 'https://amber.example' }],
    })
    return [k.kinds.map((x) => x.kind), k.providers[0].auth, k.discoveredPeers[0].name]
  })(),
  [['oauth'], ['oauth', 'api_key'], 'amber'],
)

// An empty string would be stored as a real (empty) client secret, and Bloom
// refuses an unknown field outright, so both are dropped rather than sent.
check(
  'a draft drops undefined and empty fields rather than sending them',
  (() => {
    const out = fromConnectionDraft({
      kind: 'mcp',
      name: 'amber',
      config: { url: 'https://amber.example' },
      secret: '',
      clientId: undefined,
      attachTo: ['a1'],
    })
    return Object.keys(out).sort()
  })(),
  ['attach_to', 'config', 'kind', 'name'],
)

// Bloom distinguishes "nothing has called me" from "nobody could". Flattening the
// null into an empty shape would lose the only useful half.
check('usage keeps a null `tools` as null', toUsage({ runs: {}, models: {}, tools: null }).tools, null)
check(
  'usage maps a present `tools`',
  toUsage({ runs: {}, models: {}, tools: { totals: { calls: 3, errors: 1 }, by_tool: [], by_caller: [] } }).tools.totals,
  { calls: 3, errors: 1 },
)

// Negative, so a synthetic event can never collide with Bloom's autoincrement cursor
// or be mistaken for a replayed real one by a dedup on id.
check('synthetic stream events carry a negative id', streamEvent('r1', 'stream_lost', 'x').id < 0, true)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
