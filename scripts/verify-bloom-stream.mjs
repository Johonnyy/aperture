/**
 * The run stream, against a real Bloom.
 *
 * What this covers cannot be covered by a stub, because the behaviour that matters
 * is a *conversation*: Bloom replays a run's log from the cursor, tails it, then
 * closes after the terminal event. The hazard that falls out of that is the
 * finished-run replay loop — reconnect on close, and a finished run replays and
 * closes forever. It is invisible in development, where runs end in a second, and in
 * production it reads as "Bloom is slow".
 *
 * So the load-bearing check here is the last one: re-attaching to a run that has
 * already ended must replay it once and stop.
 *
 * Start Bloom first, from its repo:
 *
 *   BLOOM_DB_PATH=data/stream.db BLOOM_ADMIN_KEYS=Aperture:stream-tok \
 *     BLOOM_OPENROUTER_API_KEY=fake uvicorn app.main:app --port 8041
 *
 * The fake key is deliberate — the run fails immediately, which is all this needs.
 * Skips rather than fails when nothing answers.
 */
import { activeRunStreams, closeAllRunStreams, openRunStream } from '../out/verify/run-stream.mjs'

const base = 'http://127.0.0.1:8041'
const token = 'stream-tok'
const target = { baseUrl: base, token }
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

let failures = 0
function check(label, ok) {
  if (!ok) failures += 1
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`)
}

const reachable = await fetch(`${base}/health`).catch(() => null)
if (!reachable?.ok) {
  console.log(`\n  skip  no Bloom on ${base} — start one to run these checks.\n`)
  process.exit(0)
}

// Self-seeding, so this is repeatable against a database that already has agents.
const existing = await (await fetch(`${base}/admin/agents`, { headers: auth })).json()
const agentId =
  existing[0]?.id ??
  (
    await (
      await fetch(`${base}/admin/agents`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ slug: 'stream-check', name: 'Stream check' }),
      })
    ).json()
  ).id

async function watch(runId, timeoutMs) {
  const seen = []
  await new Promise((resolve) => {
    const done = setTimeout(resolve, timeoutMs)
    openRunStream(target, runId, {
      onEvent: (_id, event) => {
        seen.push(event)
        if (event.kind === 'run_finished' || event.kind === 'stream_lost') {
          clearTimeout(done)
          // A beat, so a stray extra event would still be caught.
          setTimeout(resolve, 300)
        }
      },
    })
  })
  return seen
}

console.log('\na live run\n')

const started = await fetch(`${base}/admin/agents/${agentId}/test-run`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ input: 'hello' }),
})
check('test-run answers 202 with the id up front', started.status === 202)
const { run_id: runId } = await started.json()

const seen = await watch(runId, 30_000)
check('the stream delivered events', seen.length > 0)
check('beginning with run_started', seen[0]?.kind === 'run_started')
check('and ending with a terminal event', seen.at(-1)?.kind === 'run_finished')
check(
  'ids ascend, so the resume cursor is usable',
  seen.filter((e) => e.id > 0).every((e, i, a) => i === 0 || e.id > a[i - 1].id),
)
check('the stream closed itself afterwards', activeRunStreams().length === 0)

// `stream_lost` and `run_finished` are different facts. Synthesising the former for a
// run that ended normally would tell the user contact was lost when nothing was.
check('no stream_lost was invented for a run that ended cleanly', !seen.some((e) => e.kind === 'stream_lost'))

console.log('\nre-attaching to a finished run — the replay loop\n')

const again = await watch(runId, 10_000)
check('it replays the run', again.some((e) => e.kind === 'run_started'))
check('and closes rather than reconnecting forever', activeRunStreams().length === 0)

closeAllRunStreams()
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
