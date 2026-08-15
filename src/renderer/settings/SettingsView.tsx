import { useEffect, useState } from 'react'

import { FALLBACK_KEYWORDS, type CatalogueModel } from '../../shared/models'
import type { ModelKeyword } from '../../shared/protocol'
import { THEMES, swatches, type Palette, type ThemeId } from '../../shared/theme'
import type { Settings } from '../../shared/types'
import { FALLBACK_VOICE_OPTIONS } from '../../shared/voice'
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

      <VoiceSection draft={draft} setDraft={setDraft} />

      <ModelSection draft={draft} setDraft={setDraft} />

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

/**
 * How Amber sounds.
 *
 * Two sources of truth meet here and must not be conflated. `draft.tts*` is what
 * this machine is *asking for*, with `''`/`0` meaning "whatever you're configured
 * for". `voice` is the `voice` frame — what Amber is *actually* doing, after it has
 * validated and clamped the request. Every control is seeded from the effective
 * value and writes to the request, so "Amber's default" stays a real, reachable
 * state rather than a value that merely happens to match today.
 *
 * Amber is the authority on what it accepts: the lists come off the wire in
 * `options`, so a voice added server-side appears here without a release. When that
 * hasn't arrived — no connection yet, or an Amber built before voice control — the
 * pickers fall back to `FALLBACK_VOICE_OPTIONS` rather than going dead. Disabling
 * them was the wrong instinct: these settings are persisted locally and re-sent on
 * every `ready`, so choosing one while disconnected is a perfectly coherent thing to
 * do, and Amber validates whatever it is handed anyway. A settings page you cannot
 * use to change a setting is worse than a list that might be one voice out of date.
 */
