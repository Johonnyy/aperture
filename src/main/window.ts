import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#14110d',
    title: 'Aperture',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
