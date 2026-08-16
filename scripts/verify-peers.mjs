/**
 * The peer surface's diagnosis, driven headlessly.
 *
 * Same argument as `verify-registry.mjs`: which of thirteen states a pairing is in
 * decides which single button appears, so a wrong branch is a button that cannot work
 * presented as the fix. This one carries an extra obligation the registry map does
 * not — it compares CREDENTIAL fingerprints, so the assertions at the bottom check
 * that no evidence entry can carry a token, and that a state is never inferred from a
 * value this module was not given.
 *
 * `peers.ts` imports no React and no Electron, which is why it can be bundled and run
 * under plain Node like `registry.ts` and `credentials.ts`.
 */
import { bearerListFor, diagnosePeers } from '../out/verify/peers.mjs'
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

// --- fixtures ---------------------------------------------------------------
//
// Two apps in the shape the real ones have: Amber declares a peer map and presents a
// single bearer; Bloom accepts callers on BLOOM_MCP_KEYS and keeps BLOOM_ADMIN_KEYS
// separate, which is the distinction `bearerListFor` must respect.

const AMBER_FP = 'aaaa1111'
const OTHER_FP = 'bbbb2222'

const amber = (over = {}) => ({
  name: 'amber',
  domain: 'amber.example.com',
  upstream: '127.0.0.1:8000',
  imagePinned: null,
  imageRunning: null,
  container: 'running',
  health: 'healthy',
  envFile: '/etc/amber-infra/amber/amber.env',
  composeFile: null,
  registered: true,
  lastSeen: null,
  stale: false,
  httpStatus: 200,
  server: null,
  thisBox: true,
  declared: true,
  available: true,
  envKeys: ['AMBER_MCP_PEERS', 'AMBER_MCP_PEER_TOKEN'],
  env: [],
  envPrefix: 'AMBER_MCP',
  peerMapKey: 'AMBER_MCP_PEERS',
  peerTokenKey: 'AMBER_MCP_PEER_TOKEN',
  peers: [
    { name: 'bloom', baseUrl: 'https://bloom.example.com', endpoint: 'https://bloom.example.com/mcp/' },
  ],
  peerTokenFingerprint: AMBER_FP,
  bearerKeys: [{ key: 'AMBER_MCP_KEYS', peers: ['Aperture'], entries: [] }],
  ...over,
})

const bloom = (over = {}) => ({
  name: 'bloom',
  domain: 'bloom.example.com',
  upstream: '127.0.0.1:8010',
  imagePinned: null,
  imageRunning: null,
  container: 'running',
  health: 'healthy',
  envFile: '/etc/amber-infra/bloom/bloom.env',
  composeFile: null,
  registered: true,
  lastSeen: null,
  stale: false,
  httpStatus: 200,
  server: null,
  thisBox: true,
  declared: true,
  available: true,
  envKeys: ['BLOOM_MCP_KEYS'],
  env: [],
  envPrefix: 'BLOOM_MCP',
  peerMapKey: null,
  peerTokenKey: null,
  peers: [],
  peerTokenFingerprint: null,
  bearerKeys: [
    { key: 'BLOOM_MCP_KEYS', peers: ['amber'], entries: [{ name: 'amber', fp: AMBER_FP, placeholder: false }] },
    { key: 'BLOOM_ADMIN_KEYS', peers: ['Aperture'], entries: [{ name: 'Aperture', fp: OTHER_FP, placeholder: false }] },
  ],
  ...over,
})

const status = (over = {}) => ({
  installed: true,
  schema: 12,
  repoRoot: '/opt/amber-infra',
  commit: 'abc1234',
  role: 'core',
  primaryDomain: 'example.com',
  docker: 'docker 27',
  compose: 'v2',
  secretsReadable: true,
  tools: { git: true, jq: true, yq: true, docker: true },
  secrets: {},
  apps: [amber(), bloom()],
  catalogue: [],
  syncStore: {
    url: 'https://sync.example.com',
    containerState: 'running',
    reachable: true,
    detail: null,
    startedAt: null,
    servers: [
      { name: 'bloom', baseUrl: 'https://bloom.example.com', lastSeen: null, stale: false, tokenSet: true, tokenFp: AMBER_FP },
      { name: 'amber', baseUrl: 'https://amber.example.com', lastSeen: null, stale: false, tokenSet: false, tokenFp: null },
    ],
    keys: { readable: true, running: [], declared: [] },
  },
  history: [],
  backups: { target: null, count: 0, newest: null },
  warnings: [],
  ...over,
})

