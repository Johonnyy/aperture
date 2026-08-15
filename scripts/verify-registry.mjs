/**
 * The registry map's two halves that are easy to get quietly wrong.
 *
 * One is the diagnosis: which of twenty-one states an app is in decides which single
 * button appears, so a wrong branch here is a button that cannot work presented as the
 * fix — the exact failure this whole surface exists to end. The other is geometry:
 * nobody is going to sit down and check fifteen apps at four window widths by hand.
 *
 * It also enforces the two properties that keep the old paragraph from growing back —
 * copy length caps — and the one that keeps a token off the screen.
 *
 * Driven headlessly like `verify-credentials.mjs`: `registry.ts` and
 * `registry-layout.ts` import no React and no Electron, which is why they are separate
 * files from the components.
 */
import { diagnose, JOINING_WINDOW_MS } from '../out/verify/registry.mjs'
import { layoutOf, TWO_COLUMN_MIN } from '../out/verify/registry-layout.mjs'
import { ACTIONS } from '../out/verify/actions.mjs'

let failures = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`,
  )
}

function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${condition ? '' : ` — ${detail}`}`)
}

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0)
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()

// --- fixtures ---------------------------------------------------------------

const app = (over = {}) => ({
  name: 'bloom',
  domain: 'bloom.example.com',
  upstream: '127.0.0.1:8010',
  imagePinned: null,
  imageRunning: null,
  container: 'running',
  health: 'healthy',
  envFile: null,
  composeFile: null,
  registered: false,
  lastSeen: null,
  stale: false,
  httpStatus: 200,
  server: null,
  thisBox: true,
  declared: true,
  available: true,
  // The three derived keys install.sh writes for every MCP app. All three are required
  // before registration is even attempted, and the token is also what makes an app a
  // registry participant at all.
  envKeys: ['BLOOM_MCP_SYNC_STORE_TOKEN', 'BLOOM_MCP_PUBLIC_URL', 'BLOOM_MCP_SYNC_STORE_URL'],
  env: [],
  envPrefix: 'BLOOM_MCP',
  envPrefixDeclared: 'BLOOM_MCP',
  envPrefixRendered: 'BLOOM_MCP',
  startedAt: iso(60 * 60_000),
  syncTokenFingerprint: 'aaaa1111',
  ...over,
})

const status = (over = {}) => ({
  installed: true,
  schema: 10,
  repoRoot: '/opt/amber-infra',
  commit: 'abc1234',
  role: 'core',
  primaryDomain: 'example.com',
  docker: 'docker 27',
  compose: 'v2',
  secretsReadable: true,
  tools: { git: true, jq: true, yq: true, docker: true },
  secrets: {
    present: true,
    readable: true,
    path: '/etc/amber-infra/secrets.yaml',
    acmeEmailSet: true,
    placeholders: { generatable: [], manual: [] },
  },
  settings: { acmeEmail: 'a@b.c', primaryDomain: 'example.com', timezone: 'UTC', role: 'core' },
  hostServices: { port80: null, port443: null, caddyContainer: true, units: [] },
  serverLabel: 'a',
  catalogue: [],
  dns: { publicIp: null, records: [] },
  apps: [app()],
  caddy: { running: true, health: 'healthy', sites: [] },
  syncStore: {
    url: 'https://sync.example.com',
    reachable: true,
    servers: [],
    containerState: 'running',
    detail: null,
    startedAt: iso(2 * 60 * 60_000),
    keys: {
      readable: true,
      running: [
        { name: 'amber', fp: 'ffff0000', placeholder: false },
        { name: 'bloom', fp: 'aaaa1111', placeholder: false },
      ],
      declared: [
        { name: 'amber', fp: 'ffff0000', placeholder: false },
        { name: 'bloom', fp: 'aaaa1111', placeholder: false },
      ],
    },
  },
  history: [],
  backups: { target: null, count: 0, newest: null },
  warnings: [],
  ...over,
})

/** The state `diagnose` gives the one app in the fixture. */
const stateOf = (over, appOver = {}) =>
  diagnose(status({ apps: [app(appOver)], ...over }), { now: NOW }).apps[0].state

