/**
 * Everything the Servers tab can do to a box, as commands.
 *
 * The catalogue is the whole design. Aperture composes flags for scripts that already
 * exist in `amber-infra` and never reimplements what one of them decides — the same
 * rule Amber's own MCP server follows by dispatching through her tool registry rather
 * than growing a parallel path. A GUI that reinvented "what installing an app means"
 * would drift from the script within a week, and the drift would only show up on a
 * server at 3am.
 *
 * Two properties every entry is held to:
 *
 * * **Rehearsable where the underlying tool allows it.** `rehearse` is a form that
 *   changes nothing. `install.sh`, `rollback.sh` and `update-amber.sh` all take
 *   `--dry-run`; for the few actions with no script behind them, `rehearse` reads back
 *   the current value instead. What makes a GUI over root shell scripts defensible is
 *   that you can always see the command's own account of what it is about to do.
 * * **No secret in `argv`.** A value the user typed goes in through a heredoc on
 *   stdin, never as an argument, so it does not appear in `ps` on the remote box.
 */

export const DEFAULT_REPO = 'https://github.com/Johonnyy/amber-infra.git'
export const INFRA_ROOT = '/opt/amber-infra'
export const INFRA_ETC = '/etc/amber-infra'
export const SECRETS = `${INFRA_ETC}/secrets.yaml`

export type Params = Record<string, string>

export interface ActionDef {
  label: string
  /** Prefixed with `sudo -S -p ''` and given the password on stdin. */
  needsSudo: boolean
  /** Present when there is a form of this action that changes nothing. */
  rehearse?: (p: Params) => string
  build: (p: Params) => string
  /** Overrides the default 30-minute ceiling. `install.sh` runs apt and waits on ACME. */
  timeoutMs?: number
}

