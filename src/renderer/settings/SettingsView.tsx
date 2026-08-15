import { useState } from 'react'

import { THEMES, swatches, type Palette, type ThemeId } from '../../shared/theme'
import type { Settings } from '../../shared/types'
import { useStore } from '../store'
import { applyTheme } from '../theme'

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

  /**
   * Theme is the one setting that applies on click rather than on Save: it is pure
   * presentation with no side effects, and the preview *is* the decision — a Save
   * gate would make you commit to a look you can't see. Everything else on this page
   * has consequences and keeps the draft discipline.
   *
   * `draft` has to move too, or `dirty` (a stringify comparison against `settings`)
   * would read as permanently unsaved.
   */
  const pickTheme = (theme: ThemeId): void => {
    setDraft((d) => ({ ...d, theme }))
    applyTheme(theme) // ahead of the round trip, so the preview is same-frame
    void window.aperture.settings.set({ theme }).then(setSettings)
  }

  const reconnect = async (): Promise<void> => {
    await save()
    // URL and token only take effect on a fresh dial, so bounce the socket.
    await window.aperture.amber.disconnect()
    await window.aperture.amber.connect()
  }

  const field = 'w-full rounded-field border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-accent-deep'

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto px-6 py-8">
      <div>
        <h1 className="text-lg font-medium">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Stored locally in your user data directory.
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5 border-0 p-0">
        <legend className="text-sm">Appearance</legend>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2"
        >
          {Object.values(THEMES).map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              selected={draft.theme === theme.id}
              onPick={() => pickTheme(theme.id)}
            />
          ))}
        </div>
        <span className="text-xs text-muted">
          Applies immediately. Open terminals recolour in place — nothing reconnects.
        </span>
      </fieldset>

      <hr className="border-0 border-t border-line" />

      <BloomSection />

      <hr className="border-0 border-t border-line" />

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
        label="Advanced mode"
        hint="Show every action the Servers tab can run — pin and roll back an image, rename, edit env vars directly, the registry, backups and the deploy journal. Off, it offers install, update, restart and remove."
        checked={draft.advancedMode}
        onChange={(advancedMode) => setDraft({ ...draft, advancedMode })}
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
          className="rounded-field border border-accent-deep bg-accent/15 px-4 py-2 text-sm text-accent-hi transition hover:bg-accent/25 disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => void reconnect()}
          className="rounded-field border border-line px-4 py-2 text-sm text-ink transition hover:border-accent-deep"
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

/**
 * A theme card drawn *in its own theme* — its ground and raised colours, its corner
 * radius, its border width, its typeface, its elevation and its texture.
 *
 * A row of colour swatches can't tell you that Terminal green is square and
 * monospaced or that Golden hour is round and soft, and those are the differences you
 * actually pick on. Everything here reads from the palette, so a seventh theme gets a
 * truthful preview for free — it cannot drift from what switching will really do.
 */
function ThemeCard({
  theme,
  selected,
  onPick,
}: {
  theme: Palette
  selected: boolean
  onPick: () => void
}): React.JSX.Element {
  const { colors, style } = theme

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className="relative overflow-hidden text-left transition focus-visible:ring-2 focus-visible:ring-accent-deep focus-visible:outline-none"
      style={{
        background: colors.ground,
        borderStyle: 'solid',
        borderColor: selected ? colors.accentDeep : colors.line,
        borderWidth: selected ? `max(${style.stroke}, 2px)` : style.stroke,
        borderRadius: style.radius.panel,
        boxShadow: style.elevation.panel,
        fontFamily: style.sans,
        letterSpacing: style.tracking,
        padding: '0.75rem',
      }}
    >
      {/* The theme's own texture, at card scale. Purely optical, like the real one. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: style.texture.image,
          backgroundSize: style.texture.size,
          mixBlendMode: style.texture.blend as React.CSSProperties['mixBlendMode'],
        }}
      />

      <span className="relative flex flex-col gap-2">
        <span>
          <span className="block text-body" style={{ color: colors.ink }}>
            {theme.label}
          </span>
          <span className="block text-meta" style={{ color: colors.muted }}>
            {theme.hint}
          </span>
        </span>

        {/* A miniature of the primary button — the one control whose treatment
            carries the accent, the radius and the glow all at once. */}
        <span className="flex items-center gap-1.5">
          <span
            className="px-2 py-0.5 text-micro"
            style={{
              background: `color-mix(in oklab, ${colors.accent} 15%, transparent)`,
              color: colors.accentHi,
              borderStyle: 'solid',
              borderWidth: style.stroke,
              borderColor: colors.accentDeep,
              borderRadius: style.radius.control,
              textShadow: style.accentGlow,
            }}
          >
            Aa
          </span>
          {swatches(theme)
            .slice(1)
            .map((color, i) => (
              <span
                key={i}
                className="h-5 flex-1"
                style={{ background: color, borderRadius: style.radius.control }}
              />
            ))}
        </span>
      </span>
    </button>
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
        className="mt-0.5 h-4 w-4 accent-(--color-accent)"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
    </label>
  )
}

/**
 * Linking Bloom by hand.
 *
 * The usual path is the Servers tab, which reads the admin key off the box over SSH
 * — that is where the sudo password already lives, transiently, and it is the only
 * place it should. This is the escape hatch: a local instance during development, or
 * a Bloom no configured server reaches.
 *
 * The key goes straight into the OS keychain in main and never comes back across
 * the bridge, so there is nothing to display and no way to reveal it — only to
 * replace it or forget it.
 */
function BloomSection(): React.JSX.Element {
  const link = useStore((s) => s.bloomLink)
  const setBloomLink = useStore((s) => s.setBloomLink)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const field =
    'w-full rounded-field border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-accent-deep'

  const linkNow = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await window.aperture.bloom.linkManually(url, token)
    setBusy(false)
    if (result.link) setBloomLink(result.link)
    if (result.ok) {
      setUrl('')
      setToken('')
    } else {
      setError(result.error ?? 'Could not link Bloom.')
    }
  }

  const unlink = async (): Promise<void> => {
    if (!window.confirm('Forget this Bloom? Its admin key is deleted from this machine.')) return
    setBloomLink(await window.aperture.bloom.unlink())
  }

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="text-sm">Bloom</legend>

      {link.state === 'unlinked' ? (
        <p className="text-xs text-muted">
          Not linked. The usual way is the Servers tab, which reads the key off the
          box for you — this is for a local instance, or one no server reaches.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-meta text-muted">
            {link.baseUrl} · {link.state}
          </span>
          <button
            type="button"
            onClick={() => void unlink()}
            className="rounded-field border border-line px-3 py-1.5 text-sm text-muted transition hover:border-danger/50 hover:text-danger"
          >
            Forget
          </button>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">Address</span>
        <input
          className={field}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8010"
        />
        <span className="text-xs text-muted">
          Plain http is allowed only for localhost — the admin key grants full control,
          and sending it unencrypted to a public host is refused.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">Admin key</span>
        <input
          className={field}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="from BLOOM_ADMIN_KEYS"
        />
        <span className="text-xs text-muted">
          Stored in the OS keychain, never in a settings file. It is not readable back
          from here once saved.
        </span>
      </label>

      <div>
        <button
          type="button"
          disabled={busy || !url.trim() || !token.trim()}
          onClick={() => void linkNow()}
          className="rounded-field border border-accent-deep bg-accent/15 px-4 py-2 text-sm text-accent-hi transition hover:bg-accent/25 disabled:opacity-40"
        >
          {busy ? 'Linking…' : 'Link Bloom'}
        </button>
      </div>
    </fieldset>
  )
}
