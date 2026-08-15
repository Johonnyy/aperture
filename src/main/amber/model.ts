import type { Settings } from '../../shared/types'
import type { AmberConnection } from './connection'

/**
 * Push this machine's choice of brain to Amber.
 *
 * Called on every `ready` and again whenever Settings are saved — the same
 * discipline as `applyVoice()` and `ToolBridge.register()`, and for the same reason:
 * the keyword lives on Amber's *session*, so a resume after the TTL expired starts
 * from the server default and nothing else would put it back.
 *
 * The empty string means "don't override" (see `Settings.llmKeyword`) and maps to an
 * explicit `null` rather than an omitted key. Omitting is "leave it as it is", which
 * is not the same thing: clearing the control has to actually *undo* the override.
 */
export function applyModel(amber: AmberConnection, settings: Settings): boolean {
  return amber.send({ type: 'set_model', keyword: settings.llmKeyword || null })
}

/**
 * Say what a keyword means — for this Amber, and through it for every app.
 *
 * Deliberately *not* part of `applyModel`, and deliberately not stored in Settings.
 * The two look similar and belong in different places: which keyword this machine
 * asks for is a local preference, while what `coding` points at is shared state that
 * Amber persists and pushes to the sync store. Keeping a copy here would give the
 * ecosystem two answers to the same question, and this app would be the one that
 * loses — it is asleep most of the time.
 *
 * `null` resets the keyword to Amber's built-in default. Returns false when the
 * socket is down; unlike the voice there is no re-send on `ready`, because there is
 * nothing local to re-assert — the value is already Amber's.
 */
export function remapKeyword(
  amber: AmberConnection,
  keyword: string,
  model: string | null,
): boolean {
  return amber.send({ type: 'set_model', map: { [keyword]: model } })
}