const keys = (running, declared) => ({
  syncStore: { ...status().syncStore, keys: { readable: true, running, declared } },
})

const AMBER = { name: 'amber', fp: 'ffff0000', placeholder: false }
const BLOOM = { name: 'bloom', fp: 'aaaa1111', placeholder: false }

console.log('\nthe app states, one per branch\n')

check('registered and fresh is linked', stateOf({}, { registered: true }), 'linked')
check('registered and stale', stateOf({}, { registered: true, stale: true }), 'stale')
check('declared but never installed', stateOf({}, { container: 'missing' }), 'not-installed')
check('installed and stopped', stateOf({}, { container: 'exited' }), 'not-running')
// Two states rather than one, because "Install it" and "Start it" are not the same
// button and offering the wrong one is a dead end.
ok(
  'and they offer different actions',
  diagnose(status({ apps: [app({ container: 'missing' })] }), { now: NOW }).apps[0].fix.actionId !==
    diagnose(status({ apps: [app({ container: 'exited' })] }), { now: NOW }).apps[0].fix.actionId,
)

console.log('\nwho is even a registry participant\n')

{
  // An app with no MCP surface is SUPPOSED never to appear in the registry. Listing it
  // as unregistered would be inventing a fault, and offering a fix for it would be
  // inventing a repair.
  const plain = app({ name: 'static-site', envKeys: [], registered: false })
  const d = diagnose(
    status({ apps: [plain], ...keys([AMBER], [AMBER]) }),
    { now: NOW },
  )
  check('an app with no key and no token is not on the map at all', d.apps.length, 0)

  const viaEnv = app({ name: 'static-site', envKeys: ['SITE_MCP_SYNC_STORE_TOKEN'] })
  const d2 = diagnose(status({ apps: [viaEnv], ...keys([AMBER], [AMBER]) }), { now: NOW })
  check('but a rendered token makes it one', d2.apps.length, 1)

  const viaRegistry = app({ name: 'static-site', envKeys: [], registered: true })
  const d3 = diagnose(status({ apps: [viaRegistry], ...keys([AMBER], [AMBER]) }), { now: NOW })
  check('and so does already being in the registry', d3.apps.length, 1)
}

console.log('\ntwo boxes — an app on the other one is not an orphan\n')

{
  // The most damaging possible false positive on this screen: offering to deregister
  // every app that lives on the other server.
  const d = diagnose(
    status({
      apps: [app(), app({ name: 'finance', server: 'b', thisBox: false })],
      syncStore: {
        ...status().syncStore,
        servers: [
          { name: 'finance', baseUrl: 'https://finance.example.com', lastSeen: null, stale: false },
        ],
      },
    }),
    { now: NOW },
  )
  ok(
    'an app declared for another box is never called an orphan',
    !d.apps.some((a) => a.id === 'finance' && a.state === 'orphan'),
    JSON.stringify(d.apps.map((a) => [a.id, a.state])),
  )
  ok('and it is not listed as a local app either', !d.apps.some((a) => a.id === 'finance'))
}

console.log('\nthe store refusing, however it is worded\n')

for (const detail of [
  'healthy, but rejecting amber’s token',
  'healthy, but /servers returned 401',
  'Unauthorized',
]) {
  const d = diagnose(
    status({ syncStore: { ...status().syncStore, reachable: false, detail } }),
    { now: NOW },
  )
  check(`"${detail.slice(0, 28)}…" reads as refusing`, d.store.state, 'store-refusing')
}
{
  const d = diagnose(
    status({ syncStore: { ...status().syncStore, reachable: false, detail: 'connection refused' } }),
    { now: NOW },
  )
  // "refused" the word is in there, but this is a store that is down, and recommending
  // a key reload for it would be the wrong button confidently offered.
  check('a genuinely down store is not diagnosed as a credential problem', d.store.state, 'store-silent')
}

console.log('\nback to the app states\n')

