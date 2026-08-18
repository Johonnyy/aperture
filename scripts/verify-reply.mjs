/**
 * Guards how a reply is cut into bubbles, and the one invariant the caret rests on.
 *
 * Two bugs live here, and both are the kind that look like a server problem.
 *
 * **A caret that outlives its turn.** `streaming` drives the blinking block at the end
 * of a reply. Every turn that ends without `turn_complete` — an error, a socket that
 * dropped, a barge-in — used to leave it set forever, so the log filled up with
 * finished replies all claiming more text was coming, all blinking in step. Nothing
 * fails, nothing logs; the client simply lies. So the rule checked here is stronger
 * than "turn_complete clears it": **at most one message is ever streaming, and only
 * while text is genuinely arriving into it.**
 *
 * **A turn rendered as one paragraph.** "Sure, I'll take care of that" → three tool
 * calls → "all done" is three things in sequence. Appending the second reply to the
 * first collapses them into one bubble with the cards stranded above it, which is not
 * the order they happened in. A `delta` continues a bubble only when that bubble is
 * the *last item in the timeline*.
 *
 * Run via `npm run verify:reply`.
 */

import { useStore } from '../out/verify/store.mjs'

const failures = []
const fail = (msg) => failures.push(msg)

const reset = () => useStore.setState({ timeline: [], trace: [] })
const send = (frame) => useStore.getState().ingest({ kind: 'frame', frame })
const timeline = () => useStore.getState().timeline
const messages = () => timeline().filter((i) => i.kind === 'message')
const replies = () => messages().filter((m) => m.role === 'amber')
const open = () => messages().filter((m) => m.streaming)

/** The invariant, checked after every single frame in every scenario below. */
const invariant = (where) => {
  if (open().length > 1) fail(`${where}: ${open().length} messages streaming at once`)
  const last = timeline().at(-1)
  for (const m of open()) {
    if (m.id !== last?.id) fail(`${where}: a streaming message is not the last item`)
  }
}

const drive = (where, frames) => {
  reset()
  for (const frame of frames) {
    send(frame)
    invariant(`${where} (after ${frame.type})`)
  }
}

const activityStart = (id, name) => ({
  type: 'activity',
  phase: 'start',
  id,
  name,
  origin: 'own',
})
const activityEnd = (id, name) => ({
  type: 'activity',
  phase: 'end',
  id,
  name,
  origin: 'own',
  ok: true,
  ms: 12,
})
const complete = (extra = {}) => ({ type: 'turn_complete', sentences: 1, ...extra })

// --- a plain turn -----------------------------------------------------------

drive('plain turn', [
  { type: 'transcript', text: 'hello' },
  { type: 'delta', text: 'Hi ' },
  { type: 'delta', text: 'there.' },
])
if (replies().length !== 1) fail(`plain turn: ${replies().length} bubbles, expected 1`)
if (replies()[0]?.raw !== 'Hi there.') fail('plain turn: deltas did not concatenate')
if (!replies()[0]?.streaming) fail('plain turn: the open reply is not marked streaming')

send(complete())
if (open().length !== 0) fail('plain turn: turn_complete left a bubble streaming')

// --- text, tools, then more text -------------------------------------------

drive('segmented turn', [
  { type: 'transcript', text: 'update the server' },
  { type: 'delta', text: "Sure, I'll take care of that for you." },
  activityStart('c1', 'update_server'),
  activityEnd('c1', 'update_server'),
  { type: 'delta', text: 'All done — it restarted cleanly.' },
  complete(),
])

const segmented = replies()
if (segmented.length !== 2) {
  fail(`segmented turn: ${segmented.length} bubbles, expected 2 (one per segment)`)
}
if (segmented[0]?.raw !== "Sure, I'll take care of that for you.") {
  fail('segmented turn: the first bubble is not the narration alone')
}
if (segmented[1]?.raw !== 'All done — it restarted cleanly.') {
  fail('segmented turn: the report was appended to the narration instead of opening a bubble')
}
// Order is the information: narration, card, report.
const kinds = timeline().map((i) => (i.kind === 'message' ? i.role : i.kind))
if (kinds.join(' ') !== 'user amber activity amber') {
  fail(`segmented turn: timeline reads "${kinds.join(' ')}"`)
}

// --- endings that are not turn_complete ------------------------------------

// `thinking:false` is the earliest ending and the one that survives a turn that
// raised or was interrupted — it is sent from a `finally`, before `turn_complete`.
drive('thinking settles the reply', [
  { type: 'transcript', text: 'hello' },
  { type: 'thinking', active: true },
  { type: 'delta', text: 'Hey there!' },
  { type: 'thinking', active: false },
])
if (open().length !== 0) fail('thinking: active=false left the bubble streaming')

drive('failed turn', [
  { type: 'transcript', text: 'go' },
  { type: 'delta', text: 'Working on' },
  { type: 'error', message: 'upstream timed out', code: 'llm_error' },
])
if (open().length !== 0) fail('failed turn: an error left the bubble streaming')

drive('stranded turn', [
  { type: 'transcript', text: 'go' },
  { type: 'delta', text: 'Working on' },
  // No ending at all — the socket died. The next turn is the proof it is over.
  { type: 'transcript', text: 'still there?' },
])
if (open().length !== 0) fail('stranded turn: the next turn did not settle the old bubble')

reset()
send({ type: 'delta', text: 'half a th' })
useStore.getState().addUserMessage('never mind')
if (open().length !== 0) fail('typed turn: sending settled nothing')

// --- the sentence fallback must not duplicate the reply ---------------------

drive('sentences alongside deltas', [
  { type: 'transcript', text: 'hello' },
  { type: 'delta', text: 'Hi there.' },
  { type: 'audio_chunk', index: 0, text: 'Hi there.' },
  complete(),
])
if (replies().length !== 1) {
  fail(`sentences alongside deltas: ${replies().length} bubbles — audio_chunk opened its own`)
}

// An Amber with no `delta` frame at all: sentences are the only text there is. They
// segment on the same rule, and consecutive ones still join into one bubble rather
// than one bubble per sentence.
drive('sentences only', [
  { type: 'transcript', text: 'hello' },
  { type: 'audio_chunk', index: 0, text: 'Hi there.' },
  { type: 'audio_chunk', index: 1, text: 'One moment.' },
  activityStart('c1', 'web_search'),
  activityEnd('c1', 'web_search'),
  { type: 'audio_chunk', index: 2, text: 'Found it.' },
  complete(),
])
const spoken = replies()
if (spoken.length !== 2) fail(`sentences only: ${spoken.length} bubbles, expected 2`)
if (spoken[0]?.text !== 'Hi there. One moment.') {
  fail(`sentences only: sentences joined as "${spoken[0]?.text}"`)
}
if (spoken[1]?.text !== 'Found it.') {
  fail(`sentences only: the post-tool sentence did not open its own bubble`)
}

// --- the turn mark records everything she said ------------------------------

drive('turn mark', [
  { type: 'transcript', text: 'update the server' },
  { type: 'delta', text: 'On it.' },
  activityStart('c1', 'update_server'),
  activityEnd('c1', 'update_server'),
  { type: 'delta', text: 'Done.' },
  complete({ timings: { total_ms: 1000 } }),
])
const mark = timeline().find((i) => i.kind === 'turn')
if (!mark) {
  fail('turn mark: none was appended')
} else if (!mark.reply.includes('On it.') || !mark.reply.includes('Done.')) {
  fail(`turn mark: reply is "${mark.reply}" — a segment was dropped`)
}

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error('verify:reply FAILED')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('verify:reply ok')
