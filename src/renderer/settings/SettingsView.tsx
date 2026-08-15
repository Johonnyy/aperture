import { useState } from 'react'

import type { Settings } from '../../shared/types'
import { useStore } from '../store'

export function SettingsView(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const connState = useStore((s) => s.connection.state)
  const [draft, setDraft] = useState<Settings>(settings)
  const [saved, setSaved] = useState(false)

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  const save = async (): Promise<void> => {
    setSettings(await window.aperture.settings.set(draft))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const reconnect = async (): Promise<void> => {
    await save()
    // URL and token only take effect on a fresh dial, so bounce the socket.
    await window.aperture.amber.disconnect()
    await window.aperture.amber.connect()
  }

  const field = 'w-full rounded-[10px] border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-amber-deep'

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto px-6 py-8">
      <div>
        <h1 className="text-lg font-medium">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Stored locally in your user data directory.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">Amber URL</span>
        <input
          className={field}
          value={draft.amberUrl}
          onChange={(e) => setDraft({ ...draft, amberUrl: e.target.value })}
          placeholder="ws://localhost:8000/ws"
          spellCheck={false}
        />
        <span className="text-xs text-muted">
          Local dev is <code>ws://localhost:8000/ws</code>; a deployed instance uses{' '}
          <code>wss://</code>.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">Auth token</span>
        <input
          className={field}
          type="password"
          value={draft.authToken}
          onChange={(e) => setDraft({ ...draft, authToken: e.target.value })}
          placeholder="AMBER_AUTH_SECRET (leave empty if unset)"
          spellCheck={false}
        />
        <span className="text-xs text-muted">
          Sent as a bearer header. Leave empty when Amber runs without{' '}
          <code>AMBER_AUTH_SECRET</code>.
        </span>
      </label>

      <Toggle
        label="Reconnect automatically"
        hint="Retry with backoff when the connection drops, resuming the session."
        checked={draft.autoReconnect}
        onChange={(autoReconnect) => setDraft({ ...draft, autoReconnect })}
      />

      <Toggle
        label="Play Amber's voice"
        hint="Turn off to read replies without audio. Amber still synthesizes them."
        checked={draft.playAudio}
        onChange={(playAudio) => setDraft({ ...draft, playAudio })}
      />

      <Toggle
        label="Verbose logging"
        hint="Include exact commands, raw output, and host key fingerprints in operation logs. Turn it off to see only the high-level steps."
        checked={draft.verboseLogging}
        onChange={(verboseLogging) => setDraft({ ...draft, verboseLogging })}
      />

      <Toggle
        label="Confirm before running commands"
        hint="Amber-initiated SSH commands wait for your approval in the status panel. Leave this on until you trust the pattern."
        checked={draft.confirmBeforeExec}
        onChange={(confirmBeforeExec) => setDraft({ ...draft, confirmBeforeExec })}
      />

      <hr className="border-0 border-t border-line" />

      <div>
        <h2 className="text-sm font-medium">Terminal</h2>
        <p className="mt-1 text-xs text-muted">
          Applies to open shells immediately — nothing here reconnects anything.
        </p>
      </div>

      <Toggle
        label="Predict typing locally"
        hint="Draw typed characters dimmed before the remote shell echoes them back, so typing over a slow link feels immediate. It measures the round-trip and only predicts when it is worth it, and it stands down completely in full-screen programs and at password prompts."
        checked={draft.localEcho === 'auto'}
        onChange={(on) => setDraft({ ...draft, localEcho: on ? 'auto' : 'off' })}
      />

      {draft.localEcho === 'auto' && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm">Predict above</span>
          <input
            className={field}
            type="number"
            min={0}
            max={500}
            value={draft.localEcho === 'auto' ? draft.localEchoThresholdMs : 30}
            onChange={(e) =>
              setDraft({ ...draft, localEchoThresholdMs: Number(e.target.value) || 0 })
            }
          />
          <span className="text-xs text-muted">
            Milliseconds of measured round-trip. Below this the real echo already beats a
            prediction, so guessing would only ever be a flicker. The live measurement is
            in the terminal header when verbose logging is on.
          </span>
        </label>
      )}

      <Toggle
        label="Suggest commands"
        hint="Offer completions from shell history, the remote PATH, remote paths, and the flags of docker, systemctl and the amber-infra scripts. Tab accepts the inline suggestion; Ctrl+Space opens the full list. With no suggestion showing, Tab still reaches the remote shell's own completion."
        checked={draft.terminalSuggestions}
        onChange={(terminalSuggestions) => setDraft({ ...draft, terminalSuggestions })}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty}
          className="rounded-[10px] border border-amber-deep bg-amber/15 px-4 py-2 text-sm text-amber-hi transition hover:bg-amber/25 disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => void reconnect()}
          className="rounded-[10px] border border-line px-4 py-2 text-sm text-ink transition hover:border-amber-deep"
        >
          Save &amp; reconnect
        </button>
        {saved && <span className="text-xs text-ok">Saved</span>}
        {dirty && connState === 'open' && (
          <span className="text-xs text-muted">
            URL and token apply on the next connection.
          </span>
        )}
      </div>
    </section>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--color-amber)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
    </label>
  )
}