function VoiceSection({
  draft,
  setDraft,
}: {
  draft: Settings
  setDraft: React.Dispatch<React.SetStateAction<Settings>>
}): React.JSX.Element {
  const voice = useStore((s) => s.voice)
  const connState = useStore((s) => s.connection.state)
  const effective = voice?.settings
  const locked = voice?.locked === true
  /** True when the lists below are Amber's own rather than the built-in fallback. */
  const live = Boolean(voice?.options)
  const options = voice?.options ?? FALLBACK_VOICE_OPTIONS

  const field =
    'w-full rounded-field border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-accent-deep disabled:opacity-40'

  // The model that will actually be used — the request if there is one, otherwise
  // whatever Amber reports. It decides whether the speed control is real or a hint.
  // An unknown model (nothing chosen, nothing reported) is assumed to take speed
  // natively: that is true of the default and of both older models, and warning
  // about a quirk of a model nobody has selected would be noise.
  const model = draft.ttsModel || effective?.model || ''
  const nativeSpeed = !model || options.native_speed_models.includes(model)
  const takesInstructions = options.instruction_models.includes(model)

  const [min, max] = options.speed_range
  const speed = draft.ttsSpeed > 0 ? draft.ttsSpeed : (effective?.speed ?? 1)
  const overridden =
    Boolean(draft.ttsVoice || draft.ttsModel || draft.ttsInstructions) || draft.ttsSpeed > 0

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0" disabled={locked}>
      <legend className="text-sm">Voice</legend>

      {!live && (
        <p className="text-xs text-muted">
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
        </p>
      )}
      {locked && (
        <p className="text-xs text-muted">
          Pinned on the server — <code>AMBER_FEATURE_VOICE_CONTROL</code> is off, so
          Amber ignores what this app asks for. It is currently speaking as{' '}
          <strong>{effective?.voice}</strong> at {effective?.speed}×.
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">Speaking rate</span>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={Math.min(max, 2)}
            step={0.05}
            value={speed}
            onChange={(e) => setDraft((d) => ({ ...d, ttsSpeed: Number(e.target.value) }))}
            className="h-1 flex-1 accent-accent"
          />
          <span className="w-14 text-right font-mono text-meta text-muted">
            {speed.toFixed(2)}×
          </span>
        </div>
        <span className="text-xs text-muted">
          {draft.ttsSpeed > 0 ? (
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
          )}
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">Voice</span>
        <select
          className={field}
          value={draft.ttsVoice}
          onChange={(e) => setDraft((d) => ({ ...d, ttsVoice: e.target.value }))}
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
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">Model</span>
        <select
          className={field}
          value={draft.ttsModel}
          onChange={(e) => setDraft((d) => ({ ...d, ttsModel: e.target.value }))}
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
        <span className="text-xs text-muted">
          <code>tts-1</code> is the fastest to first sound, which is what a
          conversation notices most. <code>gpt-4o-mini-tts</code> is a better voice and
          takes direction below, at some latency.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">Direction</span>
        <input
          className={field}
          value={draft.ttsInstructions}
          placeholder="warm and brisk, never sing-song"
          onChange={(e) => setDraft((d) => ({ ...d, ttsInstructions: e.target.value }))}
        />
        <span className="text-xs text-muted">
          {takesInstructions ? (
            <>How the words should be delivered — tone, pace, attitude.</>
          ) : (
            <>
              Only the <code>gpt-4o-*</code> models act on this. With{' '}
              <code>{model || 'the current model'}</code> selected it is saved but not
              sent.
            </>
          )}
        </span>
      </label>

      {overridden && (
        <div>
          <button
            type="button"
            onClick={() =>
              setDraft((d) => ({
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

      <span className="text-xs text-muted">
        Applies to Amber&apos;s next reply after you save — nothing reconnects.
      </span>
    </fieldset>
  )
}

/**
 * Which brain answers, and what the words mean.
 *
 * Two settings that look like one and are emphatically not, which is why they are
 * drawn as two blocks with a rule between them:
 *
 * *Answer with* is **this machine's** preference — a keyword, saved locally, re-sent
 * on every connection, `''` meaning "whatever Amber is configured for". Same shape,
 * same sentinel and same draft discipline as the voice controls above.
 *
 * *What the keywords mean* is **shared state**. It lives in Amber's database and is
 * pushed to the sync store, so re-pointing `coding` here moves every app in the
 * ecosystem. It therefore applies on commit rather than on Save — like the theme
 * picker, and for a stronger reason: a draft of somebody else's state would be a
 * change you could stage, walk away from, and never make. There is nothing local to
 * stage. What comes back in the `model` frame is the only truth about it.
 *
 * The model field is free text with suggestions, never a closed list. A model
 * published this morning has to be usable this morning; a picker limited to a
 * fetched catalogue would reintroduce exactly the delay this feature removes.
 */
function ModelSection({
  draft,
  setDraft,
}: {
  draft: Settings
  setDraft: React.Dispatch<React.SetStateAction<Settings>>
}): React.JSX.Element {
  const model = useStore((s) => s.model)
  const connState = useStore((s) => s.connection.state)
  const [catalogue, setCatalogue] = useState<CatalogueModel[]>([])

  const live = Boolean(model?.options)
  const locked = model?.locked === true
  const effective = model?.settings
  const keywords = model?.options?.keywords ?? FALLBACK_KEYWORDS
  const sync = model?.options?.sync

  // Suggestions only; an empty list costs nothing but a shorter dropdown.
  useEffect(() => {
    let alive = true
    void window.aperture.amber.modelCatalogue().then((models) => {
      if (alive) setCatalogue(models)
    })
    return () => {
      alive = false
    }
  }, [])

  const field =
    'w-full rounded-field border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-accent-deep disabled:opacity-40'

  const chosen = keywords.find((k) => k.name === draft.llmKeyword)

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0" disabled={locked}>
      <legend className="text-sm">Brain</legend>

      {!live && (
        <p className="text-xs text-muted">
          {connState === 'open' ? (
            <>
              This Amber never sent a model catalogue, so it is running a build from
              before model control — update it and these will start applying. Choices
              made here are saved and re-sent on every connection meanwhile.
            </>
          ) : (
            <>
              Not connected, so these are the keywords Amber is expected to know rather
              than the ones it named — and what each points at is only readable from
              Amber itself.
            </>
          )}
        </p>
      )}
      {locked && (
        <p className="text-xs text-muted">
          Pinned on the server — <code>AMBER_FEATURE_MODEL_CONTROL</code> is off, so
          Amber ignores what this app asks for. It is currently answering with{' '}
          <strong>{effective?.keyword}</strong> (<code>{effective?.model}</code>).
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm">Answer with</span>
        <select
          className={field}
          value={draft.llmKeyword}
          onChange={(e) => setDraft((d) => ({ ...d, llmKeyword: e.target.value }))}
        >
          <option value="">
            Amber&apos;s default{effective ? ` (${effective.default_keyword})` : ''}
          </option>
          {keywords.map((keyword) => (
            <option key={keyword.name} value={keyword.name}>
              {keyword.name}
              {keyword.description ? ` — ${keyword.description}` : ''}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          {chosen?.model ? (
            <>
              Currently <code>{chosen.model}</code>. Applies to the next turn after you
              save — nothing reconnects.
            </>
          ) : (
            <>
              You pick a model by describing it. What each word points at is below, and
              is shared with every app.
            </>
          )}
        </span>
      </label>

      <details className="border-t border-line pt-2">
        <summary className="cursor-pointer text-meta text-muted">
          What the keywords mean
        </summary>

        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted">
            {sync?.enabled ? (
              <>
                Shared with every app through the sync store, so <code>coding</code>{' '}
                means one thing everywhere.{' '}
                {sync.pending
                  ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} still waiting to reach it.`
                  : sync.last_error
                    ? `The store last refused: ${sync.last_error}`
                    : 'Everything here is in step with it.'}
              </>
            ) : (
              <>
                Stored in Amber&apos;s own database and applied on the next turn. No
                sync store is configured, so these stay local to this Amber rather than
                reaching the other apps.
              </>
            )}
          </p>

          {live ? (
            keywords.map((keyword) => (
              <KeywordRow key={keyword.name} keyword={keyword} />
            ))
          ) : (
            <p className="text-xs text-muted">
              Connect to Amber to see and change what these point at.
            </p>
          )}

          {/* One datalist for every row. Rendering a few thousand options per
              keyword would be pointless weight, and the suggestions are identical. */}
          <datalist id="openrouter-models">
            {catalogue.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </datalist>
        </div>
      </details>
    </fieldset>
  )
}

/**
 * One keyword, and the model it points at.
 *
 * Committed on blur or Enter rather than per keystroke — every commit is a write
 * every app in the ecosystem will read, so `anthropic/c` must never be one of them.
 * The input is re-seeded from the frame whenever Amber's answer changes, which is
 * what makes a refused value visibly snap back instead of appearing to have worked.
 */
function KeywordRow({ keyword }: { keyword: ModelKeyword }): React.JSX.Element {
  const [value, setValue] = useState(keyword.model)

  useEffect(() => setValue(keyword.model), [keyword.model])

  const commit = (next: string | null): void => {
    void window.aperture.amber.remapModel(keyword.name, next)
  }

  const dirty = value.trim() !== keyword.model

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-meta text-ink">{keyword.name}</span>
        {keyword.overridden && (
          <button
            type="button"
            onClick={() => commit(null)}
            className="text-micro text-muted underline decoration-dotted hover:text-ink"
          >
            reset
          </button>
        )}
        {keyword.overridden && !keyword.shared && (
          <span className="text-micro text-muted">not shared yet</span>
        )}
      </div>
      <input
        className="w-full rounded-field border border-line bg-ground px-3 py-1.5 font-mono text-meta text-ink outline-none focus:border-accent-deep"
        list="openrouter-models"
        value={value}
        spellCheck={false}
        placeholder="vendor/model"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => dirty && commit(value.trim() || null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(value.trim() || null)
          } else if (e.key === 'Escape') {
            setValue(keyword.model)
          }
        }}
      />
      {keyword.description && (
        <span className="text-micro text-muted">{keyword.description}</span>
      )}
    </div>
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
 *
 * Once something *is* linked the form folds away behind a disclosure. It used to
 * render unconditionally, which put an empty address-and-key form directly under the
 * live link — reading as Bloom's configuration living in two places, when it is one
 * link reached two ways.
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

  const form = (
    <div className="flex flex-col gap-3">
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
    </div>
  )

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="text-sm">Bloom</legend>

      {link.state === 'unlinked' ? (
        <>
          <p className="text-xs text-muted">
            Not linked. The usual way is the Servers tab, which reads the key off the
            box for you — this is for a local instance, or one no server reaches.
          </p>
          {form}
        </>
      ) : (
        <>
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

          <details className="border-t border-line pt-2">
            <summary className="cursor-pointer text-meta text-muted">
              Link a different Bloom manually
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-muted">
                For a local instance, or one no configured server reaches. Replaces the
                link above — there is only ever one.
              </p>
              {form}
            </div>
          </details>
        </>
      )}
    </fieldset>
  )
}
