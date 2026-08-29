/**
 * The TouchDesigner extension: the wire format, the resolution, and the enum seam.
 *
 * Everything here fails *quietly* in production if it is wrong, which is the whole
 * reason the file exists.
 *
 * - A `control` declared on `switch_scene` would beat the inferred scene picker for
 *   ever, on every client, with nothing anywhere saying so.
 * - `permissions` in the wrong order re-gates three actions behind the wrong consent
 *   toggle, because `permissionFor` falls back to `permissions[0]` for an undotted name.
 * - `withChoices` mutating its input would leak an enum into `MANIFESTS`, a module
 *   singleton the Settings page and `summarize()` also read, with no way to clear it.
 * - `enum: []` is a schema no value satisfies, so an empty scene list would make the
 *   action *uncallable* rather than unconstrained.
 *
 * None of it needs Electron, a socket, or a running TouchDesigner: the modules under
 * test import nothing but types, which is the same split `bloom/wire.ts` makes against
 * `bloom/client.ts`.
 */
import { readFileSync } from 'node:fs'

import {
  capabilitiesFor,
  findAction,
  grantKey,
  isAllowed,
  permissionFor,
  withChoices,
  MAX_ACTION_TIMEOUT_MS,
  MAX_CHOICES,
} from '../out/verify/extensions.mjs'
import { MANIFESTS } from '../out/verify/extension-index.mjs'
import {
  bridgeBody,
  bridgeUrl,
  fetchTimeoutFor,
  normalizePort,
  parseBridgeResponse,
  TD_DEFAULT_PORT,
} from '../out/verify/td-bridge.mjs'
import {
  extractScenes,
  normalizeScenes,
  sameScenes,
  TD_SWITCH_SCENE_KEY,
} from '../out/verify/td-scenes.mjs'
import {
  foldName,
  nameTaken,
  normalizeProjects,
  resolveProject,
} from '../out/verify/td-projects.mjs'
import { launchCommand, tdProcessName } from '../out/verify/td-process.mjs'
import { WEB_SERVER_DAT_CALLBACK } from '../out/verify/td-callback.mjs'

let failures = 0
const fail = (msg) => {
  console.error(`  x ${msg}`)
  failures++
}
const eq = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  }
}
const ok = (label, cond) => {
  if (!cond) fail(label)
}

const td = MANIFESTS.find((m) => m.id === 'touchdesigner')
if (!td) {
  console.error('  x no touchdesigner manifest in MANIFESTS')
  process.exit(1)
}
const action = (name) => td.actions.find((a) => a.name === name)

// --- the manifest ------------------------------------------------------------

eq(
  'the five actions are declared',
  td.actions.map((a) => a.name).sort(),
  ['list_scenes', 'process.close', 'process.launch', 'send_command', 'switch_scene'],
)

// `permissionFor` takes the first dot-segment when the manifest declares it as a
// permission, and otherwise falls back to `permissions[0]`. Reversing this array would
// silently move switch_scene / list_scenes / send_command behind the `process` toggle.
eq(
  'permissions are ["network","process"] IN THAT ORDER — network must be [0], it is the fallback for the undotted actions',
  td.permissions,
  ['network', 'process'],
)

eq('process.launch consumes `process`', permissionFor(td, action('process.launch')), 'process')
eq('process.close consumes `process`', permissionFor(td, action('process.close')), 'process')
for (const name of ['switch_scene', 'list_scenes', 'send_command']) {
  eq(`${name} falls back to \`network\``, permissionFor(td, action(name)), 'network')
}

// The easiest way to break the whole feature invisibly: `toGeneric` in controls.ts
// prefers a declared hint over inference, so a control here would permanently replace
// the scene picker with a button that sends no scene.
ok(
  'switch_scene declares NO control — a declared hint beats the inferred scene picker for ever',
  action('switch_scene').control === undefined,
)

eq(
  'only process.close is destructive',
  td.actions.filter((a) => a.destructive).map((a) => a.name),
  ['process.close'],
)
eq('process.close declares a danger button', action('process.close').control, {
  kind: 'button',
  label: 'Close',
  tone: 'danger',
})

for (const a of td.actions) {
  ok(`${a.name} stays inside the action timeout ceiling`, a.timeoutMs <= MAX_ACTION_TIMEOUT_MS)
  // Our sentence has to beat the registry's cutoff, or the model gets a bare timeout
  // instead of "nothing is listening on 9980".
  ok(`${a.name}: the fetch budget is strictly under the action budget`, fetchTimeoutFor(a.timeoutMs) < a.timeoutMs)
  ok(`${a.name}: the fetch budget is still usable`, fetchTimeoutFor(a.timeoutMs) >= 1000)
  // A dotted name on the register_tools surface hits Amber's sanitizer.
  ok(`${a.name} is not exposed as a conversation tool`, a.expose === undefined || a.expose === 'device')
}

