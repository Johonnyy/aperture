import { app, BrowserWindow } from 'electron'

import { IPC } from '../shared/ipc'
import type { ApertureEvent } from '../shared/types'
import { AmberConnection } from './amber/connection'
import { ToolBridge } from './amber/tool-bridge'
import { getSettings } from './config'
import { registerIpc } from './ipc'
import { closeAllShells } from './ssh/ssh-client'
import { createWindow } from './window'

let mainWindow: BrowserWindow | null = null
let amber: AmberConnection | null = null
let bridge: ToolBridge | null = null

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
    } else if (frame.type === 'tool_call') {
      void bridge?.handleToolCall(frame)
    }
  })

  connection.on('status', (status) => {
    emit({ kind: 'connection', status })
    // The socket is gone; nobody will read a tool_result, so stop waiting on humans.
    if (status.state !== 'open') bridge?.abortAll()
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

  amber = buildConnection()
  bridge = new ToolBridge(amber, emit)
  registerIpc({ amber, bridge, emit })

  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  // Aperture is a desktop tool, not a menu-bar agent: closing the window means
  // quitting, on every platform. Amber's session is resumable, so nothing is lost.
  bridge?.abortAll()
  closeAllShells()
  amber?.disconnect()
  app.quit()
})
