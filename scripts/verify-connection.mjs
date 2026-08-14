/**
 * Protocol conformance check for AmberConnection, against a fake Amber server.
 *
 * `connection.ts` deliberately imports nothing from Electron, so it can be driven
 * headlessly. The fake server replays the exact frame sequences the real Amber
 * emits — including the audio_chunk-then-binary pairing and the 1008 auth refusal —
 * so this catches the mistakes that are otherwise only visible at runtime.
 *
 * Run: node scripts/verify-connection.mjs   (after `npm run verify:build`)
 */
import { WebSocketServer } from 'ws'

import { AmberConnection } from '../out/verify/connection.mjs'

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures++
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Collect frames/audio/status until `predicate` is satisfied or we time out. */
function collect(conn) {
  const frames = []
  const audio = []
  const statuses = []
  conn.on('frame', (f) => frames.push(f))
  conn.on('audio', (buf, meta) => audio.push({ buf, meta }))
  conn.on('status', (s) => statuses.push(s))
  return { frames, audio, statuses }
}

async function until(fn, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (fn()) return true
    await wait(25)
  }
  return false
}

// --- fake Amber -------------------------------------------------------------

function startFakeAmber({ port, requireToken = null }) {
  const wss = new WebSocketServer({ port })
  const state = { connections: 0, lastUrl: null, received: [], sockets: [] }

  wss.on('connection', (ws, req) => {
    state.connections++
    state.lastUrl = req.url
    state.sockets.push(ws)

    if (requireToken) {
      const auth = req.headers.authorization ?? ''
      if (auth !== `Bearer ${requireToken}`) {
        // Amber closes 1008 *before* accepting; the closest analogue here.
        ws.close(1008, 'bad token')
        return
      }
    }

    const url = new URL(req.url, 'http://x')
    const requested = url.searchParams.get('session_id')
    ws.send(
      JSON.stringify({
        type: 'ready',
        session_id: requested ?? 'sess-1',
        resumed: Boolean(requested),
      }),
    )

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        state.received.push({ binary: true, size: data.length })
        return
      }
      const frame = JSON.parse(data.toString())
      state.received.push(frame)

      if (frame.type === 'user_text') {
        ws.send(JSON.stringify({ type: 'transcript', text: frame.text }))
        ws.send(JSON.stringify({ type: 'thinking', active: true }))
        // Two sentences, each announced then sent as binary.
        for (const [i, sentence] of ['First one.', 'Second one.'].entries()) {
          ws.send(
            JSON.stringify({ type: 'audio_chunk', index: i, text: sentence, format: 'mp3' }),
          )
          ws.send(Buffer.from(`AUDIO[${sentence}]`), { binary: true })
        }
        ws.send(JSON.stringify({ type: 'turn_complete', sentences: 2 }))
        ws.send(JSON.stringify({ type: 'thinking', active: false }))
      }
    })
  })

  return {
    state,
    close: () =>
      new Promise((r) => {
        for (const s of state.sockets) s.terminate()
        wss.close(r)
      }),
    dropAll: () => {
      for (const s of state.sockets) s.terminate()
      state.sockets = []
    },
  }
}

// --- tests ------------------------------------------------------------------

async function testHappyPath() {
  console.log('\nhandshake, typed turn, audio pairing')
  const amber = startFakeAmber({ port: 8791 })
  const conn = new AmberConnection({
    url: 'ws://127.0.0.1:8791/ws',
    token: '',
    autoReconnect: false,
  })
  const seen = collect(conn)
  conn.connect()

  await until(() => conn.isOpen)
  check('connects', conn.isOpen)
  check('captures session id from ready', conn.status.sessionId === 'sess-1', conn.status.sessionId)
  check('state is open', conn.status.state === 'open')

  conn.send({ type: 'user_text', text: 'hello there' })
  await until(() => seen.frames.some((f) => f.type === 'turn_complete'))

  check('sent user_text', amber.state.received.some((f) => f.type === 'user_text'))
  check('received 2 audio buffers', seen.audio.length === 2, `got ${seen.audio.length}`)

  // The whole point: each binary frame must carry the metadata of the JSON frame
  // that preceded it, in order.
  check(
    'audio paired with correct metadata',
    seen.audio[0]?.meta?.text === 'First one.' &&
      seen.audio[1]?.meta?.text === 'Second one.' &&
      seen.audio[0]?.meta?.index === 0 &&
      seen.audio[1]?.meta?.index === 1,
    seen.audio.map((a) => a.meta?.text).join(' | '),
  )
  check(
    'audio bytes intact',
    seen.audio[0]?.buf.toString() === 'AUDIO[First one.]',
    seen.audio[0]?.buf.toString(),
  )

  conn.disconnect()
  await amber.close()
}

async function testResume() {
  console.log('\nreconnect with backoff and session resume')
  const amber = startFakeAmber({ port: 8792 })
  const conn = new AmberConnection({
    url: 'ws://127.0.0.1:8792/ws',
    token: '',
    autoReconnect: true,
  })
  collect(conn)
  conn.connect()
  await until(() => conn.isOpen)

  amber.dropAll() // simulate Amber restarting under us
  await until(() => !conn.isOpen)
  check('notices the drop', !conn.isOpen)

  const back = await until(() => conn.isOpen, 6000)
  check('reconnects automatically', back)
  check(
    'presents session_id on resume',
    amber.state.lastUrl?.includes('session_id=sess-1'),
    amber.state.lastUrl ?? '(none)',
  )
  check('reports resumed', conn.status.resumed === true)

  conn.disconnect()
  await amber.close()
}

async function testAuthRefusal() {
  console.log('\nauth refusal is reported, not retried forever')
  const amber = startFakeAmber({ port: 8793, requireToken: 'correct-horse' })
  const conn = new AmberConnection({
    url: 'ws://127.0.0.1:8793/ws',
    token: 'wrong',
    autoReconnect: true,
  })
  collect(conn)
  conn.connect()

  const settled = await until(() => conn.status.state === 'error', 4000)
  check('lands in error state', settled, conn.status.state)
  check(
    'explains it as an auth problem',
    /token/i.test(conn.status.detail ?? ''),
    conn.status.detail,
  )

  const before = amber.state.connections
  await wait(1500)
  check('does not retry a rejected token', amber.state.connections === before)

  conn.disconnect()
  await amber.close()
}

async function testNoDoubleSocket() {
  console.log('\nconnect() twice does not duplicate frames')
  const amber = startFakeAmber({ port: 8794 })
  const conn = new AmberConnection({
    url: 'ws://127.0.0.1:8794/ws',
    token: '',
    autoReconnect: false,
  })
  const seen = collect(conn)
  conn.connect()
  await until(() => conn.isOpen)
  conn.connect() // e.g. React StrictMode double-mount, or an impatient click
  await until(() => conn.isOpen)
  await wait(300)

  conn.send({ type: 'user_text', text: 'once' })
  await until(() => seen.frames.some((f) => f.type === 'turn_complete'))
  await wait(300)

  check(
    'exactly one turn_complete',
    seen.frames.filter((f) => f.type === 'turn_complete').length === 1,
    `${seen.frames.filter((f) => f.type === 'turn_complete').length}`,
  )
  check('exactly 2 audio buffers', seen.audio.length === 2, `${seen.audio.length}`)

  conn.disconnect()
  await amber.close()
}

await testHappyPath()
await testResume()
await testAuthRefusal()
await testNoDoubleSocket()

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
