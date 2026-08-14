/**
 * Builds the remote command that installs a public key. Pure string work, no
 * imports — which is what lets it be exercised against a real shell in
 * `scripts/verify-install-command.mjs` without dragging Electron along.
 *
 * Everything runs on one line and nothing reads stdin. The previous version piped
 * the key through a heredoc into `cat`, during an install that hung with no output.
 * That form turns out to work correctly under a POSIX shell (the verify script
 * checks), so it was probably not the culprit — but a command whose success depends
 * on the remote shell terminating a heredoc at end-of-string, reading from a channel
 * whose stdin was never closed, is a bad thing to have on the critical path either
 * way. `printf` takes the key as an argument, so there is nothing to block on.
 *
 * The permission steps are not decoration: sshd silently ignores `authorized_keys`
 * when `~/.ssh` is group-writable, which presents as "the key didn't work" with
 * nothing useful in any log.
 */

/** Echoed on success, so the caller has positive proof rather than just exit 0. */
export const INSTALL_OK_MARKER = 'APERTURE_INSTALL_OK'

/** Wrap a string as a single-quoted shell literal, escaping any embedded quotes. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildInstallCommand(publicKey: string): string {
  const key = shellQuote(publicKey.trim())
  return [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    'touch ~/.ssh/authorized_keys',
    'chmod 600 ~/.ssh/authorized_keys',
    // The `{ ...; }` group keeps this check from colliding with the `&&` chain.
    // Without it, shell precedence reads `a && b || c` as `(a && b) || c`, so the
    // append would fire whenever any earlier step failed.
    `{ grep -qxF ${key} ~/.ssh/authorized_keys || printf '%s\\n' ${key} >> ~/.ssh/authorized_keys; }`,
    `echo ${INSTALL_OK_MARKER}`,
  ].join(' && ')
}
