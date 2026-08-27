import { app, BrowserWindow } from 'electron'
import { resolve } from 'node:path'

import { IPC } from '../shared/ipc'
import type { ApertureEvent } from '../shared/types'
import { AmberConnection } from './amber/connection'
import { ToolBridge } from './amber/tool-bridge'
import { applyModel } from './amber/model'
import { applyVoice } from './amber/voice'
import { attachPeerRun, resetAttachments } from './bloom/attach'
import { verifyLink } from './bloom/link'
import { hold as holdDeepLink, parseDeepLink } from './bloom/deep-link'
import { closeAllRunStreams } from './bloom/run-stream'
import { getSettings } from './config'
import { getDeviceId, getDeviceName } from './device'
import { registerIpc } from './ipc'
import { closeAllShells } from './ssh/ssh-client'
import { createWindow } from './window'

let mainWindow: BrowserWindow | null = null
let amber: AmberConnection | null = null
let bridge: ToolBridge | null = null

/**
 * The single-instance lock, before anything else.
 *
 * Without it, a deep link on Windows and Linux launches a *second* Aperture holding
 * no state and no window, while the running one never hears about it. Acquiring the
 * lock is what routes the URL to the instance that can act on it.
 *
 * The losing instance quits immediately. `window-all-closed` will fire with `bridge`
 * and `amber` still null, which the optional calls there already tolerate.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

/**
 * Act on an `aperture://` URL: focus the window and tell the renderer to re-read.
 *
 * Parsing and the buffer live in `bloom/deep-link.ts` — including the reasoning for
 * why nothing in the URL is trusted.
 */
function handleDeepLink(raw: string | undefined): void {
  const payload = parseDeepLink(raw)
  if (!payload) return

  holdDeepLink(payload)
  emit({ kind: 'bloom-oauth', provider: payload.provider })

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

// macOS delivers the URL through this event and never through argv, and a cold
// launch can deliver it *before* `whenReady`, so it is registered at module scope.
// `preventDefault` is required.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

// Windows and Linux deliver it as an argv entry to the instance holding the lock.
app.on('second-instance', (_event, argv) => {
  handleDeepLink(argv.find((arg) => arg.startsWith('aperture://')))
})

/**
 * Push an event to the renderer. Safe to call before the window exists or after
 * it's gone — main outlives the UI, and a dropped event is never worth a crash.
 */
function emit(event: ApertureEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.EVENT, event)
  }
}

function buildConnection(): AmberConnection {
  const settings = getSettings()
  const connection = new AmberConnection({
    url: settings.amberUrl,
    token: settings.authToken,
    autoReconnect: settings.autoReconnect,
  })

  connection.on('frame', (frame) => {
    emit({ kind: 'frame', frame })
    if (frame.type === 'ready') {
      // Re-declare on every ready. Amber keeps declared specs across a reconnect,
      // so without this a stale build's tools stay advertised to the model.
      bridge?.register()
      // And announce this machine as an addressable device. Same rule again, and for a
      // sharper reason: Amber holds a device on the *connection*, not the session, so a
      // reconnect that didn't re-announce would leave this machine invisible to every
      // other client until the app was restarted.
      bridge?.announce(getDeviceId(), getDeviceName(), app.getVersion())
      // Same reasoning for the voice: it lives on Amber's session, so a resume past
      // the TTL would silently drop back to the server default. The chosen brain is
      // session state too, and re-asserted here for exactly the same reason.
      applyVoice(connection, getSettings())
      applyModel(connection, getSettings())
    } else if (frame.type === 'tool_call') {
      void bridge?.handleToolCall(frame)
    } else if (
      frame.type === 'activity' &&
      frame.phase === 'start' &&
      frame.origin === 'peer:bloom'
    ) {
      // Amber can't tell us the run id — `build_agent` blocks for the whole build
      // and only returns it at the end — so go and find it. See bloom/attach.ts.
      attachPeerRun(emit, frame.id, Date.now())
    }
  })

  connection.on('status', (status) => {
    emit({ kind: 'connection', status })
    // The socket is gone; nobody will read a tool_result, so stop waiting on humans.
    if (status.state !== 'open') {
      bridge?.abortAll()
      // Call ids are per-connection, so a resumed session must not inherit the
      // "already matched" set from the one before it.
      resetAttachments()
    }
  })
  connection.on('audio', (buffer: Buffer, meta) => {
    // Copy out of the pooled Buffer before it crosses the boundary — Node reuses
    // the backing allocation, so handing over a view of it risks the bytes being
    // overwritten by the next frame before the renderer decodes them.
    const copy = new ArrayBuffer(buffer.byteLength)
    new Uint8Array(copy).set(buffer)
    emit({ kind: 'audio', buffer: copy, meta })
  })

  return connection
}

app.whenReady().then(() => {
  app.setAppUserModelId('dev.johnny.aperture')

  // Register the scheme so Bloom's completion page can hand control back.
  //
  // Under `electron-vite dev`, `process.defaultApp` is true and the executable is
  // Electron itself — registering plainly would point the scheme at Electron rather
  // than at this app. `process.argv[1]` is the project path and must be resolved: a
  // relative one is stored verbatim and breaks when the OS launches from elsewhere.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('aperture', process.execPath, [resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('aperture')
  }

  // A cold start on Windows and Linux puts the URL in *this* process's argv, and
  // `second-instance` never fires. macOS never puts it there at all, so this is a
  // no-op on that platform and `open-url` above does the work.
  handleDeepLink(process.argv.find((arg) => arg.startsWith('aperture://')))

  amber = buildConnection()
  bridge = new ToolBridge(amber, emit)
  registerIpc({ amber, bridge, emit })

  mainWindow = createWindow()

  // Deliberately after the window and deliberately not awaited. The sidebar has
  // already decided whether the Bloom row exists — from disk, via argv — so this is
  // only ever a demotion: it can mark the link unreachable or its key rejected, and
  // can never unlink. Awaiting it would put a network round trip in front of first
  // paint for a question the disk already answered.
  void verifyLink(emit)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  // Aperture is a desktop tool, not a menu-bar agent: closing the window means
  // quitting, on every platform. Amber's session is resumable, so nothing is lost.
  bridge?.abortAll()
  closeAllShells()
  closeAllRunStreams()
  amber?.disconnect()
  app.quit()
})
