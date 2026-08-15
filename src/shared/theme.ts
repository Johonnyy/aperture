/**
 * The themes, and the single place they are defined.
 *
 * Three consumers need a palette and two of them cannot read CSS: the main process
 * sets the BrowserWindow background before a renderer exists, and xterm.js wants a
 * plain object. So the palettes live here, in `shared/`, and the renderer pushes
 * them into CSS custom properties at startup (`src/renderer/theme.ts`). The
 * `@theme` block in `styles.css` holds Darkroom's values as the static fallback.
 *
 * Adding a theme is an edit to this file and nothing else — the picker card, its
 * swatches, the CSS variables, the window background, the terminal colours and the
 * search decorations all derive from what you write here. See docs/theming.md.
 *
 * This module is compiled into main as well as the renderer, so it must stay free
 * of DOM types (tsconfig.node.json has no `DOM` lib). The xterm shapes below are
 * declared structurally rather than imported for that reason.
 */

export type ThemeId =
  | 'darkroom'
  | 'aperture-blue'
  | 'terminal-green'
  | 'contact-sheet'
  | 'golden-hour'
  | 'slate-ops'

export interface PaletteColors {
  /** App background. */
  ground: string
  /** Panels, cards, inputs — one step up from the ground. */
  raised: string
  /** Borders, dividers, scrollbar thumb. */
  line: string
  /** Primary text. */
  ink: string
  /** Secondary text. */
  muted: string

  accent: string
  /**
   * More prominent than `accent` — brighter on a dark theme, *darker* on a light
   * one. Defined by prominence rather than by lightness so the same class names
   * work in both directions.
   */
  accentHi: string
  /** The structural accent: borders, focus rings. */
  accentDeep: string

  /** The user's own chat bubble. Keep it clear of the accent hue. */
  user: string
  ok: string
  /** Distinct from the accent, which *is* the theme — see `parts.tsx`. */
  warn: string
  danger: string

  /**
   * The modal backdrop. Its own colour rather than an alpha of the ground, because
   * on a light theme an alpha of the ground is a white haze that dims nothing.
   */
  scrim: string
  /** The ambient wash on <body>. Carries its own alpha. */
  glow: string
  /** Elevation base for the shadow tokens. Carries its own alpha. */
  shadow: string
}

/**
 * The 16 ANSI colours. Not optional: xterm falls back to a VGA-ish palette whose
 * `white` (#e5e5e5) and `brightWhite` (#ffffff) are invisible on a light ground, so
 * without this every `ls --color` listing disappears under Contact sheet.
 */
