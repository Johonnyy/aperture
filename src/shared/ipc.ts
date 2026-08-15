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
} as const