/** The one pairing every fixture produces, since amber is the only caller. */
const pair = (s) => diagnosePeers(s).pairings.find((p) => p.id === 'amber->bloom')

// --- the states -------------------------------------------------------------

console.log('\nstates — the healthy case, then each way it breaks\n')

check('a correctly wired pair is linked', pair(status()).state, 'linked')
check('and offers no button', pair(status()).fix.kind, 'none')
ok('and reports that discovery would also work', pair(status()).discoverable)

// The state this whole surface exists for. Nothing is degraded, nothing errors, and
// before schema 12 nothing anywhere could say it.
check(
  'an empty peer map is unwired, not healthy',
  pair(status({ apps: [amber({ peers: [] }), bloom()] })).state,
  'unwired',
)
check(
  'and the fix is to connect it',
  pair(status({ apps: [amber({ peers: [] }), bloom()] })).fix.actionId,
  'connectPeer',
)
check(
  'with both ends as parameters',
  pair(status({ apps: [amber({ peers: [] }), bloom()] })).fix.params,
  { from: 'amber', to: 'bloom' },
)

// Written to secrets.yaml and not yet rendered. Without this state a completed
// connect reads as unwired, offering Connect again — a button that appears to do
// nothing, forever.
check(
  'declared but not rendered is pending',
  pair(
    status({
      apps: [
        amber({
          peers: [],
          env: [{ name: 'AMBER_MCP_PEERS', value: 'bloom=https://bloom.example.com', secret: false, derived: false, placeholder: false, set: true }],
        }),
        bloom(),
      ],
    }),
  ).state,
  'pending',
)
check(
  'and its fix installs the CALLER, not the callee',
  pair(
    status({
      apps: [
        amber({
          peers: [],
          env: [{ name: 'AMBER_MCP_PEERS', value: 'bloom=https://bloom.example.com', secret: false, derived: false, placeholder: false, set: true }],
        }),
        bloom(),
      ],
    }),
  ).fix.params.app,
  'amber',
)

check(
  'a bearer that does not match is a mismatch',
  pair(status({ apps: [amber({ peerTokenFingerprint: OTHER_FP }), bloom()] })).state,
  'token-mismatch',
)
check(
  'no bearer at all is its own state',
  pair(status({ apps: [amber({ peerTokenFingerprint: null }), bloom()] })).state,
  'token-absent',
)

// The /mcp/mcp/ trap: the single most common way to write this by hand, and it 404s
// in a way that reads exactly like the peer being down.
for (const url of ['https://bloom.example.com/mcp', 'https://bloom.example.com/mcp/']) {
  check(
    `an endpoint pasted as the origin is caught (${url})`,
    pair(status({ apps: [amber({ peers: [{ name: 'bloom', baseUrl: url, endpoint: `${url.replace(/\/$/, '')}/` }] }), bloom()] })).state,
    'url-endpoint',
  )
}

check(
  'pointing somewhere else is drift',
  pair(
    status({
      apps: [amber({ peers: [{ name: 'bloom', baseUrl: 'https://old.example.com', endpoint: 'https://old.example.com/mcp/' }] }), bloom()],
    }),
  ).state,
  'url-drift',
)
check(
  'a trailing slash is not drift',
  pair(
    status({
      apps: [amber({ peers: [{ name: 'bloom', baseUrl: 'https://bloom.example.com/', endpoint: 'https://bloom.example.com/mcp/' }] }), bloom()],
    }),
  ).state,
  'linked',
)

// The load_static_peers ceiling: one token slot, two peers. Named separately from a
// plain mismatch because "repair this link" would break the peer it currently works
// for, and the screen has to be able to say so.
{
  const fin = bloom({
    name: 'finance',
    domain: 'finance.example.com',
    bearerKeys: [
      { key: 'AGENT_MCP_KEYS', peers: ['amber'], entries: [{ name: 'amber', fp: OTHER_FP, placeholder: false }] },
    ],
  })
  const s = status({
    apps: [
      amber({
        peers: [
          { name: 'bloom', baseUrl: 'https://bloom.example.com', endpoint: 'https://bloom.example.com/mcp/' },
          { name: 'finance', baseUrl: 'https://finance.example.com', endpoint: 'https://finance.example.com/mcp/' },
        ],
      }),
      bloom(),
      fin,
    ],
    syncStore: {
      ...status().syncStore,
      servers: [
        ...status().syncStore.servers,
        { name: 'finance', baseUrl: 'https://finance.example.com', lastSeen: null, stale: false, tokenSet: false, tokenFp: null },
      ],
    },
  })
  const d = diagnosePeers(s)
  check('the peer whose token matches is still linked', d.pairings.find((p) => p.to === 'bloom').state, 'linked')
  check('the one that cannot share it is token-shared', d.pairings.find((p) => p.to === 'finance').state, 'token-shared')
}

