/**
 * Guards the model frames — the second place Aperture's "no override" sentinel has
 * to survive a translation, and the first place two different *scopes* travel in one
 * frame type.
 *
 * Two things worth a check:
 *
 * `Settings.llmKeyword` uses `''` for "leave Amber's own choice alone", and on the
 * wire that must be an explicit `null` — the reset — never an omitted key, which
 * means "don't touch it" and would make clearing the control a no-op until the next
 * reconnect. Identical-looking JSON in the happy case; exactly the kind of thing that
 * rots silently.
 *
 * `remapKeyword` writes shared state — Amber's database, and through it the sync
 * store every other app reads. It must never ride along with the connection's own
 * keyword: sending both in one frame would make selecting a keyword in a picker
 * re-point it for the whole ecosystem, which is a very expensive typo.
 *
 * Run via `npm run verify:model`, which esbuilds src/main/amber/model.ts first — the
 * same shape as the sibling verify scripts.
 */

import { applyModel, remapKeyword } from '../out/verify/model.mjs'
import { FALLBACK_KEYWORDS as FALLBACK } from '../out/verify/model-options.mjs'

const failures = []
const fail = (msg) => failures.push(msg)

/** A stand-in for AmberConnection that records what it was asked to send. */
function fakeAmber(open = true) {
  return {
    sent: [],
    send(frame) {
      if (!open) return false
      this.sent.push(frame)
      return true
    },
  }
}

const BASE = {
  amberUrl: 'ws://localhost:8000/ws',
  authToken: '',
  autoReconnect: true,
  confirmBeforeExec: true,
  playAudio: true,
  ttsVoice: '',
  ttsModel: '',
  llmKeyword: '',
  ttsSpeed: 0,
  ttsInstructions: '',
  verboseLogging: true,
  advancedMode: false,
  localEcho: 'auto',
  localEchoThresholdMs: 30,
  terminalSuggestions: true,
  theme: 'darkroom',
}

const settings = (patch) => ({ ...BASE, ...patch })

// --- 1. the sentinel becomes an explicit null, never an omission -------------

{
  const amber = fakeAmber()
  applyModel(amber, settings({}))
  const [frame] = amber.sent

  if (!frame) fail('an all-default settings object sent no frame at all')
  else {
    if (frame.type !== 'set_model') fail(`wrong frame type: ${frame.type}`)
    if (!('keyword' in frame)) {
      fail('"keyword" was omitted rather than sent as null — Amber reads an absent key as "leave it", so returning to its default would never take effect')
    } else if (frame.keyword !== null) {
      fail(`"keyword" should be null when unset, got ${JSON.stringify(frame.keyword)}`)
    }
  }
}

// --- 2. a chosen keyword passes through unchanged ----------------------------

{
  const amber = fakeAmber()
  applyModel(amber, settings({ llmKeyword: 'coding' }))
  if (amber.sent[0]?.keyword !== 'coding') {
    fail(`keyword should pass through, got ${JSON.stringify(amber.sent[0]?.keyword)}`)
  }
}

// --- 3. the two scopes never travel together --------------------------------

{
  const amber = fakeAmber()
  applyModel(amber, settings({ llmKeyword: 'coding' }))
  if ('map' in (amber.sent[0] ?? {})) {
    fail('applyModel must never carry a "map" — picking a keyword for this machine would re-point it for every app in the ecosystem')
  }

  const other = fakeAmber()
  remapKeyword(other, 'coding', 'vendor/coder-9')
  const [frame] = other.sent
  if ('keyword' in (frame ?? {})) {
    fail('remapKeyword must never carry a "keyword" — re-pointing what a word means must not silently switch which brain this connection uses')
  }
  if (frame?.map?.coding !== 'vendor/coder-9') {
    fail(`the map should carry the new model, got ${JSON.stringify(frame?.map)}`)
  }
}

// --- 4. resetting a keyword is null, not an empty string --------------------

{
  const amber = fakeAmber()
  remapKeyword(amber, 'coding', null)
  const value = amber.sent[0]?.map?.coding
  if (value !== null) {
    fail(`resetting must send null (Amber's "back to your default"), got ${JSON.stringify(value)}`)
  }
}

// --- 5. a closed socket is a survivable no-op -------------------------------

{
  const amber = fakeAmber(false)
  if (applyModel(amber, settings({ llmKeyword: 'coding' })) !== false) {
    fail('applyModel should report false when the socket is down')
  }
  if (remapKeyword(amber, 'coding', 'vendor/x') !== false) {
    fail('remapKeyword should report false when the socket is down — there is nowhere local to put shared state')
  }
  if (amber.sent.length) fail('nothing should be queued while disconnected')
}

// --- 6. the fallback keyword list is coherent -------------------------------
//
// It is only used when Amber has not named its own, which is exactly when nothing
// else can catch it being wrong. Two invariants: the names have to be legal keywords
// (Amber silently drops anything else, so an illegal one would be a dead menu entry),
// and no entry may claim to know which model it points at — that answer lives in
// Amber and the sync store, and a guess here would print a wrong model id directly
// above the control for fixing it.

{
  const legal = /^[a-z][a-z0-9_-]{0,31}$/
  for (const keyword of FALLBACK) {
    if (!legal.test(keyword.name)) fail(`"${keyword.name}" is not a legal keyword`)
    if (keyword.model) fail(`"${keyword.name}" ships a guessed model (${keyword.model})`)
    if (!keyword.description) fail(`"${keyword.name}" has no description, so the picker shows a bare word`)
  }
  if (!FALLBACK.some((k) => k.name === 'balanced')) {
    fail('"balanced" must stay in the fallback list — it is Amber\'s own default keyword')
  }
}

// --- report -----------------------------------------------------------------

if (failures.length) {
  console.error(`verify-model: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  'verify-model: ok — the sentinel maps to null, the two scopes stay apart, offline is ' +
    `a no-op, ${FALLBACK.length} fallback keywords coherent`,
)