check(
  'declared key absent from the RUNNING list is key-unknown',
  stateOf(keys([AMBER], [AMBER, BLOOM])),
  'key-unknown',
)
check(
  'same name, different fingerprint is key-rotated',
  stateOf(keys([AMBER, { ...BLOOM, fp: 'OLD00000' }], [AMBER, BLOOM])),
  'key-rotated',
)
check(
  'the app presenting an older token than declared is key-stale',
  stateOf({}, { syncTokenFingerprint: 'OLD00000' }),
  'key-stale',
)
check('no entry at all is key-missing', stateOf(keys([AMBER], [AMBER])), 'key-missing')
check(
  'a CHANGEME entry is key-placeholder',
  stateOf(keys([AMBER], [AMBER, { ...BLOOM, placeholder: true }])),
  'key-placeholder',
)
check(
  'the app reading a different namespace than its keys were written to',
  stateOf({}, { envPrefixRendered: 'AGENT_MCP' }),
  'prefix-drift',
)
check('no domain means no public url', stateOf({}, { domain: null }), 'no-domain')

console.log('\nthe env keys register() actually requires\n')

// The branch that shipped as "Restart it" and did nothing. register() refuses outright
// when the public URL is unset — before any HTTP is attempted — so the app has never
// made a single request and restarting it cannot change that.
check(
  'no rendered public URL',
  stateOf({}, { envKeys: ['BLOOM_MCP_SYNC_STORE_TOKEN'] }),
  'no-public-url',
)
check(
  'no rendered registry URL',
  stateOf({}, { envKeys: ['BLOOM_MCP_SYNC_STORE_TOKEN', 'BLOOM_MCP_PUBLIC_URL'] }),
  'no-store-url',
)
{
  // The regression this whole section exists for. An app that has never issued a single
  // registration request must never be offered a restart: it is the one action
  // guaranteed to change nothing, and offering it is worse than offering nothing at all
  // because it looks like progress.
  const neverAttempted = [
    { envKeys: ['BLOOM_MCP_SYNC_STORE_TOKEN'] },
    { envKeys: ['BLOOM_MCP_SYNC_STORE_TOKEN', 'BLOOM_MCP_PUBLIC_URL'] },
    { registrationLog: ['INFO MCP server disabled (BLOOM_FEATURE_MCP off, or no BLOOM_MCP_KEYS)'] },
    { registrationLog: ['WARNING [bloom] No public URL configured (BLOOM_MCP_PUBLIC_URL); skipping'] },
    { registrationLog: [] },
  ]
  const offered = neverAttempted
    .map((over) => diagnose(status({ apps: [app(over)] }), { now: NOW }).apps[0])
    .filter((n) => n.fix.actionId === 'restart')
  ok(
    'an app that never issued a request is never told to restart',
    offered.length === 0,
    offered.map((n) => n.state).join(', '),
  )
}

console.log('\nthe app’s own log — the only place the reason has ever existed\n')

const withLog = (lines, over = {}) =>
  stateOf({}, { registrationLog: lines, ...over })

check(
  'it says the MCP server never mounted',
  withLog(['INFO MCP server disabled (BLOOM_FEATURE_MCP off, or no BLOOM_MCP_KEYS)']),
  'mcp-off',
)
check(
  'it says it could not reach the store',
  withLog(['WARNING [bloom] Sync store unreachable (https://sync.x.dev): ConnectError']),
  'app-cannot-reach',
)
check(
  'it says it has no public URL',
  withLog(['WARNING [bloom] No public URL configured (BLOOM_MCP_PUBLIC_URL); skipping']),
  'no-public-url',
)
check(
  'it says it registered, and the registry disagrees',
  withLog(['INFO [bloom] Registered with the sync store at https://sync.x.dev']),
  'unregistered',
)
check('it has said nothing at all', withLog([]), 'never-tried')
check('its agent layer mounted and then went quiet', withLog(['INFO MCP server mounted at /mcp']), 'never-tried')

{
  // Most recent wins: an app that failed, was fixed, and now succeeds must not be
  // diagnosed off the stale failure earlier in the same log.
  const d = withLog([
    'WARNING [bloom] Sync store unreachable (https://sync.x.dev): ConnectError',
    'INFO [bloom] Registered with the sync store at https://sync.x.dev',
  ])
  check('the newest line wins', d, 'unregistered')
}

