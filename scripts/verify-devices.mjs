/**
 * The power commands — the one place in this repo that can turn a machine off.
 *
 * These cannot be tested by running them, and they are per-platform, so two of the three
 * branches would otherwise never execute on any given developer's machine until the day
 * someone asked Amber to sleep a Mac and got a Linux command. Hence a pure module and
 * this script.
 *
 * The canary matters most. `execFile(file, args)` hands argv straight to the OS, so there
 * is nothing to quote — but that safety evaporates the instant someone "simplifies" this
 * into a command string, and the change would look harmless in review. So every returned
 * token is checked for shell metacharacters: if a future edit reintroduces a shell, this
 * fails rather than shipping a quoting bug into something that runs `shutdown`.
 */
import {
  commandFor,
  shutdownCommand,
  sleepCommand,
  SHUTDOWN_DELAY_S,
  POWER_ACTIONS,
  UnsupportedPlatformError,
} from '../out/verify/system-commands.mjs'
import {
  clampVolume,
  getVolumeCommand,
  parseVolume,
  setVolumeCommand,
  VOLUME_ENV,
} from '../out/verify/system-audio.mjs'
import {
  closeAppCommand,
  listAppsCommand,
  parseApps as parseAppsOutput,
} from '../out/verify/system-apps.mjs'
import { describeAudio, isMuted, parseAudioState } from '../out/verify/audio-state.mjs'
import {
  asControlSpec,
  controlFor,
  isEmpty,
  parseApps,
  surfaceFor,
} from '../out/verify/device-controls.mjs'

let failures = 0
const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  failures++
}

const PLATFORMS = ['win32', 'darwin', 'linux']
const SHELL_CHARS = [';', '&&', '||', '|', '`', '$(', '\n', '>', '<']

for (const platform of PLATFORMS) {
  for (const [label, build] of [
    ['shutdown', shutdownCommand],
    ['sleep', sleepCommand],
  ]) {
    let command
    try {
      command = build(platform)
    } catch (error) {
      fail(`${label} on ${platform} threw: ${error.message}`)
      continue
    }

    if (!command?.file || typeof command.file !== 'string') {
      fail(`${label} on ${platform} returned no executable`)
      continue
    }
    if (!Array.isArray(command.args)) {
      fail(`${label} on ${platform} returned args that are not an array — that is the ` +
        `shape that becomes a shell string`)
      continue
    }
    for (const token of [command.file, ...command.args]) {
      for (const meta of SHELL_CHARS) {
        if (String(token).includes(meta)) {
          fail(`${label} on ${platform} contains "${meta}" in "${token}" — this must be ` +
            `argv passed to execFile, never a shell string`)
        }
      }
    }
  }
}

// --- Windows specifics, both of which are load-bearing -----------------------

{
  const win = shutdownCommand('win32')
  if (win.args.includes('/f')) {
    fail(`Windows shutdown carries /f — it would force-close applications with unsaved ` +
      `work, which a voice command must never do`)
  }
  const delayAt = win.args.indexOf('/t')
  if (delayAt === -1) {
    fail(`Windows shutdown has no /t delay — the tool_result would not get out before ` +
      `the machine goes, so every shutdown looks like a timeout to the model`)
  } else {
    const delay = Number(win.args[delayAt + 1])
    if (!Number.isInteger(delay) || delay < 1) {
      fail(`Windows shutdown delay is "${win.args[delayAt + 1]}"; it must be at least 1s`)
    }
    if (delay !== SHUTDOWN_DELAY_S) {
      fail(`Windows shutdown delay ${delay} disagrees with SHUTDOWN_DELAY_S`)
    }
  }
}

// --- an unknown platform fails loudly ----------------------------------------
//
// Silently returning the Linux command would run `systemctl poweroff` on something that
// has never heard of systemd — a no-op that reports success.
for (const build of [shutdownCommand, sleepCommand]) {
  let threw = false
  try {
    build('aix')
  } catch (error) {
    threw = error instanceof UnsupportedPlatformError
  }
  if (!threw) fail(`${build.name} did not throw UnsupportedPlatformError on an unknown platform`)
}

// --- commandFor agrees with the two builders ---------------------------------

for (const platform of PLATFORMS) {
  const viaName = JSON.stringify(commandFor('power.shutdown', platform))
  if (viaName !== JSON.stringify(shutdownCommand(platform))) {
    fail(`commandFor("power.shutdown", "${platform}") disagrees with shutdownCommand`)
  }
  if (JSON.stringify(commandFor('power.sleep', platform)) !== JSON.stringify(sleepCommand(platform))) {
    fail(`commandFor("power.sleep", "${platform}") disagrees with sleepCommand`)
  }
}

