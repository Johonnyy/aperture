# Theming

Aperture ships six themes. Five are dark; **Contact sheet** is light, and it exists
partly to keep the rest honest — a token that only works on a dark ground gets caught
the moment you switch to it.

A theme is **not just a palette**. Each carries a `style` block — radii, border width,
typeface, elevation, texture, tracking and motion — because six palettes on identical
geometry read as one interface in six moods rather than six instruments.

| Theme | Character | Geometry | Surface |
|---|---|---|---|
| **Darkroom** | warm, soft, the reference | 8/10/14px, 1px rule | diffuse black shadow |
| **Aperture blue** | optical bench | 3/4/6px, near-square | tight shadow, 32px measurement grid |
| **Terminal green** | CRT | **0px**, 2px rule, **whole UI in mono** | hard offset shadow, scanlines, phosphor bloom |
| **Contact sheet** | photographic print | 2/2/3px, **serif** | real drop shadow, paper grain (multiply) |
| **Golden hour** | late sun | **14/18/24px**, roundest | big warm shadow, lens vignette, soft glow |
| **Slate ops** | ops console | 4/5/6px | **no panel elevation at all**, faint readout hatch |

Motion varies too: Terminal green moves in 60ms linear (phosphor decays, it doesn't
ease), Golden hour in 260ms on a languid curve.

## Adding a seventh theme

1. Add the id to `ThemeId` and the entry to `THEMES` in [`src/shared/theme.ts`](../src/shared/theme.ts) — `colors`, `style`, `ansi`, `pulseFloor`.
2. `npm run verify:theme` — fix whatever it reports.

That's the whole change. The picker card, its preview, the CSS variables, the window
background, the terminal colours and the search decorations all derive from that entry.
**If you find yourself editing a second file, the abstraction has leaked — fix that
instead of working around it.**

## How it fits together

`src/shared/theme.ts` is the single source of truth. It lives in `shared/` because
three consumers need a palette and two of them can't read CSS:

| Consumer | Why not CSS |
|---|---|
| `main/window.ts` | Paints the window background before a renderer exists |
| `ssh/Terminal.tsx` | xterm wants a JS object, including 16 ANSI colours |
| `ssh/SearchBar.tsx` | `ISearchOptions.decorations` wants hex strings |

`src/renderer/theme.ts` pushes a palette into the document by setting the custom
properties as an inline style on `<html>`. Tailwind v4 compiles every utility to
`var(--color-x)`, so that one write moves the whole app — opacity modifiers included,
since `bg-accent/15` compiles to `color-mix(… var(--color-accent) …)`.

The `@theme` block in `styles.css` still declares every token, with **Darkroom's**
values. That is not redundant, it's required twice over: Tailwind only generates
`bg-accent` / `text-muted` / `shadow-pop` if the names exist at build time, and the
values are the fallback before any JS runs. `verify:theme` asserts they equal
`THEMES.darkroom`, because that one duplication is the only place drift can hide.

`shared/theme.ts` compiles into the main process too, where `tsconfig.node.json` has
no `DOM` lib. Keep it free of DOM types — that's why `TerminalTheme` is declared
structurally instead of importing `ITheme` from `@xterm/xterm`.

### First paint

The theme id reaches the renderer as a **launch argument**, not over IPC:
`window.ts` reads settings, passes `--aperture-theme=<id>` via `additionalArguments`,
preload exposes it as `window.aperture.theme.initial`, and `main.tsx` applies it before
`createRoot`. Everything else on that bridge is async, which is exactly what a first
paint can't afford — an `await` means a frame of the wrong theme.

The usual trick, an inline `<script>` in `index.html`, is unavailable: the CSP is
`script-src 'self'` with no `'unsafe-inline'`.

Because main supplies the id *and* paints the window background from the same palette,
the two cannot disagree. That's also why the preference lives in `settings.json` rather
than the renderer's `localStorage` (where the sidebar's collapsed state lives) — main
needs this one, and two stores for one value drift into a startup flash nobody can
reproduce.

### Live switching

`useThemeSync()` in `App.tsx` reapplies on change. Every CSS-driven surface follows on
the next frame with nothing remounting.

Terminals are the exception. `Terminal.tsx`'s creation effect is keyed on `[server.id]`
and **must stay that way** — re-running it disposes the xterm and ends the SSH session
behind it. A second effect keyed on the theme alone pushes `term.options.theme` into
the live instance instead. Hidden terminals re-render too, so every open session
follows.

## Writing themeable UI

**Colours: use a token, never a literal.** `verify:theme` fails on any hex outside
`src/shared/theme.ts`. If a component needs a colour the vocabulary doesn't have, add a
token to all six palettes — don't reach for a hex.

Tailwind's stock palette is switched off (`--color-*: initial`). `text-blue-500` and
`bg-gray-800` generate no CSS at all, so the failure is loud (an unstyled element)
rather than silent (a fixed colour that ignores the theme).

| Token | Use for |
|---|---|
| `ground` | app background |
| `raised` | panels, cards, inputs |
| `line` | borders, dividers |
| `ink` | primary text |
| `muted` | secondary text |
| `accent` | the interactive/brand colour |
| `accent-hi` | *more prominent* than accent — brighter on dark, **darker on light** |
| `accent-deep` | structural accent: borders, focus rings |
| `user` | the user's own chat bubble |
| `ok` / `warn` / `danger` | status |
| `scrim` | modal backdrop — **not** `bg-ground/80`, which is a white haze on paper |
| `glow` / `shadow` | the body wash and the elevation base |

