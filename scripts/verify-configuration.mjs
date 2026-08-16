/**
 * How an app's configuration list is classified.
 *
 * This is the arithmetic behind what an operator is told is wrong, and every way of
 * getting it wrong is quiet. Call a derived key "needed" and you send someone hunting
 * for a value `install.sh` is about to overwrite. Call a missing key "managed" and the
 * app runs without it, healthy and green, missing exactly one capability. Miss the
 * `live` join and a value sits in the editor that the container has never read.
 *
 * Driven headlessly like `verify-credentials.mjs`: `shared/configuration.ts` imports no
 * Electron, which is the reason it is not a component.
 */
import { readinessOf } from '../out/verify/credentials.mjs'
import { buildConfigView, looksSecret } from '../out/verify/configuration.mjs'

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

/** An `EnvVar` as `status.sh` reports one. */
function env(name, over = {}) {
  return {
    name,
    secret: looksSecret(name),
    derived: false,
    placeholder: false,
    set: true,
    value: looksSecret(name) ? null : 'v',
    ...over,
  }
}

const groupOf = (view, name) => view.rows.find((r) => r.name === name)?.group ?? 'ABSENT'

/** What `readinessOf` reads out of the env: set-ness and placeholder-ness, no values. */
function valuesOf(vars) {
  const out = {}
  for (const v of vars) out[v.name] = { set: v.set, placeholder: v.placeholder }
  return out
}

console.log('\nlooksSecret — the fallback mask rule\n')

check('a key suffix masks', looksSecret('AMBER_OPENROUTER_API_KEY'), true)
check('a token suffix masks', looksSecret('BLOOM_MCP_TOKEN'), true)
check('a plain setting does not', looksSecret('AMBER_TIMEZONE'), false)
check('a keys list masks', looksSecret('AMBER_MCP_KEYS'), true)

console.log('\nbuildConfigView — who fills it decides where it goes\n')

const KEYS = [
  { name: 'A_OPENROUTER_API_KEY', kind: 'supplied', credential: 'openrouter-api-key', label: 'OpenRouter', required: true, secret: true },
  { name: 'A_MCP_KEYS', kind: 'generated:token', label: 'MCP keys', required: true, secret: true },
  { name: 'A_PUBLIC_URL', kind: 'derived', label: 'Public URL', required: true },
  { name: 'A_TIMEZONE', kind: 'config', default: 'UTC', label: 'Timezone', required: false, why: 'stamped on every turn' },
  { name: 'A_DB_PATH', kind: 'config', label: 'Database path', required: true },
]

// A deployed app: the two config keys and the generated token are written, the
// OpenRouter key never was, and the derived URL is in the live env only.
const ENV = [
  env('A_MCP_KEYS'),
  env('A_TIMEZONE', { value: 'America/New_York' }),
  env('A_DB_PATH', { value: '/data/a.db' }),
  env('A_PUBLIC_URL', { derived: true, value: 'https://a.example' }),
  env('A_EXTRA_FLAG', { value: 'true' }),
]
const LIVE = ['A_MCP_KEYS', 'A_TIMEZONE', 'A_DB_PATH', 'A_PUBLIC_URL']

const deployed = buildConfigView(ENV, LIVE, readinessOf(KEYS, valuesOf(ENV), []))

check('a supplied key nothing wrote is needed', groupOf(deployed, 'A_OPENROUTER_API_KEY'), 'needed')
check('a derived key is managed, never a task', groupOf(deployed, 'A_PUBLIC_URL'), 'managed')
check('a generated token is managed', groupOf(deployed, 'A_MCP_KEYS'), 'managed')
check('a set config key is a changeable setting', groupOf(deployed, 'A_TIMEZONE'), 'settings')
check('a hand-added non-secret is a setting', groupOf(deployed, 'A_EXTRA_FLAG'), 'settings')