if (POWER_ACTIONS.length !== 2) {
  fail(`POWER_ACTIONS has ${POWER_ACTIONS.length} entries; commandFor handles exactly ` +
    `shutdown and sleep`)
}

// --- audio: the only commands built from a value rather than a constant -------

// The metacharacter canary cannot apply verbatim here, and the reason is worth stating:
// the Windows argument to `-Command` is a *script*, so it legitimately contains `;` and
// `$`. What the canary is really protecting is "no command is assembled out of a value",
// and for a script argument the sharper form of that is below — the script must be
// byte-identical no matter what value was asked for. Every other token still gets the
// plain scan.
const SCRIPT_FLAGS = new Set(['-Command', '-e'])

for (const platform of PLATFORMS) {
  for (const [label, command] of [
    ['get', getVolumeCommand(platform)],
    ['set', setVolumeCommand(platform, 42)],
    ['mute', setVolumeCommand(platform, 0)],
  ]) {
    if (!command.file || !Array.isArray(command.args)) {
      fail(`audio ${label} on ${platform} is malformed`)
      continue
    }
    for (const [index, token] of [command.file, ...command.args].entries()) {
      // `command.file` is index 0, so args[i] is index i+1; the script is whatever
      // follows a script flag.
      const previous = index === 0 ? null : [command.file, ...command.args][index - 1]
      if (previous && SCRIPT_FLAGS.has(String(previous))) continue
      for (const meta of [';', '&&', '||', '`', '$(']) {
        if (String(token).includes(meta)) {
          fail(`audio ${label} on ${platform} contains "${meta}" — no shell metacharacters`)
        }
      }
    }
  }
}

{
  // Windows: the level travels in the environment, never inside the script. Asserting the
  // script is *identical* for two different levels is the real check — a metacharacter
  // scan would pass an interpolated integer, and an interpolated integer today is an
  // interpolated string tomorrow.
  const low = setVolumeCommand('win32', 5)
  const high = setVolumeCommand('win32', 95)
  if (JSON.stringify(low.args) !== JSON.stringify(high.args)) {
    fail('the Windows audio script differs between volume levels — a value is being ' +
      'interpolated into it instead of passed through the environment')
  }
  if (low.env?.[VOLUME_ENV] !== '5' || high.env?.[VOLUME_ENV] !== '95') {
    fail(`Windows set_volume did not put the level in ${VOLUME_ENV}: ${JSON.stringify(high.env)}`)
  }
  if (getVolumeCommand('win32').env?.[VOLUME_ENV]) {
    fail('reading the volume set a target level — it must only report')
  }

  // Clamping is what makes interpolating a number on macOS safe: nothing but an integer
  // in 0..100 can ever reach a command, whatever the model produced.
  for (const [input, expected] of [
    [150, 100],
    [-5, 0],
    [42.6, 43],
    ['70', 70],
    ['nonsense', 0],
    [null, 0],
    ['0; rm -rf ~', 0],
  ]) {
    if (clampVolume(input) !== expected) {
      fail(`clampVolume(${JSON.stringify(input)}) = ${clampVolume(input)}, expected ${expected}`)
    }
  }
  if (!setVolumeCommand('darwin', 150).args.join(' ').includes('100')) {
    fail('macOS set_volume did not clamp to 100')
  }

  // An unreadable volume must be null, not a guess — a confident wrong percentage is
  // worse than admitting the read failed.
  for (const [output, expected] of [
    ['42', 42],
    ['  75  ', 75],
    ['Volume: front-left: 32768 /  50% / -18.06 dB', 50],
    ['nothing useful', null],
    ['999', null],
  ]) {
    if (parseVolume(output) !== expected) {
      fail(`parseVolume(${JSON.stringify(output)}) = ${parseVolume(output)}, expected ${expected}`)
    }
  }
}

// --- processes: a name straight from the model, and why that is safe ----------

for (const platform of PLATFORMS) {
  const list = listAppsCommand(platform)
  if (!list.file || !Array.isArray(list.args)) fail(`list on ${platform} is malformed`)

  // Not sanitised anywhere, and it does not need to be: with no shell there is no
  // parser to fool, so this is just a process name that matches nothing.
  const hostile = closeAppCommand(platform, 'foo; rm -rf ~')
  if (!hostile.args.includes('foo; rm -rf ~')) {
    fail(`close on ${platform} altered the name instead of passing it as one argv entry`)
  }
  if (hostile.args.length > 3) {
    fail(`close on ${platform} split the name across arguments — that is shell parsing`)
  }

  // No force-kill, for the same reason `shutdown` carries no /f.
  const close = closeAppCommand(platform, 'notepad.exe')
  if (close.args.includes('/f') || close.args.includes('-9') || close.args.includes('-KILL')) {
    fail(`close on ${platform} force-kills — unsaved work must be able to refuse`)
  }
}

