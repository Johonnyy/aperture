import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { randomUUID } from 'node:crypto'

import type { AgentConfigInput, BloomLink } from '../shared/bloom'
import { IPC } from '../shared/ipc'
import { paletteFor } from '../shared/theme'
import type {
  ApertureEvent,
  ConnectionStatus,
  KeyRecord,
  ServerConfig,
  Settings,
} from '../shared/types'
import type { AmberConnection } from './amber/connection'
import type { ToolBridge } from './amber/tool-bridge'
import * as bloomApi from './bloom'
import * as bloom from './bloom/link'
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
import * as infra from './infra'
import { installKey } from './ssh/install'
import { deleteKey, isVaultAvailable, listKeys } from './ssh/key-store'
import { titleBarOverlayFor } from './window'
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
    // Repaint the window chrome so a reload — or the next cold start — never shows
    // the previous theme behind the renderer. The renderer restyles itself.
    if (patch.theme) {
      const theme = paletteFor(next.theme)
      const overlay = titleBarOverlayFor(theme).titleBarOverlay
      for (const win of BrowserWindow.getAllWindows()) {
        win.setBackgroundColor(theme.colors.ground)
        // Repaint the native window buttons in the new theme. Without this they keep
        // the previous theme's tint until the app restarts, which is the one place a
        // theme switch would visibly not take.
        if (overlay) win.setTitleBarOverlay(overlay)
      }
      nativeTheme.themeSource = theme.scheme
    }
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
  ipcMain.on(IPC.SSH_ACK_SHELL, (_e, id: string, chars: number) => ssh.ackShell(id, chars))

  ipcMain.handle(IPC.SSH_EXEC_ON_SHELL, (_e, id: string, command: string) =>
    ssh.execOnShell(id, command),
  )

  // --- infrastructure -------------------------------------------------------

  ipcMain.handle(IPC.INFRA_STATUS, async (_e, serverId: string, sudoPassword?: string) => {
    const server = getServer(serverId)
    if (!server) return { ok: false, error: 'Unknown server.' }
    return infra.readStatus(`status-${serverId}`, server, sudoPassword)
  })

  /**
   * Run one catalogued infra action.
   *
   * `sudoPassword` arrives per call and is never written anywhere: not to
   * `servers.json`, not to an `op` entry, not to the audit log. It goes to the
   * command's stdin and out of scope when this handler returns.
   */
  ipcMain.handle(
    IPC.INFRA_RUN,
    async (
      _e,
      opId: string,
      serverId: string,
      actionId: string,
      params: Record<string, string>,
      opts: { dryRun?: boolean; sudoPassword?: string },
    ) => {
      const server = getServer(serverId)
      if (!server) {
        emit({ kind: 'op-done', opId, ok: false, error: 'Unknown server.' })
        return { ok: false, error: 'Unknown server.' }
      }
      return infra.runAction(opId, server, actionId, params ?? {}, opts ?? {}, {
        emit,
        verbose: getSettings().verboseLogging,
      })
    },
  )

  ipcMain.handle(IPC.INFRA_CANCEL, (_e, opId: string) => infra.cancelAction(opId))

  // --- approvals ------------------------------------------------------------

  ipcMain.handle(IPC.BRIDGE_APPROVE, (_e, id: string) => bridge.resolveApproval(id, true))
  ipcMain.handle(IPC.BRIDGE_DENY, (_e, id: string) => bridge.resolveApproval(id, false))
  ipcMain.handle(IPC.BRIDGE_PENDING, () => bridge.listPending())

  // --- bloom ----------------------------------------------------------------

  /**
   * The link record, straight off disk.
   *
   * Deliberately does no I/O beyond the vault: this is what the sidebar reads to
   * decide whether the Bloom tab exists, so it has to answer immediately even with
   * every server unreachable.
   */
  ipcMain.handle(IPC.BLOOM_LINK, (): BloomLink => bloom.getLink())

  /**
   * Read Bloom off a box over SSH.
   *
   * `sudoPassword` arrives per call and is never written anywhere — same contract as
   * `INFRA_RUN`. The token it recovers goes straight into the `safeStorage` vault and
   * is never returned to the renderer.
   */
  ipcMain.handle(
    IPC.BLOOM_DISCOVER,
    async (_e, serverId: string, domain: string, sudoPassword?: string) => {
      const server = getServer(serverId)
      if (!server) return { ok: false, error: 'Unknown server.' }
      return bloom.linkFromServer(emit, `bloom-link-${serverId}`, server, { domain, sudoPassword })
    },
  )

  ipcMain.handle(IPC.BLOOM_LINK_MANUAL, async (_e, baseUrl: string, token: string) =>
    bloom.linkManually(emit, baseUrl, token),
  )

  ipcMain.handle(IPC.BLOOM_UNLINK, (): BloomLink => bloom.unlink(emit))

  ipcMain.handle(IPC.BLOOM_VERIFY, async (): Promise<BloomLink> => {
    await bloom.verifyLink(emit)
    return bloom.getLink()
  })

  // Everything below resolves credentials, calls Bloom, and lets the outcome move
  // the link's state — see `bloom/index.ts`. Results carry `code` as well as a
  // message, because the renderer has to tell a pruned run from a restarting Bloom
  // from a slug that is already taken.

  ipcMain.handle(IPC.BLOOM_AGENTS, () => bloomApi.listAgents(emit))
  ipcMain.handle(IPC.BLOOM_AGENT_CREATE, (_e, input: AgentConfigInput) =>
    bloomApi.createAgent(emit, input),
  )
  ipcMain.handle(IPC.BLOOM_AGENT_UPDATE, (_e, id: string, input: AgentConfigInput) =>
    bloomApi.updateAgent(emit, id, input),
  )
  ipcMain.handle(IPC.BLOOM_AGENT_DELETE, (_e, id: string) => bloomApi.deleteAgent(emit, id))

  /** Starts the run *and* opens its stream; events arrive as `bloom-run`. */
  ipcMain.handle(IPC.BLOOM_TEST_RUN, (_e, agentId: string, input: string) =>
    bloomApi.startTestRun(emit, agentId, input),
  )
  ipcMain.handle(IPC.BLOOM_CANCEL_RUN, (_e, runId: string) => bloomApi.cancelRun(emit, runId))
  ipcMain.handle(IPC.BLOOM_WATCH_RUN, (_e, runId: string) => bloomApi.watchRun(emit, runId))

  ipcMain.handle(IPC.BLOOM_RUNS, (_e, params: Record<string, never>) =>
    bloomApi.listRuns(emit, params ?? {}),
  )
  ipcMain.handle(IPC.BLOOM_AGENT_RUNS, (_e, agentId: string, params: Record<string, never>) =>
    bloomApi.listAgentRuns(emit, agentId, params ?? {}),
  )
  ipcMain.handle(IPC.BLOOM_TRACE, (_e, agentId: string, runId: string, after?: number) =>
    bloomApi.runTrace(emit, agentId, runId, after ?? 0),
  )

  ipcMain.handle(IPC.BLOOM_PROVIDERS, () => bloomApi.listProviders(emit))
  ipcMain.handle(IPC.BLOOM_CONNECTIONS, (_e, agentId: string) =>
    bloomApi.listConnections(emit, agentId),
  )
  /** Opens the authorize URL in the *system* browser — never an embedded window. */
  ipcMain.handle(
    IPC.BLOOM_OAUTH_START,
    (_e, agentId: string, provider: string, scopes?: string[]) =>
      bloomApi.startOAuth(emit, agentId, provider, scopes),
  )
  ipcMain.handle(IPC.BLOOM_OAUTH_DISCONNECT, (_e, agentId: string, provider: string) =>
    bloomApi.disconnectProvider(emit, agentId, provider),
  )

  ipcMain.handle(IPC.BLOOM_USAGE, (_e, since?: string) => bloomApi.usage(emit, since))

  // --- audit ----------------------------------------------------------------

  ipcMain.handle(IPC.AUDIT_LIST, () => listAudit())
  ipcMain.handle(IPC.AUDIT_CLEAR, () => {
    clearAudit()
    return []
  })
}
