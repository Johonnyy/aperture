import type { VoiceOptions } from './protocol'

/**
 * What to offer in the voice pickers when Amber hasn't told us.
 *
 * **A fallback, never the source of truth.** Amber sends its own catalogue in the
 * `voice` frame and that always wins — this list exists only so the controls are
 * usable when there is nothing to ask: before the first connection, while the socket
 * is down, or against an Amber built before voice control existed.
 *
 * Guessing is safe here in a way it usually isn't, because `set_voice` is validated
 * server-side: a value this list has and that Amber doesn't is dropped, and the
 * `voice` frame that comes back reports what actually took effect. The cost of being
 * wrong is one setting that doesn't stick and says so; the cost of showing nothing is
 * a settings page that cannot be used to change settings.
 *
 * Mirrors `amber/app/voice.py`. If the two drift, this one is wrong.
 */
export const FALLBACK_VOICE_OPTIONS: VoiceOptions = {
  voices: [
    'alloy',
    'ash',
    'ballad',
    'coral',
    'echo',
    'fable',
    'nova',
    'onyx',
    'sage',
    'shimmer',
    'verse',
  ],
  models: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
  formats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
  speed_range: [0.25, 4],
  native_speed_models: ['tts-1-hd', 'tts-1'],
  instruction_models: ['gpt-4o-mini-tts'],
}
