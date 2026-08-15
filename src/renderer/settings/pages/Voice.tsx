import { FALLBACK_VOICE_OPTIONS } from '../../../shared/voice'
import { useStore } from '../../store'
import { useSettings } from '../context'
import { Field, Note, Toggle, field } from '../parts'

/**
 * How Amber sounds.
 *
 * Two sources of truth meet here and must not be conflated. `draft.tts*` is what this
 * machine is *asking for*, with `''`/`0` meaning "whatever you're configured for".
 * `voice` is the `voice` frame — what Amber is *actually* doing, after it has
 * validated and clamped the request. Every control is seeded from the effective value
 * and writes to the request, so "Amber's default" stays a real, reachable state rather
 * than a value that merely happens to match today.
 *
 * Amber is the authority on what it accepts: the lists come off the wire in `options`,
 * so a voice added server-side appears here without a release. When that hasn't
 * arrived — no connection yet, or an Amber built before voice control — the pickers
 * fall back to `FALLBACK_VOICE_OPTIONS` rather than going dead. Disabling them was the
 * wrong instinct: these settings are persisted locally and re-sent on every `ready`, so
 * choosing one while disconnected is a perfectly coherent thing to do, and Amber
 * validates whatever it is handed anyway. A settings page you cannot use to change a
 * setting is worse than a list that might be one voice out of date.
 */
export function Voice(): React.JSX.Element {
  const { draft, set, update } = useSettings()
  const voice = useStore((s) => s.voice)
  const connState = useStore((s) => s.connection.state)
  const effective = voice?.settings
  const locked = voice?.locked === true
  /** True when the lists below are Amber's own rather than the built-in fallback. */
  const live = Boolean(voice?.options)
  const options = voice?.options ?? FALLBACK_VOICE_OPTIONS

  // The model that will actually be used — the request if there is one, otherwise
  // whatever Amber reports. It decides whether the speed control is real or a hint.
  // An unknown model (nothing chosen, nothing reported) is assumed to take speed
  // natively: that is true of the default and of both older models, and warning about
  // a quirk of a model nobody has selected would be noise.
  const model = draft.ttsModel || effective?.model || ''
  const nativeSpeed = !model || options.native_speed_models.includes(model)
  const takesInstructions = options.instruction_models.includes(model)

  const [min, max] = options.speed_range
  const speed = draft.ttsSpeed > 0 ? draft.ttsSpeed : (effective?.speed ?? 1)
  const overridden =
    Boolean(draft.ttsVoice || draft.ttsModel || draft.ttsInstructions) ||
    draft.ttsSpeed > 0

  return (
    <>
      <Toggle
        label="Play Amber's voice"
        hint="Turn off to read replies without audio. Amber still synthesizes them."
        checked={draft.playAudio}
        onChange={(playAudio) => set({ playAudio })}
      />

      <fieldset className="flex flex-col gap-3 border-0 p-0" disabled={locked}>
        <legend className="sr-only">Speech</legend>

        {!live && (
          <Note>
            {connState === 'open' ? (
              <>
                This Amber never sent its voice catalogue, so it is running a build from
                before voice control — update it and these will start applying. Choices
                made here are saved and re-sent on every connection meanwhile.
              </>
            ) : (
              <>
                Not connected, so these are the voices Amber is expected to accept rather
                than the list it named. They are saved locally and sent as soon as it
                answers.
              </>
            )}
          </Note>
        )}
        {locked && (
          <Note>
            Pinned on the server — <code>AMBER_FEATURE_VOICE_CONTROL</code> is off, so
            Amber ignores what this app asks for. It is currently speaking as{' '}
            <strong>{effective?.voice}</strong> at {effective?.speed}×.
          </Note>
        )}

        <Field
          label="Speaking rate"
          hint={
            draft.ttsSpeed > 0 ? (
              <>
                1.0× is the API default and is noticeably unhurried; 1.15–1.3× is where
                most people land.{' '}
                {!nativeSpeed && (
                  <>
                    <code>{model}</code> has no speed parameter, so Amber turns this into
                    a pacing instruction — it works, but less precisely.
                  </>
                )}
              </>
            ) : (
              <>Using Amber&apos;s own setting. Move the slider to override it here.</>
            )
          }
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={min}
              max={Math.min(max, 2)}
              step={0.05}
              value={speed}
              onChange={(e) => set({ ttsSpeed: Number(e.target.value) })}
              className="h-1 flex-1 accent-accent"
            />
            <span className="w-14 text-right font-mono text-meta text-muted">
              {speed.toFixed(2)}×
            </span>
          </div>
        </Field>

        <Field label="Voice">
          <select
            className={field}
            value={draft.ttsVoice}
            onChange={(e) => set({ ttsVoice: e.target.value })}
          >
            <option value="">
              Amber&apos;s default{effective ? ` (${effective.voice})` : ''}
            </option>
            {options?.voices.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Model"
          hint={
            <>
              <code>tts-1</code> is the fastest to first sound, which is what a
              conversation notices most. <code>gpt-4o-mini-tts</code> is a better voice
              and takes direction below, at some latency.
            </>
          }
        >
          <select
            className={field}
            value={draft.ttsModel}
            onChange={(e) => set({ ttsModel: e.target.value })}
          >
            <option value="">
              Amber&apos;s default{effective ? ` (${effective.model})` : ''}
            </option>
            {options?.models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Direction"
          hint={
            takesInstructions ? (
              <>How the words should be delivered — tone, pace, attitude.</>
            ) : (
              <>
                Only the <code>gpt-4o-*</code> models act on this. With{' '}
                <code>{model || 'the current model'}</code> selected it is saved but not
                sent.
              </>
            )
          }
        >
          <input
            className={field}
            value={draft.ttsInstructions}
            placeholder="warm and brisk, never sing-song"
            onChange={(e) => set({ ttsInstructions: e.target.value })}
          />
        </Field>

        {overridden && (
          <div>
            <button
              type="button"
              onClick={() =>
                update((d) => ({
                  ...d,
                  ttsVoice: '',
                  ttsModel: '',
                  ttsSpeed: 0,
                  ttsInstructions: '',
                }))
              }
              className="rounded-field border border-line px-3 py-1.5 text-sm text-muted transition hover:border-accent-deep hover:text-ink"
            >
              Use Amber&apos;s settings
            </button>
          </div>
        )}

        <Note>
          Applies to Amber&apos;s next reply after you save — nothing reconnects.
        </Note>
      </fieldset>
    </>
  )
}
