/**
 * Drives the terminal's speculative local echo against a real VT model.
 *
 * Prediction draws characters the server has not confirmed. Two ways that can go
 * wrong are unacceptable rather than merely annoying:
 *
 *   * it leaves the screen showing something the server never sent, and every
 *     subsequent keystroke compounds the drift;
 *   * it draws a character at a hidden-input prompt, putting one letter of a
 *     password on screen.
 *
 * So this does not assert on internal state. It replays keystrokes and server bytes
 * through a small terminal that actually applies the escape sequences the typeahead
 * emits, then asserts on what is left on screen — and on which cells are dim, since
 * dim is the only signal that a character is a guess.
 *
 * Run: node scripts/verify-typeahead.mjs
 */
import { Typeahead } from '../out/verify/typeahead.mjs'

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures++
}

/**
 * Enough of a terminal to be wrong in the same ways a real one would be.
 *
 * Handles exactly the sequences the typeahead emits — cursor-left, erase-to-end,
 * dim on, dim off — and nothing else, so an unrecognised sequence shows up as
 * garbage on screen rather than being quietly tolerated.
 */
class FakeTerm {
  constructor({ cols = 80, prompt = '$ ', type = 'normal' } = {}) {
    this.cols = cols
    this.cells = [...prompt].map((ch) => ({ ch, dim: false }))
    this.cursor = this.cells.length
    this._dim = false
    this._type = type
    const self = this
    this.buffer = {
      active: {
        get type() {
          return self._type
        },
        get cursorX() {
          return self.cursor
        },
        cursorY: 0,
        baseY: 0,
        getLine: () => ({
          isWrapped: false,
          translateToString: (trimRight, start = 0, end = self.cells.length) => {
            const text = self.cells
              .slice(start, end)
              .map((c) => c.ch)
              .join('')
            return trimRight ? text.replace(/\s+$/, '') : text
          },
        }),
      },
    }
  }

  get text() {
    return this.cells.map((c) => c.ch).join('')
  }

  /** The dimmed tail — what is currently a guess. */
  get dimText() {
    return this.cells
      .filter((c) => c.dim)
      .map((c) => c.ch)
      .join('')
  }

