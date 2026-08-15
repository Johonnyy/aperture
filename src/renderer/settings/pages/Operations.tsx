import { useSettings } from '../context'
import { Toggle } from '../parts'

/**
 * What the Servers tab is allowed to do and how much it says while doing it.
 *
 * The three sit together because they answer one question — how much of the machinery
 * you want in front of you — and apart because they are not the same flag. Verbose is
 * about how much a running operation narrates and defaults ON; advanced is about how
 * many buttons exist and defaults OFF. See `Settings.advancedMode` for why merging
 * them is a regression in one direction or the other.
 */
export function Operations(): React.JSX.Element {
  const { draft, set } = useSettings()

  return (
    <>
      <Toggle
        label="Advanced mode"
        hint="Show every action the Servers tab can run — pin and roll back an image, rename, edit env vars directly, the registry, backups and the deploy journal. Off, it offers install, update, restart and remove."
        checked={draft.advancedMode}
        onChange={(advancedMode) => set({ advancedMode })}
      />

      <Toggle
        label="Confirm before running commands"
        hint="Amber-initiated SSH commands wait for your approval in the status panel. Leave this on until you trust the pattern."
        checked={draft.confirmBeforeExec}
        onChange={(confirmBeforeExec) => set({ confirmBeforeExec })}
      />

      <Toggle
        label="Verbose logging"
        hint="Include exact commands, raw output, and host key fingerprints in operation logs. Turn it off to see only the high-level steps."
        checked={draft.verboseLogging}
        onChange={(verboseLogging) => set({ verboseLogging })}
      />
    </>
  )
}
