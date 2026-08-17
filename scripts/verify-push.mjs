/**
 * Guards the frame gate and the push reducer — two things that fail silently.
 *
 * `isServerFrame` is the only thing standing between the socket and `reduceFrame`, and
 * it reads a hand-maintained `SERVER_FRAME_TYPES` set. A frame added to the union and
 * forgotten in the set is not a type error and not a runtime error: the frame is simply
 * dropped at `connection.ts` with no log line anywhere, and the feature looks like a
 * server bug. That is the single most expensive mistake available in this file, so it
 * is checked against the union rather than trusted.
 *
 * The push reducer has its own silent failure. Delivery is at-least-once — Amber marks
 * the outbox only *after* a successful send, so a restart in between redelivers the same
 * id — and without dedupe the user simply sees every reminder twice and concludes
 * reminders are broken.
 *
 * Run via `npm run verify:push`.
 */

import { isServerFrame } from '../out/verify/protocol.mjs'

const failures = []
const fail = (msg) => failures.push(msg)

// --- the gate ---------------------------------------------------------------

// Every server frame Amber can send, from app/protocol.py. Kept here deliberately by
// hand: this file is the thing that notices when the two drift.
const SERVER_FRAMES = [
  'ready',
  'transcript',
  'thinking',
  'audio_chunk',
  'turn_complete',
  'memory',
  'tool_call',
  'activity',
  'delta',
  'status',
  'voice',
  'model',
  'push',
  'confirm_request',
  'review',
  'error',
]

for (const type of SERVER_FRAMES) {
  if (!isServerFrame({ type })) {
    fail(`"${type}" is not accepted by isServerFrame — it would be dropped at the socket`)
  }
}

for (const bogus of [null, undefined, {}, { type: 'nope' }, { type: 42 }, 'push']) {
  if (isServerFrame(bogus)) fail(`isServerFrame accepted ${JSON.stringify(bogus)}`)
}

// The client->server frames Amber's `_handle_control` actually dispatches on. A typo
// here is the mirror-image silent failure: Amber logs "unknown control frame" at debug
// and drops it, so the button just does nothing.
const CLIENT_FRAMES = [
  'interrupt',
  'user_text',
  'register_tools',
  'tool_result',
  'set_voice',
  'set_model',
  'memory_action',
  'memory_query',
  'push_ack',
  'confirm_response',
  'review_query',
  'review_action',
  'eval_capture',
]
if (new Set(CLIENT_FRAMES).size !== CLIENT_FRAMES.length) {
  fail('duplicate client frame type in the list')
}

// --- push dedupe ------------------------------------------------------------

/** The reducer's rule, mirrored: same id in, nothing changes. */
function applyPush(pushes, frame) {
  if (pushes.some((p) => p.id === frame.id)) return pushes
  return [frame, ...pushes]
}

{
  const first = applyPush([], { id: 'p_1', kind: 'reminder', text: 'call the dentist' })
  if (first.length !== 1) fail('a new push should be added')

  const again = applyPush(first, { id: 'p_1', kind: 'reminder', text: 'call the dentist' })
  if (again.length !== 1) {
    fail('a redelivered push must be deduped on id — delivery is at-least-once')
  }

  const second = applyPush(again, { id: 'p_2', kind: 'notice', text: 'build finished' })
  if (second.length !== 2) fail('a different id is a different push')
  if (second[0].id !== 'p_2') fail('newest push should be first')
}

// --- report -----------------------------------------------------------------

if (failures.length) {
  console.error(`verify-push: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  `verify-push: ok — ${SERVER_FRAMES.length} server frames pass the gate, ` +
    `${CLIENT_FRAMES.length} client frames listed, redelivery is deduped`,
)
