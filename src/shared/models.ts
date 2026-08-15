import type { ModelKeyword } from './protocol'

/**
 * The keywords to offer before Amber has named its own.
 *
 * **A fallback, never the source of truth** — the same posture as
 * `FALLBACK_VOICE_OPTIONS`, for the same reason. Amber sends its whole catalogue in
 * the `model` frame and that always wins; this list only exists so the picker is
 * usable when there is nothing to ask: before the first connection, while the socket
 * is down, or against an Amber built before model control existed.
 *
 * Guessing is safe here because `set_model` is validated server-side and the `model`
 * frame reports what actually took effect. It is also deliberately *incomplete* in a
 * particular way: no `model` values. Which model a keyword points at is exactly the
 * thing this app exists to change, so shipping a guess would put a wrong answer on
 * screen next to the control for fixing it. The words are stable; their targets are
 * not.
 *
 * Mirrors `amber/app/models.py`. If the two drift, this one is wrong.
 */
export const FALLBACK_KEYWORDS: ModelKeyword[] = [
  ['fast', 'First word out quickest. What a spoken turn actually notices.'],
  ['cheap', 'The least you can spend and still hold a conversation.'],
  ['balanced', "The everyday all-rounder, and Amber's own default."],
  ['strong', 'Best general quality, at more latency and more money.'],
  ['coding', 'Writing, reading and fixing code.'],
  ['reasoning', 'Multi-step problems worth thinking slowly about.'],
  ['writing', 'Long-form prose — tone, structure, keeping a voice.'],
  ['research', 'Long tool-using chains: search, read, cross-check, summarise.'],
  ['vision', 'Turns with an image in them.'],
  ['long', 'Very large inputs — a whole document, a whole transcript.'],
].map(([name, description]) => ({
  name,
  model: '',
  default_model: null,
  description,
  custom: false,
  overridden: false,
  shared: false,
}))

/**
 * Models to suggest in the "points at" field, fetched from OpenRouter's public
 * catalogue by the main process (`main/amber/catalogue.ts`).
 *
 * A suggestion list, not a constraint: the field stays free text, because a model
 * that shipped this morning must be usable this morning — waiting for a catalogue to
 * list it would reintroduce exactly the delay this whole feature removes.
 */
export interface CatalogueModel {
  id: string
  name: string
  /** USD per million prompt tokens, when OpenRouter states one. */
  promptPrice: number | null
  contextLength: number | null
}