{
  // The line itself has to reach the screen, or this whole mechanism is pointless.
  const d = diagnose(
    status({
      apps: [
        app({
          registrationLog: ['WARNING [bloom] Sync store unreachable (https://sync.x.dev): ConnectError'],
        }),
      ],
    }),
    { now: NOW },
  )
  ok('the app’s own sentence is carried to the UI', d.apps[0].note?.includes('ConnectError'))
  ok(
    'and it is in the evidence too',
    d.apps[0].evidence.some((e) => e.label === 'its own log'),
  )
}

console.log('\nthe boot window — "give it a moment", made arithmetic\n')

check(
  'inside the window it is still joining',
  stateOf({}, { startedAt: iso(JOINING_WINDOW_MS / 2) }),
  'joining',
)
ok(
  'and inside the window it offers nothing to press',
  diagnose(status({ apps: [app({ startedAt: iso(JOINING_WINDOW_MS / 2) })] }), { now: NOW }).apps[0]
    .fix.kind === 'none',
)
// Past the window it must stop saying "give it a moment". Which state it lands in is
// the log's business; the assertion is only that waiting is no longer the answer.
for (const [label, startedAt] of [
  ['past the window', iso(JOINING_WINDOW_MS + 1000)],
  ['an unknown start time', null],
  // A container whose clock runs ahead of ours would otherwise produce a negative age
  // and read as freshly booted forever.
  ['a start time in the future', new Date(NOW + 600_000).toISOString()],
]) {
  ok(`${label} never reads as joining`, stateOf({}, { startedAt }) !== 'joining')
}

console.log('\nrule 1 — the store dominates\n')

for (const [label, over] of [
  ['not deployed', { containerState: 'missing' }],
  ['stopped', { containerState: 'exited' }],
  ['silent', { reachable: false, detail: 'running but not answering on /health' }],
  ['unconfigured', { url: null }],
]) {
  const d = diagnose(status({ syncStore: { ...status().syncStore, ...over } }), { now: NOW })
  ok(
    `a store that is ${label} leaves no app-level buttons`,
    d.apps.every((a) => a.fix.kind === 'none'),
    JSON.stringify(d.apps.map((a) => [a.id, a.fix.actionId])),
  )
  ok(`a store that is ${label} still offers exactly one action`, d.next !== null)
}

{
  // The exception, and the whole point of the release: a store that is *refusing* is
  // precisely when the per-app key diff is the answer, so it must NOT suppress it.
  const d = diagnose(
    status({
      syncStore: {
        ...status().syncStore,
        reachable: false,
        detail: 'healthy, but rejecting amber’s token',
      },
    }),
    { now: NOW },
  )
  check('a refusing store is diagnosed as refusing', d.store.state, 'store-refusing')
  ok('a refusing store still diagnoses its apps', d.apps.every((a) => a.state !== 'unclear'))
}

{
  const d = diagnose(status(keys([AMBER], [AMBER, BLOOM])), { now: NOW })
  check('a store behind its declared list is locked-out', d.store.state, 'store-locked-out')
}

console.log('\nrule 3 — identical fixes collapse into one button\n')

{
  const many = ['bloom', 'finance', 'school', 'outpost'].map((name) =>
    app({ name, domain: `${name}.example.com` }),
  )
  const d = diagnose(
    status({ apps: many, ...keys([AMBER], [AMBER, ...many.map((m) => ({ name: m.name, fp: 'aaaa1111', placeholder: false }))]) }),
    { now: NOW },
  )
  ok('all four read key-unknown', d.apps.every((a) => a.state === 'key-unknown'))
  check('and there is one action for all of them', d.next.fix.actionId, 'reloadRegistry')
  ok('which reports what it repairs', d.next.affects.length >= 4, JSON.stringify(d.next.affects))
}

console.log('\nrule 5 — degrade, never hide\n')

