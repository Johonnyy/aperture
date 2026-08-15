import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import type { BloomLink } from '../shared/bloom'
import { IPC } from '../shared/ipc'
import type {
  ApertureEvent,
  AuditEntry,
  ConnectionStatus,
  ExecResult,
  InfraStatus,
  KeyRecord,
  PendingApproval,
  ServerConfig,
  Settings,
} from '../shared/types'

/** One frame of output from an interactive shell, or notice that it closed. */
export interface ShellMessage {
  id: string
  data?: string
  closed?: true
}

/**
 * The entire privileged surface the renderer can reach.
 *
 * Everything is a narrow, typed function — no `ipcRenderer` and no Node primitives
 * are exposed. Subscriptions return an unsubscribe function so React effects can
 * clean up without needing a channel name.
 */
const THEME_FLAG = '--aperture-theme='
const THEME_ARG =
  process.argv.find((arg) => arg.startsWith(THEME_FLAG))?.slice(THEME_FLAG.length) ?? ''

/** Whether a Bloom link exists, as main knew it when the window was created. */
const BLOOM_FLAG = '--aperture-bloom='
const BLOOM_AT_LAUNCH =
  process.argv.find((arg) => arg.startsWith(BLOOM_FLAG))?.slice(BLOOM_FLAG.length) === '1'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  amber: {
    connect: (): Promise<ConnectionStatus> => ipcRenderer.invoke(IPC.AMBER_CONNECT),
    disconnect: (): Promise<ConnectionStatus> => ipcRenderer.invoke(IPC.AMBER_DISCONNECT),
    status: (): Promise<ConnectionStatus> => ipcRenderer.invoke(IPC.AMBER_STATUS),
    sendText: (text: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.AMBER_SEND_TEXT, text),
    sendAudio: (buffer: ArrayBuffer): Promise<boolean> =>
      ipcRenderer.invoke(IPC.AMBER_SEND_AUDIO, buffer),
    interrupt: (): Promise<boolean> => ipcRenderer.invoke(IPC.AMBER_INTERRUPT),
    onEvent: (cb: (event: ApertureEvent) => void): (() => void) =>
      subscribe<ApertureEvent>(IPC.EVENT, cb),
  },

  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  },

  theme: {
    /**
     * The theme to paint before anything is fetched, handed over as a launch
     * argument by `main/window.ts` (see `additionalArguments`).
     *
     * Everything else here is async, which is exactly what the first paint can't
     * afford: an `await` means one frame of the wrong theme. Reading it off argv is
     * synchronous, cannot deadlock the way `sendSync` can, and needs no channel —
     * and because main is the one supplying it, the window background and the
     * renderer are guaranteed to agree.
     */
    initial: THEME_ARG,
  },

  ssh: {
    listServers: (): Promise<ServerConfig[]> => ipcRenderer.invoke(IPC.SSH_LIST),
    addServer: (input: Omit<ServerConfig, 'id'>): Promise<ServerConfig> =>
      ipcRenderer.invoke(IPC.SSH_ADD, input),
    updateServer: (id: string, patch: Partial<ServerConfig>): Promise<ServerConfig> =>
      ipcRenderer.invoke(IPC.SSH_UPDATE, id, patch),
    removeServer: (id: string): Promise<ServerConfig[]> =>
      ipcRenderer.invoke(IPC.SSH_REMOVE, id),
    testConnection: (
      id: string,
    ): Promise<{ ok: boolean; output?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.SSH_TEST, id),

    listKeys: (): Promise<{ keys: KeyRecord[]; available: boolean }> =>
      ipcRenderer.invoke(IPC.SSH_LIST_KEYS),
    generateKey: (label: string): Promise<KeyRecord> =>
      ipcRenderer.invoke(IPC.SSH_GENERATE_KEY, label),
    deleteKey: (id: string): Promise<KeyRecord[]> =>
      ipcRenderer.invoke(IPC.SSH_DELETE_KEY, id),
    /**
     * Password is used for this one call only and never stored. Progress is pushed
     * back as `op` events tagged with `opId`, so the caller can render a live log.
     */
    installKey: (
      opId: string,
      serverId: string,
      keyId: string,
      password: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SSH_INSTALL_KEY, opId, serverId, keyId, password),

    openShell: (serverId: string): Promise<{ ok: boolean; shellId?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.SSH_OPEN_SHELL, serverId),
    writeShell: (id: string, data: string): void => {
      ipcRenderer.send(IPC.SSH_WRITE_SHELL, id, data)
    },
    resizeShell: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send(IPC.SSH_RESIZE_SHELL, id, cols, rows)
    },
    closeShell: (id: string): void => {
      ipcRenderer.send(IPC.SSH_CLOSE_SHELL, id)
    },
    /**
     * Report that xterm finished parsing `chars` characters. Main pauses the ssh2
     * stream when too much is outstanding, which is what keeps a runaway command
     * from starving the renderer of the frame it needs to send Ctrl-C.
     */
    ackShell: (id: string, chars: number): void => {
      ipcRenderer.send(IPC.SSH_ACK_SHELL, id, chars)
    },
    /** Completion probe on a shell's existing connection. */
    execOnShell: (id: string, command: string): Promise<ExecResult> =>
      ipcRenderer.invoke(IPC.SSH_EXEC_ON_SHELL, id, command),
    onShellData: (cb: (message: ShellMessage) => void): (() => void) =>
      subscribe<ShellMessage>(IPC.SHELL_DATA, cb),
  },

  infra: {
    /** One round trip: sudo reachability, whether amber-infra is here, and its report. */
    status: (
      serverId: string,
      sudoPassword?: string,
    ): Promise<{
      ok: boolean
      status?: InfraStatus
      passwordlessSudo?: boolean
      error?: string
    }> => ipcRenderer.invoke(IPC.INFRA_STATUS, serverId, sudoPassword),
    /**
     * Run one catalogued action. Progress arrives as `op` events tagged with `opId`,
     * so it renders in the same `OperationLog` the key install uses.
     *
     * `sudoPassword` is used for this one call and never stored. `dryRun` runs the
     * script's own rehearsal — which is the whole reason a GUI over root shell
     * scripts is defensible: the GUI composes flags, the script proves them.
     */
    run: (
      opId: string,
      serverId: string,
      actionId: string,
      params: Record<string, string>,
      opts: { dryRun?: boolean; sudoPassword?: string },
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.INFRA_RUN, opId, serverId, actionId, params, opts),
    cancel: (opId: string): Promise<boolean> => ipcRenderer.invoke(IPC.INFRA_CANCEL, opId),
  },

  bloom: {
    /**
     * Whether the sidebar row exists at all, seeded from argv.
     *
     * Read the same way as `theme.initial`, and for the same reason: `link()` is a
     * round trip, so gating the row on it pops the row in a frame after paint and
     * reflows the nav. Argv carries the one boolean that decides *presence*; the
     * five-valued state settles asynchronously and only changes the row's dot.
     */
    linkedAtLaunch: BLOOM_AT_LAUNCH,
    /** The stored record. Answered from disk, so it is safe to call on mount. */
    link: (): Promise<BloomLink> => ipcRenderer.invoke(IPC.BLOOM_LINK),
    /**
     * Find Bloom on a box and read its admin key.
     *
     * `sudoPassword` is used for this one call and never stored — the key file is
     * root-only by design. The key itself never comes back across this bridge.
     */
    discover: (
      serverId: string,
      domain: string,
      sudoPassword?: string,
    ): Promise<{ ok: boolean; link?: BloomLink; error?: string; needsSudo?: boolean }> =>
      ipcRenderer.invoke(IPC.BLOOM_DISCOVER, serverId, domain, sudoPassword),
    /** Point at a Bloom by hand — a local instance, or one no SSH server reaches. */
    linkManually: (
      baseUrl: string,
      token: string,
    ): Promise<{ ok: boolean; link?: BloomLink; error?: string }> =>
      ipcRenderer.invoke(IPC.BLOOM_LINK_MANUAL, baseUrl, token),
    unlink: (): Promise<BloomLink> => ipcRenderer.invoke(IPC.BLOOM_UNLINK),
    /** Re-check reachability and the key now. Cannot unlink, only demote. */
    verify: (): Promise<BloomLink> => ipcRenderer.invoke(IPC.BLOOM_VERIFY),
  },

  bridge: {
    approve: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.BRIDGE_APPROVE, id),
    deny: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.BRIDGE_DENY, id),
    pending: (): Promise<PendingApproval[]> => ipcRenderer.invoke(IPC.BRIDGE_PENDING),
  },

  audit: {
    list: (): Promise<AuditEntry[]> => ipcRenderer.invoke(IPC.AUDIT_LIST),
    clear: (): Promise<AuditEntry[]> => ipcRenderer.invoke(IPC.AUDIT_CLEAR),
  },
}

export type ApertureApi = typeof api

contextBridge.exposeInMainWorld('aperture', api)
