import { useSettings } from '../context'
import { Field, Note, Toggle, field } from '../parts'

/** Everything that changes how an open shell behaves. Nothing here reconnects. */
export function Terminal(): React.JSX.Element {
  const { draft, set } = useSettings()

  return (
    <>
      <Toggle
        label="Predict typing locally"
        hint="Draw typed characters dimmed before the remote shell echoes them back, so typing over a slow link feels immediate. It measures the round-trip and only predicts when it is worth it, and it stands down completely in full-screen programs and at password prompts."
        checked={draft.localEcho === 'auto'}
        onChange={(on) => set({ localEcho: on ? 'auto' : 'off' })}
      />

      {draft.localEcho === 'auto' && (
        <Field
          label="Predict above"
          hint={
            <>
              Milliseconds of measured round-trip. Below this the real echo already beats
              a prediction, so guessing would only ever be a flicker. The live
              measurement is in the terminal header when verbose logging is on.
            </>
          }
        >
          <input
            className={field}
            type="number"
            min={0}
            max={500}
            value={draft.localEchoThresholdMs}
            onChange={(e) =>
              set({ localEchoThresholdMs: Number(e.target.value) || 0 })
            }
          />
        </Field>
      )}

      <Toggle
        label="Suggest commands"
        hint="Offer completions from shell history, the remote PATH, remote paths, and the flags of docker, systemctl and the amber-infra scripts. Tab accepts the inline suggestion; Ctrl+Space opens the full list. With no suggestion showing, Tab still reaches the remote shell's own completion."
        checked={draft.terminalSuggestions}
        onChange={(terminalSuggestions) => set({ terminalSuggestions })}
      />

      <Note>Applies to open shells immediately — nothing here reconnects anything.</Note>
    </>
  )
}
