/**
 * Reading Bloom's `BLOOM_ADMIN_KEYS` value, and keeping it out of everything else.
 *
 * **Zero imports, on purpose.** `discover.ts` reaches SSH and therefore Electron, so
 * it cannot be bundled standalone; this half can, which is what lets
 * `npm run verify:bloom-keys` drive it headlessly. Same arrangement as
 * `ssh/authorized-keys.ts`, and for the same reason: the fiddly string handling is
 * the part worth testing, and it does not need a machine to test it on.
 */

/** What Bloom's key list calls us. `install.sh` writes this name. */
const CALLER = 'Aperture'

/**
 * Pull our token out of a `name:token,name:token` list.
 *
 * Four things this has to get right, each of which has a way of going wrong:
 *
 * * **Split on the first colon only.** A token may contain one, and splitting on
 *   every colon would silently truncate it into something that authenticates as
 *   nothing.
 * * **Prefer the entry named for us**, so a list that also holds a key for another
 *   client does not hand us theirs.
 * * **Fall back to the first entry** when no name matches — a single-entry list
 *   written by hand often omits the name entirely.
 * * **Tolerate quoting.** `env` files are frequently written `KEY="a:b"`, and the
 *   quotes are the file format, not the value.
 *
 * Returns `''` for anything it cannot make sense of. An empty token is a link that
 * will fail its verification, which is a far better outcome than a malformed one
 * that fails later against a real request.
 */
export function parseAdminToken(raw: string): string {
  const unquoted = raw.trim().replace(/^["']|["']$/g, '')
  if (!unquoted) return ''

  const pairs = unquoted
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf(':')
      return at === -1
        ? { name: '', token: entry }
        : { name: entry.slice(0, at).trim(), token: entry.slice(at + 1).trim() }
    })
    .filter((pair) => pair.token)

  const mine = pairs.find((pair) => pair.name.toLowerCase() === CALLER.toLowerCase())
  return (mine ?? pairs[0])?.token ?? ''
}

/**
 * Strip anything that could be a credential from text bound for a log or the UI.
 *
 * Belt and braces over the structured parsing in `discover.ts`, which already keeps
 * the key line out of the collected output. This catches a line that reached an
 * error string by some path nobody thought of — and on this probe specifically, the
 * cost of being wrong is the admin token rendered in the Status Panel, because
 * `verboseLogging` defaults to on.
 */
export function redact(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('KEYS='))
    .join('\n')
}
