/**
 * A stand-in for a Web Server DAT, so the bridge is testable before any `.toe` exists.
 *
 * This is deliberately *not* part of `npm run verify`. The envelope handling is already
 * covered there without a socket, which is the more valuable test — a stub written from
 * the same understanding that produced the client would only confirm that understanding
 * back to itself. What this is for is the other half: pointing the real app at something
 * that answers, so you can watch a scene list arrive, land in the config, and come back
 * out as an announce and a row of buttons.
 *
 *   node scripts/td-stub.mjs [port] [scene ...]
 *   node scripts/td-stub.mjs 9980 ambient spotify ps5
 *
 * It implements the three reserved commands and refuses everything else, exactly as the
 * reference callback does — including answering a refusal with HTTP 200 and an error
 * envelope, which is what lets Aperture tell "the project said no" from "nothing
 * answered".
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 9980)
const scenes = process.argv.slice(3)
const state = { current: scenes[0] ?? null }

const reply = (res, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

const COMMANDS = {
  list_scenes: () => ({ scenes }),
  status: () => ({ current_scene: state.current, running: true }),
  switch_scene: (args) => {
    if (!scenes.includes(args.scene)) throw new Error(`no scene called ${JSON.stringify(args.scene)}`)
    state.current = args.scene
    console.log(`  -> switched to ${args.scene}`)
    return { current_scene: state.current }
  },
}

createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    let body
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      return reply(res, { status: 'error', message: 'body was not JSON' })
    }
    console.log(`  <- ${body.command} ${JSON.stringify(body.args ?? {})}`)
    const handler = COMMANDS[body.command]
    if (!handler) return reply(res, { status: 'error', message: `unknown command ${JSON.stringify(body.command)}` })
    try {
      return reply(res, { status: 'ok', result: handler(body.args ?? {}) })
    } catch (error) {
      return reply(res, { status: 'error', message: error.message })
    }
  })
}).listen(port, '127.0.0.1', () => {
  console.log(`td-stub listening on http://127.0.0.1:${port}/`)
  console.log(`scenes: ${scenes.join(', ') || '(none — pass some as arguments)'}`)
})