`accent-hi` and `accent-deep` are defined by *prominence*, not lightness. That's what
lets the same class names work in both directions — on Contact sheet `accent-hi` is
darker than `accent`.

Don't borrow `accent` for warnings. The accent *is* the theme, so an amber-accented
theme would make a warning chip and a primary button read identically. That's what
`warn` is for.

**Shape and elevation: use the scale — its *values* are the theme's to set.**

- `rounded-control` · `rounded-field` · `rounded-panel` — 8/10/14px in Darkroom, 0 in
  Terminal green, 14/18/24px in Golden hour. Never hardcode a radius: a square theme
  will look broken around it.
- `elev-panel` · `elev-pop` — ours, not Tailwind's `shadow-*`. Tailwind bakes a shadow
  token's geometry into the utility at build time and leaves only the colour as a
  variable, so `shadow-pop` could never change shape at runtime. `elev-*` reads a
  custom property directly, which is what lets Terminal green use a hard offset and
  Slate ops use none.
- `text-nano` (9px) · `text-micro` (10px) · `text-meta` (11px) · `text-body` (13px) ·
  `text-lead` (15px), alongside Tailwind's `text-xs` / `text-sm` / `text-lg`. The type
  scale does *not* vary per theme — only the typeface does.
- Plain `border` / `border-t` / `border-b` pick up the theme's stroke width
  automatically. Don't write `border-2`.

`verify:theme` rejects `rounded-[Npx]` and `text-[Npx]`.

**Motion is the theme's too.** Use bare `transition` / `transition-colors` and let it
inherit; don't pin `duration-*` unless the animation is structural (the sidebar's width
tween is the one exception in the app).

### The window's own chrome

The title bar is the app's, the buttons in it are the OS's. Main sets
`titleBarStyle: 'hidden'` and hands Windows/Linux a `titleBarOverlay`, so the real
minimise, maximise and close buttons stay native — Snap Layouts, hover behaviour and
accessibility included — while the strip they sit in is `nav/TitleBar.tsx` and
follows the theme like anything else.

Both sides are painted with **`titleBarColor()`**, a derived token (`--color-titlebar`,
what `bg-raised/50` resolves to over the ground) so the buttons sit *in* the bar
rather than on a patch of their own. It has to be opaque and computed: the OS overlay
takes one flat colour and cannot composite over whatever the page has behind it, so a
translucent strip would always drift from it — most visibly under the body glow, which
is brightest at exactly the top edge. Symbol colour is `ink`, which the contrast floors
already hold to 7:1 against the ground in every theme.

`ipc.ts` calls `setTitleBarOverlay` on a theme change; without it the buttons keep the
previous theme's tint until restart, which would be the one place a switch visibly
didn't take.

`TitleBar` lays itself out from `env(titlebar-area-x/width/height)`, which Chromium
derives from that overlay — so it is correct on Windows (area stops short of the
buttons) and macOS (area starts after the traffic lights) with no platform branch.
The strip is `drag`; anything clickable in it needs `no-drag`, or the button swallows
the press into a window move.

Most ride Tailwind namespaces — `--radius-*` and `--font-sans` are read by
`rounded-*` and `body` for free. Three don't, and are handled in `styles.css`:

- **Border width** is the one structural property a token can't reach: `border`
  compiles to a literal `border-width: 1px`. Five **unlayered** rules re-point it at
  `var(--stroke)`; unlayered CSS outranks every `@layer`, so no specificity fight.
  `border-0` still wins on the edges it zeroes, so `<hr className="border-0 border-t">`
  behaves exactly as before.
- **Elevation** uses `@utility elev-panel/elev-pop`, per above.
- **Texture** is a `body::after` overlay — fixed, `pointer-events: none`, above modals
  (a CRT's scanlines fall on whatever is on screen). Themes without one set `none`, and
  it costs nothing.

**Focus rings** are `focus-visible:ring-2 focus-visible:ring-accent-deep` or
`focus:border-accent-deep`. The verify script holds `accent-deep` to a 3:1 floor
against both `ground` and `raised` precisely so this stays visible in every theme.

`infra/parts.tsx` (`Chip`, `SmallButton`, `Field`, `Card`) is the worked example —
prefer composing it over restyling from scratch.

## What `verify:theme` checks

Wired into `npm run verify`, alongside the three other verify scripts.

1. **Completeness** — every theme declares every colour, a full `style` block and all
   16 ANSI entries, all parseable. Plus **silhouette uniqueness**: no two themes may
   share the same radius/stroke/elevation/texture combination, or they may as well be
   one theme with a palette switch.
2. **Contrast floors** — WCAG ratios for text on both `ground` and `raised`; 3:1 for
   `accent-deep` as a non-text UI colour; 4.5:1 for `ansi.white` / `ansi.brightWhite`,
   without which a light terminal ships with invisible output.
3. **Role separation** — `user` and `danger` must be perceptually clear of `accent`, or
   a chat bubble reads as accented and a destructive button as primary.
4. **Drift** — the `@theme` and `:root` fallbacks equal `THEMES.darkroom` (colours *and*
   style), and `--font-mono` equals `MONO`. The mono stack is deliberately not
   per-theme: xterm is built with it and the ghost-completion overlay is positioned
   against the resulting cell grid, so letting a theme change it would mean
   re-measuring a live terminal on every switch for no gain.
5. **Literals** — no hex, no arbitrary radius/type value, no stale `-amber` utility.

The contrast floors are deliberately a little strict. When one fails, the right move is
almost always to adjust the palette, not the floor.
