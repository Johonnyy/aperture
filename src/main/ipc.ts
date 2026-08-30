import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { randomUUID } from 'node:crypto'

import type { AgentConfigInput, BloomLink, ConnectionSecretInput } from '../shared/bloom'
import type { CatalogueModel } from '../shared/models'
import type { ReleaseInfo } from '../shared/version'
import { IPC } from '../shared/ipc'
import { paletteFor } from '../shared/theme'
import type {
  ApertureEvent,
  ConnectionStatus,
  CredentialSummary,
  KeyRecord,
  ServerConfig,
  Settings,
} from '../shared/types'
import type { AmberConnection } from './amber/connection'
import type { TdConfig, TdProbeResult, TdProject } from '../shared/touchdesigner'
import { declareSelf } from './amber/declare'
import { sendCommand } from './extensions/touchdesigner/bridge'
import {
  addProject,
  getTdConfig,
  removeProject,
  updateProject,
  updateTdSettings,
} from './extensions/touchdesigner/config'
import { refreshScenes } from './extensions/touchdesigner/refresh'
import type { ToolBridge } from './amber/tool-bridge'
import { listModels } from './amber/catalogue'
import { applyModel, remapKeyword } from './amber/model'
import { applyVoice } from './amber/voice'
import * as bloomApi from './bloom'
import { take as takePendingDeepLink } from './bloom/deep-link'
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
import { getDeviceId, getDeviceName, setDeviceName } from './device'
import { lanAddresses } from './net/lan'
import { setGrant } from './extensions/grants'
import { extensionRegistry } from './extensions/registry'
import * as infra from './infra'
import { listNicknames, setNickname } from './nicknames'
import {
  deleteCredential,
  isVaultAvailable as isCredentialVaultAvailable,
  listCredentials,
  saveCredential,
  updateCredential,
} from './keys/credential-store'
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

  ipcMain.handle(
    IPC.AMBER_REMAP_MODEL,
    (_e, keyword: string, model: string | null): boolean => {
      if (typeof keyword !== 'string' || !keyword.trim()) return false
      const target = typeof model === 'string' && model.trim() ? model.trim() : null
      // No optimistic local copy: Amber owns this value and answers with a `model`
      // frame carrying what actually took effect. Returning false when the socket is
      // down is the honest answer — there is nowhere else to put it.
      return remapKeyword(amber, keyword.trim().toLowerCase(), target)
    },
  )

  // Curating memory from the UI. Like the keyword map above, there is no optimistic
  // local copy: Amber owns the facts and answers with a `memory` frame carrying what
  // actually took effect, so the panel renders the reply rather than its own guess.
  ipcMain.handle(
    IPC.AMBER_MEMORY_ACTION,
    (
      _e,
      action: 'forget' | 'restore' | 'correct',
      id: number,
      content?: string,
    ): boolean => amber.send({ type: 'memory_action', action, id, content }),
  )

  ipcMain.handle(
    IPC.AMBER_MEMORY_QUERY,
    (_e, q: string | null, limit?: number): boolean =>
      amber.send({ type: 'memory_query', q, limit }),
  )

  // The same frame under a different scope: a fact's revision history, or everything
  // she has stopped believing. Both read columns that have always been written and,
  // until now, read by nothing.
  ipcMain.handle(
    IPC.AMBER_MEMORY_SCOPE,
    (_e, scope: 'lineage' | 'archive', id?: number, limit?: number): boolean =>
      amber.send({ type: 'memory_query', scope, id, limit }),
  )

  // Acknowledging what Amber said unprompted. No reply comes back — she settles the
  // outbox on a successful send, so this is about the *user's* verdict rather than
  // delivery. `complete` is the only one that changes anything else, and it lands on
  // the same row `complete_reminder` would.
  ipcMain.handle(
    IPC.AMBER_PUSH_ACK,
    (_e, id: string, action?: 'seen' | 'dismiss' | 'complete'): boolean =>
      amber.send({ type: 'push_ack', id, action }),
  )

  // A turn is blocked on this. Not answering is a refusal after 60s, so the dialog on
  // the other end of it is the one thing in Aperture that genuinely holds Amber up.
  ipcMain.handle(
    IPC.AMBER_CONFIRM,
    (_e, id: string, approved: boolean): boolean =>
      amber.send({ type: 'confirm_response', id, approved }),
  )

  // How Amber is doing. Like the memory panel above, there is no optimistic local
  // copy: Amber owns the numbers and answers with a `review` frame carrying what is
  // actually true, so the panel renders the reply rather than its own guess.
  ipcMain.handle(
    IPC.AMBER_REVIEW_QUERY,
    (_e, topic: 'tools' | 'reflections' | 'evals', since?: string, limit?: number): boolean =>
      amber.send({ type: 'review_query', topic, since, limit }),
  )

  ipcMain.handle(
    IPC.AMBER_REVIEW_ACTION,
    (
      _e,
      topic: 'tools' | 'reflections' | 'evals',
      action: 'promote' | 'dismiss' | 'archive',
      id: number,
    ): boolean => amber.send({ type: 'review_action', topic, action, id }),
  )

  ipcMain.handle(
    IPC.AMBER_EVAL_CAPTURE,
    (
      _e,
      payload: { query: string; expect_tool?: string; got_tool?: string; note?: string; reply?: string },
    ): boolean => amber.send({ type: 'eval_capture', ...payload }),
  )

  ipcMain.handle(
    IPC.AMBER_MODEL_CATALOGUE,
    (_e, refresh?: boolean): Promise<CatalogueModel[]> => listModels(refresh === true),
  )

  // --- settings -------------------------------------------------------------

  ipcMain.handle(IPC.SETTINGS_GET, (): Settings => getSettings())

  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<Settings>): Settings => {
    const next = updateSettings(patch)
    // The live socket reads autoReconnect when a close happens, not just at dial
    // time, so push it now — otherwise toggling it wouldn't take effect until the
    // next manual reconnect. URL and token only matter on the next dial.
    amber.updateOptions({ autoReconnect: next.autoReconnect })
    // The voice applies to the next sentence Amber synthesizes, so push it now
    // rather than on the next dial — the whole point of the controls is hearing the
    // change on the reply after you save. A no-op when the socket is down; `ready`
    // re-sends it.
    if (
      patch.ttsVoice !== undefined ||
      patch.ttsModel !== undefined ||
      patch.ttsSpeed !== undefined ||
      patch.ttsInstructions !== undefined
    ) {
      applyVoice(amber, next)
    }
    // The brain applies to the next turn, so push it now for the same reason —
    // saving a choice should change the reply after it, not after a reconnect.
    if (patch.llmKeyword !== undefined) {
      applyModel(amber, next)
    }
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

  // --- credentials ------------------------------------------------------------
  //
  // The same `{ items, available }` envelope the SSH key list uses, for the same
  // reason: "there are none" and "this machine cannot decrypt any" need different
  // screens, and a bare array cannot tell them apart.
  //
  // Note what is NOT here: no handler returns a credential's value. See IPC.KEYS_*.
  ipcMain.handle(
    IPC.KEYS_LIST,
    (): { credentials: CredentialSummary[]; available: boolean } => ({
      credentials: listCredentials(),
      available: isCredentialVaultAvailable(),
    }),
  )

  ipcMain.handle(
    IPC.KEYS_SAVE,
    (_e, input: { uid?: string; credentialId: string; label: string; value: string }) =>
      saveCredential(input),
  )

  ipcMain.handle(
    IPC.KEYS_UPDATE,
    (_e, uid: string, patch: { label?: string; credentialId?: string }): void => {
      updateCredential(uid, patch)
    },
  )

  ipcMain.handle(IPC.KEYS_DELETE, (_e, uid: string): void => {
    deleteCredential(uid)
  })

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

  ipcMain.handle(
    IPC.INFRA_RELEASES,
    (_e, repos: string[], force?: boolean): Promise<Record<string, ReleaseInfo>> =>
      infra.checkReleases(repos ?? [], { force: Boolean(force) }),
  )

  ipcMain.handle(IPC.INFRA_CANCEL, (_e, opId: string) => infra.cancelAction(opId))

  // --- approvals ------------------------------------------------------------

  ipcMain.handle(IPC.BRIDGE_APPROVE, (_e, id: string) => bridge.resolveApproval(id, true))
  ipcMain.handle(IPC.BRIDGE_DENY, (_e, id: string) => bridge.resolveApproval(id, false))
  ipcMain.handle(IPC.BRIDGE_PENDING, () => bridge.listPending())

  // Stopping something Amber is still checking on. Answered with a fresh `status`,
  // whose `waits` section is what the panel renders — so there is no optimistic local
  // copy here either, for the reason the memory panel has none: she owns the list.
  ipcMain.handle(
    IPC.AMBER_WAIT_CANCEL,
    (_e, id: string): boolean => amber.send({ type: 'wait_action', action: 'cancel', id }),
  )

  // --- devices & extensions -------------------------------------------------

  ipcMain.handle(IPC.DEVICE_IDENTITY, () => ({
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
  }))

  ipcMain.handle(IPC.DEVICE_RENAME, (_e, name: string) => {
    const deviceName = setDeviceName(name)
    // Re-announce: the name is part of what other clients resolve "my desktop" against,
    // so a rename that only landed on disk would leave every panel showing the old one.
    bridge.announce(getDeviceId(), deviceName, app.getVersion())
    return deviceName
  })

  // Fire-and-forget (`on`, not `handle`). The answer comes back as a
  // `device_control_response` frame, so awaiting here would be a promise that resolves
  // long before the thing it describes.
  ipcMain.on(
    IPC.DEVICE_CONTROL,
    (_e, request: { id: string; deviceId: string; action: string; args?: Record<string, unknown> }) => {
      amber.send({
        type: 'device_control_request',
        id: request.id,
        device_id: request.deviceId,
        action: request.action,
        args: request.args,
      })
    },
  )

  // Read fresh on every call rather than cached at startup: a laptop changes networks,
  // and a stale address is exactly the failure pairing exists to avoid.
  ipcMain.handle(IPC.DEVICE_LAN_ADDRESSES, () => lanAddresses())

  ipcMain.handle(IPC.DEVICE_NICKNAMES, () => listNicknames())

  ipcMain.handle(IPC.DEVICE_SET_NICKNAME, (_e, deviceId: string, nickname: string) =>
    setNickname(deviceId, nickname),
  )

  // --- touchdesigner --------------------------------------------------------
  //
  // Every mutation re-declares. The announced `switch_scene` schema carries the cached
  // scene list as an enum and the tool specs name the projects, so a change here is a
  // change to what this machine advertises — and Amber refuses anything a device did not
  // announce, which is what makes an edit take effect rather than merely persist.

  // Bound once here: `declareSelf` takes the bridge because `index.ts` owns a nullable
  // module-scoped one while this function receives a non-null parameter.
  const redeclare = (): void => declareSelf(bridge)

  ipcMain.handle(IPC.TOUCHDESIGNER_CONFIG, (): TdConfig => getTdConfig())

  ipcMain.handle(IPC.TOUCHDESIGNER_SET_CONFIG, (_e, patch: Partial<TdConfig>): TdConfig => {
    const { config, scenesCleared } = updateTdSettings(patch)
    if (scenesCleared) redeclare()
    return config
  })

  ipcMain.handle(IPC.TOUCHDESIGNER_ADD_PROJECT, (_e, input: { name: string; path: string }) => {
    const result = addProject(input)
    if ('project' in result) redeclare()
    return result
  })

  ipcMain.handle(IPC.TOUCHDESIGNER_UPDATE_PROJECT, (_e, id: string, patch: { name?: string; path?: string }) => {
    const result = updateProject(id, patch)
    if ('project' in result) redeclare()
    return result
  })

  ipcMain.handle(IPC.TOUCHDESIGNER_REMOVE_PROJECT, (_e, id: string): TdProject[] => {
    const projects = removeProject(id)
    redeclare()
    return projects
  })

  // Deliberately **not** routed through `ExtensionRegistry`, so it needs no grant.
  //
  // This is a local diagnostic someone pressed a button for on their own machine, not
  // something Amber asked for. Making you grant a permission before you can find out
  // whether your own port is open would put the consent screen in front of the thing
  // that makes consent informed. It reads and writes only this machine's own cache.
  ipcMain.handle(IPC.TOUCHDESIGNER_PROBE, async (): Promise<TdProbeResult> => {
    const { bridgePort } = getTdConfig()
    const status = await sendCommand(bridgePort, 'status', {}, 4000)
    const outcome = await refreshScenes(4000)
    if (outcome.changed) redeclare()

    if (!status.ok && !outcome.ok) {
      return { ok: false, message: status.error, scenes: outcome.scenes }
    }
    const currentScene = status.ok && typeof status.result.current_scene === 'string'
      ? status.result.current_scene
      : undefined
    const where = currentScene ? ` It reports "${currentScene}" showing now.` : ''
    const found = outcome.ok
      ? ` ${outcome.scenes.length} scene(s): ${outcome.scenes.join(', ') || 'none'}.`
      : ' It did not report a scene list.'
    return {
      ok: true,
      message: `TouchDesigner answered on 127.0.0.1:${bridgePort}.${where}${found}`,
      scenes: outcome.scenes,
      ...(currentScene ? { currentScene } : {}),
    }
  })

  ipcMain.handle(IPC.EXTENSIONS_LIST, () => extensionRegistry.describe())

  ipcMain.handle(IPC.EXTENSIONS_SET_GRANT, (_e, key: string, granted: boolean) => {
    setGrant(key, granted)
    const summaries = extensionRegistry.describe()
    emit({ kind: 'extensions', summaries })
    // A grant changes what this machine can do, so both declarations are stale. Amber
    // refuses anything a device didn't announce, which is what makes revoking here
    // enforce on her side too rather than only hiding a button.
    declareSelf(bridge)
    return summaries
  })

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

  ipcMain.handle(IPC.BLOOM_CONNECTION_KINDS, () => bloomApi.connectionKinds(emit))
  ipcMain.handle(IPC.BLOOM_CONNECTIONS, (_e, filters?: Record<string, string>) =>
    bloomApi.listConnections(emit, filters ?? {}),
  )
  ipcMain.handle(IPC.BLOOM_CONNECTION_CREATE, (_e, draft: Record<string, unknown>) =>
    bloomApi.createConnection(emit, draft),
  )
  ipcMain.handle(IPC.BLOOM_CONNECTION_UPDATE, (_e, id: string, patch: Record<string, unknown>) =>
    bloomApi.updateConnection(emit, id, patch),
  )
  ipcMain.handle(IPC.BLOOM_CONNECTION_DELETE, (_e, id: string, force?: boolean) =>
    bloomApi.deleteConnection(emit, id, force === true),
  )
  ipcMain.handle(
    IPC.BLOOM_CONNECTION_SECRET,
    (_e, id: string, body: ConnectionSecretInput) =>
      bloomApi.setConnectionSecret(emit, id, body),
  )
  ipcMain.handle(IPC.BLOOM_CONNECTION_REVOKE, (_e, id: string) =>
    bloomApi.revokeConnection(emit, id),
  )
  ipcMain.handle(IPC.BLOOM_CONNECTION_TEST, (_e, id: string) => bloomApi.testConnection(emit, id))

  ipcMain.handle(IPC.BLOOM_AGENT_CONNECTIONS, (_e, agentId: string) =>
    bloomApi.agentConnections(emit, agentId),
  )
  ipcMain.handle(IPC.BLOOM_CONNECTION_ATTACH, (_e, agentId: string, connectionId: string) =>
    bloomApi.attachConnection(emit, agentId, connectionId),
  )
  ipcMain.handle(IPC.BLOOM_CONNECTION_DETACH, (_e, agentId: string, connectionId: string) =>
    bloomApi.detachConnection(emit, agentId, connectionId),
  )
  /** Opens the authorize URL in the *system* browser — never an embedded window. */
  ipcMain.handle(IPC.BLOOM_OAUTH_START, (_e, connectionId: string, scopes?: string[]) =>
    bloomApi.startOAuth(emit, connectionId, scopes),
  )

  ipcMain.handle(IPC.BLOOM_USAGE, (_e, since?: string) => bloomApi.usage(emit, since))

  /**
   * A deep link that landed before the renderer was listening.
   *
   * `emit` is documented as safe-to-drop, and normally that is fine — but a dropped
   * OAuth handoff strands the user on "waiting for authorization" forever, so this
   * one is buffered and pulled on mount instead.
   */
  ipcMain.handle(IPC.BLOOM_OAUTH_PENDING, () => takePendingDeepLink())

  // --- the builder ----------------------------------------------------------
  //
  // No watch handler: a build is a run, so BLOOM_WATCH_RUN already covers it.

  ipcMain.handle(IPC.BLOOM_BUILD, (_e, brief: string) => bloomApi.startBuild(emit, brief))
  ipcMain.handle(
    IPC.BLOOM_BUILDS,
    (_e, params?: { limit?: number; offset?: number; status?: string }) =>
      bloomApi.listBuilds(emit, params),
  )
  ipcMain.handle(IPC.BLOOM_BUILD_GET, (_e, buildId: string) => bloomApi.getBuild(emit, buildId))
  ipcMain.handle(IPC.BLOOM_BUILD_STEP_DONE, (_e, buildId: string, index: number) =>
    bloomApi.markStepDone(emit, buildId, index),
  )
  ipcMain.handle(IPC.BLOOM_BUILD_DELETE, (_e, buildId: string) =>
    bloomApi.deleteBuild(emit, buildId),
  )
  ipcMain.handle(IPC.BLOOM_KEYWORDS, () => bloomApi.listKeywords(emit))

  // --- audit ----------------------------------------------------------------

  ipcMain.handle(IPC.AUDIT_LIST, () => listAudit())
  ipcMain.handle(IPC.AUDIT_CLEAR, () => {
    clearAudit()
    return []
  })
}
