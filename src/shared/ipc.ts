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
  /**
   * Say what a model keyword means. Separate from SETTINGS_SET because it is not a
   * setting of *this machine* — Amber persists it and shares it with every app
   * through the sync store. See `main/amber/model.ts`.
   */
  AMBER_REMAP_MODEL: 'amber:remap-model',
  /** OpenRouter's public model list, to suggest ids for the field above. */
  AMBER_MODEL_CATALOGUE: 'amber:model-catalogue',

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

  /** What kinds and providers this Bloom offers, so a picker is built from the wire. */
  BLOOM_CONNECTION_KINDS: 'bloom:connection-kinds',
  /** The global library. Not scoped to an agent — that is the point of it. */
  BLOOM_CONNECTIONS: 'bloom:connections',
  BLOOM_CONNECTION_CREATE: 'bloom:connection-create',
  BLOOM_CONNECTION_UPDATE: 'bloom:connection-update',
  BLOOM_CONNECTION_DELETE: 'bloom:connection-delete',
  BLOOM_CONNECTION_SECRET: 'bloom:connection-secret',
  BLOOM_CONNECTION_REVOKE: 'bloom:connection-revoke',
  BLOOM_CONNECTION_TEST: 'bloom:connection-test',
  /** What one agent has attached, and attaching or detaching it. */
  BLOOM_AGENT_CONNECTIONS: 'bloom:agent-connections',
  BLOOM_CONNECTION_ATTACH: 'bloom:connection-attach',
  BLOOM_CONNECTION_DETACH: 'bloom:connection-detach',
  BLOOM_OAUTH_START: 'bloom:oauth-start',

  BLOOM_USAGE: 'bloom:usage',
  /** Pull a deep link that landed before the renderer was listening. */
  BLOOM_OAUTH_PENDING: 'bloom:oauth-pending',

  /**
   * The builder: describe an agent, and Bloom writes it.
   *
   * There is no `bloom:build-watch` here on purpose — a build *is* a run, so
   * `BLOOM_WATCH_RUN` and the existing `bloom-run` event stream carry its trace
   * with nothing added.
   */
  BLOOM_BUILD: 'bloom:build',
  BLOOM_BUILDS: 'bloom:builds',
  BLOOM_BUILD_GET: 'bloom:build-get',
  BLOOM_BUILD_STEP_DONE: 'bloom:build-step-done',
  BLOOM_BUILD_DELETE: 'bloom:build-delete',
  /** What a model keyword resolves to on this Bloom. Read-only; Amber owns editing. */
  BLOOM_KEYWORDS: 'bloom:keywords',
} as const