{
  const csv = [
    '"notepad.exe","1","Console","1","2,000 K"',
    '"notepad.exe","2","Console","1","2,000 K"',
    '"code.exe","3","Console","1","9 K"',
  ].join('\r\n')
  const windows = parseAppsOutput('win32', csv)
  if (JSON.stringify(windows) !== JSON.stringify(['code.exe', 'notepad.exe'])) {
    fail(`parseApps(win32) = ${JSON.stringify(windows)}; expected deduped, sorted names`)
  }

  const unix = parseAppsOutput(
    'darwin',
    ['/usr/bin/ssh', '/Applications/Spotify.app/Contents/MacOS/Spotify', '/usr/bin/ssh'].join('\n'),
  )
  if (JSON.stringify(unix) !== JSON.stringify(['Spotify', 'ssh'])) {
    fail(`parseApps(darwin) = ${JSON.stringify(unix)}; expected basenames, deduped`)
  }

  const many = Array.from({ length: 200 }, (_, i) => `p${i}`).join('\n')
  if (parseAppsOutput('linux', many).length > 40) fail('parseApps did not cap its output')
}

// --- the panel is generated from capabilities, not hardcoded ------------------
//
// Each rule below has a wrong answer that renders a confident, misleading control rather
// than failing: a cheerful toggle labelled "Shutdown", a slider with no range, or an
// audio section on a machine that never offered audio.

{
  const AUDIO = [
    { action: 'system-control.audio.get_volume' },
    { action: 'system-control.audio.set_volume' },
    { action: 'system-control.audio.mute' },
  ]
  const POWER = [
    { action: 'system-control.power.shutdown', destructive: true },
    { action: 'system-control.power.sleep', destructive: true },
  ]

  const full = surfaceFor([...AUDIO, ...POWER, { action: 'system-control.process.list' }])
  if (!full.audio?.canRead || !full.audio.canSet || !full.audio.canMute) {
    fail(`audio surface misread: ${JSON.stringify(full.audio)}`)
  }
  if (!full.apps?.canList || full.apps.canClose || full.apps.canLaunch) {
    fail(`apps surface misread: ${JSON.stringify(full.apps)}`)
  }
  // Sleep before shutdown: the reversible one first, so the more destructive button is
  // never the one nearest whatever you were reaching for.
  const order = full.power.map((p) => p.action).join()
  if (order !== 'system-control.power.sleep,system-control.power.shutdown') {
    fail(`power order is ${order}; sleep must come first`)
  }
  // A capability drawn bespoke must not ALSO appear as a generic row, or the card grows
  // two of every control.
  if (full.other.length !== 0) {
    fail(`known capabilities leaked into the generic bucket: ${full.other.map((o) => o.action)}`)
  }

  // A device this build has never heard of still renders. This is the property that
  // keeps the panel honest for Aperture mobile and for TouchDesigner.
  const foreign = surfaceFor([{ action: 'notify.toast' }, { action: 'td.trigger' }])
  if (foreign.audio || foreign.apps || foreign.power.length) {
    fail('a foreign device produced bespoke sections it never announced')
  }
  if (foreign.other.length !== 2) {
    fail(`a foreign device rendered ${foreign.other.length} controls; expected 2`)
  }
  if (foreign.other[0].label !== 'Toast') {
    fail(`fallback label was "${foreign.other[0].label}"; expected "Toast"`)
  }

  if (!isEmpty(surfaceFor([]))) fail('a device with no capabilities did not read as empty')
  if (isEmpty(foreign)) fail('a device with capabilities read as empty')

  // --- inference, for a capability that declared no control ---
  const destructive = controlFor({ action: 'system-control.power.shutdown', destructive: true })
  if (destructive.kind !== 'button' || destructive.tone !== 'danger') {
    fail(`a destructive capability rendered as ${JSON.stringify(destructive)}`)
  }
  const slider = controlFor({
    action: 'ext.set_level',
    input_schema: { properties: { level: { type: 'number', minimum: 0, maximum: 100 } } },
  })
  if (slider.kind !== 'slider' || slider.arg !== 'level' || slider.max !== 100) {
    fail(`a bounded number did not become a slider: ${JSON.stringify(slider)}`)
  }
  const unbounded = controlFor({
    action: 'ext.set_level',
    input_schema: { properties: { level: { type: 'number' } } },
  })
  if (unbounded.kind === 'slider') fail('an unbounded number became a slider with no range')
  const toggle = controlFor({
    action: 'ext.mute',
    input_schema: { properties: { on: { type: 'boolean' } } },
  })
  if (toggle.kind !== 'toggle' || toggle.arg !== 'on') {
    fail(`a boolean did not become a toggle: ${JSON.stringify(toggle)}`)
  }

  // --- a control hint from the wire is untrusted data, not a ControlSpec ---
  //
  // It arrives from another machine. Every shape below renders something silently broken
  // if taken at face value, so each must be refused and fall back to inference.
  for (const bad of [
    null,
    'slider',
    {},
    { kind: 'slider', label: 'V' },
    { kind: 'slider', label: 'V', arg: 'level', min: 0 },
    { kind: 'slider', label: 'V', arg: 'level', min: 100, max: 0 },
    { kind: 'telepathy', label: 'V' },
    { kind: 'toggle', label: '' },
  ]) {
    if (asControlSpec(bad, false) !== null) {
      fail(`asControlSpec accepted ${JSON.stringify(bad)}`)
    }
  }
  const good = asControlSpec(
    { kind: 'slider', label: 'Volume', arg: 'level', min: 0, max: 100 },
    false,
  )
  if (good?.kind !== 'slider' || good.label !== 'Volume') {
    fail(`asControlSpec rejected a valid hint: ${JSON.stringify(good)}`)
  }
  // A destructive capability may never be drawn as anything but a danger button, whatever
  // the remote machine asked for.
  const coerced = asControlSpec({ kind: 'toggle', label: 'Shut down', arg: 'on' }, true)
  if (coerced?.kind !== 'button' || coerced.tone !== 'danger') {
    fail(`a destructive capability was allowed a ${coerced?.kind} control`)
  }
}

