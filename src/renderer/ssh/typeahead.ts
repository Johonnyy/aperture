import type { Terminal as XTerm } from '@xterm/xterm'

/**
 * Speculative local echo.
 *
 * In SSH the *remote* pty owns the echo, so every character you type costs a full
 * round-trip before it appears. Nothing about the protocol can change that — the fix
 * is to draw the character locally, dimmed, and reconcile when the real echo lands.
 *
 * The reconciliation is deliberately blunt. Rather than modelling a predicted cursor
 * and patching it in place, every inbound chunk first *erases the dimmed tail*, then
 * lets the server's own bytes land, then redraws whatever prediction is still
 * outstanding. The consequence is that the only thing ever left on screen is what the
 * server actually sent, so the two can never drift apart — at the cost of repainting
 * a few characters per echo, which is invisible at these sizes.
 *
 * Prediction is off unless it is both wanted and worth it, and gives up readily:
 *
 * * below the measured latency threshold it never runs at all (on a LAN it would be
 *   pure risk for no gain);
 * * never in the alternate screen buffer — vim and htop own every cell;
 * * never when the cursor is not at the end of its line, or when the character would
 *   wrap, because the erase is a simple "move left N and clear";
 * * never after a prompt that looks like it is asking for a password;
 * * and any prediction that goes unconfirmed for `TIMEOUT_MS` erases itself and
 *   suspends prediction for the rest of the line. That last rule is what makes a
 *   hidden-input prompt we failed to recognise safe: it echoes nothing, so the
 *   prediction times out instead of sitting there.
 */

/** Weight of each new sample in the round-trip EWMA. */
const ALPHA = 0.2

/** Samples above this are a slow command finishing, not an echo. Ignored. */
const MAX_SAMPLE_MS = 2_000

/** How long a prediction may go unconfirmed before it is rolled back. */
const TIMEOUT_MS = 500

/** A prompt ending like this is asking for something that must not be drawn. */
const SECRET_PROMPT = /(password|passphrase|pin|secret|token)\b[^\n]{0,24}:\s*$/i

export interface EchoConfig {
  localEcho: 'auto' | 'off'
  threshold: number
}

export class Typeahead {
  /** Characters currently drawn dimmed and not yet confirmed by the server. */
  private predicted = ''
  /** When the oldest outstanding keystroke was sent, for the latency sample. */
  private sentAt: number | null = null
  private ewma: number | null = null
  /** Set when a prediction went wrong; cleared on the next Enter. */
  private suspended = false
  // `ReturnType` rather than `number`: @types/node is in scope here, so a bare
  // `setTimeout` is typed as Node's even though this runs in the renderer.
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly term: XTerm,
    private readonly config: EchoConfig,
  ) {}

  /** The measured round-trip, or null before the first sample. */
  get latencyMs(): number | null {
    return this.ewma
  }

  // --- input ---------------------------------------------------------------

  /** Called for every keystroke, just before it is written to the shell. */
  onInput(data: string): void {
    if (this.sentAt === null) this.sentAt = performance.now()

    if (data === '\r' || data === '\n') {
      // The server is about to redraw from a new prompt. Drop everything and give
      // prediction a fresh start — suspension is per-line, not permanent.
      this.rollback()
      this.suspended = false
      return
    }

    if (!this.enabled()) {
      this.rollback()
      return
    }

    if (data === '\x7f') {
      // Only ever un-draw our own prediction. Erasing a character the server drew
      // would need us to know what was underneath it.
      if (!this.predicted) return
      this.erase()
      this.predicted = this.predicted.slice(0, -1)
      this.draw()
      this.arm()
      return
    }

    if (!this.predictable(data)) {
      this.rollback()
      return
    }

    this.erase()
    this.predicted += data
    this.draw()
    this.arm()
  }

  // --- output --------------------------------------------------------------

  /**
   * Sample the round-trip. Separate from `render` so the caller can update a
   * latency readout without waiting on the parser.
   */
  onOutput(_data: string): void {
    if (this.sentAt === null) return
    const sample = performance.now() - this.sentAt
    this.sentAt = null
    if (sample > MAX_SAMPLE_MS) return
    this.ewma = this.ewma === null ? sample : this.ewma * (1 - ALPHA) + sample * ALPHA
  }

  /**
   * Write one chunk of server output, reconciling it against any prediction.
   *
   * Owns the `term.write` call because the erase must land before the server's bytes
   * and the redraw after them, and the caller's ack has to hang off the last write.
   */
  render(data: string, ack: () => void): void {
    if (!this.predicted) {
      this.term.write(data, ack)
      return
    }

    const matched = commonPrefix(data, this.predicted)
    this.erase()

    if (matched === 0) {
      // The server sent something we did not predict — a redraw, a completion, an
      // escape sequence. Our characters may still be coming, but we can no longer
      // tell where, so stop guessing for this line.
      this.predicted = ''
      this.suspended = true
      this.disarm()
      this.term.write(data, ack)
      return
    }

    this.predicted = this.predicted.slice(matched)
    if (this.predicted) {
      // The ack rides the redraw rather than a separate empty write, so it is
      // guaranteed to fire after everything above has been parsed.
      this.term.write(data)
      this.term.write(`\x1b[2m${this.predicted}\x1b[22m`, ack)
      this.arm()
    } else {
      this.term.write(data, ack)
      this.disarm()
    }
  }

  dispose(): void {
    this.disarm()
  }

  // --- internals -----------------------------------------------------------

  private enabled(): boolean {
    if (this.config.localEcho === 'off' || this.suspended) return false
    // Below the threshold the echo is already fast enough that a prediction would
    // only ever be a flicker.
    if (this.ewma === null || this.ewma < this.config.threshold) return false
    return this.term.buffer.active.type !== 'alternate'
  }

  /** Whether `data` is a lone printable character we can safely draw here. */
  private predictable(data: string): boolean {
    if (data.length !== 1) return false // a paste, or an escape sequence
    const code = data.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return false

    const buf = this.term.buffer.active
    // The erase is `move left N, clear to end of line`, which cannot cross a row.
    if (buf.cursorX + 1 >= this.term.cols) return false

    const line = buf.getLine(buf.baseY + buf.cursorY)
    if (!line) return false
    const before = line.translateToString(false, 0, buf.cursorX)
    // Not at the end of the line: predicting here would overwrite, and the erase
    // would take the rest of the line with it.
    if (line.translateToString(true, buf.cursorX).length > 0) return false
    // The visible prompt is asking for something that must never be drawn.
    if (SECRET_PROMPT.test(before.slice(0, before.length - this.predicted.length))) return false
    return true
  }

  /** Un-draw the dimmed tail without forgetting it. */
  private erase(): void {
    if (this.predicted) this.term.write(`\x1b[${this.predicted.length}D\x1b[K`)
  }

  private draw(): void {
    // `22m` rather than `0m`: resetting every attribute would clobber a colour the
    // prompt set, and dim is the only thing we turned on.
    if (this.predicted) this.term.write(`\x1b[2m${this.predicted}\x1b[22m`)
  }

  /** Erase and forget — used when we can no longer reason about the line. */
  private rollback(): void {
    if (!this.predicted) return
    this.erase()
    this.predicted = ''
    this.disarm()
  }

  private arm(): void {
    this.disarm()
    this.timer = setTimeout(() => {
      // Nothing echoed it back. Either the far end is hidden input, or it is busy
      // and not running a line editor at all. Both mean: stop drawing.
      this.rollback()
      this.suspended = true
    }, TIMEOUT_MS)
  }

  private disarm(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }
}

function commonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a[i] === b[i]) i++
  return i
}