{
  // A box on an older status.sh: `keys` is absent entirely, which must not read as
  // "the registry has no keys" — that would paint every app broken AND point at the
  // wrong repair with total confidence.
  const old = status({ schema: 9 })
  delete old.syncStore.keys
  const d = diagnose(old, { now: NOW })
  check('every app collapses to unclear', d.apps[0].state, 'unclear')
  check('the offered fix is the one that is safe either way', d.apps[0].fix.actionId, 'reloadRegistry')
  check('and it says it cannot be sure', d.certain, false)
  ok('with a caveat naming the schema', d.caveats.some((c) => c.includes('schema')), JSON.stringify(d.caveats))
}

{
  const blind = status({ secretsReadable: false })
  blind.syncStore.keys = { readable: false, running: [], declared: [] }
  const d = diagnose(blind, { now: NOW })
  check('unreadable secrets also degrade rather than accuse', d.apps[0].state, 'unclear')
  ok('and the caveat names the password', d.caveats.some((c) => /root password/i.test(c)))
}

console.log('\nregistry entries with nothing behind them\n')

{
  const d = diagnose(
    status({
      syncStore: {
        ...status().syncStore,
        servers: [{ name: 'ghost', baseUrl: 'https://ghost.example.com', lastSeen: null, stale: false }],
      },
    }),
    { now: NOW },
  )
  const ghost = d.apps.find((a) => a.id === 'ghost')
  check('an unmatched registry entry is an orphan', ghost?.state, 'orphan')
  check('whose fix removes it', ghost?.fix.actionId, 'deregister')
}

console.log('\nevery fix points at an action that exists\n')

{
  // The check that stops the map growing a button that does nothing. Every branch above
  // has now produced at least one node, so this covers the whole COPY table by way of
  // the cases exercised.
  const scenarios = [
    status(),
    status({ apps: [app({ registered: true })] }),
    status({ apps: [app({ container: 'missing' })] }),
    status(keys([AMBER], [AMBER, BLOOM])),
    status(keys([AMBER], [AMBER, { ...BLOOM, placeholder: true }])),
    status({ apps: [app({ envPrefixRendered: 'AGENT_MCP' })] }),
    status({ apps: [app({ domain: null })] }),
    status({ apps: [app({ syncTokenFingerprint: 'OLD00000' })] }),
    status({ syncStore: { ...status().syncStore, url: null } }),
    status({ syncStore: { ...status().syncStore, containerState: 'missing' } }),
    status({ syncStore: { ...status().syncStore, containerState: 'exited' } }),
    status({ syncStore: { ...status().syncStore, reachable: false, detail: 'not answering' } }),
    status({ syncStore: { ...status().syncStore, reachable: false, detail: 'rejecting token' } }),
    status({
      syncStore: {
        ...status().syncStore,
        servers: [{ name: 'ghost', baseUrl: 'x', lastSeen: null, stale: false }],
      },
    }),
  ]
  const seen = new Set()
  let bad = []
  for (const s of scenarios) {
    const d = diagnose(s, { now: NOW })
    for (const node of [d.store, ...d.apps]) {
      seen.add(node.state)
      if (node.fix.kind === 'action' && !ACTIONS[node.fix.actionId]) {
        bad.push(`${node.state} -> ${node.fix.actionId}`)
      }
    }
    if (d.next?.fix.kind === 'action' && !ACTIONS[d.next.fix.actionId]) {
      bad.push(`next -> ${d.next.fix.actionId}`)
    }
  }
  ok('no fix names an action that is not in ACTIONS', bad.length === 0, bad.join(', '))
  ok(`${seen.size} distinct states exercised`, seen.size >= 16, [...seen].join(', '))
}

console.log('\ncopy stays short, and never carries a secret\n')

{
  // The mechanism that keeps the five-sentence paragraph from growing back one edit at
  // a time. Caps are deliberately tight: a summary that needs 80 characters is a
  // paragraph in the making.
  let long = []
  for (const s of [
    status(),
    status(keys([AMBER], [AMBER, BLOOM])),
    status({ apps: [app({ container: 'missing' })] }),
    status({ syncStore: { ...status().syncStore, url: null } }),
    status({ syncStore: { ...status().syncStore, containerState: 'missing' } }),
    status({ apps: [app({ envPrefixRendered: 'AGENT_MCP' })] }),
  ]) {
    const d = diagnose(s, { now: NOW })
    for (const node of [d.store, ...d.apps]) {
      if (node.summary.length > 64) long.push(`summary ${node.state}: ${node.summary.length}`)
      if (node.fix.label.length > 28) long.push(`label ${node.state}: ${node.fix.label.length}`)
      if (node.fix.because.length > 120) long.push(`because ${node.state}: ${node.fix.because.length}`)
      // One sentence means at most one full stop that is not the last character.
      const mid = node.summary.slice(0, -1).split('.').length - 1
      if (mid > 0) long.push(`summary ${node.state} is more than one sentence`)
    }
  }
  ok('every string is inside its cap', long.length === 0, long.join('; '))
}