check('only the required missing key blocks', deployed.blocking.map((r) => r.name), ['A_OPENROUTER_API_KEY'])
check('the manifest reason survives the join', deployed.rows.find((r) => r.name === 'A_TIMEZONE').why, 'stamped on every turn')
check('manifest order first, hand-added last', deployed.rows.at(-1).name, 'A_EXTRA_FLAG')

console.log('\nsecrecy — a value the report withheld is never rendered\n')

// The manifest says secret and status.sh withheld the value. Both must agree, because
// the UI decides to mask from THIS flag and the value was withheld by the other one.
check('a manifest secret is secret', deployed.rows.find((r) => r.name === 'A_MCP_KEYS').secret, true)
check('a suffix-only secret is secret', buildConfigView([env('X_API_TOKEN', { set: false, value: null })], [], null).rows[0].secret, true)
check('a plain setting is not', deployed.rows.find((r) => r.name === 'A_TIMEZONE').secret, false)

console.log('\nthe live join — set is not applied\n')

check('a key in secrets.yaml but not the running env is pending', deployed.pending.map((r) => r.name), ['A_EXTRA_FLAG'])
check('a pending row is marked not live', deployed.rows.find((r) => r.name === 'A_EXTRA_FLAG').live, false)
// Every row is "not live" before an install, and calling that drift would be an alarm
// about the ordinary state of not having installed it yet.
check(
  'nothing is pending when nothing is deployed',
  buildConfigView(ENV, [], readinessOf(KEYS, valuesOf(ENV), [])).pending.length,
  0,
)

console.log('\nthe vault — a key you already hold is still a key the app lacks\n')

const VAULT = [
  { uid: 'u1', credentialId: 'openrouter-api-key', label: 'OpenRouter (personal)', createdAt: 1, updatedAt: 2, readable: true },
]
const withVault = buildConfigView(ENV, LIVE, readinessOf(KEYS, valuesOf(ENV), VAULT))
check('a fillable key is still listed as needed', groupOf(withVault, 'A_OPENROUTER_API_KEY'), 'needed')
check('…and marked one click away', withVault.rows.find((r) => r.name === 'A_OPENROUTER_API_KEY').fillable, true)
// The contrast this pair exists to pin down: `readiness.missing` is empty, so the
// Install button is not blocked and the checklist reads 3 of 3 — while the running app
// has no OpenRouter key at all. Two different questions, and conflating them is how a
// green checklist sat above an app that could not reach a model.
check('…while the install-time count is not blocked', readinessOf(KEYS, valuesOf(ENV), VAULT).missing.map((m) => m.name), [])
check('…and the app still lacks a written value', withVault.rows.find((r) => r.name === 'A_OPENROUTER_API_KEY').filled, false)

console.log('\nno manifest — a box whose status.sh predates them\n')

const bare = buildConfigView(
  [env('A_TIMEZONE', { value: 'UTC' }), env('A_API_KEY', { set: false, value: null }), env('A_OLD', { placeholder: true, value: 'CHANGEME' })],
  ['A_TIMEZONE'],
  null,
)
check('an unset key is needed', groupOf(bare, 'A_API_KEY'), 'needed')
check('a CHANGEME is needed', groupOf(bare, 'A_OLD'), 'needed')
check('a set value is a setting', groupOf(bare, 'A_TIMEZONE'), 'settings')
// Nothing declared these, so nothing can call them required — painting every
// hand-added row as blocking would make the count meaningless.
check('nothing is blocking without a manifest', bare.blocking.length, 0)

console.log('\nunknown kinds degrade, they do not crash\n')

const future = buildConfigView(
  [env('A_QUANTUM', { value: 'q' })],
  ['A_QUANTUM'],
  readinessOf([{ name: 'A_QUANTUM', kind: 'quantum:entangled', required: true }], { A_QUANTUM: { set: true, placeholder: false } }, []),
)
check('an unrecognised kind that is set is a setting', groupOf(future, 'A_QUANTUM'), 'settings')

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
