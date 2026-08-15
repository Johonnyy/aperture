/**
 * Pushing a palette into the document.
 *
 * Tailwind v4 emits the `@theme` tokens into `:root` and compiles every utility to
 * `var(--color-x)`, so setting those same properties as an inline style on <html>
 * outranks the rule and the whole app follows — opacity modifiers included, since
 * v4 compiles `bg-accent/15` to `color-mix(… var(--color-accent) …)`.
 *
 * `settings.json`, owned by main, is the only store. The id for the first paint
 * arrives synchronously as a launch argument (`window.aperture.theme.initial`)
 * rather than over IPC, because an `await` here would mean a frame of the wrong
 * theme; the settings hydration later on is a no-op that also self-heals if the
 * argument were ever missing.
 */

import { useEffect } from 'react'

import { paletteFor, titleBarColor, type Palette, type ThemeId } from '../shared/theme'
import { useStore } from './store'

export function applyTheme(id: ThemeId | string | undefined): Palette {
  const palette = paletteFor(id)
  const root = document.documentElement

  for (const [key, value] of Object.entries(palette.colors)) {
    root.style.setProperty(`--color-${kebab(key)}`, value)
  }
  // Derived rather than authored, and shared with the OS's window-button overlay so
  // the buttons sit in the same band the app draws. See `titleBarColor`.
  root.style.setProperty('--color-titlebar', titleBarColor(palette))

  // The non-colour half. `--radius-*` and `--font-sans` are Tailwind namespaces, so
  // `rounded-panel` and the body face follow them for free; the rest are consumed by
  // the hand-written rules and `@utility` definitions in styles.css.
  const { radius, elevation, texture, motion } = palette.style
  const vars: Record<string, string> = {
    '--radius-control': radius.control,
    '--radius-field': radius.field,
    '--radius-panel': radius.panel,
    '--stroke': palette.style.stroke,
    '--font-sans': palette.style.sans,
    '--elev-panel': elevation.panel,
    '--elev-pop': elevation.pop,
    '--texture-image': texture.image,
    '--texture-size': texture.size,
    '--texture-blend': texture.blend,
    '--accent-glow': palette.style.accentGlow,
    '--tracking-base': palette.style.tracking,
    '--motion-duration': motion.duration,
    '--motion-ease': motion.ease,
    // Not a Tailwind namespace either — the `pulse-dot` keyframe reads it directly.
    '--pulse-floor': palette.pulseFloor,
  }
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  // Drives the native controls — the settings checkbox, fallback scrollbars, any
  // widget the OS draws rather than us.
  root.style.colorScheme = palette.scheme
  // Not needed for styling; a handle for debugging and for the rare per-theme
  // exception a variable can't express.
  root.dataset.theme = palette.id
  root.dataset.scheme = palette.scheme
  return palette
}

/** `accentHi` → `accent-hi`, so the keys line up with the CSS custom properties. */
function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/**
 * Keeps the document in step with the stored setting. Mounted once, at the root.
 *
 * Everything CSS-driven — every Tailwind utility, the scrollbars, the body glow,
 * the scrim, the shadows — follows on the next frame with nothing remounting. The
 * terminals are the exception and update themselves imperatively; see `Terminal.tsx`.
 */
export function useThemeSync(): void {
  const theme = useStore((s) => s.settings.theme)
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
}
