/**
 * `BLOOM_ADMIN_KEYS` parsing, and the redaction that keeps it out of the UI.
 *
 * Both matter more than their size suggests. A mis-split token authenticates as
 * nothing and surfaces as "Bloom rejected the stored key", which sends you looking
 * at the server. A redaction miss puts a full-control bearer token in the Status
 * Panel, where `verboseLogging` defaults to on.
 *
 * Driven headlessly, like `verify-install-command.mjs`: the module has no imports,
 * so it needs neither Electron nor a box to run against.
 */
import { parseAdminToken, redact } from '../out/verify/bloom-keys.mjs'

let failures = 0

function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  const mark = ok ? '  ok  ' : ' FAIL '
  const detail = ok ? actual : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  console.log(`${mark} ${label} — ${detail}`)
}

console.log('\nparseAdminToken\n')

check('the plain case', parseAdminToken('Aperture:abc123'), 'abc123')

check(
  'picks our entry out of a list rather than the first',
  parseAdminToken('amber:not-ours,Aperture:ours,other:theirs'),
  'ours',
)

check(
  'matches our name case-insensitively, because an env file is hand-edited',
  parseAdminToken('aperture:ours'),
  'ours',
)

check(
  'falls back to the first entry when nothing is named for us',
  parseAdminToken('amber:only-one'),
  'only-one',
)

check(
  'a bare token with no name at all still works',
  parseAdminToken('just-a-token'),
  'just-a-token',
)

// The one that silently truncates a credential if you split on every colon.
check(
  'splits on the FIRST colon only, so a token may contain one',
  parseAdminToken('Aperture:abc:def:ghi'),
  'abc:def:ghi',
)

check(
  'strips the quotes an env file wraps values in',
  parseAdminToken('"Aperture:abc123"'),
  'abc123',
)

check("and single quotes too", parseAdminToken("'Aperture:abc123'"), 'abc123')

check(
  'tolerates whitespace around entries and around the name',
  parseAdminToken('  amber : a , Aperture : b  '),
  'b',
)

check('an empty value is empty, not undefined', parseAdminToken(''), '')
check('whitespace only is empty', parseAdminToken('   '), '')
check('a trailing comma does not yield an empty token', parseAdminToken('Aperture:abc,'), 'abc')
check('a name with no token is skipped', parseAdminToken('Aperture:,amber:real'), 'real')

console.log('\nredact\n')

check(
  'drops a key line entirely',
  redact('SUDO_OK\nKEYS=Aperture:secret\nPROBE_DONE'),
  'SUDO_OK\nPROBE_DONE',
)

check(
  'drops it even when the far end indented it',
  redact('   KEYS=Aperture:secret'),
  '',
)

check(
  'leaves everything else untouched',
  redact('STATE=running\nPROBE_DONE'),
  'STATE=running\nPROBE_DONE',
)

const leaked = redact('sudo: a password is required\nKEYS=Aperture:s3cr3t')
check('a secret cannot survive into an error string', leaked.includes('s3cr3t'), false)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