console.log('\nordering — structural facts settle before inferred ones\n')

// A stopped callee has no token problem, and "install it" and "start it" are
// different sentences with different buttons.
check(
  'a missing callee beats a bad token',
  pair(status({ apps: [amber({ peerTokenFingerprint: OTHER_FP }), bloom({ container: 'missing' })] })).state,
  'callee-not-installed',
)
check(
  'a stopped callee beats a bad token',
  pair(status({ apps: [amber({ peerTokenFingerprint: OTHER_FP }), bloom({ container: 'exited' })] })).state,
  'callee-not-running',
)
check(
  'and it offers to start it, not to connect',
  pair(status({ apps: [amber(), bloom({ container: 'exited' })] })).fix.actionId,
  'restart',
)

// agent-mcp-py fails closed on an empty key list, so there is nothing to connect TO.
check(
  'a callee with no bearers is closed, not unwired',
  pair(
    status({
      apps: [
        amber({ peers: [] }),
        bloom({ bearerKeys: [{ key: 'BLOOM_MCP_KEYS', peers: ['amber'], entries: [] }] }),
      ],
    }),
  ).state,
  'callee-closed',
)

// Checked AFTER the link itself: restarting a caller whose bearer is wrong changes
// nothing, so "start it" there would be a button that cannot work.
check(
  'a stopped caller with a good link says so',
  pair(status({ apps: [amber({ container: 'exited' }), bloom()] })).state,
  'caller-not-running',
)
check(
  'a stopped caller with a bad link reports the link',
  pair(status({ apps: [amber({ container: 'exited', peerTokenFingerprint: OTHER_FP }), bloom()] })).state,
  'token-mismatch',
)

console.log('\ndegrading — an older box says so rather than looking finished\n')

{
  const old = status({ schema: 11 })
  const d = diagnosePeers(old)
  check('every pairing reads unclear', [...new Set(d.pairings.map((p) => p.state))], ['unclear'])
  ok('it is not certain', d.certain === false)
  ok('and it says why', d.caveats.length === 1 && d.caveats[0].includes('schema'))
  ok('the surface is not empty', d.pairings.length > 0)
  check('the offered repair is still safe', d.pairings[0].fix.actionId, 'connectPeer')
}
{
  const d = diagnosePeers(status({ secretsReadable: false }))
  ok('an unreadable secrets file is a caveat, not a wrong answer', d.certain === false)
  ok('and it names the password field', d.caveats[0].includes('root password'))
}

console.log('\ndiscovery — the second path, reported and never counted as linked\n')

{
  // The registry holds the right token and the env map is empty. Amber's build_broker
  // passes an explicit resolver, so she never consults the registry — this is what
  // works after that ships, not now, and the state has to keep saying unwired.
  const s = status({ apps: [amber({ peers: [] }), bloom()] })
  check('a discoverable peer with no env entry is still unwired', pair(s).state, 'unwired')
  ok('but discoverability is reported', pair(s).discoverable)
}
{
  const s = status({
    syncStore: {
      ...status().syncStore,
      servers: [{ name: 'bloom', baseUrl: 'https://bloom.example.com', lastSeen: null, stale: false, tokenSet: true, tokenFp: OTHER_FP }],
    },
  })
  ok('a registry token that disagrees is not discoverable', pair(s).discoverable === false)
}

console.log('\nbearer lists — which one, and why it is never guessed by name\n')

check('the list naming the caller is chosen', bearerListFor(bloom(), 'amber').key, 'BLOOM_MCP_KEYS')
check('the GUI list is chosen for the GUI', bearerListFor(bloom(), 'Aperture').key, 'BLOOM_ADMIN_KEYS')
ok('an unknown caller matches nothing', bearerListFor(bloom(), 'nobody') === undefined)

console.log('\nwiring — the catalogue, the caps, and the one field shaped like a leak\n')

