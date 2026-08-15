/** IPC channel names, in one place so they stay greppable across the boundary. */
export const IPC = {
  /** main -> renderer: the single ApertureEvent stream. */
  EVENT: 'aperture:event',
  /** main -> renderer: a tool call is waiting on a human. */
  APPROVAL_REQUEST: 'aperture:approval-request',
  /** main -> renderer: bytes from an interactive SSH shell. */
  SHELL_DATA: 'aperture:shell-data',

  AMBER_CONNECT: 'amber:connect',
  AMBER_DISCONNECT: 'amber:disconnect',
  AMBER_STATUS: 'amber:status',
  AMBER_SEND_TEXT: 'amber:send-text',
  AMBER_SEND_AUDIO: 'amber:send-audio',
  AMBER_INTERRUPT: 'amber:interrupt',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  SSH_LIST: 'ssh:list',
  SSH_ADD: 'ssh:add',
  SSH_UPDATE: 'ssh:update',
  SSH_REMOVE: 'ssh:remove',
  SSH_TEST: 'ssh:test',
  SSH_GENERATE_KEY: 'ssh:generate-key',
  SSH_INSTALL_KEY: 'ssh:install-key',
  SSH_LIST_KEYS: 'ssh:list-keys',
  SSH_DELETE_KEY: 'ssh:delete-key',
  SSH_OPEN_SHELL: 'ssh:open-shell',
  SSH_WRITE_SHELL: 'ssh:write-shell',
  SSH_RESIZE_SHELL: 'ssh:resize-shell',
  SSH_CLOSE_SHELL: 'ssh:close-shell',
  /** renderer -> main: xterm finished parsing N characters. Drives backpressure. */
  SSH_ACK_SHELL: 'ssh:ack-shell',
  /** Completion probes, on a shell's already-authenticated connection. */
  SSH_EXEC_ON_SHELL: 'ssh:exec-on-shell',

  INFRA_STATUS: 'infra:status',
  INFRA_RUN: 'infra:run',
  INFRA_CANCEL: 'infra:cancel',
  /**
   * Newest published version per repo. Separate from INFRA_STATUS on purpose: that is
   * one SSH round trip and this is a GitHub call, so a slow or rate-limited GitHub
   * must never make a reachable box look unreachable.
   */
  INFRA_RELEASES: 'infra:releases',

  /**
   * The credential vault.
   *
   * There is deliberately **no `keys:read`**. Nothing in the renderer can ask for a
   * plaintext credential; a value is decrypted in main, inside `runAction`, and goes
   * straight into the SSH heredoc. That absence is the design — please do not add one
   * helpfully. The renderer passes `uid`s and never sees what they unlock.
   */
  KEYS_LIST: 'keys:list',
  KEYS_SAVE: 'keys:save',
  KEYS_UPDATE: 'keys:update',
  KEYS_DELETE: 'keys:delete',

  BRIDGE_APPROVE: 'bridge:approve',
  BRIDGE_DENY: 'bridge:deny',
  BRIDGE_PENDING: 'bridge:pending',

  AUDIT_LIST: 'audit:list',
  AUDIT_CLEAR: 'audit:clear',

  /** The link record, answered from disk — synchronous enough to gate the sidebar. */
  BLOOM_LINK: 'bloom:link',
  /** Read Bloom off a box over SSH. Needs the sudo password the Servers tab holds. */
  BLOOM_DISCOVER: 'bloom:discover',
  /** Point at a Bloom by hand — a local instance, or one no SSH server reaches. */
  BLOOM_LINK_MANUAL: 'bloom:link-manual',
  /** Forget it. The only path back to `unlinked`. */
  BLOOM_UNLINK: 'bloom:unlink',
  /** Re-check reachability and the token now, rather than waiting for a call. */
  BLOOM_VERIFY: 'bloom:verify',

  BLOOM_AGENTS: 'bloom:agents',
  BLOOM_AGENT_CREATE: 'bloom:agent-create',
  BLOOM_AGENT_UPDATE: 'bloom:agent-update',
  BLOOM_AGENT_DELETE: 'bloom:agent-delete',

  /** Starts the run *and* opens its stream — see `main/bloom/run-stream.ts`. */
  BLOOM_TEST_RUN: 'bloom:test-run',
  BLOOM_CANCEL_RUN: 'bloom:cancel-run',
  /** Attach to a run already in flight, e.g. after reopening the tab. */
  BLOOM_WATCH_RUN: 'bloom:watch-run',
  BLOOM_RUNS: 'bloom:runs',
  BLOOM_AGENT_RUNS: 'bloom:agent-runs',
  BLOOM_TRACE: 'bloom:trace',

  BLOOM_PROVIDERS: 'bloom:providers',
  BLOOM_CONNECTIONS: 'bloom:connections',
  BLOOM_OAUTH_START: 'bloom:oauth-start',
  BLOOM_OAUTH_DISCONNECT: 'bloom:oauth-disconnect',

  BLOOM_USAGE: 'bloom:usage',
  /** Pull a deep link that landed before the renderer was listening. */
  BLOOM_OAUTH_PENDING: 'bloom:oauth-pending',
} as const
