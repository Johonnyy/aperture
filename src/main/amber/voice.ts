import type { Settings } from '../../shared/types'
import type { AmberConnection } from './connection'

/**
 * Push this machine's voice preferences to Amber.
 *
 * Called on every `ready` and again whenever Settings are saved — the same
 * discipline as `ToolBridge.register()`, and for the same reason: Amber holds the
 * voice on the *session*, so a resume after the TTL expired starts from the server
 * default and nothing else would put it back.
 *
 * The empty string and `0` mean "don't override" (see `Settings.ttsVoice`), and they
 * map to an explicit `null` on the wire rather than to an omitted key. Omitting is
 * "leave it as it is", which is not the same thing: clearing a control in the UI has
 * to actually *undo* the override, not merely stop asking for it. Amber's `null`
 * means "back to your configured default", which is exactly the state the empty
 * sentinel describes.
 */
export function applyVoice(amber: AmberConnection, settings: Settings): boolean {
  return amber.send({
    type: 'set_voice',
    voice: settings.ttsVoice || null,
    model: settings.ttsModel || null,
    speed: settings.ttsSpeed > 0 ? settings.ttsSpeed : null,
    instructions: settings.ttsInstructions || null,
  })
}