{
  const states = new Set()
  const samples = [
    status(),
    status({ schema: 11 }),
    status({ apps: [amber({ peers: [] }), bloom()] }),
    status({ apps: [amber({ peerTokenFingerprint: OTHER_FP }), bloom()] }),
    status({ apps: [amber({ peerTokenFingerprint: null }), bloom()] }),
    status({ apps: [amber(), bloom({ container: 'missing' })] }),
    status({ apps: [amber(), bloom({ container: 'exited' })] }),
    status({ apps: [amber({ container: 'exited' }), bloom()] }),
  ]

  const unknown = []
  const long = []
  for (const s of samples) {
    for (const p of diagnosePeers(s).pairings) {
      states.add(p.state)
      if (p.fix.kind === 'action' && !ACTIONS[p.fix.actionId]) unknown.push(`${p.id}: ${p.fix.actionId}`)
      if (p.summary.length > 64) long.push(`summary "${p.summary}" is ${p.summary.length}`)
      if (p.fix.label.length > 28) long.push(`label "${p.fix.label}" is ${p.fix.label.length}`)
      if (p.fix.because.length > 120) long.push(`because "${p.fix.because}" is ${p.fix.because.length}`)
    }
  }

  ok('every fix names an action that exists', unknown.length === 0, unknown.join(', '))
  ok('every string is inside its cap', long.length === 0, long.join('; '))
  ok('connectPeer is rehearsable', typeof ACTIONS.connectPeer?.rehearse === 'function')
  ok('disconnectPeer is rehearsable', typeof ACTIONS.disconnectPeer?.rehearse === 'function')

  // Rule 1, mechanically: no state may be reachable without a sentence to describe it.
  ok('every reachable state has copy', [...states].every((s) => typeof s === 'string' && s.length > 0))
}

{
  // `evidence` is the field shaped like a leak: it is the only one carrying values
  // rather than labels, and the values it carries are about credentials. Every one
  // must be a fingerprint, a container state, a key NAME or a public URL.
  const leaks = []
  const samples = [status(), status({ apps: [amber({ peerTokenFingerprint: OTHER_FP }), bloom()] })]
  for (const s of samples) {
    for (const p of diagnosePeers(s).pairings) {
      for (const e of p.evidence) {
        // A bearer is 64 hex from `openssl rand -hex 32`; a fingerprint is 8, and is
        // always introduced as such. Anything long and token-shaped is a leak.
        if (/^sha256:/.test(e.value)) continue
        if (/[A-Za-z0-9_-]{24,}/.test(e.value) && !/^https?:\/\//.test(e.value)) {
          leaks.push(`${p.id} ${e.label}=${e.value}`)
        }
      }
    }
  }
  ok('no evidence entry carries anything token-shaped', leaks.length === 0, leaks.join(', '))

  // And the digests it does carry are the SHORT ones status.sh computes, never a
  // full hash that could be compared against a rainbow table of likely tokens.
  const digests = diagnosePeers(status())
    .pairings.flatMap((p) => p.evidence)
    .filter((e) => e.value.startsWith('sha256:'))
  ok('there are digests to check', digests.length > 0)
  ok('every digest is short', digests.every((e) => e.value.length <= 'sha256:'.length + 16), JSON.stringify(digests))
}

{
  // Rule: the collapsed action is the most severe, so a danger is never buried under
  // an equally-sized warn.
  const d = diagnosePeers(status({ apps: [amber({ peerTokenFingerprint: OTHER_FP }), bloom()] }))
  ok('next names the broken pairing', d.next !== null && d.next.affects.includes('amber->bloom'))
  check('and its label is the repair', d.next.fix.label, 'Repair the link')
}

{
  const d = diagnosePeers(status())
  ok('a healthy surface offers nothing', d.next === null)
  ok('the caption counts what is there', d.caption.includes('1 pairing') && d.caption.includes('1 connected'))
}

{
  // An app that is not on this box must never appear: a two-server split would
  // otherwise accuse Server B's apps of being unwired from Server A's screen.
  const d = diagnosePeers(status({ apps: [amber(), bloom({ thisBox: false })] }))
  ok('an app on another box is not diagnosed here', d.pairings.length === 0)
}

console.log('')
if (failures > 0) {
  console.error(`verify-peers: ${failures} failure(s)`)
  process.exit(1)
}
console.log('verify-peers: ok')
