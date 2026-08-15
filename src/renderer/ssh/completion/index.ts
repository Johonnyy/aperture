import type { Terminal as XTerm } from '@xterm/xterm'

import { FLAGS, flagKeyFor } from './flags'
import { fetchCommands, fetchHistory, fetchLocation, listDir, type Exec } from './remote'

export interface Suggestion {
  /** What to show in the list. */
  label: string
  /** The characters still missing — written verbatim to the shell on accept. */
  insert: string
  kind: 'history' | 'command' | 'path' | 'flag'
}

export interface PopupState {
  /** Viewport coordinates of the cell after the cursor. */
  x: number
  y: number
  cellHeight: number
  /** Inline dimmed completion of the top (or selected) suggestion. */
  ghost: string
  /** Whether the dropdown is showing. */
  open: boolean
  items: Suggestion[]
  index: number
}

export interface CompleterHost {
  exec: Exec
  write: (data: string) => void
  onState: (state: PopupState | null) => void
}

/** Recompute after this much quiet, so a burst of output costs one pass. */
const DEBOUNCE_MS = 40

const MAX_ITEMS = 12

/** Prompt endings we treat as "the input starts here". */
const PROMPTS = ['$ ', '# ', '> ', '% ']

/**
 * Completion for the terminal: history, remote command names, remote paths, and the
 * flags of the tools this app exists to drive.
 *
 * Two rules keep it from ever being able to corrupt the session:
 *
 * 1. **It never writes to the terminal.** The ghost and the dropdown are DOM overlays
 *    positioned over the cursor. Drawing them into the buffer would collide with the
 *    typeahead's own dimmed tail, and two writers of speculative text in one buffer
 *    is a desync waiting to happen.
 * 2. **It never rewrites the line.** Accepting a suggestion writes the *missing*
 *    characters as ordinary input, so the remote line editor stays the only thing
 *    that decides what is on screen.
 *
 * The current input is re-read from the buffer on every keystroke rather than
 * accumulated. That costs a string copy and buys self-healing: a redraw, a Ctrl-C, a
 * resize or a resumed job all just work, where a tracked buffer would quietly drift.
 */
export class Completer {
  private history: string[] = []
  private session: string[] = []
  private commands: string[] = []
  /** Best-effort remote working directory; null once we lose track of it. */
  private cwd: string | null = null
  private home = ''
  private dirs = new Map<string, string[]>()

  private items: Suggestion[] = []
  private index = 0
  private open = false
  private enabled = true
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false

  constructor(
    private readonly term: XTerm,
    private readonly host: CompleterHost,
  ) {}