  write(data, cb) {
    for (let i = 0; i < data.length; i++) {
      if (data[i] === '\x1b') {
        const match = /^\x1b\[(\d*)([A-Za-z])/.exec(data.slice(i))
        if (!match) throw new Error(`unparsed escape at ${JSON.stringify(data.slice(i, i + 8))}`)
        const n = match[1] === '' ? 1 : Number(match[1])
        if (match[2] === 'D') this.cursor = Math.max(0, this.cursor - n)
        else if (match[2] === 'K') this.cells.length = this.cursor
        else if (match[2] === 'm') {
          if (match[1] === '2') this._dim = true
          else if (match[1] === '22' || match[1] === '0' || match[1] === '') this._dim = false
        } else throw new Error(`unhandled sequence ${JSON.stringify(match[0])}`)
        i += match[0].length - 1
        continue
      }
      this.cells[this.cursor] = { ch: data[i], dim: this._dim }
      this.cursor++
    }
    cb?.()
  }
}

const ack = () => {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Get past the threshold gate: prediction is off until a slow round-trip is seen. */
function warmUp(typeahead) {
  typeahead.onInput('x')
  // Pretend the echo took a while; the EWMA is what the gate reads.
  const started = Date.now()
  while (Date.now() - started < 60) {
    /* busy-wait: performance.now() is what it samples */
  }
  typeahead.onOutput('x')
}

// --- it predicts, and the server's bytes are what survive ---------------------
{
  const term = new FakeTerm()
  const t = new Typeahead(term, { localEcho: 'auto', threshold: 30 })
  warmUp(t)
  term.cells.length = 2 // clear the warm-up character
  term.cursor = 2

  t.onInput('l')
  check('a keystroke appears before the server answers', term.text === '$ l', term.text)
  check('and it is marked as a guess', term.dimText === 'l', `dim=${term.dimText}`)

  t.render('l', ack)
  check('the echo replaces the guess', term.text === '$ l', term.text)
  check('nothing is left dim once confirmed', term.dimText === '', `dim=${term.dimText}`)

  t.onInput('s')
  t.render('s', ack)
  check('a second character converges too', term.text === '$ ls', term.text)
}

// --- a partial echo keeps the rest pending -----------------------------------
{
  const term = new FakeTerm()
  const t = new Typeahead(term, { localEcho: 'auto', threshold: 30 })
  warmUp(t)
  term.cells.length = 2
  term.cursor = 2

  t.onInput('l')
  t.onInput('s')
  check('both characters are drawn as guesses', term.dimText === 'ls', `dim=${term.dimText}`)
  t.render('l', ack)
  check('the confirmed half is no longer dim', term.dimText === 's', `dim=${term.dimText}`)
  check('the line still reads correctly', term.text === '$ ls', term.text)
  t.render('s', ack)
  check('and settles with nothing pending', term.dimText === '' && term.text === '$ ls', term.text)
}

// --- a mismatch rolls back rather than compounding ---------------------------
{
  const term = new FakeTerm()
  const t = new Typeahead(term, { localEcho: 'auto', threshold: 30 })
  warmUp(t)
  term.cells.length = 2
  term.cursor = 2

  t.onInput('a')
  // The shell redrew instead of echoing — a completion, a colour, anything.
  t.render('XYZ', ack)
  check('a wrong guess leaves only what the server sent', term.text === '$ XYZ', term.text)
  check('nothing stays dim after a mismatch', term.dimText === '', `dim=${term.dimText}`)

  t.onInput('b')
  check('and prediction stands down for the rest of the line', term.text === '$ XYZ', term.text)

  t.onInput('\r')
  t.onInput('c')
  check('Enter re-arms it for the next line', term.dimText === 'c', `dim=${term.dimText}`)
}

// --- the gates ---------------------------------------------------------------
{
  const term = new FakeTerm()
  const t = new Typeahead(term, { localEcho: 'off', threshold: 30 })
  warmUp(t)
  const before = term.text
  t.onInput('a')
  check('off means off', term.text === before, term.text)
}

{
  const term = new FakeTerm()
  const t = new Typeahead(term, { localEcho: 'auto', threshold: 30 })
  // No warm-up: the EWMA is null, so the link is unmeasured.
  t.onInput('a')
  check('it never predicts before measuring the round-trip', term.text === '$ ', term.text)
}

{
  const term = new FakeTerm()
  const t = new Typeahead(term, { localEcho: 'auto', threshold: 5_000 })
  warmUp(t)
  term.cells.length = 2
  term.cursor = 2
  t.onInput('a')
  check('below the threshold it stays out of the way', term.text === '$ ', term.text)
}

{
  const term = new FakeTerm({ type: 'alternate' })
  const t = new Typeahead(term, { localEcho: 'auto', threshold: 30 })
  warmUp(t)
  const before = term.text
  t.onInput('a')
  check('never in the alternate buffer (vim, htop, less)', term.text === before, term.text)
}

{
  const term = new FakeTerm({ prompt: '[sudo] password for johnny: ' })
  const t = new Typeahead(term, { localEcho: 'auto', threshold: 30 })
  warmUp(t)
  term.cells.length = 28
  term.cursor = 28
  const before = term.text
  t.onInput('h')
  check('never at a password prompt', term.text === before, JSON.stringify(term.text.slice(-4)))
}

{
  const term = new FakeTerm({ cols: 4 })
  const t = new Typeahead(term, { localEcho: 'auto', threshold: 30 })
  warmUp(t)
  term.cells.length = 2
  term.cursor = 2
  t.onInput('a')
  t.onInput('b')
  check(
    'never where the guess would wrap (the erase cannot cross a row)',
    term.dimText.length <= 1,
    `dim=${term.dimText}`,
  )
}

// --- unconfirmed guesses time out --------------------------------------------
{
  const term = new FakeTerm()
  const t = new Typeahead(term, { localEcho: 'auto', threshold: 30 })
  warmUp(t)
  term.cells.length = 2
  term.cursor = 2

  t.onInput('h')
  check('drawn while we wait', term.dimText === 'h')

  await sleep(700)
  check('an echo that never comes rolls itself back', term.text === '$ ', term.text)
  t.onInput('i')
  check(
    'and prediction is suspended afterwards — the safety net under any prompt we failed to recognise',
    term.text === '$ ',
    term.text,
  )
  t.dispose()
}

console.log(
  failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`,
)
process.exit(failures === 0 ? 0 : 1)
