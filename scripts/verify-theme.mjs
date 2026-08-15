/**
 * Guards the theming layer, so new UI cannot quietly stop being themeable.
 *
 * Five checks:
 *   1. every theme declares every colour and all 16 ANSI entries, all parseable
 *   2. contrast floors, so a palette can't ship unreadable
 *   3. role separation — `user` vs `accent`, `danger` vs `accent`
 *   4. drift between the `@theme` fallback in styles.css and THEMES.darkroom
 *   5. no colour literal and no arbitrary radius/type value outside the palette file
 *
 * Run via `npm run verify:theme`, which esbuilds src/shared/theme.ts first — the same
 * shape as the three sibling verify scripts.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { THEMES, MONO, mix, titleBarColor } from '../out/verify/theme.mjs'

const STYLES = 'src/renderer/styles.css'
const PALETTE = 'src/shared/theme.ts'
const ROOTS = ['src/main', 'src/preload', 'src/renderer', 'src/shared']

const failures = []
const fail = (msg) => failures.push(msg)

// --- colour maths -----------------------------------------------------------

const parse = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** WCAG relative luminance. */
const luminance = (hex) => {
  const [r, g, b] = parse(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** Rough perceptual distance, enough to catch two colours reading as one role. */
const distance = (a, b) => {
  const [r1, g1, b1] = parse(a)
  const [r2, g2, b2] = parse(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) / 441.67
}

const HEX = /^#[0-9a-f]{6}$/i
const RGB = /^rgb\(/i

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
]
const COLOR_KEYS = [
  'ground', 'raised', 'line', 'ink', 'muted',
  'accent', 'accentHi', 'accentDeep',
  'user', 'ok', 'warn', 'danger',
  'scrim', 'glow', 'shadow',
]
// These three carry their own alpha, so they're rgb() rather than plain hex and are
// excluded from the contrast maths.
const ALPHA_KEYS = new Set(['scrim', 'glow', 'shadow'])

// --- 1. completeness --------------------------------------------------------

for (const [id, theme] of Object.entries(THEMES)) {
  if (theme.id !== id) fail(`${id}: \`id\` field is "${theme.id}", must match its key`)
  if (!theme.label || !theme.hint) fail(`${id}: needs both a label and a hint`)
  if (theme.scheme !== 'light' && theme.scheme !== 'dark') {
    fail(`${id}: scheme must be "light" or "dark"`)
  }

  for (const key of COLOR_KEYS) {
    const value = theme.colors[key]
    if (!value) {
      fail(`${id}: missing colour "${key}"`)
    } else if (ALPHA_KEYS.has(key) ? !RGB.test(value) && !HEX.test(value) : !HEX.test(value)) {
      fail(`${id}.${key}: "${value}" is not a #rrggbb${ALPHA_KEYS.has(key) ? ' or rgb()' : ''} value`)
    }
  }
  for (const key of Object.keys(theme.colors)) {
    if (!COLOR_KEYS.includes(key)) fail(`${id}: unknown colour "${key}"`)
  }
  for (const key of ANSI_KEYS) {
    if (!HEX.test(theme.ansi?.[key] ?? '')) fail(`${id}.ansi.${key}: missing or not #rrggbb`)
  }
  if (!/^0?\.\d+$|^1$/.test(theme.pulseFloor)) {
    fail(`${id}: pulseFloor "${theme.pulseFloor}" should be a 0–1 decimal string`)
  }

  const s = theme.style
  if (!s) {
    fail(`${id}: missing \`style\` — a theme is geometry and surface, not only colour`)
    continue
  }
  for (const key of ['control', 'field', 'panel']) {
    if (!/^\d+(\.\d+)?px$/.test(s.radius?.[key] ?? '')) {
      fail(`${id}.style.radius.${key}: "${s.radius?.[key]}" must be a px value`)
    }
  }
  if (!/^\d+(\.\d+)?px$/.test(s.stroke ?? '')) {
    fail(`${id}.style.stroke: "${s.stroke}" must be a px value`)
  }
  if (!s.sans?.includes(',')) {
    fail(`${id}.style.sans: needs a fallback stack, not a single family`)
  }
  for (const key of ['panel', 'pop']) {
    if (!s.elevation?.[key]) fail(`${id}.style.elevation.${key}: missing`)
  }
  for (const key of ['image', 'size', 'blend']) {
    if (!s.texture?.[key]) fail(`${id}.style.texture.${key}: missing (use 'none'/'auto'/'normal')`)
  }
  if (!/^\d+ms$/.test(s.motion?.duration ?? '')) {
    fail(`${id}.style.motion.duration: "${s.motion?.duration}" must be in ms`)
  }
  for (const key of ['accentGlow', 'tracking']) {
    if (!s[key]) fail(`${id}.style.${key}: missing (use 'none'/'normal')`)
  }
}

// The point of the style layer is that the themes look *different*. If two share a
// silhouette they may as well be one theme with a palette switch.
{
  const seen = new Map()
  for (const [id, { style }] of Object.entries(THEMES)) {
    if (!style) continue
    const shape = [
      style.radius.control,
      style.radius.field,
      style.radius.panel,
      style.stroke,
      style.elevation.panel,
      style.texture.image,
    ].join('|')
    if (seen.has(shape)) {
      fail(`${id} and ${seen.get(shape)} have an identical silhouette — vary radius, stroke, elevation or texture`)
    }
    seen.set(shape, id)
  }
}

// --- 2. contrast floors -----------------------------------------------------

for (const [id, { colors, ansi }] of Object.entries(THEMES)) {
  const { ground, raised } = colors
  const floor = (a, b, min, what) => {
    const ratio = contrast(a, b)
    if (ratio < min) fail(`${id}: ${what} is ${ratio.toFixed(2)}:1, needs ${min}:1`)
  }

  floor(colors.ink, ground, 7, 'ink on ground')
  floor(colors.ink, raised, 7, 'ink on raised')
  floor(colors.muted, ground, 4.5, 'muted on ground')
  floor(colors.muted, raised, 4, 'muted on raised')
  floor(colors.accent, ground, 4.5, 'accent on ground')

  // The primary-button pair: `bg-accent/15 text-accent-hi`, 13 sites. The single
  // check most likely to catch a naive light theme.
  floor(colors.accentHi, mix(ground, colors.accent, 0.15), 4.5, 'accent-hi on accent/15')

  // Non-text UI component floor — this one is the focus ring.
  floor(colors.accentDeep, ground, 3, 'accent-deep on ground')
  floor(colors.accentDeep, raised, 3, 'accent-deep on raised')

  for (const key of ['ok', 'warn', 'danger', 'user']) {
    floor(colors[key], ground, 4.5, `${key} on ground`)
  }

  // House rule: a divider you can actually see.
  floor(colors.line, ground, 1.25, 'line on ground')

  // Without this the light terminal ships with invisible default-foreground output.
  floor(ansi.white, ground, 4.5, 'ansi.white on ground')
  floor(ansi.brightWhite, ground, 4.5, 'ansi.brightWhite on ground')
}

// --- 3. role separation -----------------------------------------------------

for (const [id, { colors }] of Object.entries(THEMES)) {
  // `user` and `danger` sit right next to the accent — a chat bubble beside an
  // accent-bordered one, a destructive button beside the primary — so they get the
  // full floor. `warn` is looser on purpose: in an amber-accented theme a warning
  // tone genuinely wants to be amber-adjacent, and warn chips don't share space
  // with primary buttons.
  const pairs = [
    ['user', 'accent', 0.15],
    ['danger', 'accent', 0.15],
    ['warn', 'accent', 0.1],
  ]
  for (const [a, b, min] of pairs) {
    const d = distance(colors[a], colors[b])
    if (d < min) {
      fail(`${id}: ${a} and ${b} are only ${d.toFixed(3)} apart — they'll read as one role`)
    }
  }
}

// --- 4. drift between styles.css and THEMES.darkroom ------------------------

const css = readFileSync(STYLES, 'utf8')
const themeBlock = css.match(/@theme\s*\{([\s\S]*?)\n\}/)
if (!themeBlock) {
  fail(`${STYLES}: could not find the @theme block`)
} else {
  const body = themeBlock[1]
  // Anchored on the brace, or the prose warning about `@theme inline` matches itself.
  if (/@theme\s+inline\s*\{/.test(css)) {
    fail(`${STYLES}: \`@theme inline\` bakes literals into every rule and kills runtime theming`)
  }
  const declared = new Map(
    [...body.matchAll(/^\s*(--[a-z-]+):\s*([^;]+);/gim)].map(([, k, v]) => [k, v.trim()]),
  )

  // Derived, so the fallback is a computed value someone had to paste in by hand —
  // exactly the kind of thing that goes stale when a palette is retuned.
  const titlebar = titleBarColor(THEMES.darkroom)
  if (normalise(declared.get('--color-titlebar') ?? '') !== normalise(titlebar)) {
    fail(
      `${STYLES}: \`--color-titlebar\` is ${declared.get('--color-titlebar')} but ` +
        `titleBarColor(THEMES.darkroom) is ${titlebar}. The app's title bar and the ` +
        `OS window-button overlay must be handed the same colour.`,
    )
  }

  const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
  for (const key of COLOR_KEYS) {
    const name = `--color-${kebab(key)}`
    const expected = THEMES.darkroom.colors[key]
    if (!declared.has(name)) {
      fail(`${STYLES}: \`${name}\` is not declared, so Tailwind won't generate its utilities`)
    } else if (normalise(declared.get(name)) !== normalise(expected)) {
      fail(
        `${STYLES}: \`${name}\` is ${declared.get(name)} but THEMES.darkroom says ${expected}. ` +
          `The @theme block is the pre-JS fallback and must equal the default palette.`,
      )
    }
  }
  if (normalise(declared.get('--font-mono') ?? '') !== normalise(MONO)) {
    fail(
      `${STYLES}: \`--font-mono\` and MONO in ${PALETTE} disagree. ` +
        `xterm and the ghost-completion overlay must use the identical stack.`,
    )
  }

  // The style half of the fallback. `--radius-*` and `--font-sans` sit in @theme
  // (Tailwind namespaces); the rest sit in the `:root` block below it.
  const style = THEMES.darkroom.style
  const rootBlock = css.match(/\n:root\s*\{([\s\S]*?)\n\}/)
  const rootVars = new Map(
    [...(rootBlock?.[1] ?? '').matchAll(/^\s*(--[a-z-]+):\s*([^;]+);/gim)].map(([, k, v]) => [
      k,
      v.trim(),
    ]),
  )
  const expectStyle = [
    [declared, '--radius-control', style.radius.control],
    [declared, '--radius-field', style.radius.field],
    [declared, '--radius-panel', style.radius.panel],
    [declared, '--font-sans', style.sans],
    [rootVars, '--stroke', style.stroke],
    [rootVars, '--elev-panel', style.elevation.panel],
    [rootVars, '--elev-pop', style.elevation.pop],
    [rootVars, '--texture-image', style.texture.image],
    [rootVars, '--accent-glow', style.accentGlow],
    [rootVars, '--tracking-base', style.tracking],
    [rootVars, '--motion-duration', style.motion.duration],
    [rootVars, '--motion-ease', style.motion.ease],
    [rootVars, '--pulse-floor', THEMES.darkroom.pulseFloor],
  ]
  for (const [source, name, expected] of expectStyle) {
    if (!source.has(name)) {
      fail(`${STYLES}: \`${name}\` is not declared`)
    } else if (normalise(source.get(name)) !== normalise(expected)) {
      fail(
        `${STYLES}: \`${name}\` is ${source.get(name)} but THEMES.darkroom.style says ${expected}`,
      )
    }
  }
}

function normalise(value) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

// --- 5. no literals outside the palette file --------------------------------

const files = ROOTS.flatMap(walk).filter((f) => /\.(tsx?|css)$/.test(f))
for (const file of files) {
  const rel = file.replace(/\\/g, '/')
  const source = readFileSync(file, 'utf8')

  if (!rel.endsWith(PALETTE)) {
    for (const [line, text] of lines(source)) {
      const hex = text.match(/#[0-9a-fA-F]{3,8}\b/)
      // `styles.css` is the declared fallback, checked for drift above instead.
      if (hex && !rel.endsWith(STYLES)) {
        fail(`${rel}:${line}: colour literal ${hex[0]} — use a token, or add one`)
      }
      const arbitrary = text.match(/\b(rounded|text)-\[\d+px\]/)
      if (arbitrary) {
        fail(
          `${rel}:${line}: \`${arbitrary[0]}\` — use rounded-control|field|panel ` +
            `or text-nano|micro|meta|body|lead`,
        )
      }
      const stale = text.match(
        /\b(text|bg|border|ring|from|to|via|decoration|outline|divide|fill|stroke)-amber\b/,
      )
      if (stale) fail(`${rel}:${line}: \`${stale[0]}\` — the accent token is \`accent\` now`)
    }
  }
}

function walk(dir) {
  let out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else out.push(p)
  }
  return out
}

function* lines(source) {
  const all = source.split(/\r?\n/)
  for (let i = 0; i < all.length; i++) yield [i + 1, all[i]]
}

// --- report -----------------------------------------------------------------

if (failures.length) {
  console.error(`verify-theme: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  `verify-theme: ok — ${Object.keys(THEMES).length} themes, ` +
    `${COLOR_KEYS.length} colours + 16 ANSI each, ${files.length} files scanned`,
)