ok('TD_SWITCH_SCENE_KEY names a real action', Boolean(findAction(MANIFESTS, TD_SWITCH_SCENE_KEY)))

// --- the enum seam -----------------------------------------------------------

const granted = [grantKey('touchdesigner', 'network'), grantKey('touchdesigner', 'process')]
const base = capabilitiesFor(MANIFESTS, 'win32', (key) => isAllowed(MANIFESTS, granted, key))
const manifestsBefore = JSON.stringify(MANIFESTS)
const baseBefore = JSON.stringify(base)

const spliced = withChoices(base, TD_SWITCH_SCENE_KEY, { scene: ['ambient', 'spotify', 'ps5'] })
const sceneProp = spliced.find((c) => c.action === TD_SWITCH_SCENE_KEY).input_schema.properties.scene
eq('the real manifest gains a scene enum', sceneProp.enum, ['ambient', 'spotify', 'ps5'])
ok('the enum keeps the declared type', sceneProp.type === 'string')

// Copy-on-write. MANIFESTS is a Rollup-inlined singleton the Settings page and
// `summarize()` also read; an in-place write would leak the enum with no way to clear it.
eq('MANIFESTS is structurally unchanged', JSON.stringify(MANIFESTS), manifestsBefore)
eq('the input array is structurally unchanged', JSON.stringify(base), baseBefore)
ok(
  'untouched capabilities are the very same objects',
  spliced.every((c, i) => c.action === TD_SWITCH_SCENE_KEY || c === base[i]),
)

// An empty list must write nothing: `enum: []` is satisfied by no value, so it would
// make the action uncallable rather than unconstrained.
ok('an empty list returns the input untouched', withChoices(base, TD_SWITCH_SCENE_KEY, { scene: [] }) === base)
ok('a list of only junk returns the input untouched', withChoices(base, TD_SWITCH_SCENE_KEY, { scene: [1, null, '  '] }) === base)
ok('no enums at all returns the input untouched', withChoices(base, TD_SWITCH_SCENE_KEY, {}) === base)

// Decorate, never add — the grant gate stays the only thing deciding what is announced.
const ungranted = capabilitiesFor(MANIFESTS, 'win32', () => false)
eq('nothing is announced without a grant', ungranted.length, 0)
eq('withChoices adds nothing to an empty set', withChoices(ungranted, TD_SWITCH_SCENE_KEY, { scene: ['a'] }).length, 0)

// A typo in the arg name must be visible, not a silent no-op that ships.
ok('an undeclared property is left alone', withChoices(base, TD_SWITCH_SCENE_KEY, { scenes: ['a'] }) === base)
ok('an unknown action is left alone', withChoices(base, 'touchdesigner.nope', { scene: ['a'] }) === base)
ok(
  'an action with no input_schema is left alone',
  withChoices(base, 'touchdesigner.process.close', { scene: ['a'] }) === base,
)

const messy = withChoices(base, TD_SWITCH_SCENE_KEY, { scene: ['  a  ', 'a', 'b', '', 'x'.repeat(200)] })
eq(
  'values are trimmed, deduped and bounded',
  messy.find((c) => c.action === TD_SWITCH_SCENE_KEY).input_schema.properties.scene.enum,
  ['a', 'b'],
)
const many = withChoices(base, TD_SWITCH_SCENE_KEY, {
  scene: Array.from({ length: 100 }, (_, i) => `s${i}`),
})
eq(
  'the value count is capped',
  many.find((c) => c.action === TD_SWITCH_SCENE_KEY).input_schema.properties.scene.enum.length,
  MAX_CHOICES,
)

// --- the wire ----------------------------------------------------------------

// 127.0.0.1, never `localhost`: modern Windows and macOS resolve `localhost` to ::1
// first, and a Web Server DAT binds IPv4 — an opaque refusal against a running project.
eq(
  'the bridge URL is literally 127.0.0.1 — localhost resolves to ::1 first and would miss an IPv4-bound DAT',
  bridgeUrl(9980),
  'http://127.0.0.1:9980/',
)

eq('the request envelope is {command, args}', bridgeBody('switch_scene', { scene: 'ps5' }), {
  command: 'switch_scene',
  args: { scene: 'ps5' },
})
eq('a non-object args becomes {}', bridgeBody('x', 'nope'), { command: 'x', args: {} })
eq('an array args becomes {}', bridgeBody('x', ['a']), { command: 'x', args: {} })
eq('a missing args becomes {}', bridgeBody('x', undefined), { command: 'x', args: {} })

