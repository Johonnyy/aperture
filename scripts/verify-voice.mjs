/**
 * Guards the voice patch — the one place Aperture's "no override" sentinel has to
 * survive a translation.
 *
 * `Settings.ttsVoice`/`ttsModel`/`ttsInstructions` use `''` and `ttsSpeed` uses `0`
 * to mean "leave Amber's own setting alone". On the wire that is `null`, which Amber
 * reads as "reset this field to your configured default" — deliberately NOT an
 * omitted key, which means "don't touch it" and would make clearing a control in the
 * UI a no-op until the next reconnect.
 *
 * Those two readings are one word apart and produce identical-looking JSON in the
 * happy case, which is exactly the kind of thing that rots silently. Hence a check.
 *
 * Run via `npm run verify:voice`, which esbuilds src/main/amber/voice.ts first — the
 * same shape as the sibling verify scripts.
 */

import { applyVoice } from '../out/verify/voice.mjs'
import { FALLBACK_VOICE_OPTIONS as FALLBACK } from '../out/verify/voice-options.mjs'

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

// --- 1. the sentinels become explicit nulls, never omissions -----------------

{
  const amber = fakeAmber()
  applyVoice(amber, settings({}))
  const [frame] = amber.sent

  if (!frame) fail('an all-default settings object sent no frame at all')
  else {
    if (frame.type !== 'set_voice') fail(`wrong frame type: ${frame.type}`)
    for (const key of ['voice', 'model', 'speed', 'instructions']) {
      if (!(key in frame)) {
        fail(`"${key}" was omitted rather than sent as null — Amber reads an absent key as "leave it", so clearing this control would never take effect`)
      } else if (frame[key] !== null) {
        fail(`"${key}" should be null when unset, got ${JSON.stringify(frame[key])}`)
      }
    }
  }
}

// --- 2. real values pass through unchanged ----------------------------------

{
  const amber = fakeAmber()
  applyVoice(
    amber,
    settings({
      ttsVoice: 'nova',
      ttsModel: 'gpt-4o-mini-tts',
      ttsSpeed: 1.25,
      ttsInstructions: 'warm and brisk',
    }),
  )
  const [frame] = amber.sent
  const expected = {
    voice: 'nova',
    model: 'gpt-4o-mini-tts',
    speed: 1.25,
    instructions: 'warm and brisk',
  }
  for (const [key, value] of Object.entries(expected)) {
    if (frame?.[key] !== value) {
      fail(`"${key}" should pass through as ${JSON.stringify(value)}, got ${JSON.stringify(frame?.[key])}`)
    }
  }
}

// --- 3. a partial override leaves the rest resettable -----------------------

{
  const amber = fakeAmber()
  applyVoice(amber, settings({ ttsSpeed: 1.4 }))
  const [frame] = amber.sent
  if (frame?.speed !== 1.4) fail(`speed override lost: ${JSON.stringify(frame?.speed)}`)
  if (frame?.voice !== null) {
    fail('overriding only the speed must still reset the voice — otherwise a voice picked earlier in the session sticks after being cleared')
  }
}

// --- 4. speed 0 is the sentinel, not a speed --------------------------------

{
  const amber = fakeAmber()
  applyVoice(amber, settings({ ttsSpeed: 0 }))
  if (amber.sent[0]?.speed !== null) {
    fail('ttsSpeed 0 must become null, never 0 — the API floor is 0.25 and 0 would be clamped to it')
  }
}

// --- 5. a closed socket is a survivable no-op -------------------------------

{
  const amber = fakeAmber(false)
  const ok = applyVoice(amber, settings({ ttsVoice: 'nova' }))
  if (ok !== false) fail('applyVoice should report false when the socket is down')
  if (amber.sent.length) fail('nothing should be queued while disconnected — `ready` re-sends it')
}

// --- 6. the fallback catalogue is internally coherent -----------------------
//
// It only gets used when Amber hasn't named its own list, which is exactly when
// nothing else can catch it being wrong. The invariant that matters is the model
// split: every model takes `speed` natively or takes `instructions`, never both and
// never neither — the Settings page picks which hint to show from it, so a model in
// neither list would silently claim the speed slider does nothing.

{
  for (const model of FALLBACK.models) {
    const native = FALLBACK.native_speed_models.includes(model)
    const directed = FALLBACK.instruction_models.includes(model)
    if (native === directed) {
      fail(`"${model}" is in ${native ? 'both' : 'neither'} of native_speed_models / instruction_models`)
    }
  }
  for (const model of [...FALLBACK.native_speed_models, ...FALLBACK.instruction_models]) {
    if (!FALLBACK.models.includes(model)) fail(`"${model}" is classified but not offered in models`)
  }
  const [min, max] = FALLBACK.speed_range
  if (!(min > 0 && min < max)) fail(`nonsensical speed_range: ${JSON.stringify(FALLBACK.speed_range)}`)
  if (!FALLBACK.formats.includes('mp3')) {
    fail('mp3 must stay in the format list — it is the one container every renderer decodes')
  }
}

// --- report -----------------------------------------------------------------

if (failures.length) {
  console.error(`verify-voice: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  'verify-voice: ok — sentinels map to null, values pass through, offline is a no-op, ' +
    `${FALLBACK.models.length} fallback models classified`,
)