export interface Ansi {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/** Shared by the five dark themes; each spreads it and overrides its own hue. */
const DARK_ANSI: Ansi = {
  black: '#3b3b3b',
  red: '#e06c6c',
  green: '#79c22f',
  yellow: '#e5c04c',
  blue: '#6fb3ff',
  magenta: '#c792ea',
  cyan: '#5fd0c5',
  white: '#d8d2c6',
  brightBlack: '#6b6b6b',
  brightRed: '#ff8a8a',
  brightGreen: '#a6e45c',
  brightYellow: '#ffd97a',
  brightBlue: '#9ccdff',
  brightMagenta: '#e0b3ff',
  brightCyan: '#8fe6dc',
  brightWhite: '#f5f0e8',
}

/**
 * Contact sheet. Fully separate rather than a tweak of the above, because "white" in
 * ANSI means *the default foreground* — which on paper is dark. Inverting those two
 * is the whole point.
 */
const LIGHT_ANSI: Ansi = {
  black: '#2c2c2a',
  red: '#a8342b',
  green: '#2f7d4f',
  yellow: '#8a6008',
  blue: '#2b5f96',
  magenta: '#8a4a9c',
  cyan: '#1f6f6a',
  white: '#5a5954',
  brightBlack: '#7d7b72',
  brightRed: '#c4483d',
  brightGreen: '#3f9463',
  brightYellow: '#a07714',
  brightBlue: '#3a76b0',
  brightMagenta: '#a35fb5',
  brightCyan: '#2c8a83',
  brightWhite: '#2c2c2a',
}

/**
 * The non-colour half of a theme: silhouette, weight, surface and pace.
 *
 * A palette alone makes six variations of one interface. These are what make them
 * feel like different instruments — a CRT has square corners and scanlines, a
 * photographic print has a paper tooth and a real drop shadow, an optical bench has
 * hairline geometry and a measurement grid.
 *
 * Everything here is safe to vary because none of it changes layout: corner radii,
 * shadows and textures don't affect box size, and borders are inside `border-box`.
 * Type is the one exception — a different `sans` shifts text metrics slightly, which
 * is why `mono` deliberately does *not* vary (see MONO below).
 */
export interface PaletteStyle {
  /** Corner radii. The single biggest lever on how an interface reads. */
  radius: { control: string; field: string; panel: string }
  /** Border width, applied to every `border` utility. */
  stroke: string
  /** The UI typeface. Terminal green runs the entire interface in mono. */
  sans: string
  /** Elevation. Hard offsets, soft haze, or nothing at all. */
  elevation: { panel: string; pop: string }
  /** A full-screen decorative overlay: scanlines, paper grain, a vignette. */
  texture: { image: string; size: string; blend: string }
  /** Extra bloom on accent text. Phosphor wants it; paper must not have it. */
  accentGlow: string
  /** Body letter-spacing. Consoles run wide. */
  tracking: string
  /** How the interface moves. */
  motion: { duration: string; ease: string }
}

/**
 * The monospace stack, shared by every theme *on purpose*.
 *
 * xterm is constructed with it and the ghost-completion overlay is positioned
 * against xterm's resulting cell grid, so the two must be byte-identical. Letting a
 * theme change it would mean re-measuring a live terminal on every switch, for no
 * gain — `sans` already carries the typographic personality.
 *
 * Duplicated from `--font-mono` in `styles.css` because CSS cannot import
 * TypeScript; `scripts/verify-theme.mjs` asserts the two still agree.
 */
export const MONO = "'Cascadia Code', 'JetBrains Mono', Consolas, monospace"

const INTER = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

/** No overlay. The default for themes whose character is in their geometry. */
const NO_TEXTURE = { image: 'none', size: 'auto', blend: 'normal' }

export interface Palette {
  id: ThemeId
  label: string
  /** One line, shown under the label in the picker. */
  hint: string
  /** Drives `color-scheme`, which is what makes native controls behave. */
  scheme: 'light' | 'dark'
  colors: PaletteColors
  style: PaletteStyle
  /** The floor of the `pulse-dot` animation; 0.35 disappears on a light ground. */
  pulseFloor: string
  ansi: Ansi
}

export const DEFAULT_THEME: ThemeId = 'darkroom'

export const THEMES: Record<ThemeId, Palette> = {
  darkroom: {
    id: 'darkroom',
    label: 'Darkroom',
    hint: 'Warm blacks, amber accent',
    scheme: 'dark',
    colors: {
      ground: '#14110d',
      raised: '#1d1812',
      line: '#322a1f',
      ink: '#f2e9da',
      muted: '#9a8f7d',
      accent: '#ffb347',
      accentHi: '#ffc66b',
      accentDeep: '#c8821f',
      user: '#6fb3ff',
      ok: '#5fd08a',
      // Leans yellow so it reads as caution beside the orange accent.
      warn: '#ffe066',
      danger: '#ff6b6b',
      scrim: 'rgb(10 8 6 / 78%)',
      glow: 'rgb(255 179 71 / 6%)',
      shadow: 'rgb(0 0 0 / 55%)',
    },
    // The reference silhouette: soft corners, warm diffuse shadow, nothing on top.
    style: {
      radius: { control: '8px', field: '10px', panel: '14px' },
      stroke: '1px',
      sans: INTER,
      elevation: {
        panel: '0 2px 8px rgb(0 0 0 / 55%)',
        pop: '0 12px 32px rgb(0 0 0 / 55%)',
      },
      texture: NO_TEXTURE,
      accentGlow: 'none',
      tracking: 'normal',
      motion: { duration: '150ms', ease: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    },
    pulseFloor: '0.35',
    ansi: DARK_ANSI,
  },

  'aperture-blue': {
    id: 'aperture-blue',
    label: 'Aperture blue',
    hint: 'Cool, precise, lens-glass tones',
    scheme: 'dark',
    colors: {
      ground: '#0a0e14',
      raised: '#122333',
      line: '#1d3247',
      ink: '#e6f1fb',
      muted: '#8199ae',
      accent: '#378add',
      accentHi: '#6fb2ee',
      accentDeep: '#3579bd',
      // Muted purple: the usual blue bubble would vanish into this accent.
      user: '#b39ddb',
      ok: '#4ec9a0',
      warn: '#e8b04a',
      danger: '#f2716b',
      scrim: 'rgb(4 8 14 / 80%)',
      glow: 'rgb(55 138 221 / 7%)',
      shadow: 'rgb(0 0 0 / 60%)',
    },
    // An optical bench. Nearly square corners, shadows tight enough to read as
    // machined edges rather than depth, and a faint measurement grid underneath.
    style: {
      radius: { control: '3px', field: '4px', panel: '6px' },
      stroke: '1px',
      sans: INTER,
      elevation: {
        panel: '0 1px 2px rgb(0 0 0 / 70%)',
        pop: '0 4px 14px rgb(0 0 0 / 75%)',
      },
      texture: {
        image:
          'linear-gradient(rgb(55 138 221 / 5%) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgb(55 138 221 / 5%) 1px, transparent 1px)',
        size: '32px 32px',
        blend: 'normal',
      },
      accentGlow: 'none',
      tracking: '0.01em',
      // Snappy and slightly overshoot-free: instruments settle, they don't bounce.
      motion: { duration: '100ms', ease: 'cubic-bezier(0.2, 0, 0, 1)' },
    },
    pulseFloor: '0.35',
    ansi: { ...DARK_ANSI, blue: '#378add', brightBlue: '#6fb2ee' },
  },

  'terminal-green': {
    id: 'terminal-green',
    label: 'Terminal green',
    hint: 'CRT phosphor, hacker-console feel',
    scheme: 'dark',
    colors: {
      ground: '#0b0f0c',
      raised: '#131c15',
      line: '#21331f',
      // The phosphor itself is the text colour here, not a neutral off-white.
      ink: '#97c459',
      muted: '#7f9b64',
      accent: '#6ea82a',
      accentHi: '#b6dd77',
      accentDeep: '#4f8c1b',
      // Teal, the one cool hue that still reads as "screen".
      user: '#7fd0c0',
      ok: '#5ad07f',
      warn: '#d3b23c',
      danger: '#e5564b',
      scrim: 'rgb(4 8 5 / 80%)',
      glow: 'rgb(110 168 42 / 7%)',
      shadow: 'rgb(0 0 0 / 60%)',
    },
    // A CRT. Square corners everywhere, the *whole interface* in monospace, chunky
    // 2px rules, hard offset shadows with no blur (a screen has no depth of field),
    // scanlines over the top and phosphor bloom on the accent.
    style: {
      radius: { control: '0px', field: '0px', panel: '0px' },
      stroke: '2px',
      sans: MONO,
      elevation: {
        panel: '2px 2px 0 rgb(0 0 0 / 70%)',
        pop: '5px 5px 0 rgb(0 0 0 / 80%)',
      },
      texture: {
        image:
          'repeating-linear-gradient(0deg, rgb(0 0 0 / 22%) 0px,' +
          ' rgb(0 0 0 / 22%) 1px, transparent 1px, transparent 3px)',
        size: 'auto',
        blend: 'normal',
      },
      accentGlow: '0 0 9px color-mix(in oklab, currentColor 55%, transparent)',
      tracking: '0.03em',
      // Near-instant and linear. Phosphor decays, it doesn't ease.
      motion: { duration: '60ms', ease: 'linear' },
    },
    pulseFloor: '0.35',
    ansi: { ...DARK_ANSI, green: '#6ea82a', brightGreen: '#b6dd77', white: '#97c459' },
  },

  'contact-sheet': {
    id: 'contact-sheet',
    label: 'Contact sheet',
    hint: 'Off-white, negatives-and-tape paper feel',
    // The only light theme. `accentHi` is *darker* than `accent` here, and the
    // status colours are deepened — the dark themes' #5fd08a / #ff6b6b are
    // unreadable on off-white.
    scheme: 'light',
    colors: {
      ground: '#f1efe8',
      raised: '#e6e4dc',
      line: '#cbc9be',
      ink: '#2c2c2a',
      muted: '#68675f',
      accent: '#5f5e5a',
      accentHi: '#33322f',
      accentDeep: '#7d7b72',
      user: '#2f6fa8',
      ok: '#286d47',
      warn: '#875d09',
      danger: '#b03a30',
      // Stays dark. An alpha of this theme's own ground would be a white haze that
      // dims nothing — the reason `scrim` is a token at all.
      scrim: 'rgb(44 44 42 / 46%)',
      glow: 'rgb(95 94 90 / 4%)',
      // A real shadow, not a black smear: this is the one theme where elevation
      // is actually visible.
      shadow: 'rgb(44 44 42 / 16%)',
    },
    // A photographic print. Prints have square corners and a paper tooth, and they
    // cast a real shadow rather than glowing. The serif is the point, not a
    // flourish — Constantia is a screen-designed text face and ships on Windows.
    style: {
      radius: { control: '2px', field: '2px', panel: '3px' },
      stroke: '1px',
      sans: "Constantia, 'Iowan Old Style', Georgia, 'Times New Roman', serif",
      elevation: {
        panel: '0 1px 3px rgb(44 44 42 / 20%)',
        pop: '0 10px 28px rgb(44 44 42 / 24%)',
      },
      texture: {
        // feTurbulence desaturated to grey, multiplied into the page so it reads as
        // paper fibre rather than a film laid over it.
        image:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23g)' opacity='0.32'/%3E%3C/svg%3E\")",
        size: '140px 140px',
        blend: 'multiply',
      },
      accentGlow: 'none',
      tracking: 'normal',
      motion: { duration: '190ms', ease: 'cubic-bezier(0.33, 0, 0.15, 1)' },
    },
    // A mid-chroma dot at 0.35 on off-white is effectively gone.
    pulseFloor: '0.5',
    ansi: LIGHT_ANSI,
  },

  'golden-hour': {
    id: 'golden-hour',
    label: 'Golden hour',
    hint: 'Coral + amber, warm without being loud',
    scheme: 'dark',
    colors: {
      ground: '#1a120c',
      raised: '#2a1710',
      line: '#4a1b0c',
      ink: '#faece7',
      muted: '#b08d80',
      accent: '#d85a30',
      accentHi: '#f07a4e',
      accentDeep: '#c05628',
      user: '#7fb3d5',
      ok: '#5fc98e',
      warn: '#e8b04a',
      // Pushed pink: a red danger would be indistinguishable from the coral accent.
      danger: '#ff4d6d',
      scrim: 'rgb(14 8 5 / 80%)',
      glow: 'rgb(216 90 48 / 8%)',
      shadow: 'rgb(0 0 0 / 60%)',
    },
    // Late sun. The roundest theme by a wide margin, with big soft shadows that
    // fall warm rather than black, a lens vignette, and a slow languid ease.
    style: {
      radius: { control: '14px', field: '18px', panel: '24px' },
      stroke: '1px',
      sans: INTER,
      elevation: {
        panel: '0 4px 18px rgb(60 20 8 / 52%)',
        pop: '0 22px 52px rgb(60 20 8 / 62%)',
      },
      texture: {
        image:
          'radial-gradient(ellipse at 50% 30%, transparent 45%, rgb(26 18 12 / 42%) 100%)',
        size: '100% 100%',
        blend: 'normal',
      },
      accentGlow: '0 0 14px color-mix(in oklab, currentColor 32%, transparent)',
      tracking: 'normal',
      motion: { duration: '260ms', ease: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
    pulseFloor: '0.35',
    ansi: { ...DARK_ANSI, red: '#e8624e', brightRed: '#ff8a6b' },
  },

  'slate-ops': {
    id: 'slate-ops',
    label: 'Slate ops',
    hint: 'Neutral gray, teal accent for status',
    scheme: 'dark',
    colors: {
      ground: '#101211',
      raised: '#22251f',
      line: '#2f332c',
      ink: '#e4e8e5',
      muted: '#8b938d',
      accent: '#0f9e78',
      accentHi: '#5dcaa5',
      accentDeep: '#189070',
      user: '#7fa8d9',
      ok: '#6fd08a',
      warn: '#d9a441',
      danger: '#e5645c',
      scrim: 'rgb(8 10 9 / 80%)',
      glow: 'rgb(15 158 120 / 6%)',
      shadow: 'rgb(0 0 0 / 60%)',
    },
    // An ops console: flat, dense, matter-of-fact. The distinguishing move is *no
    // panel elevation at all* — surfaces are separated by rule and tone, not depth.
    // Only modals lift, because they genuinely need to sit above the page.
    style: {
      radius: { control: '4px', field: '5px', panel: '6px' },
      stroke: '1px',
      sans: INTER,
      elevation: { panel: 'none', pop: '0 6px 20px rgb(0 0 0 / 55%)' },
      texture: {
        image:
          'repeating-linear-gradient(0deg, rgb(255 255 255 / 2%) 0px,' +
          ' rgb(255 255 255 / 2%) 1px, transparent 1px, transparent 5px)',
        size: 'auto',
        blend: 'normal',
      },
      accentGlow: 'none',
      tracking: '0.015em',
      motion: { duration: '120ms', ease: 'cubic-bezier(0.3, 0, 0.2, 1)' },
    },
    pulseFloor: '0.35',
    ansi: { ...DARK_ANSI, cyan: '#2e9e7c', brightCyan: '#5dcaa5' },
  },
}

/**
 * Never trust a stored id. A downgrade, a hand-edited `settings.json` or a missing
 * launch argument must fall back to the default, not render an undefined palette.
 */
export function paletteFor(id: string | undefined): Palette {
  return THEMES[id as ThemeId] ?? THEMES[DEFAULT_THEME]
}

/**
 * The title bar's background, shared by the strip the app draws and the overlay the
 * OS paints the window buttons onto — so the two are the same colour and the buttons
 * sit *in* the bar rather than on a patch of their own.
 *
 * It has to be opaque and computed rather than an alpha of `raised`: the OS overlay
 * takes a flat colour and cannot composite over what the page happens to have behind
 * it, so a translucent strip would always drift from it — most visibly under the
 * body glow, which is brightest at exactly the top edge. This is what `bg-raised/50`
 * resolves to over the ground, made explicit.
 */
export function titleBarColor(p: Palette): string {
  return mix(p.colors.ground, p.colors.raised, 0.5)
}

/** The four colours the picker shows as a swatch strip. Derived, never hand-listed. */
export function swatches(p: Palette): [string, string, string, string] {
  return [p.colors.ground, p.colors.raised, p.colors.accent, p.colors.ink]
}

// --- derived: terminal ------------------------------------------------------

/**
 * xterm's `ITheme`, structurally. Not imported from `@xterm/xterm` because this
 * module also compiles into the main process, which has no renderer dependencies.
 */
export interface TerminalTheme extends Ansi {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
}

export interface SearchDecorations {
  activeMatchBackground: string
  matchBackground: string
  activeMatchColorOverviewRuler: string
  matchOverviewRuler: string
}

export function terminalTheme(p: Palette): TerminalTheme {
  return {
    background: p.colors.ground,
    foreground: p.colors.ink,
    cursor: p.colors.accent,
    // What the cursor block punches through with, so the character under it stays
    // legible rather than becoming accent-on-accent.
    cursorAccent: p.colors.ground,
    selectionBackground: p.colors.line,
    ...p.ansi,
  }
}

export function searchDecorations(p: Palette): SearchDecorations {
  // The active hit is the full accent; the others are the accent knocked back
  // toward the ground so they mark without shouting.
  const dim = mix(p.colors.accentDeep, p.colors.ground, 0.55)
  return {
    activeMatchBackground: p.colors.accent,
    matchBackground: dim,
    activeMatchColorOverviewRuler: p.colors.accent,
    matchOverviewRuler: dim,
  }
}

/** Blend `from` a fraction `t` of the way toward `to`. Both must be `#rrggbb`. */
export function mix(from: string, to: string, t: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  const channel = (i: number): string =>
    Math.round(a[i] * (1 - t) + b[i] * t)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
