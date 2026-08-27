import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

import { paletteFor, titleBarColor, type Palette } from '../shared/theme'
import { getBloomRecord, getSettings } from './config'

/** Matches `--titlebar-height` in styles.css and the `env(titlebar-area-*)` box. */
export const TITLE_BAR_HEIGHT = 36

/**
 * How long to wait for `ready-to-show` before showing the window regardless.
 *
 * `ready-to-show` fires on the renderer's **first paint**, and a window created with
 * `show: false` is a hidden widget Chromium is entitled not to composite. When that
 * happens the event never arrives — and since it was the only caller of `show()`,
 * Aperture becomes a live process with no window: the renderer runs, connects to
 * Amber and announces this machine to the fleet, so the device appears on another
 * computer while nothing is on screen here.
 *
 * There is no way back from that state. Aperture has no tray, `activate` only builds
 * a window when there are *zero* windows (a hidden one counts), and the
 * single-instance lock means relaunching hands control to the stuck instance.
 *
 * A deadline turns "never" into "a beat late". The white flash `show: false` exists
 * to avoid is still avoided on the normal path, and on this one `backgroundColor`
 * has already painted the frame the right colour anyway.
 */
const SHOW_DEADLINE_MS = 4_000

/**
 * The tint for the native window buttons.
 *
 * Windows and Linux only — on macOS `titleBarStyle: 'hidden'` already yields the
 * traffic lights, and passing an overlay object there does nothing useful. The
 * renderer doesn't need to know which happened: it lays the bar out from
 * `env(titlebar-area-*)`, which Chromium fills in per platform.
 */
export function titleBarOverlayFor(theme: Palette): {
  titleBarOverlay?: { color: string; symbolColor: string; height: number }
} {
  if (process.platform === 'darwin') return {}
  return {
    titleBarOverlay: {
      color: titleBarColor(theme),
      // `ink`, not `muted`: the verify script holds ink to 7:1 against ground in
      // every theme, so the glyphs stay legible on paper as well as on charcoal.
      symbolColor: theme.colors.ink,
      height: TITLE_BAR_HEIGHT,
    },
  }
}

export function createWindow(): BrowserWindow {
  // Read before constructing the window, so the OS-composited frame is already the
  // right colour before Chromium paints anything. The renderer gets the same id off
  // argv (see preload) and so cannot disagree with what's already on screen.
  const theme = paletteFor(getSettings().theme)

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: theme.colors.ground,
    title: 'Aperture',
    // The app draws its own title bar and the OS keeps drawing the real minimise /
    // maximise / close buttons on top, tinted to match. `frame: false` with custom
    // buttons was the alternative and is worse: it loses Windows Snap Layouts (which
    // need the genuine maximise button to hover over), the OS hover and focus
    // behaviour, and every accessibility affordance that comes with them.
    titleBarStyle: 'hidden',
    ...titleBarOverlayFor(theme),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: [
        `--aperture-theme=${theme.id}`,
        // Whether the Bloom sidebar row exists, for the same reason the theme is
        // here: asking main over IPC costs a round trip, so the row would pop in a
        // frame after paint and reflow the nav. One boolean decides *presence*; the
        // link's five-valued state settles asynchronously and only moves its dot.
        `--aperture-bloom=${getBloomRecord().state === 'unlinked' ? '0' : '1'}`,
      ],
      // The renderer runs untrusted-ish UI code and has no business touching Node.
      // Everything privileged (the socket, SSH, the key vault) lives in main and is
      // reached through the narrow contextBridge surface in preload.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs `require` for the ipcRenderer bridge
    },
  })

  // Avoid the white flash: wait until the first paint — but never *only* on that.
  // See SHOW_DEADLINE_MS for why a missed `ready-to-show` is unrecoverable.
  let shown = false
  const show = (why: string): void => {
    if (shown || window.isDestroyed()) return
    shown = true
    if (why !== 'ready-to-show') console.warn(`[window] shown via ${why}, not first paint`)
    window.show()
  }
  const deadline = setTimeout(() => show('deadline'), SHOW_DEADLINE_MS)
  window.once('ready-to-show', () => show('ready-to-show'))
  window.once('closed', () => clearTimeout(deadline))

  // Never navigate the shell itself to an external page; open it in the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
    // In dev, a renderer failure is otherwise silent: the window keeps showing the
    // last good paint while nothing responds. Open DevTools so the console is
    // already there when that happens.
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Surface renderer crashes and blocked resources in the main-process log rather
  // than letting them disappear into a console nobody has open.
  //
  // A failed document load used to be entirely silent — `loadFile` is called with
  // `void`, so a rejection is an unhandled warning nobody reads — and the window then
  // waited forever for a paint that could not happen. Main frame only, and `-3`
  // (ABORTED) is skipped because a superseded navigation reports it routinely.
  window.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    console.error(`[window] load failed ${code} ${description} (${url})`)
    // Show it anyway: a visibly broken window is a bug report, a ghost process is a
    // mystery, and this is the case where no `ready-to-show` will ever arrive.
    show('did-fail-load')
  })
  window.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details.reason, details.exitCode)
  })
  window.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`)
  })

  return window
}
