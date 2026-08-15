/**
 * The credential vault's two easy-to-get-quietly-wrong parts.
 *
 * One is a security property: `publicView` is the destructure that keeps ciphertext
 * out of the renderer, and it is one character away from not being there. The other is
 * arithmetic: "3 of 4 ready" decides whether the Install button is enabled, so an
 * off-by-one there either blocks a valid install or lets a broken one start.
 *
 * Driven headlessly, like `verify-bloom-keys.mjs`: `credentials.ts` imports no
 * Electron, which is the whole reason it is a separate file from `credential-store.ts`.
 */
import {
  matchFor,
  normalizeId,
  publicView,
  readinessOf,
} from '../out/verify/credentials.mjs'

let failures = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  const mark = ok ? '  ok  ' : ' FAIL '
  const detail = ok
    ? JSON.stringify(actual)
    : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  console.log(`${mark} ${label} — ${detail}`)
}

console.log('\npublicView — the security boundary\n')

const CIPHER = 'BASE64CIPHERTEXTs3cr3t'
const stored = {
  uid: 'u1',
  credentialId: 'openrouter-api-key',
  label: 'OpenRouter',
  createdAt: 1,
  updatedAt: 2,
  encryptedValue: CIPHER,
}

// Asserted on the serialised form, not on the absence of a named property: a nested
// copy would satisfy `!('encryptedValue' in view)` and still ship the ciphertext.
check(
  'the ciphertext cannot survive serialisation of the public view',
  JSON.stringify(publicView(stored, true)).includes(CIPHER),
  false,
)
check('the record itself is not mutated', stored.encryptedValue, CIPHER)
check('readable is carried through', publicView(stored, false).readable, false)

console.log('\nnormalizeId — manifests and hand-typed ids have to meet\n')

check('spaces and case', normalizeId('OpenRouter API Key'), 'openrouter-api-key')
check('already normal', normalizeId('openrouter-api-key'), 'openrouter-api-key')
check('punctuation collapses', normalizeId('  Spotify__client.id  '), 'spotify-client-id')
check('empty stays empty', normalizeId(''), '')
check('null does not throw', normalizeId(null), '')

console.log('\nmatchFor — one saved key, many apps\n')

const vault = [
  { uid: 'a', credentialId: 'openrouter-api-key', label: 'work', createdAt: 1, updatedAt: 10, readable: true },
  { uid: 'b', credentialId: 'openrouter-api-key', label: 'personal', createdAt: 2, updatedAt: 20, readable: true },
  { uid: 'c', credentialId: 'openai-api-key', label: 'openai', createdAt: 3, updatedAt: 30, readable: true },
]

check('no match', matchFor('nope', vault).length, 0)
check('one match', matchFor('openai-api-key', vault).map((m) => m.uid), ['c'])
check('several, newest first', matchFor('openrouter-api-key', vault).map((m) => m.uid), ['b', 'a'])
check('matching is normalised on both sides', matchFor('OpenRouter API Key', vault).length, 2)
check('an empty id matches nothing rather than everything', matchFor('', vault).length, 0)

console.log('\nreadinessOf — what the Install button reads\n')

const KEYS = [
  { name: 'BLOOM_MCP_PUBLIC_URL', kind: 'derived' },
  { name: 'BLOOM_MCP_SYNC_STORE_TOKEN', kind: 'derived' },
  { name: 'BLOOM_MCP_KEYS', kind: 'generated:token' },
  { name: 'BLOOM_FERNET_KEYS', kind: 'generated:fernet' },
  { name: 'BLOOM_DB_PATH', kind: 'config', default: '/data/bloom.db' },
  { name: 'BLOOM_OPENROUTER_API_KEY', kind: 'supplied', credential: 'openrouter-api-key' },
  { name: 'BLOOM_OAUTH_SPOTIFY_CLIENT_ID', kind: 'supplied', credential: 'spotify-client-id', required: false },
]
const ENV = {
  BLOOM_DB_PATH: { set: true, placeholder: false },
  BLOOM_MCP_KEYS: { set: true, placeholder: true },
  BLOOM_OPENROUTER_API_KEY: { set: true, placeholder: true },
}

