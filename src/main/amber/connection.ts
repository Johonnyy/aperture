import { EventEmitter } from 'node:events'
import WebSocket, { type RawData } from 'ws'

import {
  isServerFrame,
  type AudioChunkFrame,
  type ClientFrame,
  type ServerFrame,
} from '../../shared/protocol'
import type { ConnectionStatus, ConnState } from '../../shared/types'

/**
 * WebSocket client for Amber, living in the main process.
 *
 * Main rather than renderer for three reasons: only Node can set an
 * `Authorization` header on the handshake, only Node can run `ssh2` (and the tool
 * bridge sits between the socket and SSH), and keeping it here means a renderer
 * reload during development doesn't drop the session or the declared tools.
 *
 * Emits:
 *   'frame'  (frame: ServerFrame)                      every JSON frame
 *   'audio'  (buffer: Buffer, meta: AudioChunkFrame|null)  one synthesized sentence
 *   'status' (status: ConnectionStatus)                connection state changes
 */
export interface AmberConnectionOptions {
  url: string
  token: string
  autoReconnect: boolean
}

const BASE_RETRY_MS = 1_000
const MAX_RETRY_MS = 30_000

export class AmberConnection extends EventEmitter {
  private ws: WebSocket | null = null
  private opts: AmberConnectionOptions
  private state: ConnState = 'idle'

  /** Survives disconnects so the next dial can resume with `?session_id=`. */
  private sessionId: string | null = null
  private resumed = false
  private detail: string | undefined

  /** Set to false by an explicit disconnect(), so we don't fight the user. */
  private wantConnection = false
  private attempt = 0
  private retryTimer: NodeJS.Timeout | null = null

  /**
   * The last `audio_chunk` frame, held until the binary frame it describes lands.
   * This pairing is the one genuinely non-obvious part of the protocol: audio bytes
   * carry no metadata of their own, so ordering is the only thing linking them to
   * the sentence they speak.
   */
  private pendingChunk: AudioChunkFrame | null = null

  constructor(opts: AmberConnectionOptions) {
    super()
    this.opts = opts
  }

  // --- lifecycle ------------------------------------------------------------

  connect(opts?: Partial<AmberConnectionOptions>): void {
    if (opts) this.opts = { ...this.opts, ...opts }
    this.wantConnection = true
    this.attempt = 0
    this.clearRetry()
    this.open()
  }

  /**
   * Apply settings changes to the live client. `autoReconnect` takes effect
   * immediately (it's read when a close happens); `url` and `token` apply on the
   * next dial, since changing them mid-socket would be meaningless.
   */
  updateOptions(patch: Partial<AmberConnectionOptions>): void {
    this.opts = { ...this.opts, ...patch }
  }

  /** Deliberate disconnect: stop retrying and forget the session. */
  disconnect(): void {
    this.wantConnection = false
    this.clearRetry()
    this.sessionId = null
    this.resumed = false
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.removeAllListeners()
      ws.close(1000, 'client disconnect')
    }
    this.setState('idle')
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get status(): ConnectionStatus {
    return {
      state: this.state,
      sessionId: this.sessionId,
      resumed: this.resumed,
      detail: this.detail,
      attempt: this.attempt || undefined,
    }
  }

  // --- sending --------------------------------------------------------------

  send(frame: ClientFrame): boolean {
    if (!this.isOpen) return false
    this.ws!.send(JSON.stringify(frame))
    return true
  }

  /** One complete recorded utterance. The frame boundary is the utterance boundary. */
  sendAudio(data: ArrayBuffer | Buffer): boolean {
    if (!this.isOpen) return false
    this.ws!.send(Buffer.isBuffer(data) ? data : Buffer.from(data), { binary: true })
    return true
  }

  // --- internals ------------------------------------------------------------

  private open(): void {
    this.clearRetry()
    // Tear down any existing socket first. Without this, a second connect() would
    // orphan a still-open socket whose listeners keep firing — every frame would
    // arrive twice, and every sentence would play twice.
    if (this.ws) {
      const stale = this.ws
      this.ws = null
      stale.removeAllListeners()
      stale.close(1000, 'superseded')
    }
    this.pendingChunk = null
    this.detail = undefined
    this.setState(this.attempt > 0 ? 'reconnecting' : 'connecting')

    let url: URL
    try {
      url = new URL(this.opts.url)
    } catch {
      this.detail = `Not a valid WebSocket URL: ${this.opts.url}`
      this.setState('error')
      return
    }
    // Resume the previous conversation when we have an id to present. Amber mints a
    // fresh one if it has expired, so this is always safe to send.
    if (this.sessionId) url.searchParams.set('session_id', this.sessionId)

    const headers: Record<string, string> = {}
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`

    const ws = new WebSocket(url.toString(), { headers })
    this.ws = ws

    ws.on('open', () => {
      this.attempt = 0
      this.setState('open')
    })

    ws.on('message', (data: RawData, isBinary: boolean) => this.onMessage(data, isBinary))

    ws.on('error', (err: Error) => {
      // Amber refuses a bad token by closing with 1008 *before* accepting, so an
      // auth failure surfaces here as a handshake error with no close reason —
      // never as a clean close. Say something actionable instead of "socket error".
      this.detail = /401|403|1008|Unexpected server response/i.test(err.message)
        ? 'Amber refused the connection — check the auth token.'
        : err.message
    })

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.ws !== ws) return // superseded by a newer socket; ignore
      this.ws = null
      this.pendingChunk = null
      const why = reason.toString() || this.detail
      this.detail = why || `closed (${code})`

      if (!this.wantConnection) {
        this.setState('idle')
        return
      }
      // 1008 is policy — retrying with the same token just fails the same way.
      if (code === 1008 || !this.opts.autoReconnect) {
        this.setState('error')
        return
      }
      this.scheduleRetry()
    })
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      // The sentence this describes was announced by the frame just before it.
      const meta = this.pendingChunk
      this.pendingChunk = null
      this.emit('audio', data as Buffer, meta)
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(data.toString())
    } catch {
      return // Amber never sends malformed JSON; ignore rather than crash the socket
    }
    if (!isServerFrame(parsed)) return // an additive frame we don't know yet

    const frame: ServerFrame = parsed
    if (frame.type === 'audio_chunk') {
      this.pendingChunk = frame
    } else if (frame.type === 'ready') {
      this.sessionId = frame.session_id ?? null
      this.resumed = frame.resumed ?? false
      this.detail = undefined
      this.setState('open')
    }
    this.emit('frame', frame)
  }

  private scheduleRetry(): void {
    this.attempt += 1
    const delay = Math.min(BASE_RETRY_MS * 2 ** (this.attempt - 1), MAX_RETRY_MS)
    this.setState('reconnecting', { retryInMs: delay })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.wantConnection) this.open()
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private setState(state: ConnState, extra?: Partial<ConnectionStatus>): void {
    this.state = state
    this.emit('status', { ...this.status, ...extra })
  }
}