/** Single-quote for `sh`. Every interpolated value goes through this. */
export function q(value: string): string {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`
}

/**
 * Read a literal value into a shell variable without it ever being an argument.
 *
 * A quoted heredoc (`<<'TAG'`) is not expanded by the shell, so no character in the
 * body is special, and the body is not in `argv` — `ps` on the remote box shows the
 * `read` and nothing else. `-r` stops backslashes being eaten.
 *
 * `read` rather than `cat`, because `$(cat …)` strips trailing newlines and would
 * silently alter a value that legitimately ends in one.
 */
function heredoc(name: string, value: string): string {
  const tag = `${name}_EOF`
  // A body line equal to the delimiter would end the heredoc early. Rejected rather
  // than silently truncating the value.
  if (value.split('\n').includes(tag)) throw new Error('value contains the heredoc delimiter')
  return [
    // `-d ''` reads to a NUL that never comes, so it consumes the whole body and
    // returns non-zero at EOF — hence `|| true`.
    `IFS= read -r -d '' ${name} <<'${tag}' || true`,
    value,
    tag,
    // The heredoc always ends with a newline the value did not have. Strip exactly
    // one, so a value that genuinely ends in a newline still round-trips.
    `${name}="\${${name}%$'\\n'}"`,
  ].join('\n')
}

/**
 * The yq path a `setVar`/`unsetVar` call refers to.
 *
 * Built here rather than in the renderer so yq's syntax lives in exactly one place —
 * the caller says *what* it means (`{app, key}` or `{setting}`) and never has to know
 * how a path is spelled.
 *
 * The `.a."b"` form is the one `install/lib/secrets.sh` already uses, which is the
 * reason to prefer it over the equivalent bracket form: it is the spelling this
 * ecosystem has proven against its own yq.
 */
function pathOf(p: Params): string {
  if (p.setting) return `.infra.${JSON.stringify(p.setting)}`
  if (p.root) return `.${p.root}`
  // An app's own fields — domain, upstream, image, server — as opposed to its env.
  // These are the ones nothing derives and everything depends on, so they need to be
  // editable from the same place you read them.
  if (p.app && p.field) return `.apps.${JSON.stringify(p.app)}.${JSON.stringify(p.field)}`
  if (p.app && p.key) return `.apps.${JSON.stringify(p.app)}.env.${JSON.stringify(p.key)}`
  throw new Error('setVar needs {setting}, {root}, {app, field} or {app, key}')
}

/**
 * Refuse to "rename" anything that has actually been deployed.
 *
 * A deployed name is not a label, it is an identifier in six places at once. Editing
 * secrets.yaml alone would leave a container, a directory, a TLS site, a registry
 * entry and a set of backups all answering to the old name, and the config claiming
 * otherwise — the kind of split-brain that only shows up when you need a restore.
 */
const RENAME_GUARD = (p: Params): string =>
  [
    `if docker inspect ${q(p.app)} >/dev/null 2>&1 || [ -d ${q(`${INFRA_ETC}/${p.app}`)} ]; then`,
    `  echo "error: ${p.app} is deployed on this box, and there is no rename for that.";`,
    `  echo " !  The name is in the container, ${INFRA_ETC}/${p.app}, /etc/caddy/snippets/${p.app}.caddy, the sync-store registry and the backup targets.";`,
    `  echo " !  Remove it first (Manage > Remove app, which keeps its volumes), then declare and install the new name.";`,
    `  exit 1;`,
    `fi`,
  ].join('\n')

/** The compose file for an app, resolved on the remote side rather than guessed. */
const composeOf = (app: string): string =>
  `$(find ${q(`${INFRA_ETC}/${app}`)} -maxdepth 1 -name 'docker-compose*.yml' | sort | head -n1)`

const script = (path: string): string => q(`${INFRA_ROOT}/${path}`)

/** Optional flag, omitted entirely when the field was left blank. */
const opt = (flag: string, value?: string): string => (value ? ` ${flag} ${q(value)}` : '')

/**
 * The three tools that make a box *manageable*, installed by the bootstrap.
 *
 * `status.sh` needs `jq` and `yq` and the clone needs `git`, so without these the
 * Servers tab can see nothing and the first thing it would report is its own
 * blindness. `install.sh` installs the same three later for its own reasons; doing
 * it here means the management view works from the moment the checkout lands rather
 * than only after the first app is deployed.
 *
 * yq comes from upstream rather than apt on purpose, and the reason is copied from
 * `install.sh`: the distro package of that name is a different, incompatible tool on
 * older Ubuntu, and `secrets.sh` depends on v4 semantics.
 */
const ENSURE_TOOLS = [
  'MISSING=',
  'command -v git >/dev/null || MISSING="$MISSING git"',
  'command -v jq  >/dev/null || MISSING="$MISSING jq"',
  'command -v curl >/dev/null || MISSING="$MISSING curl"',
  'if [ -n "$MISSING" ]; then',
  '  echo "==> installing:$MISSING"',
  // shellcheck-style word splitting is wanted here: $MISSING is a package list.
  '  apt-get update -qq && apt-get install -y -qq $MISSING || { echo "error: could not install:$MISSING"; exit 127; }',
  'fi',
  'if ! command -v yq >/dev/null; then',
  '  echo "==> installing yq (v4) from upstream"',
  '  curl -fsSL https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -o /usr/local/bin/yq \\',
  '    && chmod +x /usr/local/bin/yq || { echo "error: could not install yq"; exit 127; }',
  'fi',
  'echo " ok  git, jq, curl and yq are present"',
].join('\n')

/**
 * Refuse a fast-forward over a hand edit — but only over an actual edit.
 *
 * `git pull --ff-only` already refuses, correctly, and reports it as a wall of
 * porcelain that reads like a malfunction rather than a guard. A modified file under
 * `/opt/amber-infra` is somebody's 2am fix and must not be silently discarded, so
 * this names the files and both ways out, and stops.
 *
 * The distinction between a *content* change and a *mode* change is the whole point.
 * Git records the executable bit, so a single `chmod +x` across the tree marks every
 * script modified and then this guard blocks every future update — a loop an earlier
 * version of this file created and could not get out of. Mode-only drift is noise we
 * caused; it is repaired in place and said out loud. Anything with real content, or
 * anything staged or untracked, still stops.
 */
const DIRTY_CHECK = [
  `  CONTENT="$(git -C ${q(INFRA_ROOT)} diff --numstat | awk '$1 != 0 || $2 != 0 { print $3 }')"`,
  `  UNTRACKED="$(git -C ${q(INFRA_ROOT)} ls-files --others --exclude-standard)"`,
  `  STAGED="$(git -C ${q(INFRA_ROOT)} diff --cached --name-only)"`,
  `  if [ -n "$CONTENT$UNTRACKED$STAGED" ]; then`,
  `    echo "error: ${INFRA_ROOT} has local modifications — updating would overwrite them.";`,
  `    git -C ${q(INFRA_ROOT)} status --porcelain | sed 's/^/ !  /';`,
  `    echo " !  Keep them:    Stash local changes and update (below), or  git -C ${INFRA_ROOT} stash";`,
  `    echo " !  Discard them: git -C ${INFRA_ROOT} checkout -- .";`,
  `    exit 1;`,
  `  elif [ -n "$(git -C ${q(INFRA_ROOT)} status --porcelain)" ]; then`,
  `    echo " !  only file modes differ — an earlier version of this bootstrap ran chmod +x on tracked files, which git records as a change to every one of them. Restoring the committed modes.";`,
  `    git -C ${q(INFRA_ROOT)} checkout -- .;`,
  `  fi`,
].join('\n')

/**
 * The admin bearer for the sync-store, read on the remote box.
 *
 * Never round-tripped through Aperture: the token is already on the server, and
 * fetching it here just to send it back would put a credential in this process's
 * memory and in the IPC channel for no gain.
 */
const ADMIN_TOKEN = `$(yq -r '.sync_store.keys[] | select(.name == "amber") | .token' ${q(SECRETS)} | head -n1)`
const SYNC_BASE = `$(yq -r '.sync_store.url' ${q(SECRETS)})`

export const ACTIONS: Record<string, ActionDef> = {
  // --- getting amber-infra onto the box ------------------------------------

  bootstrap: {
    label: 'Install amber-infra',
    needsSudo: true,
    // `git fetch --dry-run` is genuinely read-only and reports exactly what a pull
    // would bring, which is the useful rehearsal for "update the checkout".
    rehearse: (p) =>
      [
        // The rehearsal reports what is missing; it does not install it.
        'for t in git jq curl yq; do',
        '  command -v "$t" >/dev/null && echo " ok  $t is present" || echo " !  $t is missing and would be installed";',
        'done',
        `if [ -d ${q(INFRA_ROOT)}/.git ]; then`,
        `  git -C ${q(INFRA_ROOT)} fetch -v 2>&1 | sed 's/^/    /';`,
        `  git -C ${q(INFRA_ROOT)} status -sb | sed 's/^/    /';`,
        DIRTY_CHECK,
        `else echo " ok  would clone ${p.repo || DEFAULT_REPO} into ${INFRA_ROOT}"; fi`,
      ].join('\n'),
    build: (p) =>
      [
        ENSURE_TOOLS,
        `if [ -d ${q(INFRA_ROOT)}/.git ]; then`,
        DIRTY_CHECK,
        `fi`,
        'set -e',
        `if [ -d ${q(INFRA_ROOT)}/.git ]; then git -C ${q(INFRA_ROOT)} pull --ff-only;`,
        `else git clone ${q(p.repo || DEFAULT_REPO)} ${q(INFRA_ROOT)}; fi`,
        // No chmod. amber-infra commits its scripts 644 and every call site here
        // invokes them as `bash <script>`, so setting +x buys nothing — and git
        // records the mode, so doing it once marks all fifteen scripts modified and
        // wedges every subsequent --ff-only pull.
        // Advisory, not fatal: status.sh needs jq, and jq is one of the packages
        // install.sh installs. A checkout that landed correctly should not be
        // reported as a failed bootstrap because the next step has not run yet.
        `if bash ${q(`${INFRA_ROOT}/deploy/status.sh`)} --json >/dev/null 2>&1; then`,
        `  echo " ok  amber-infra is in place and status.sh works";`,
        `else`,
        `  echo " !  amber-infra is in place, but status.sh cannot run yet — it needs jq and yq, which install.sh installs. Add your first app next.";`,
        `fi`,
      ].join('\n'),
    timeoutMs: 5 * 60_000,
  },

  /**
   * The way past a hand edit that does not throw it away.
   *
   * `stash` rather than `checkout --`: whatever is in there was written by someone
   * solving a problem on a live box, and a GUI button that destroys it is not a
   * button worth having. The rehearsal prints the full diff, so what is about to be
   * set aside is on screen before anything moves.
   */
  stashAndUpdate: {
    label: 'Stash local changes and update',
    needsSudo: true,
    rehearse: () =>
      `git -C ${q(INFRA_ROOT)} status --porcelain | sed 's/^/ !  /'; ` +
      `echo "==> the diff that would be stashed"; ` +
      `git -C ${q(INFRA_ROOT)} diff --stat; git -C ${q(INFRA_ROOT)} diff`,
    build: () =>
      [
        'set -e',
        // -u so an untracked file is carried along too, and a message that says
        // where it came from when you find it three months later.
        `git -C ${q(INFRA_ROOT)} stash push -u -m "aperture: before update" || true`,
        `git -C ${q(INFRA_ROOT)} pull --ff-only`,
        `echo " ok  updated. Your edit is safe:  git -C ${INFRA_ROOT} stash list"`,
      ].join('\n'),
    timeoutMs: 5 * 60_000,
  },

  /**
   * Build the sync-store image on the box, from the checkout.
   *
   * The escape hatch for a registry you cannot pull from — a package that is private,
   * a tag that never published, or a box with no credentials. The source is already
   * here: `sync-store/` is a real FastAPI service in this repo, not a reference to
   * one, so the image can be produced locally with no registry involved at all.
   * `preflight_image` accepts a locally-present image for exactly this reason.
   *
   * The honest cost: an image built here exists only here. It is not the artefact CI
   * produced, nothing else can pull it, and rebuilding on another box gives you a
   * different layer hash for the same tag. For one server that is fine; the moment
   * there are two, publish properly instead.
   */
  buildSyncStore: {
    label: 'Build the sync-store image here',
    needsSudo: true,
    rehearse: () =>
      [
        `IMAGE="$(yq -r '.sync_store.image' ${q(SECRETS)})"`,
        `SRC=${q(`${INFRA_ROOT}/sync-store`)}`,
        `[ -f "$SRC/Dockerfile" ] || { echo "error: no Dockerfile at $SRC — is the checkout complete?"; exit 1; }`,
        `echo " ok  would build $SRC into $IMAGE"`,
        `if docker image inspect "$IMAGE" >/dev/null 2>&1; then`,
        `  echo " !  that tag already exists locally and would be replaced";`,
        `fi`,
      ].join('\n'),
    build: () =>
      [
        'set -e',
        `IMAGE="$(yq -r '.sync_store.image' ${q(SECRETS)})"`,
        `SRC=${q(`${INFRA_ROOT}/sync-store`)}`,
        `[ -f "$SRC/Dockerfile" ] || { echo "error: no Dockerfile at $SRC"; exit 1; }`,
        `docker build -t "$IMAGE" "$SRC"`,
        `echo " ok  built $IMAGE locally — install.sh will use it without pulling"`,
      ].join('\n'),
    timeoutMs: 15 * 60_000,
  },

  // --- first-run setup ------------------------------------------------------

  /**
   * Put the starter secrets file in place.
   *
   * `install.sh` does this too and then *stops*, on the principle that a secret
   * invented at a prompt is a secret that is not in your backups. Doing it as its own
   * step means the setup screen can say "now fill these in" instead of making you
   * read a failed install to discover the same thing.
   *
   * It refuses to overwrite. There is no version of clobbering a live secrets file
   * that is worth the convenience.
   */
  writeSecrets: {
    label: 'Create the secrets file',
    needsSudo: true,
    rehearse: () =>
      `if [ -f ${q(SECRETS)} ]; then echo " !  ${SECRETS} already exists — it would not be touched";` +
      ` else echo " ok  would copy secrets.example.yaml to ${SECRETS} (mode 600, root:root)"; fi`,
    build: () =>
      [
        'set -e',
        `if [ -f ${q(SECRETS)} ]; then echo "error: ${SECRETS} already exists — refusing to overwrite it."; exit 1; fi`,
        `install -d -m 700 ${q(INFRA_ETC)}`,
        `install -m 600 -o root -g root ${q(`${INFRA_ROOT}/secrets/secrets.example.yaml`)} ${q(SECRETS)}`,
        `echo " ok  wrote ${SECRETS}"`,
      ].join('\n'),
  },

  /**
   * Fill in every value that can only be a random secret.
   *
   * Two passes, because the placeholders come in two shapes:
   *
   * 1. **`CHANGEME-openssl-rand-hex-32`** — a placeholder whose own text is the
   *    recipe. Nothing for a human to decide, only a chore to do nine times without
   *    pasting the same token into two slots by mistake.
   * 2. **A bare `CHANGEME` inside a `*_KEYS` value** — `AMBER_MCP_KEYS:
   *    "spawner:CHANGEME,Aperture:CHANGEME"`. These are bearer tokens other agents
   *    present to this app's MCP server; `agent_mcp.parse_keys` accepts any string
   *    after the colon, so they are as generatable as the first kind. They are not
   *    marked as such in the example only because the value is a compound string and
   *    a whole-value replace would destroy the `name:` labels.
   *
   * The second pass is a correctness fix, not a convenience. `secrets_render_env`
   * does not check for placeholders, so a `CHANGEME` here is rendered verbatim into
   * the app's `.env` and mounted as a live credential — a public HTTPS MCP endpoint
   * whose bearer token is the word CHANGEME.
   *
   * Replaced one occurrence at a time so every slot gets a *distinct* token, which is
   * the part that is easy to get wrong by hand. Anything left is an API key nobody
   * here can invent; those are listed, not touched.
   */
  generateSecrets: {
    label: 'Generate the random tokens',
    needsSudo: true,
    rehearse: () =>
      [
        'echo "==> would generate a distinct 32-byte token for each of these"',
        `grep -nE 'CHANGEME-openssl-rand-hex|^[[:space:]]*[A-Z_]+_KEYS:.*CHANGEME' ${q(SECRETS)} \\`,
        `  | sed 's/^/ !  /' || echo " ok  none left to generate"`,
        'echo "==> these need a value only you have, and would be left alone"',
        `grep -n CHANGEME ${q(SECRETS)} \\`,
        `  | grep -vE 'openssl-rand-hex|^[0-9]+:[[:space:]]*[A-Z_]+_KEYS:' \\`,
        `  | sed 's/^/ !  /' || echo " ok  none"`,
      ].join('\n'),
    build: () =>
      [
        'set -e',
        `[ -f ${q(SECRETS)} ] || { echo "error: no ${SECRETS} yet — create it first."; exit 1; }`,
        `cp -a ${q(SECRETS)} ${q(`${SECRETS}.bak`)}`,
        'N=0',
        // `0,/re/s//x/` replaces only the first match, so each turn of the loop mints
        // a new token rather than one token landing in every slot.
        `while grep -q 'CHANGEME-openssl-rand-hex-32' ${q(SECRETS)}; do`,
        '  V="$(openssl rand -hex 32)"',
        `  sed -i "0,/CHANGEME-openssl-rand-hex-32/s//$V/" ${q(SECRETS)}`,
        '  N=$((N + 1))',
        'done',
        // Anchored to the key name so it can only ever touch a `*_KEYS` line — an API
        // key on any other line keeps its CHANGEME and stays visibly unset.
        `while grep -qE '^[[:space:]]*[A-Z_]+_KEYS:.*CHANGEME' ${q(SECRETS)}; do`,
        '  V="$(openssl rand -hex 32)"',
        `  sed -i "0,/^\\([[:space:]]*[A-Z_]\\+_KEYS:.*\\)CHANGEME/s//\\1$V/" ${q(SECRETS)}`,
        '  N=$((N + 1))',
        'done',
        `chmod 600 ${q(SECRETS)}`,
        'echo " ok  generated $N token(s); previous file kept as secrets.yaml.bak"',
        `if grep -q CHANGEME ${q(SECRETS)}; then`,
        '  echo " !  still needs a value only you have:";',
        `  grep -n CHANGEME ${q(SECRETS)} | sed 's/^/ !  /';`,
        `else echo " ok  no placeholders left"; fi`,
        `echo " !  a generated *_MCP_KEYS token is only the ACCEPTING half. Whatever presents it — a peer agent via the sync-store, or Aperture — still needs the same value."`,
      ].join('\n'),
  },

  /**
   * Write one value into `secrets.yaml`.
   *
   * Three things this is careful about:
   *
   * * **The value never enters `argv`.** It arrives on stdin through a quoted
   *   heredoc, so `ps` on the remote box cannot show it, and the quoting means no
   *   character in it is special. The same trick as `setPeerToken`.
   * * **`yq -i` with `strenv`**, so the *value* is never parsed as YAML. A token
   *   containing `:` or `#` would otherwise rewrite the file's structure.
   * * **Only this key changes.** Regenerating the file from a template would discard
   *   comments, ordering, and anything hand-added — and `secrets.yaml` is the one
   *   file in the ecosystem that is not reproducible from anywhere else.
   *
   * It does not restart anything. `secrets.yaml` is the *source*; the running app
   * reads a rendered `.env`, and reconciling is what carries a change across.
   */
  setVar: {
    label: 'Set a value',
    needsSudo: true,
    rehearse: (p) =>
      [
        `[ -f ${q(SECRETS)} ] || { echo "error: no ${SECRETS} yet."; exit 1; }`,
        `CUR="$(yq -r ${q(`${pathOf(p)} // ""`)} ${q(SECRETS)} 2>/dev/null)"`,
        `[ "$CUR" = "null" ] && CUR=""`,
        // Report shape, never content — a rehearsal that echoed the old key back
        // would put it in the log the operator is about to copy and paste.
        `case "$CUR" in`,
        `  '') echo " !  ${pathOf(p)} is currently unset — it would be added";;`,
        `  *CHANGEME*) echo " !  ${pathOf(p)} is currently a placeholder — it would be replaced";;`,
        `  *) echo " !  ${pathOf(p)} is currently set (\${#CUR} characters) — it would be replaced";;`,
        `esac`,
        `echo " ok  would write a new value of ${(p.value ?? '').length} characters"`,
      ].join('\n'),
    build: (p) =>
      [
        'set -e',
        `[ -f ${q(SECRETS)} ] || { echo "error: no ${SECRETS} yet."; exit 1; }`,
        `cp -a ${q(SECRETS)} ${q(`${SECRETS}.bak`)}`,
        heredoc('APERTURE_VALUE', p.value ?? ''),
        `V="$APERTURE_VALUE" yq -i ${q(`${pathOf(p)} = strenv(V)`)} ${q(SECRETS)}`,
        `chmod 600 ${q(SECRETS)}`,
        `echo " ok  ${pathOf(p)} updated (previous file kept as secrets.yaml.bak)"`,
        `echo " !  the running app still has the old value — reconcile it to render the new .env and restart"`,
      ].join('\n'),
  },

  unsetVar: {
    label: 'Remove a value',
    needsSudo: true,
    rehearse: (p) =>
      `if yq -e ${q(pathOf(p))} ${q(SECRETS)} >/dev/null 2>&1; ` +
      `then echo " !  ${pathOf(p)} is set and would be removed"; ` +
      `else echo " ok  ${pathOf(p)} is not set — nothing to remove"; fi`,
    build: (p) =>
      [
        'set -e',
        `cp -a ${q(SECRETS)} ${q(`${SECRETS}.bak`)}`,
        `yq -i ${q(`del(${pathOf(p)})`)} ${q(SECRETS)}`,
        `chmod 600 ${q(SECRETS)}`,
        `echo " ok  removed ${pathOf(p)}"`,
        `echo " !  reconcile the app to drop it from the rendered .env"`,
      ].join('\n'),
  },

  /**
   * Declare a new app in `secrets.yaml`.
   *
   * This is only the *first* of two things a new app needs. The other is a
   * `<app>/docker-compose.prod.yml` committed to amber-infra — `install.sh` refuses
   * without one, deliberately, because a generic template cannot know about the
   * volume, the health check or the bind mount a given app needs. So this writes the
   * stanza and then says plainly what is still missing, rather than letting you find
   * out from a failed install.
   *
   * The MCP key is generated here because it can be: it is the bearer token peers
   * present to this app, and nothing outside the box constrains it. The three
   * discovery keys are deliberately left out — `install.sh` computes them.
   */
  addApp: {
    label: 'Declare a new app',
    needsSudo: true,
    rehearse: (p) =>
      [
        `if yq -e ${q(`.apps.${JSON.stringify(p.app)}`)} ${q(SECRETS)} >/dev/null 2>&1; then`,
        `  echo "error: ${p.app} is already declared in secrets.yaml."; exit 1;`,
        `fi`,
        `echo " ok  would add apps.${p.app} (domain ${p.domain}, upstream ${p.upstream || '127.0.0.1:8090'}, image ${p.image || '(unset)'})"`,
        `echo " ok  would generate one AGENT_MCP_KEYS token for it"`,
        `if [ -f ${q(`${INFRA_ROOT}/${p.app}/docker-compose.prod.yml`)} ]; then`,
        `  echo " ok  ${INFRA_ROOT}/${p.app}/docker-compose.prod.yml exists in the checkout";`,
        `else`,
        `  echo " !  there is no ${INFRA_ROOT}/${p.app}/ in the amber-infra checkout. install.sh needs ${p.app}/docker-compose.prod.yml — commit one to the repo (model it on sync-store/docker-compose.prod.yml) before installing.";`,
        `fi`,
      ].join('\n'),
    build: (p) =>
      [
        'set -e',
        `cp -a ${q(SECRETS)} ${q(`${SECRETS}.bak`)}`,
        'TOK="$(openssl rand -hex 32)"',
        `A=${q(p.app)} D=${q(p.domain)} U=${q(p.upstream || '127.0.0.1:8090')} I=${q(p.image)} S=${q(p.server || 'b')} \\`,
        `  yq -i '.apps[strenv(A)] = {` +
          `"domain": strenv(D), "upstream": strenv(U), "image": strenv(I), ` +
          `"managed_by": "docker", "server": strenv(S), "env": {}}' ${q(SECRETS)}`,
        `A=${q(p.app)} V="amber:$TOK" yq -i '.apps[strenv(A)].env.AGENT_MCP_KEYS = strenv(V)' ${q(SECRETS)}`,
        `chmod 600 ${q(SECRETS)}`,
        `echo " ok  declared apps.${p.app} with a generated AGENT_MCP_KEYS token"`,
        `echo " !  install.sh also needs ${INFRA_ROOT}/${p.app}/docker-compose.prod.yml committed to amber-infra. Until that exists, installing ${p.app} will stop with 'no compose file'."`,
      ].join('\n'),
  },

  /**
   * Rename an app that has not been deployed yet.
   *
   * There is no rename for a *deployed* app, and pretending otherwise would be the
   * worst thing this catalogue could do. The name is baked into the container, the
   * `/etc/amber-infra/<app>` directory, the Caddy snippet, the registry entry, the
   * backup target names and the image reference — the honest path is uninstall, then
   * install under the new name. So this refuses the moment it finds any trace of a
   * deployment, and is otherwise a two-line edit of a config file.
   *
   * It moves the `sync_store.keys[]` entry too. Leaving that behind would mean the
   * renamed app generating a fresh token on next install while the old one lingered
   * as a valid credential nobody could account for.
   */
  renameApp: {
    label: 'Rename an app',
    needsSudo: true,
    rehearse: (p) =>
      [
        RENAME_GUARD(p),
        `yq -e ${q(`.apps.${JSON.stringify(p.app)}`)} ${q(SECRETS)} >/dev/null 2>&1 \\`,
        `  || { echo "error: ${p.app} is not declared in secrets.yaml."; exit 1; }`,
        `echo " ok  would rename apps.${p.app} to apps.${p.to}"`,
        `if yq -e ${q(`.sync_store.keys[] | select(.name == ${JSON.stringify(p.app)})`)} ${q(SECRETS)} >/dev/null 2>&1; then`,
        `  echo " ok  would move its sync-store key to the new name";`,
        `fi`,
        `echo " !  the amber-infra checkout would still have ${p.app}/ — its compose file and image name are a repo change, not a config one."`,
      ].join('\n'),
    build: (p) =>
      [
        'set -e',
        RENAME_GUARD(p),
        `yq -e ${q(`.apps.${JSON.stringify(p.to)}`)} ${q(SECRETS)} >/dev/null 2>&1 \\`,
        `  && { echo "error: ${p.to} is already declared."; exit 1; } || true`,
        `cp -a ${q(SECRETS)} ${q(`${SECRETS}.bak`)}`,
        `yq -i ${q(`.apps.${JSON.stringify(p.to)} = .apps.${JSON.stringify(p.app)}`)} ${q(SECRETS)}`,
        `yq -i ${q(`del(.apps.${JSON.stringify(p.app)})`)} ${q(SECRETS)}`,
        `O=${q(p.app)} N=${q(p.to)} yq -i ` +
          `'(.sync_store.keys[] | select(.name == strenv(O)) | .name) = strenv(N)' ${q(SECRETS)}`,
        `chmod 600 ${q(SECRETS)}`,
        `echo " ok  ${p.app} is now ${p.to} in secrets.yaml"`,
        `echo " !  rename ${p.app}/ in the amber-infra repo and update apps.${p.to}.image to match."`,
      ].join('\n'),
  },

  /**
   * Delete an app's stanza from `secrets.yaml`. Config only — nothing is uninstalled.
   *
   * The case this exists for: `secrets.example.yaml` is copied *once*, at first
   * install, and older versions of it shipped a `finance` entry as documentation.
   * That entry is then real configuration on your box forever, and editing the
   * template cannot reach back and change it. It shows up as an app that does not
   * exist, whose placeholders read as outstanding work nobody can do.
   *
   * Refuses if anything is actually deployed under the name, for the same reason
   * `renameApp` does: config that disagrees with a running container is worse than
   * config that is merely untidy. `uninstall.sh` is the path for a real app.
   */
  undeclareApp: {
    label: 'Remove the declaration',
    needsSudo: true,
    rehearse: (p) =>
      [
        RENAME_GUARD(p),
        `yq -e ${q(`.apps.${JSON.stringify(p.app)}`)} ${q(SECRETS)} >/dev/null 2>&1 \\`,
        `  || { echo " ok  ${p.app} is not declared — nothing to remove"; exit 0; }`,
        `echo " !  would delete apps.${p.app} from secrets.yaml:"`,
        `yq ${q(`.apps.${JSON.stringify(p.app)}`)} ${q(SECRETS)} | sed 's/CHANGEME[^ ]*/CHANGEME/; s/^/    /'`,
        `if yq -e ${q(`.sync_store.keys[] | select(.name == ${JSON.stringify(p.app)})`)} ${q(SECRETS)} >/dev/null 2>&1; then`,
        `  echo " !  would also drop its sync-store key";`,
        `fi`,
        `echo " ok  nothing is uninstalled — this only edits the config file"`,
      ].join('\n'),
    build: (p) =>
      [
        'set -e',
        RENAME_GUARD(p),
        `cp -a ${q(SECRETS)} ${q(`${SECRETS}.bak`)}`,
        `yq -i ${q(`del(.apps.${JSON.stringify(p.app)})`)} ${q(SECRETS)}`,
        `O=${q(p.app)} yq -i 'del(.sync_store.keys[] | select(.name == strenv(O)))' ${q(SECRETS)}`,
        `chmod 600 ${q(SECRETS)}`,
        `echo " ok  ${p.app} is no longer declared (previous file kept as secrets.yaml.bak)"`,
      ].join('\n'),
  },

  // --- apps -----------------------------------------------------------------

  install: {
    label: 'Install / reconcile app',
    needsSudo: true,
    rehearse: (p) => `bash ${script('install/install.sh')} ${installFlags(p)} --dry-run`,
    build: (p) => `bash ${script('install/install.sh')} ${installFlags(p)}`,
    // apt, a Docker install, a first ACME issuance. Fifteen minutes is generous
    // rather than optimistic; the alternative is killing a half-finished install.
    timeoutMs: 15 * 60_000,
  },

  setImage: {
    label: 'Change the pinned image',
    needsSudo: true,
    rehearse: (p) =>
      `echo "current: $(yq -r ${q(`.apps."${p.app}".image`)} ${q(SECRETS)})"; ` +
      `echo "would set: ${p.image}"`,
    // `yq -i` with strenv does the escaping, and rewrites only this one key —
    // regenerating the file would discard anything hand-edited.
    build: (p) =>
      `V=${q(p.image)} yq -i ${q(`.apps."${p.app}".image = strenv(V)`)} ${q(SECRETS)} && ` +
      `echo "pinned ${p.app} to ${p.image}"`,
  },

  updateAmber: {
    label: 'Update Amber',
    needsSudo: true,
    rehearse: () => `bash ${script('deploy/update-amber.sh')} --dry-run`,
    build: () => `bash ${script('deploy/update-amber.sh')}`,
    timeoutMs: 10 * 60_000,
  },

  rollbackList: {
    label: 'List rollback targets',
    needsSudo: true,
    build: (p) => `bash ${script('deploy/rollback.sh')} ${q(p.app)} --list`,
  },

  rollback: {
    label: 'Roll back',
    needsSudo: true,
    rehearse: (p) => `bash ${script('deploy/rollback.sh')} ${q(p.app)} ${q(p.tag)} --dry-run`,
    build: (p) => `bash ${script('deploy/rollback.sh')} ${q(p.app)} ${q(p.tag)} --yes`,
    timeoutMs: 10 * 60_000,
  },

  restart: {
    label: 'Restart',
    needsSudo: true,
    rehearse: (p) => `docker compose -f ${composeOf(p.app)} config --services`,
    build: (p) =>
      `docker compose -f ${composeOf(p.app)} --project-directory ${q(`${INFRA_ETC}/${p.app}`)} up -d`,
    timeoutMs: 5 * 60_000,
  },

  stop: {
    label: 'Stop',
    needsSudo: true,
    build: (p) =>
      `docker compose -f ${composeOf(p.app)} --project-directory ${q(`${INFRA_ETC}/${p.app}`)} stop`,
  },

  logs: {
    label: 'Recent logs',
    needsSudo: true,
    build: (p) => `docker logs --tail ${q(p.lines ?? '300')} ${q(p.app)}`,
  },

  uninstall: {
    label: 'Remove app',
    needsSudo: true,
    rehearse: (p) => `bash ${script('install/uninstall.sh')} --app ${q(p.app)} --dry-run`,
    build: (p) => `bash ${script('install/uninstall.sh')} --app ${q(p.app)}`,
    timeoutMs: 5 * 60_000,
  },

  // --- the edge -------------------------------------------------------------

  caddyReload: {
    label: 'Validate & reload Caddy',
    needsSudo: true,
    // Validation is the rehearsal — and it is also the first half of the real thing,
    // which is why a bad snippet can never reach a live reload.
    rehearse: () => `docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`,
    build: () =>
      `docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && ` +
      `docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && ` +
      `echo reloaded`,
  },

  // --- the registry ---------------------------------------------------------

  setPeerToken: {
    label: 'Set peer token',
    needsSudo: true,
    rehearse: (p) =>
      `curl -fsS -o /dev/null -w 'registry says %{http_code}\\n' ` +
      `-H "Authorization: Bearer ${ADMIN_TOKEN}" ${SYNC_BASE}/servers/${q(p.name)}`,
    // The token arrives on stdin via a quoted heredoc, so it is neither expanded by
    // the shell nor visible in `ps` on the far end.
    build: (p) =>
      `curl -fsS -X PUT ${SYNC_BASE}/servers/${q(p.name)} ` +
      `-H "Authorization: Bearer ${ADMIN_TOKEN}" -H 'Content-Type: application/json' ` +
      `--data @- <<'APERTURE_EOF'\n${JSON.stringify({ token: p.token })}\nAPERTURE_EOF`,
  },

  deregister: {
    label: 'Remove from the registry',
    needsSudo: true,
    rehearse: (p) =>
      `curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN}" ${SYNC_BASE}/servers/${q(p.name)}`,
    build: (p) =>
      `curl -fsS -X DELETE ${SYNC_BASE}/servers/${q(p.name)} -H "Authorization: Bearer ${ADMIN_TOKEN}"`,
  },

  // --- housekeeping ---------------------------------------------------------

  backupNow: {
    label: 'Back up now',
    needsSudo: true,
    build: () => `bash ${script('backup/backup-sqlite.sh')}`,
    timeoutMs: 10 * 60_000,
  },

  migrateAmberDb: {
    label: 'Migrate Amber onto the container volume',
    needsSudo: true,
    rehearse: () => `bash ${script('deploy/migrate-amber-db.sh')} --dry-run`,
    build: () => `bash ${script('deploy/migrate-amber-db.sh')}`,
    timeoutMs: 10 * 60_000,
  },
}

function installFlags(p: Params): string {
  return (
    `--app ${q(p.app)}` +
    opt('--domain', p.domain) +
    opt('--upstream', p.upstream) +
    opt('--image', p.image) +
    opt('--role', p.role)
  )
}

/**
 * The command to actually send, wrapped for privilege.
 *
 * `-S` reads the password from stdin, `-p ''` means it prints no prompt, so the
 * credential touches neither `argv` nor the operation log. `bash -lc` is what makes
 * `yq`, `docker` and the rest resolve the same way they do for a human on this box.
 */
export function compose(
  action: ActionDef,
  params: Params,
  opts: { dryRun?: boolean; withSudo?: boolean },
): string {
  const body = opts.dryRun && action.rehearse ? action.rehearse(params) : action.build(params)
  const inner = `bash -lc ${q(body)}`
  return action.needsSudo && opts.withSudo ? `sudo -S -p '' ${inner}` : inner
}