const withVault = readinessOf(KEYS, ENV, vault)
check('derived keys are not counted at all', withVault.total, 4)
check('everything is ready when the vault has the key', withVault.ready, 4)
check('nothing missing', withVault.missing.length, 0)
check(
  'the supplied key resolves from the vault',
  withVault.items.find((i) => i.name === 'BLOOM_OPENROUTER_API_KEY').state,
  'from-vault',
)
check(
  'a placeholder generated key is still "the box will do it"',
  withVault.items.find((i) => i.name === 'BLOOM_MCP_KEYS').state,
  'generated',
)
check(
  'a real value already in secrets counts as set',
  withVault.items.find((i) => i.name === 'BLOOM_DB_PATH').state,
  'set',
)

const empty = readinessOf(KEYS, ENV, [])
check('3 of 4 ready with an empty vault', [empty.ready, empty.total], [3, 4])
check('and it names what is missing', empty.missing.map((m) => m.name), ['BLOOM_OPENROUTER_API_KEY'])

// The whole point of deriving `readable` rather than trusting the row's existence.
const unreadable = readinessOf(KEYS, ENV, [
  { uid: 'x', credentialId: 'openrouter-api-key', label: 'from another machine', createdAt: 1, updatedAt: 1, readable: false },
])
check(
  'a credential this machine cannot decrypt does not count as ready',
  [unreadable.ready, unreadable.total],
  [3, 4],
)

// An optional key must never block, but must still be offered.
check(
  'an optional supplied key is listed but not counted',
  [
    empty.items.some((i) => i.name === 'BLOOM_OAUTH_SPOTIFY_CLIENT_ID'),
    empty.missing.some((m) => m.name === 'BLOOM_OAUTH_SPOTIFY_CLIENT_ID'),
  ],
  [true, false],
)

// A newer manifest must not crash an older Aperture.
const unknownKind = readinessOf([{ name: 'X', kind: 'quantum:entangled' }], {}, [])
check('an unknown kind degrades to "somebody must supply this"', unknownKind.missing.length, 1)

check('no keys at all is ready, not divide-by-zero', readinessOf([], {}, []).ready, 0)

console.log('\nconfig keys — the ones that blocked an install with no way to unblock it\n')

// BLOOM_DB_PATH and BLOOM_FEATURE_OAUTH both have manifest defaults that declare.sh
// seeds, so they are answered before anyone touches them. With no `config` branch they
// fell through to `needed` — and since a config key names no credential, the checklist
// rendered no way to enter one either. Install was disabled with nothing to click.
const configOnly = readinessOf(
  [
    { name: 'BLOOM_DB_PATH', kind: 'config', default: '/data/bloom.db' },
    { name: 'BLOOM_FEATURE_OAUTH', kind: 'config', default: 'true' },
  ],
  {},
  [],
)
check('a config key with a default does not block', configOnly.missing.length, 0)
check('…and counts as ready', [configOnly.ready, configOnly.total], [2, 2])
check(
  '…in the `default` state, so the value can still be shown and overridden',
  configOnly.items.map((i) => i.state),
  ['default', 'default'],
)
check('…and the default travels with it', configOnly.items[0].default, '/data/bloom.db')

// A default of "false" is a real default. `//`-style falsiness here would push a
// feature flag back into `needed` for the sake of the word false.
check(
  'a falsy-looking default is still a default',
  readinessOf([{ name: 'X_FEATURE', kind: 'config', default: 'false' }], {}, []).missing.length,
  0,
)

// The genuine gap: nothing to fall back on. It must block, and the UI offers a plain
// text field for it rather than a vault lookup.
const noDefault = readinessOf([{ name: 'X_PATH', kind: 'config' }], {}, [])
check('a config key with NO default does block', noDefault.missing.map((m) => m.name), ['X_PATH'])
check('…and has no credential, so it is offered as plain text', noDefault.items[0].credential, null)

// Already answered in secrets.yaml beats the manifest default.
check(
  'a config key already set reads as set, not default',
  readinessOf(
    [{ name: 'BLOOM_DB_PATH', kind: 'config', default: '/data/bloom.db' }],
    { BLOOM_DB_PATH: { set: true, placeholder: false } },
    [],
  ).items[0].state,
  'set',
)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