for (const bad of [0, 65536, -1, 9.5, NaN, '9980x', null, undefined, {}]) {
  eq(`a broken port ${JSON.stringify(bad) ?? 'undefined'} falls back to the default`, normalizePort(bad), TD_DEFAULT_PORT)
}
eq('a numeric string port is accepted', normalizePort(' 1234 '), 1234)
eq('a number port is accepted', normalizePort(6666), 6666)

// The distinction the handler messages rest on: "nothing answered" sends you to the
// port, "the project said no" sends you to the scene name. Merging them helps nobody.
eq('an ok envelope carries the result', parseBridgeResponse(200, '{"status":"ok","result":{"scenes":["a"]}}'), {
  ok: true,
  result: { scenes: ['a'] },
})
eq('an ok envelope with no result is still ok', parseBridgeResponse(200, '{"status":"ok"}'), { ok: true, result: {} })

const refused = parseBridgeResponse(200, '{"status":"error","message":"unknown scene"}')
eq('an error envelope is a `project` failure carrying its reason', [refused.ok, refused.kind, refused.error], [
  false,
  'project',
  'unknown scene',
])
const blank = parseBridgeResponse(200, '{"status":"error"}')
eq('an error envelope with no message still says something', [blank.ok, blank.kind, blank.error.length > 0], [
  false,
  'project',
  true,
])

for (const [label, status, body] of [
  ['non-JSON', 200, '<html>hi</html>'],
  ['an empty body', 200, ''],
  ['a JSON array', 200, '[1,2]'],
  ['a body with no status field', 200, '{"scenes":[]}'],
  ['a 500 from something else', 500, 'Internal Server Error'],
]) {
  const r = parseBridgeResponse(status, body)
  eq(`${label} is a \`transport\` failure, not the project speaking`, [r.ok, r.kind], [false, 'transport'])
}
// An error envelope is honoured whatever the status says: the project chose to send it.
eq(
  'an error envelope on a 400 is still the project speaking',
  parseBridgeResponse(400, '{"status":"error","message":"nope"}').kind,
  'project',
)

// --- scenes ------------------------------------------------------------------

eq('scenes are trimmed, deduped and ordered', normalizeScenes([' b ', 'a', 'b', '', 3, null, 'a']), ['b', 'a'])
eq('an over-long scene name is dropped', normalizeScenes(['ok', 'x'.repeat(200)]), ['ok'])
eq('a non-array is no scenes', normalizeScenes('nope'), [])
ok('order is meaningful, so a reorder is a change', !sameScenes(['a', 'b'], ['b', 'a']))
ok('an identical list is not a change', sameScenes(['a', 'b'], ['a', 'b']))

// null and [] are different answers: "did not mention scenes" must leave a cache alone,
// "has no scenes" must clear it.
eq('a reply that never mentions scenes is null', extractScenes({ current_scene: 'ps5' }), null)
eq('a non-array scenes field is null', extractScenes({ scenes: 'a,b' }), null)
eq('an empty scenes array is an empty list, not null', extractScenes({ scenes: [] }), [])
eq('a real list comes through normalized', extractScenes({ scenes: ['a', 'a', ' b '] }), ['a', 'b'])

// --- projects ----------------------------------------------------------------

const projects = [
  { id: 'i1', name: 'Bedroom Rig', path: 'C:/rigs/bedroom.toe' },
  { id: 'i2', name: 'Studio', path: 'C:/rigs/studio.toe' },
]
eq('resolves by id', resolveProject(projects, 'i2', '').project.id, 'i2')
eq('resolves by name', resolveProject(projects, 'Bedroom Rig', '').project.id, 'i1')
eq('resolves by folded name', resolveProject(projects, '  bedroom   rig ', '').project.id, 'i1')
eq('falls back to the default', resolveProject(projects, undefined, 'i2').project.id, 'i2')
eq('a lone project needs no default', resolveProject([projects[0]], undefined, '').project.id, 'i1')
ok('an unknown name names the configured ones', resolveProject(projects, 'nope', '').error.includes('Bedroom Rig, Studio'))
// Never guesses between candidates: opening the wrong rig is worse than asking.
ok('ambiguity with no default asks rather than picking', resolveProject(projects, undefined, '').error.includes('Which project'))
ok('no projects at all points at Settings', resolveProject([], undefined, '').error.includes('Settings'))

eq('folding ignores case and inner whitespace', foldName('  Bedroom   RIG '), 'bedroom rig')
ok('a duplicate name is caught', nameTaken(projects, 'bedroom rig'))
ok('a project does not collide with itself', !nameTaken(projects, 'Bedroom Rig', 'i1'))
eq(
  'malformed rows are dropped rather than fatal',
  normalizeProjects([{ id: 'a', name: 'A' }, null, { name: 'no id' }, { id: 'b' }, 'x']),
  [{ id: 'a', name: 'A', path: '' }],
)
eq('a non-array is no projects', normalizeProjects(undefined), [])

