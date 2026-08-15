import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

import { paletteFor, titleBarColor, type Palette } from '../shared/theme'
import { getSettings } from './config'

/** Matches `--titlebar-height` in styles.css and the `env(titlebar-area-*)` box. */
export const TITLE_BAR_HEIGHT = 36

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
      additionalArguments: [`--aperture-theme=${theme.id}`],
      // The renderer runs untrusted-ish UI code and has no business touching Node.
      // Everything privileged (the socket, SSH, the key vault) lives in main and is
      // reached through the narrow contextBridge surface in preload.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs `require` for the ipcRenderer bridge
    },
  })

  // Avoid the white flash: wait until the first paint.
  window.once('ready-to-show', () => window.show())

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
  window.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details.reason, details.exitCode)
  })
  window.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`)
  })

  return window
}