// --- the audio state contract, in both directions -----------------------------
//
// `describeAudio` is prose the model reads AND the string the panel parses a level back
// out of, because a tool_result is a string and a reading has nowhere else to travel. If
// the two drift, the slider silently stops reflecting the machine.

{
  for (const [output, level, what] of [
    ['67', 67, 'windows'],
    ['0', 0, 'windows, silent'],
    ['output volume:67, input volume:75, alert volume:100, output muted:false', 67, 'macos'],
    // The label has to be matched, not the first number: `input volume` would otherwise
    // win on a machine whose input is louder than its output.
    ['output volume:12, input volume:75, alert volume:100, output muted:true', 12, 'macos'],
    ['Volume: front-left: 43417 /  67% / -10.5 dB', 67, 'linux'],
    ['  75  ', 75, 'a bare number'],
    ['nothing useful', null, 'unreadable'],
    ['999', null, 'out of range'],
  ]) {
    const state = parseAudioState(output)
    if (state.level !== level) {
      fail(`parseAudioState(${what}) = ${JSON.stringify(state)}; expected level ${level}`)
    }
  }

  // The round trip. This is the assertion that catches a reworded message.
  for (const level of [0, 1, 42, 67, 100]) {
    const back = parseAudioState(describeAudio({ level }))
    if (back.level !== level) {
      fail(`describeAudio({level:${level}}) does not parse back: ` +
        `"${describeAudio({ level })}" gave ${JSON.stringify(back)}`)
    }
  }

  // An unreadable level must never parse back as a number: a slider at 0 looks exactly
  // like a machine that is genuinely silent, and the two need different treatment.
  if (parseAudioState(describeAudio({ level: null })).level !== null) {
    fail('an unreadable level parsed back as a number')
  }

  // Mute is level zero, and nothing else. If these ever diverge, the speaker button and
  // the slider start disagreeing about the same machine.
  if (!isMuted({ level: 0 })) fail('level 0 did not read as muted')
  for (const level of [1, 42, 100]) {
    if (isMuted({ level })) fail(`level ${level} read as muted`)
  }
  // A failed read is not silence.
  if (isMuted({ level: null })) fail('an unreadable level read as muted')
}

// --- the running-apps contract ------------------------------------------------

{
  const parsed = parseApps('Running: code.exe, notepad.exe, spotify.exe.')
  if (JSON.stringify(parsed) !== JSON.stringify(['code.exe', 'notepad.exe', 'spotify.exe'])) {
    fail(`parseApps returned ${JSON.stringify(parsed)}`)
  }
  if (parseApps('Nothing readable is running.').length !== 0) {
    fail('parseApps invented entries from a non-list message')
  }
}


if (failures) {
  console.error(`\nverify-devices: ${failures} problem(s)`)
  process.exit(1)
}
console.log(
  `verify-devices: ok — ${PLATFORMS.length} platforms × 2 power actions, argv only, ` +
    `no /f, delay ${SHUTDOWN_DELAY_S}s, panel generated from capabilities`,
)
