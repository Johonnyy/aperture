import { THEMES, swatches, type Palette, type ThemeId } from '../../../shared/theme'
import { applyTheme } from '../../theme'
import { useSettings } from '../context'

/**
 * Theme is the one setting that applies on click rather than on Save: it is pure
 * presentation with no side effects, and the preview *is* the decision — a Save gate
 * would make you commit to a look you can't see. Everything else in Settings has
 * consequences and keeps the draft discipline.
 *
 * `commit` moves the draft as well as writing through, or `dirty` (a stringify
 * comparison against the saved settings) would read as permanently unsaved and the
 * save bar would sit there forever after you picked a colour.
 */
export function Appearance(): React.JSX.Element {
  const { draft, commit } = useSettings()

  const pickTheme = (theme: ThemeId): void => {
    applyTheme(theme) // ahead of the round trip, so the preview is same-frame
    commit({ theme })
  }

  return (
    <>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2"
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
    </>
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