  /** Fetch the per-shell caches. Safe to call before the shell finishes opening. */
  async prime(): Promise<void> {
    const [history, commands, location] = await Promise.all([
      fetchHistory(this.host.exec),
      fetchCommands(this.host.exec),
      fetchLocation(this.host.exec),
    ])
    if (this.disposed) return
    this.history = history
    this.commands = commands
    this.cwd = location.cwd
    this.home = location.home
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) this.reset()
  }

  // --- keys ----------------------------------------------------------------

  /**
   * First refusal on every keystroke. Returns true when the key drove the popup and
   * must not reach the shell.
   *
   * Only ever swallows keys *while the dropdown is open* (plus Ctrl+Space to open it,
   * and Tab when there is a ghost to accept). With it closed, Tab reaches the remote
   * shell's own completion, which stays the authority.
   */
  handleInput(data: string): boolean {
    if (!this.enabled) return false

    if (this.open) {
      switch (data) {
        case '\x1b[A':
          this.move(-1)
          return true
        case '\x1b[B':
        case '\t':
          this.move(1)
          return true
        case '\r':
        case '\n':
          this.accept()
          return true
        case '\x1b':
          this.reset()
          return true
      }
      // Anything else dismisses the dropdown and is typed normally.
      this.open = false
      return false
    }

    // Ctrl+Space arrives as NUL, which no shell wants anyway.
    if (data === '\x00') {
      this.open = this.items.length > 0
      this.index = 0
      this.publish()
      return this.open
    }

    if (data === '\t' && this.items[0]?.insert) {
      this.accept()
      return true
    }

    return false
  }

  /** Called for keystrokes that reached the shell. */
  onInput(data: string): void {
    if (data === '\r' || data === '\n') {
      const { line } = this.read()
      const command = line.trim()
      if (command) {
        this.session = [command, ...this.session.filter((c) => c !== command)].slice(0, 500)
        this.track(command)
      }
      this.reset()
      return
    }
    this.schedule()
  }

  /** Called once the terminal has parsed a chunk of server output. */
  onOutput(): void {
    this.schedule()
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.host.onState(null)
  }

  // --- internals -----------------------------------------------------------

  private move(delta: number): void {
    if (!this.items.length) return
    this.index = (this.index + delta + this.items.length) % this.items.length
    this.publish()
  }

  private accept(): void {
    const chosen = this.items[this.open ? this.index : 0]
    this.reset()
    if (chosen?.insert) this.host.write(chosen.insert)
  }

  private reset(): void {
    this.open = false
    this.index = 0
    this.items = []
    this.host.onState(null)
  }

  private schedule(): void {
    if (!this.enabled) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.refresh(), DEBOUNCE_MS)
  }

  private refresh(): void {
    if (this.disposed || !this.enabled) return
    // vim, htop and less own every cell; a floating suggestion over them is noise.
    if (this.term.buffer.active.type === 'alternate') {
      this.reset()
      return
    }

    const { line, token } = this.read()
    if (!line.trim()) {
      this.items = []
      this.publish()
      return
    }

    this.items = this.rank(line, token)
    if (this.index >= this.items.length) this.index = 0
    this.publish()
    void this.fetchPaths(line, token)
  }

  private rank(line: string, token: string): Suggestion[] {
    const out: Suggestion[] = []
    const seen = new Set<string>()
    const push = (label: string, insert: string, kind: Suggestion['kind']): void => {
      if (!insert || seen.has(label)) return
      seen.add(label)
      out.push({ label, insert, kind })
    }

    // Whole-line history first. It is the one suggestion that saves a whole command
    // rather than a word, and it is what makes the ghost worth reading at all.
    for (const command of [...this.session, ...this.history]) {
      if (command.length > line.length && command.startsWith(line)) {
        push(command, command.slice(line.length), 'history')
      }
      if (out.length >= MAX_ITEMS) break
    }

    const { head, naming } = split(line)

    if (naming) {
      for (const command of this.commands) {
        if (command.length > token.length && command.startsWith(token)) {
          push(command, command.slice(token.length), 'command')
        }
        if (out.length >= MAX_ITEMS) break
      }
    } else {
      // Flags and subcommands live in the same table; which one is wanted is decided
      // by the token, not by a second lookup.
      const key = flagKeyFor(head)
      const wantsFlag = token.startsWith('-')
      for (const word of key ? FLAGS[key] : []) {
        if (word.startsWith('-') !== wantsFlag) continue
        if (word.startsWith(token) && word.length > token.length) {
          push(word, word.slice(token.length), 'flag')
        }
      }
    }

    for (const entry of this.dirs.get(this.dirKey(token)) ?? []) {
      const leaf = leafOf(token)
      if (entry.startsWith(leaf) && entry.length > leaf.length) {
        push(entry, entry.slice(leaf.length), 'path')
      }
      if (out.length >= MAX_ITEMS) break
    }

    return out.slice(0, MAX_ITEMS)
  }

  /** Fill the directory cache for the token being completed, then republish. */
  private async fetchPaths(line: string, token: string): Promise<void> {
    if (split(line).naming) return // still naming the command
    if (token.startsWith('-')) return

    const key = this.dirKey(token)
    if (this.dirs.has(key)) return
    // Mark it taken before awaiting, so a burst of keystrokes fires one lookup.
    this.dirs.set(key, [])

    const entries = await listDir(this.host.exec, this.cwd, key || '.')
    if (this.disposed) return
    this.dirs.set(key, entries)
    this.refresh()
  }

  /** The directory part of a path token — what `ls` should be pointed at. */
  private dirKey(token: string): string {
    const cut = token.lastIndexOf('/')
    if (cut === -1) return ''
    const dir = token.slice(0, cut + 1)
    return dir.startsWith('~') ? this.home + dir.slice(1) : dir
  }

  /**
   * Follow `cd` so relative path completion keeps working.
   *
   * Deliberately narrow. A `cd` inside a subshell, a pipeline, an alias or a script
   * is not something we can see, so anything unrecognised sets `cwd` to null and
   * relative completion goes quiet until the next absolute `cd`. Guessing wrong here
   * would offer entries from a directory you are not in, which is worse than none.
   */
  private track(command: string): void {
    const match = /^\s*cd\s*(.*)$/.exec(command)
    if (!match) {
      if (/[;&|]|\$\(|`/.test(command) && /\bcd\b/.test(command)) this.cwd = null
      return
    }
    const target = match[1].trim().replace(/^["']|["']$/g, '')
    this.dirs.clear()

    if (!target || target === '~') {
      this.cwd = this.home
      return
    }
    if (target === '-' || /[;&|$`*?]/.test(target)) {
      this.cwd = null
      return
    }
    const base = target.startsWith('~')
      ? this.home + target.slice(1)
      : target.startsWith('/')
        ? target
        : this.cwd
          ? `${this.cwd}/${target}`
          : null
    this.cwd = base === null ? null : normalize(base)
  }

  /** Read the current input line straight out of the buffer. */
  private read(): { line: string; token: string } {
    const buf = this.term.buffer.active
    const row = buf.baseY + buf.cursorY

    // A long command wraps across rows; walk back to the row it started on.
    let start = row
    while (start > 0 && buf.getLine(start)?.isWrapped) start--

    let text = ''
    for (let y = start; y < row; y++) text += buf.getLine(y)?.translateToString(false) ?? ''
    text += buf.getLine(row)?.translateToString(false, 0, buf.cursorX) ?? ''

    let cut = 0
    for (const prompt of PROMPTS) {
      const at = text.lastIndexOf(prompt)
      if (at >= 0 && at + prompt.length > cut) cut = at + prompt.length
    }

    const line = text.slice(cut)
    return { line, token: line.split(/\s+/).pop() ?? '' }
  }

  private publish(): void {
    if (!this.items.length) {
      this.host.onState(null)
      return
    }
    const screen = this.term.element?.querySelector('.xterm-screen') as HTMLElement | null
    if (!screen) {
      this.host.onState(null)
      return
    }
    const rect = screen.getBoundingClientRect()
    const cellWidth = rect.width / this.term.cols
    const cellHeight = rect.height / this.term.rows
    const buf = this.term.buffer.active

    this.host.onState({
      x: rect.left + buf.cursorX * cellWidth,
      y: rect.top + buf.cursorY * cellHeight,
      cellHeight,
      ghost: this.items[this.open ? this.index : 0]?.insert ?? '',
      open: this.open,
      items: this.items,
      index: this.index,
    })
  }
}

/**
 * Separate the words already committed from the one being typed.
 *
 * A trailing space means the last word is finished and the *next* one is what is
 * being completed — which is the difference between `docker` (complete this) and
 * `docker ` (what comes after this).
 */
function split(line: string): { head: string[]; naming: boolean } {
  const words = line.split(/\s+/).filter(Boolean)
  const head = /\s$/.test(line) ? words : words.slice(0, -1)
  return { head, naming: head.length === 0 }
}

function leafOf(token: string): string {
  const cut = token.lastIndexOf('/')
  return cut === -1 ? token : token.slice(cut + 1)
}

/** Resolve `.` and `..` without touching the network. */
function normalize(path: string): string {
  const parts: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return `/${parts.join('/')}`
}
