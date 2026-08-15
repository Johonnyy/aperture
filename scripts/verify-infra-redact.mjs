/**
 * The op log must not narrate a value the user typed.
 *
 * `runAction` logs the composed command at `debug`, and `verboseLogging` defaults to
 * on — so before `redact.ts` existed, saving an API key in the Env editor rendered it
 * into the Status Panel. This drives the **real** `compose(ACTIONS.setVar, …)` rather
 * than a hand-written sample, because the thing that broke was the gap between what
 * `heredoc()` writes and what reaches the log after `q()` has escaped every quote in
 * it. A fixture would have been written against the wrong one of those two shapes.
 *
 * Headless, like `verify-bloom-keys.mjs`: neither module imports Electron.
 */
import { redactCommand } from '../out/verify/redact.mjs'
import { ACTIONS, compose } from '../out/verify/actions.mjs'

let failures = 0

function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  const mark = ok ? '  ok  ' : ' FAIL '
  const detail = ok ? String(actual) : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  console.log(`${mark} ${label} — ${detail}`)
}

const SECRET = 'sk-or-v1-s3cr3t'
const setVar = (value) =>
  compose(
    ACTIONS.setVar,
    { app: 'bloom', key: 'BLOOM_OPENROUTER_API_KEY', value },
    { dryRun: false, withSudo: true },
  )

console.log('\nthe real composed command\n')

const composed = setVar(SECRET)
check('the raw command does contain the secret, so this test is testing something',
  composed.includes(SECRET), true)
check('redacted, it does not', redactCommand(composed).includes(SECRET), false)
check('the delimiter survives, so the command still reads as a heredoc',
  redactCommand(composed).includes('APERTURE_VALUE_EOF'), true)
check('and the length is reported', redactCommand(composed).includes(`« ${SECRET.length} characters »`), true)

console.log('\nvalues that break naive escaping\n')

for (const [label, value] of [
  ['a single quote', `it's a key`],
  ['an embedded newline', 'line one\nline two'],
  ['a line that looks like the delimiter', 'APERTURE_VALUE_EO\nnot-the-tag'],
  ['a nested heredoc opener', `nope <<'APERTURE_VALUE_EOF' nope`],
  ['a shell substitution', '$(whoami)`id`'],
  ['an empty value', ''],
]) {
  const cmd = setVar(value)
  const red = redactCommand(cmd)
  // The empty value is the one case where "does the plaintext survive" is vacuous —
  // every string contains "". Assert the shape instead.
  const leaked = value === '' ? !red.includes('« 0 characters »') : red.includes(value)
  check(`${label} does not survive redaction`, leaked, false)
}

console.log('\nthe other secret-carrying action\n')

const peer = compose(ACTIONS.setPeerToken, { name: 'bloom', token: 'peer-t0ken' }, { withSudo: true })
check('setPeerToken also puts its token in a heredoc', peer.includes('peer-t0ken'), true)
check('…and it is redacted too', redactCommand(peer).includes('peer-t0ken'), false)

console.log('\ncommands with nothing to hide\n')

const plain = compose(ACTIONS.restart, { app: 'bloom' }, { withSudo: true })
check('a command with no heredoc is returned byte-for-byte', redactCommand(plain), plain)
check('the debug line therefore keeps its point', redactCommand(plain).includes('bloom'), true)

console.log('\nmalformed input fails closed\n')

const unterminated = "bash -lc 'IFS= read -r -d '\\'''\\'' V <<'\\''V_EOF'\\'' || true\nleaked-value"
check('an unterminated heredoc still hides its body',
  redactCommand(unterminated).includes('leaked-value'), false)
check('…and says so rather than pretending it was fine',
  redactCommand(unterminated).includes('unterminated'), true)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
