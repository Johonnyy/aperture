/**
 * Reading a machine's audio level back out of what its OS printed.
 *
 * In `shared/` because two processes need it and neither can borrow the other's copy:
 * main parses the raw command output, and the **renderer** parses the sentence back out
 * of a `device_control_response` to seed the slider. A `tool_result` is a string, so
 * there is nowhere structured for a reading to travel, which makes `describeAudio`'s
 * output a contract between the two rather than only prose for the model.
 *
 * ## There is no mute state, deliberately
 *
 * There used to be. Every platform reports OS mute differently (Windows through a COM
 * interop, macOS in the same line as the level, Linux not at all), which meant a
 * nullable third state, a second thing to parse out of prose, and a toggle that could
 * disagree with the level it sat next to: volume 67 and silence, or volume 0 and "not
 * muted". Two sources of truth for one question.
 *
 * So mute is **level zero**. `audio.mute` sets the volume to 0 and remembers where it
 * was; unmuting puts it back. One value, one control, identical on all three platforms,
 * and the slider and the speaker button cannot contradict each other because they read
 * the same number.
 *
 * Pure, so `verify:devices` exercises every platform's format without running anything.
 */

export interface AudioState {
  /** 0..100, or `null` when the output could not be read. */
  level: number | null
}

/** Muting is not a separate state: it is the level being zero. */
export function isMuted(state: AudioState): boolean {
  return state.level === 0
}

/**
 * Turn whatever the platform printed into a level.
 *
 * Three formats, one function, because the alternative is three parsers that drift:
 *
 * - **Windows** — a bare number, our own script's doing, so the shape is a contract.
 * - **macOS** — `output volume:67, input volume:75, alert volume:100, output muted:false`
 * - **Linux** — `Volume: front-left: 43417 /  67% / -10.5 dB, front-right: …`
 *
 * `null` rather than a guess. A slider parked at 0 because a read failed looks exactly
 * like a machine that is genuinely silent, and the panel has to be able to tell those
 * apart: one shows a dash, the other shows a muted speaker.
 */
export function parseAudioState(output: string): AudioState {
  const text = output.trim()

  // macOS reports several volumes in one line, so the label has to be matched rather
  // than the first number: `input volume` would otherwise win on some machines.
  const mac = text.match(/output volume:\s*(\d{1,3})/i)
  if (mac) return { level: inRange(mac[1]) }

  // Linux (and any bare percentage): take the first, since pactl prints one per channel.
  // Also the path `describeAudio`'s own output takes, which is what lets the panel read
  // a reading back out of a sentence.
  const percent = text.match(/(\d{1,3})\s*%/)
  if (percent) return { level: inRange(percent[1]) }

  const bare = text.match(/^\s*(\d{1,3})\s*$/m)
  return { level: bare ? inRange(bare[1]) : null }
}

function inRange(raw: string): number | null {
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

/** The level alone, for callers that only want the number. */
export function parseVolume(output: string): number | null {
  return parseAudioState(output).level
}

/**
 * How `audio.get_volume` and `audio.set_volume` report themselves.
 *
 * **This string is a contract**, not just prose: the Devices panel parses the level back
 * out of it to seed the slider. Keep the `NN%` intact, and `verify:devices` round-trips
 * it against `parseAudioState` to hold you to it.
 */
export function describeAudio(state: AudioState): string {
  if (state.level === null) return 'The volume could not be read.'
  if (state.level === 0) return 'Volume is at 0%, so nothing is audible.'
  return `Volume is at ${state.level}%.`
}