{
  // `evidence` is the field shaped like a leak: it is the only one that carries values
  // read off the box. Every entry must be a fingerprint or a known non-secret.
  const SAFE = new Set([
    'container',
    'health',
    'started',
    'url',
    'detail',
    'base url',
    'prefix (manifest)',
    'prefix (rendered)',
  ])
  const d = diagnose(status(keys([AMBER, { ...BLOOM, fp: 'OLD00000' }], [AMBER, BLOOM])), { now: NOW })
  const leaks = []
  for (const node of [d.store, ...d.apps]) {
    for (const e of node.evidence) {
      const fingerprint = /^sha256:[0-9a-zA-Z]{8}$/.test(e.value)
      if (!fingerprint && !SAFE.has(e.label)) leaks.push(`${node.id}.${e.label}`)
      // Belt and braces: nothing the length of a real token, ever.
      if (/[A-Za-z0-9]{32,}/.test(e.value)) leaks.push(`${node.id}.${e.label} looks like a token`)
    }
  }
  ok('no evidence entry carries anything token-shaped', leaks.length === 0, leaks.join(', '))
}

console.log('\nlayout — nothing overlaps, nothing escapes\n')

{
  const overlaps = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  let problems = []
  let heights = new Map()
  for (const width of [320, 400, 520, 696, 1024]) {
    let previousHeight = 0
    for (const count of [0, 1, 2, 3, 4, 7, 8, 15, 24, 40]) {
      const l = layoutOf(count, width)
      if (l.nodes.length !== count) problems.push(`${width}/${count}: wrong node count`)
      for (let i = 0; i < l.nodes.length; i++) {
        const n = l.nodes[i]
        if (n.x < 0 || n.x + n.w > l.width) problems.push(`${width}/${count}: node ${i} escapes horizontally`)
        if (n.y < 0 || n.y + n.h > l.height) problems.push(`${width}/${count}: node ${i} escapes vertically`)
        if (overlaps(n, l.store)) problems.push(`${width}/${count}: node ${i} overlaps the store`)
        for (let j = i + 1; j < l.nodes.length; j++) {
          if (overlaps(n, l.nodes[j])) problems.push(`${width}/${count}: nodes ${i} and ${j} overlap`)
        }
      }
      if (l.height < previousHeight) problems.push(`${width}: height shrank going to ${count} apps`)
      previousHeight = l.height
      heights.set(`${width}/${count}`, l.height)
    }
  }
  ok('no node overlaps another, the store, or the frame', problems.length === 0, problems.slice(0, 5).join('; '))
}

{
  check('narrow is one column', layoutOf(6, TWO_COLUMN_MIN - 1).columns, 1)
  check('wide is two', layoutOf(6, TWO_COLUMN_MIN).columns, 2)
  check('no apps means no trunk', layoutOf(0, 696).trunk, null)
  ok('one app still gets a trunk', layoutOf(1, 696).trunk !== null)
  // A width of zero happens for one frame before the ResizeObserver reports, and a
  // collapsed box that then jumps is worse than a wrong-width box that settles.
  ok('a zero width does not produce a degenerate layout', layoutOf(3, 0).width >= 280)
  ok('every node sits clear of the trunk', layoutOf(15, 696).nodes.every((n) => {
    const t = layoutOf(15, 696).trunk.x
    return n.side === 'left' ? n.x + n.w < t : n.x > t
  }))
}

console.log('')
if (failures > 0) {
  console.error(`verify-registry: ${failures} failure(s)`)
  process.exit(1)
}
console.log('verify-registry: ok')