// --- argv only, no shell ------------------------------------------------------

// The canary `verify:devices` runs over the power commands, repeated here: values reach
// the OS as argv, so a hostile-looking path is a path that matches nothing — but only
// while there is no shell anywhere to re-parse it.
const HOSTILE = 'C:/rigs/x; rm -rf ~'
eq('a project path is one argument, unquoted and unescaped', launchCommand('td.exe', HOSTILE).args, [HOSTILE])
eq('an empty project path means no arguments', launchCommand('td.exe', '').args, [])
eq('a path with spaces stays one argument', launchCommand('td.exe', 'a b.toe').args, ['a b.toe'])
ok('launchCommand always passes an array', Array.isArray(launchCommand('td.exe', 'x').args))

eq('the Windows process name', tdProcessName('win32'), 'TouchDesigner.exe')
eq('the macOS process name', tdProcessName('darwin'), 'TouchDesigner')
let threw = false
try {
  tdProcessName('linux')
} catch {
  threw = true
}
ok('an unsupported platform throws rather than guessing an executable name', threw)

// A textual canary over the whole extension: the argv rule is only worth anything while
// nothing here reintroduces a shell for something else to re-parse.
/**
 * Code only, never prose.
 *
 * The docstrings in these files quote the very rule they follow, so a canary scanning
 * raw text fires on the comment explaining why the thing it hunts for is forbidden —
 * which is exactly what happened the first time this ran. Block comments and comment
 * lines are dropped; string contents are deliberately left alone, because stripping
 * those could hide a real hit, and a false negative in a canary is worse than a noisy one.
 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

for (const file of ['bridge.ts', 'config.ts', 'process.ts', 'projects.ts', 'refresh.ts', 'scenes.ts']) {
  const source = codeOnly(
    readFileSync(new URL(`../src/main/extensions/touchdesigner/${file}`, import.meta.url), 'utf8'),
  )
  if (/[^A-Za-z.]exec\s*\(/.test(source)) fail(`${file} calls exec() — extensions use execFile/spawn with argv`)
  if (/shell:\s*true/.test(source)) fail(`${file} sets shell: true`)
}

// The canary must still see a real one after stripping, or it protects nothing.
ok(
  'the canary fires on real code',
  /shell:\s*true/.test(codeOnly('/** a docstring */\nspawn(f, a, { shell: true })')),
)
ok(
  'the canary ignores the rule quoted in a docstring',
  !/shell:\s*true/.test(codeOnly('/** never write shell: true here */\nconst x = 1')),
)
ok('the canary still catches a bare exec(', /[^A-Za-z.]exec\s*\(/.test(codeOnly('const r = exec("ls")')))
ok('the canary does not trip on execFile', !/[^A-Za-z.]exec\s*\(/.test(codeOnly('execFile(f, a, cb)')))

// --- the documented callback still matches the protocol ------------------------
//
// The snippet is what someone pastes into TouchDesigner, and it is the only part of this
// feature that lives outside the repo once pasted. If the wire format is reworded here in
// TypeScript and the reference is not, every new setup starts from a broken example — so
// the build fails instead.
for (const needle of [
  'onHTTPRequest',
  'list_scenes',
  'switch_scene',
  'status',
  "'status': 'ok'",
  "'status': 'error'",
  'COMMANDS',
]) {
  ok(`the reference callback still mentions ${needle}`, WEB_SERVER_DAT_CALLBACK.includes(needle))
}
// An explicit dispatch table is the authorization surface; getattr would make every
// operator in the network reachable from a sentence.
// The call, not the word — the snippet's own comment explains why it does not do this,
// and the first version of this check fired on that comment.
ok(
  'the reference callback never getattr()s into the project',
  !/getattr\s*\(/.test(WEB_SERVER_DAT_CALLBACK),
)
ok(
  'and it still says why, so the next person keeps the table',
  WEB_SERVER_DAT_CALLBACK.includes('authorization surface'),
)
ok(
  'the reference callback answers project errors with HTTP 200 so transport stays distinguishable',
  /statusCode.] = 200/.test(WEB_SERVER_DAT_CALLBACK),
)

if (failures) {
  console.error(`\nverify-touchdesigner: ${failures} problem(s)`)
  process.exit(1)
}
console.log(
  `verify-touchdesigner: ok — ${td.actions.length} actions, grants split two ways, ` +
    `enum spliced copy-on-write, envelope and argv checked`,
)
