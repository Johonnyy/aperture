/**
 * Strip literal values out of a composed command before it is narrated.
 *
 * `runAction` logs the exact command at `debug` so that a flag this GUI composed
 * wrongly is visible rather than inferred. That is worth keeping — but the command
 * also carries every value the user typed, because `heredoc()` is how a value reaches
 * the box without ever being in `argv`. `verboseLogging` defaults to **true**, so
 * saving an API key in the Env editor rendered it straight into the Status Panel, and
 * from there into anything the user copied out of it.
 *
 * The rule this restores is the one `bloom/discover.ts` already states in the
 * strongest form available — it emits no `op` events at all, rather than risk
 * narrating an admin token — and that `bloom/keys.ts::redact` applies to the Bloom
 * client's output. Same hazard, same answer: the shape of the command is the useful
 * part, the body is not.
 *
 * Deliberately keyed on the heredoc, not on a list of sensitive parameter names. A
 * name list is a thing you forget to update; every literal value already goes through
 * `heredoc()` precisely because it must not be an argument, so redacting heredoc
 * bodies covers today's secrets and tomorrow's without anyone remembering to opt in.
 *
 * No Electron imports — this is driven directly by `scripts/verify-infra-redact.mjs`.
 */

/**
 * The heredoc opener, in both spellings it can reach here in.
 *
 * `heredoc()` writes `<<'NAME_EOF'`, but this runs on the output of `compose()`,
 * which has already passed the whole body through `q()` — so every `'` has become
 * `'\''` and the opener actually reads `<<'\''NAME_EOF'\''`. Matching only the
 * unescaped form would silently redact nothing, which is the one failure mode that
 * looks exactly like success. The closing delimiter needs no such care: it is a line
 * with no quote characters, so `q()` leaves it alone.
 */
const OPENER = /<<'(?:\\'')?([A-Za-z_][A-Za-z0-9_]*)/

/**
 * Replace every quoted-heredoc body with a count of what it held.
 *
 * The length is kept because it is the one property that stays useful when something
 * has gone wrong — "0 characters" is the difference between a value that failed to
 * reach the box and one that arrived and was rejected. A command with no heredoc is
 * returned byte-for-byte, so the debug line keeps its whole point for every other
 * action.
 */
export function redactCommand(command: string): string {
  const lines = command.split('\n')
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i])
    const tag = OPENER.exec(lines[i])?.[1]
    if (!tag) continue

    // Inside a body nothing is shell syntax, so an opener appearing in the value is
    // just text — only a line that is exactly the delimiter ends it. Scanning rather
    // than matching a regex across the whole string is what keeps that true.
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && lines[j] !== tag) body.push(lines[j++])

    // An unterminated heredoc means the command is malformed, or this function's idea
    // of the delimiter is out of step with `heredoc()`. Either way the safe reading is
    // that everything after the opener is the value — never fall through and print it.
    const closed = j < lines.length
    const n = body.join('\n').length
    out.push(`« ${n} character${n === 1 ? '' : 's'}${closed ? '' : ', unterminated'} »`)
    if (closed) out.push(tag)
    i = j
  }

  return out.join('\n')
}
