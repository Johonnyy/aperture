import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'

import { IPC } from '../shared/ipc'
import type {
  ApertureEvent,
  ConnectionStatus,
  KeyRecord,
  ServerConfig,
  Settings,
} from '../shared/types'
import type { AmberConnection } from './amber/connection'
import type { ToolBridge } from './amber/tool-bridge'
import {
  addServer,
  clearAudit,
  getServer,
  getSettings,
  listAudit,
  listServers,
  removeServer,
  updateServer,
  updateSettings,
} from './config'
import { installKey } from './ssh/install'
import { deleteKey, isVaultAvailable, listKeys } from './ssh/key-store'
import { generateKey } from './ssh/keygen'
import * as ssh from './ssh/ssh-client'
import type { Log } from './ssh/ssh-client'

export interface IpcContext {
  amber: AmberConnection
  bridge: ToolBridge
  emit: (event: ApertureEvent) => void
}

/**
 * Every `ipcMain` registration lives here, so the privileged surface the renderer
 * can reach is one file you can read top to bottom.
 */
export function registerIpc({ amber, bridge, emit }: IpcContext): void {
  // --- amber ----------------------------------------------------------------

  ipcMain.handle(IPC.AMBER_CONNECT, (): ConnectionStatus => {
    const settings = getSettings()
    // Re-read config on every connect so editing the URL or token in Settings takes
    // effect on the next attempt without restarting the app.
    amber.connect({
      url: settings.amberUrl,
      token: settings.authToken,
      autoReconnect: settings.autoReconnect,
    })
    return amber.status
  })

  ipcMain.handle(IPC.AMBER_DISCONNECT, (): ConnectionStatus => {
    amber.disconnect()
    return amber.status
  })

  ipcMain.handle(IPC.AMBER_STATUS, (): ConnectionStatus => amber.status)

  ipcMain.handle(IPC.AMBER_SEND_TEXT, (_e, text: string): boolean => {
    if (typeof text !== 'string' || !text.trim()) return false
    return amber.send({ type: 'user_text', text: text.trim() })
  })

  ipcMain.handle(IPC.AMBER_SEND_AUDIO, (_e, buffer: ArrayBuffer): boolean =>
    amber.sendAudio(buffer),
  )

  ipcMain.handle(IPC.AMBER_INTERRUPT, (): boolean => amber.send({ type: 'interrupt' }))

  // --- settings -------------------------------------------------------------

  ipcMain.handle(IPC.SETTINGS_GET, (): Settings => getSettings())

  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<Settings>): Settings => {
    const next = updateSettings(patch)
    // The live socket reads autoReconnect when a close happens, not just at dial
    // time, so push it now — otherwise toggling it wouldn't take effect until the
    // next manual reconnect. URL and token only matter on the next dial.
    amber.updateOptions({ autoReconnect: next.autoReconnect })
    return next
  })

  // --- servers & keys -------------------------------------------------------

  ipcMain.handle(IPC.SSH_LIST, (): ServerConfig[] => listServers())

  ipcMain.handle(IPC.SSH_ADD, (_e, input: Omit<ServerConfig, 'id'>): ServerConfig => {
    const server = addServer(input)
    // The server names are baked into the tool schema, so Amber needs the new set.
    bridge.register()
    return server
  })

  ipcMain.handle(
    IPC.SSH_UPDATE,
    (_e, id: string, patch: Partial<ServerConfig>): ServerConfig | undefined => {
      const server = updateServer(id, patch)
      bridge.register()
      return server
    },
  )

  ipcMain.handle(IPC.SSH_REMOVE, (_e, id: string): ServerConfig[] => {
    removeServer(id)
    bridge.register()
    return listServers()
  })

  ipcMain.handle(IPC.SSH_LIST_KEYS, (): { keys: KeyRecord[]; available: boolean } => ({
    keys: listKeys(),
    available: isVaultAvailable(),
  }))

  ipcMain.handle(IPC.SSH_GENERATE_KEY, (_e, label: string): KeyRecord =>
    generateKey(label || 'aperture'),
  )

  /**
   * The install flow, narrated. Every step is pushed to the renderer as it happens
   * under a caller-supplied `opId`, so the UI can show what the connection is
   * actually doing instead of an opaque spinner.
   */
  ipcMain.handle(
    IPC.SSH_INSTALL_KEY,
    async (
      _e,
      opId: string,
      serverId: string,
      keyId: string,
      password: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      let seq = 0
      const verbose = getSettings().verboseLogging
      const log: Log = (level, message, detail) => {
        // `debug` carries commands and raw output; everything else always ships,
        // because which step failed should never be behind a setting.
        if (level === 'debug' && !verbose) return
        emit({
          kind: 'op',
          opId,
          entry: { id: `${opId}-${seq++}`, ts: Date.now(), level, message, detail },
        })
      }

      let result: { ok: boolean; error?: string }
      try {
        result = await installKey(serverId, keyId, password, log)
      } catch (err) {
        // installKey handles its own failures; this is the last line of defence so
        // an unexpected throw still resolves the UI rather than hanging it.
        const message = (err as Error).message
        log('error', `Unexpected failure: ${message}`)
        result = { ok: false, error: message }
      }

      if (result.ok) bridge.register() // server may now be reachable for tool calls
      emit({ kind: 'op-done', opId, ok: result.ok, error: result.error })
      return result
    },
  )

  ipcMain.handle(IPC.SSH_TEST, async (_e, id: string) => {
    const server = getServer(id)
    if (!server) return { ok: false, error: 'Unknown server.' }
    const result = await ssh.exec(server, 'uname -a || ver', 8_000)
    return result.error
      ? { ok: false, error: result.error }
      : { ok: true, output: result.stdout.trim() }
  })

  ipcMain.handle(IPC.SSH_DELETE_KEY, (_e, id: string): KeyRecord[] => {
    deleteKey(id)
    return listKeys()
  })

  // --- interactive shells ---------------------------------------------------

  ipcMain.handle(IPC.SSH_OPEN_SHELL, async (event, serverId: string) => {
    const server = getServer(serverId)
    if (!server) return { ok: false, error: 'Unknown server.' }

    const shellId = randomUUID()
    const target = BrowserWindow.fromWebContents(event.sender)
    const send = (payload: unknown): void => {
      if (target && !target.isDestroyed()) target.webContents.send(IPC.SHELL_DATA, payload)
    }

    try {
      await ssh.openShell(
        shellId,
        server,
        (data) => send({ id: shellId, data }),
        () => send({ id: shellId, closed: true }),
      )
      return { ok: true, shellId }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.on(IPC.SSH_WRITE_SHELL, (_e, id: string, data: string) => ssh.writeShell(id, data))
  ipcMain.on(IPC.SSH_RESIZE_SHELL, (_e, id: string, cols: number, rows: number) =>
    ssh.resizeShell(id, cols, rows),
  )
  ipcMain.on(IPC.SSH_CLOSE_SHELL, (_e, id: string) => ssh.closeShell(id))

  // --- approvals ------------------------------------------------------------

  ipcMain.handle(IPC.BRIDGE_APPROVE, (_e, id: string) => bridge.resolveApproval(id, true))
  ipcMain.handle(IPC.BRIDGE_DENY, (_e, id: string) => bridge.resolveApproval(id, false))
  ipcMain.handle(IPC.BRIDGE_PENDING, () => bridge.listPending())

  // --- audit ----------------------------------------------------------------

  ipcMain.handle(IPC.AUDIT_LIST, () => listAudit())
  ipcMain.handle(IPC.AUDIT_CLEAR, () => {
    clearAudit()
    return []
  })
}
