import { REGISTRY_SCHEMA, type InfraApp, type InfraStatus, type SyncStoreKey } from './types'

/**
 * What is linked, what is not, and the one thing to press about it.
 *
 * THE PROBLEM THIS REPLACES. The sync-store reads `SYNC_STORE_KEYS` once, at container
 * start. An app whose token was minted after the store last started gets a 401 on every
 * registration attempt, forever — while its own `/health` returns 200, its container
 * reports healthy, and `agent_mcp`'s `register()` swallows the failure by contract. The
 * only symptom is the word "unregistered".
 *
 * Aperture could not tell that apart from four other causes, so it printed all of them:
 * a five-sentence paragraph in the Bloom card hedging with "most likely" and "give it a
 * moment", under a button whose own tooltip described a different operation. Nobody
 * reads that, and they are right not to — it is a list of things that might be true.
 *
 * Schema 10 makes it decidable. `status.sh` now reports the key list from *both* sides:
 * what secrets.yaml declares and what the running container was actually started with.
 * The difference between those two is not a hypothesis, it is the bug. This module is
 * where that becomes one state and one button.
 *
 * THE RULES, in order, because the order is the design:
 *
 *   1. The store's own state dominates. If it is absent, stopped or silent, no app's
 *      registration state is knowable, so every app reads `unknown` with no fix and the
 *      only button on screen is the store's. Fifteen buttons for one cause is the
 *      failure this whole surface exists to end.
 *   2. Every state has exactly one fix. Not a list, not a "try this, then that".
 *   3. Identical fixes collapse. Ten apps locked out by one stale key list is ONE
 *      button that says it repairs ten, not ten buttons.
 *   4. Copy is data. Every sentence lives in `COPY` below, length-capped by the verify
 *      script, so the paragraph cannot grow back one edit at a time.
 *   5. Degrade, never hide. On a box that predates schema 10 the precise states are
 *      unreachable, so they collapse into `unclear` — same shape, same button, which is
 *      safe and idempotent either way, plus one line about updating the checkout.
 *
 * Pure: no React, no Electron, no `window`, no clock except the injected one. It is in
 * `shared/` and free of DOM types so `scripts/verify-registry.mjs` can drive it under
 * plain Node, the way `credentials.ts` and `typeahead.ts` are driven.
 */

/** Every distinguishable condition. Closed set; `COPY` must cover it exhaustively. */
export type RegistryState =
  // the store itself
  | 'store-ok'
  | 'store-unconfigured' // no sync_store.url in secrets.yaml
  | 'store-absent' // not deployed on this box
  | 'store-stopped' // container exists, is not running
  | 'store-silent' // running, nothing answers on /health
  | 'store-refusing' // healthy, but 401 for amber's own token
  | 'store-locked-out' // healthy, and its running key list is behind secrets.yaml
  // an app
  | 'linked'
  | 'stale' // registered, but its heartbeat is old
  | 'joining' // keys agree, started recently, first registration still pending
  | 'unregistered' // everything agrees and it still is not there
  | 'key-unknown' // its key is absent from the store's RUNNING list
  | 'key-rotated' // present by name, different fingerprint
  | 'key-stale' // the app is presenting a token older than secrets.yaml's
  | 'key-missing' // no sync_store.keys entry at all
  | 'key-placeholder' // there is an entry and it is still CHANGEME
  | 'prefix-drift' // the app reads one namespace, its keys were written to another
  | 'no-domain' // nothing to build a public URL from
  | 'no-public-url' // no *_PUBLIC_URL rendered, so register() refuses before any HTTP
  | 'no-store-url' // no *_SYNC_STORE_URL rendered, so it does not even know where to go
  | 'mcp-off' // its MCP server never mounted, so nothing registers
  | 'app-cannot-reach' // it tried, and the store was unreachable FROM THE CONTAINER
  | 'never-tried' // running, and its log has never mentioned registering at all
  | 'not-installed' // declared here, never deployed
  | 'not-running' // deployed, container stopped
  | 'orphan' // in the registry with no app behind it
  | 'unclear' // schema < 10, or secrets unreadable — cannot tell

/** How a node joins the trunk. Drives stroke and dash only. */
export type RegistryLink = 'live' | 'stale' | 'refused' | 'absent' | 'unknown'

export type RegistryTone = 'ok' | 'warn' | 'danger' | 'muted'

export interface RegistryFix {
  /**
   * `action` runs through `useRunner`; `password` means the sudo field above is what
   * is blocking; `none` is a genuine dead end and renders no button at all.
   */
  kind: 'action' | 'password' | 'none'
  /** An id in `ACTIONS`. Null unless `kind === 'action'`. */
  actionId: string | null
  params: Record<string, string>
  /** Imperative, on the button. Capped at 28 chars by the verify script. */
  label: string
  /** One sentence under the button. Capped at 120 chars. */
  because: string
}

export interface RegistryNode {
  id: string
  kind: 'store' | 'app'
  label: string
  state: RegistryState
  tone: RegistryTone
  link: RegistryLink
  /** One line of fact. Capped at 64 chars, which is what keeps it from being a paragraph. */
  summary: string
  /**
   * The app's own last word on the subject, verbatim.
   *
   * Not written by us and deliberately not capped — it is a machine's error message,
   * which is the one kind of long string worth showing whole. It is also the only thing
   * on this surface that can name a cause nobody anticipated, which is why the summary
   * above it stays generic rather than pretending to have parsed it.
   */
  note: string | null
  fix: RegistryFix
  lastSeen: string | null
  /**
   * Advanced mode only. Every value is a fingerprint or a non-secret string — asserted
   * by the verify script, because this is the one field shaped like a leak.
   */
  evidence: Array<{ label: string; value: string }>
}

export interface RegistryDiagnosis {
  store: RegistryNode
  apps: RegistryNode[]
  /**
   * The one action for the whole map, and everything it repairs. Collapsed here rather
   * than in the component: rule 3 is a property of the diagnosis, and a component that
   * re-derived it would drift from the states it is summarising.
   */
  next: { fix: RegistryFix; affects: string[] } | null
  certain: boolean
  /** Why it is not certain. Rendered above the map, never inside it. */
  caveats: string[]
  /** For the `sr-only` figcaption and the polite live region. */
  caption: string
}

/**
 * How long after a container starts we still call a missing registration "joining".
 *
 * `agent_mcp`'s heartbeat is 300 s and it *sleeps before* re-registering, so a boot
 * registration that fails is not retried for a full five minutes. Two minutes is the
 * honest edge of "still arriving": past it, waiting is no longer the answer.
 */
export const JOINING_WINDOW_MS = 120_000

const NO_FIX: RegistryFix = { kind: 'none', actionId: null, params: {}, label: '', because: '' }

/**
 * Every sentence in the surface, in one table.
 *
 * `summary` is what the map and the row show. `label`/`because` are the button and its
 * one line. Nothing here may grow into a second sentence — `verify-registry.mjs`
 * enforces the caps, which is the mechanism that stops the old paragraph reappearing.
 */
const COPY: Record<RegistryState, { summary: string; label: string; because: string }> = {
  'store-ok': { summary: 'Answering, and reading its current key list.', label: '', because: '' },
  'store-unconfigured': {
    summary: 'No registry URL is set for this box.',
    label: 'Set the registry URL',
    because: 'Every app is told this address at install time; it must be https://sync.<your domain>.',
  },
  'store-absent': {
    summary: 'The registry is not deployed on this box.',
    label: 'Deploy the registry',
    because: 'Nothing can register until the store is running here.',
  },
  'store-stopped': {
    summary: 'The registry container is not running.',
    label: 'Start the registry',
    because: 'It exists but is stopped, so every registration is refused.',
  },
  'store-silent': {
    summary: 'Running, but nothing answers on its health check.',
    label: 'Show the registry log',
    because: 'It may still be starting, or bound to a different port than configured.',
  },
  'store-refusing': {
    summary: 'Healthy, but it rejects this box’s own key.',
    label: 'Reload the registry',
    because: 'It is checking against the key list it started with, which is no longer this one.',
  },
  'store-locked-out': {
    summary: 'Running an older key list than this box declares.',
    label: 'Reload the registry',
    because: 'It reads its keys once, at startup, so keys added since then are refused.',
  },

  linked: { summary: 'Linked.', label: '', because: '' },
  stale: {
    summary: 'Linked, but it has not checked in recently.',
    label: 'Restart it',
    because: 'It is still in the registry; a restart makes it check in immediately.',
  },
  joining: { summary: 'Starting up — it registers on boot.', label: '', because: '' },
  // Reached only when the app's own log says it registered and the registry disagrees.
  // It used to be the catch-all, offering "Restart it" on the theory that a missed
  // heartbeat was the likeliest cause — which was a guess dressed as a diagnosis, and
  // restarting an app whose public URL was never rendered does exactly nothing.
  unregistered: {
    summary: 'It reports it registered; the registry disagrees.',
    label: 'Show its log',
    because: 'Both cannot be true, and its own account is the one nothing else records.',
  },
  'key-unknown': {
    summary: 'The registry has never been told this app’s key.',
    label: 'Reload the registry',
    because: 'The store was started before this key existed, so it refuses every attempt.',
  },
  'key-rotated': {
    summary: 'Its key changed after the registry started.',
    label: 'Reload the registry',
    because: 'The store is still checking against the previous token for this name.',
  },
  'key-stale': {
    summary: 'The app is presenting an older key than it was given.',
    label: 'Reconcile it',
    because: 'Its env file was written before the token changed; reinstalling rewrites it.',
  },
  'key-missing': {
    summary: 'No registry key exists for this app.',
    label: 'Reconcile it',
    because: 'Installing mints one and writes it into both the app and the registry.',
  },
  'key-placeholder': {
    summary: 'Its registry key is still a placeholder.',
    label: 'Generate its key',
    because: 'The token in secrets.yaml is literally CHANGEME, so it can never be accepted.',
  },
  'prefix-drift': {
    summary: 'Its keys were written under the wrong prefix.',
    label: 'Repair its configuration',
    because: 'It reads one namespace and its keys are in another, so it never sees them.',
  },
  'no-domain': {
    summary: 'It has no domain, so it has no public URL.',
    label: 'Reconcile it',
    because: 'Registration is skipped outright when the public URL is empty.',
  },
  'no-public-url': {
    summary: 'It has no public URL, so it never even tries.',
    label: 'Reconcile it',
    because: 'Registration is refused before any request when the public URL is unset.',
  },
  'no-store-url': {
    summary: 'It was never told where the registry is.',
    label: 'Reconcile it',
    because: 'Without the registry URL it skips registration silently, at debug level.',
  },
  'mcp-off': {
    summary: 'Its MCP server never started, so nothing registers.',
    label: 'Repair its configuration',
    because: 'With no keys or the feature off it serves normally and mounts nothing.',
  },
  'app-cannot-reach': {
    summary: 'It tried, and could not reach the registry.',
    label: 'Show its log',
    because: 'The app’s own error is below; this is a network or TLS problem, not a key one.',
  },
  'never-tried': {
    summary: 'Running, and it has never mentioned registering.',
    label: 'Show its log',
    because: 'No attempt appears in its log at all, so its agent layer may not be running.',
  },
  'not-installed': {
    summary: 'Declared for this box, never installed.',
    label: 'Install it',
    because: 'It has no container here yet, so there is nothing to register.',
  },
  'not-running': {
    summary: 'Not running.',
    label: 'Start it',
    because: 'A stopped app cannot register.',
  },
  orphan: {
    summary: 'In the registry, with nothing behind it here.',
    label: 'Remove from the registry',
    because: 'Every agent believes in this peer and nothing answers for it.',
  },
  unclear: {
    summary: 'Not registered — the cause cannot be read from here.',
    label: 'Reload the registry',
    because: 'Safe either way, and it repairs the most common cause of this.',
  },
}

const TONE: Record<RegistryState, RegistryTone> = {
  'store-ok': 'ok',
  'store-unconfigured': 'warn',
  'store-absent': 'muted',
  'store-stopped': 'danger',
  'store-silent': 'danger',
  'store-refusing': 'danger',
  'store-locked-out': 'warn',
  linked: 'ok',
  stale: 'warn',
  joining: 'muted',
  unregistered: 'warn',
  'key-unknown': 'danger',
  'key-rotated': 'danger',
  'key-stale': 'warn',
  'key-missing': 'warn',
  'key-placeholder': 'warn',
  'prefix-drift': 'danger',
  'no-domain': 'warn',
  'no-public-url': 'danger',
  'no-store-url': 'danger',
  'mcp-off': 'danger',
  'app-cannot-reach': 'danger',
  'never-tried': 'warn',
  'not-installed': 'muted',
  'not-running': 'muted',
  orphan: 'warn',
  unclear: 'warn',
}

const LINK: Record<RegistryState, RegistryLink> = {
  'store-ok': 'live',
  'store-unconfigured': 'unknown',
  'store-absent': 'absent',
  'store-stopped': 'absent',
  'store-silent': 'unknown',
  'store-refusing': 'refused',
  'store-locked-out': 'refused',
  linked: 'live',
  stale: 'stale',
  joining: 'unknown',
  unregistered: 'absent',
  'key-unknown': 'refused',
  'key-rotated': 'refused',
  'key-stale': 'refused',
  'key-missing': 'absent',
  'key-placeholder': 'absent',
  'prefix-drift': 'refused',
  'no-domain': 'absent',
  'no-public-url': 'absent',
  'no-store-url': 'absent',
  'mcp-off': 'absent',
  'app-cannot-reach': 'refused',
  'never-tried': 'absent',
  'not-installed': 'absent',
  'not-running': 'absent',
  orphan: 'absent',
  unclear: 'unknown',
}

/** A container state that means the container exists at all. */
function exists(container: string): boolean {
  return container !== 'missing' && container !== ''
}

function keyOf(list: SyncStoreKey[] | undefined, name: string): SyncStoreKey | undefined {
  return list?.find((k) => k.name === name)
}

function fix(
  state: RegistryState,
  kind: RegistryFix['kind'],
  actionId: string | null,
  params: Record<string, string> = {},
): RegistryFix {
  const copy = COPY[state]
  return { kind, actionId, params, label: copy.label, because: copy.because }
}

function node(
  kind: 'store' | 'app',
  id: string,
  state: RegistryState,
  f: RegistryFix,
  extra: {
    lastSeen?: string | null
    evidence?: RegistryNode['evidence']
    label?: string
    note?: string | null
  } = {},
): RegistryNode {
  return {
    id,
    kind,
    label: extra.label ?? id,
    state,
    tone: TONE[state],
    link: LINK[state],
    summary: COPY[state].summary,
    note: extra.note ?? null,
    fix: f,
    lastSeen: extra.lastSeen ?? null,
    evidence: extra.evidence ?? [],
  }
}

/**
 * What the app itself said about registering, most recent first.
 *
 * Classified rather than parsed: each pattern is a line `agent_mcp` or the app's own
 * lifespan is known to emit, and anything unrecognised is still carried through as a
 * `note` so an unanticipated cause is shown rather than swallowed. That is the whole
 * lesson of the failure this module exists for — a reason that exists and is not read
 * is the same as no reason at all.
 */
export function readRegistrationLog(lines: string[] | undefined): {
  kind: 'registered' | 'no-public-url' | 'unreachable' | 'mcp-off' | 'mounted' | 'none'
  line: string | null
} {
  const recent = [...(lines ?? [])].reverse()
  for (const line of recent) {
    if (/registered with the sync store/i.test(line)) return { kind: 'registered', line }
    if (/no public url configured/i.test(line)) return { kind: 'no-public-url', line }
    if (/sync store unreachable/i.test(line)) return { kind: 'unreachable', line }
    if (/mcp server disabled/i.test(line)) return { kind: 'mcp-off', line }
  }
  // "Mounted" is only meaningful when nothing above matched: it means the agent layer
  // is up and simply never said anything about the store, which is its own finding.
  const mounted = recent.find((l) => /mcp server mounted/i.test(l))
  if (mounted) return { kind: 'mounted', line: mounted }
  return { kind: 'none', line: recent[0] ?? null }
}

/** Milliseconds since an ISO timestamp, or null when it is absent or unparseable. */
function ageOf(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : now - t
}

function diagnoseStore(status: InfraStatus): RegistryNode {
  const s = status.syncStore
  const evidence: RegistryNode['evidence'] = []
  if (s.url) evidence.push({ label: 'url', value: s.url })
  evidence.push({ label: 'container', value: s.containerState })
  if (s.startedAt) evidence.push({ label: 'started', value: s.startedAt })
  if (s.detail) evidence.push({ label: 'detail', value: s.detail })

  const mk = (state: RegistryState, f: RegistryFix): RegistryNode =>
    node('store', 'registry', state, f, { evidence, label: 'registry' })

  if (!s.url) {
    // install.sh serves the store at sync.<primary_domain>, so when that is known the
    // value is derivable and the button can just be right. When it is not, there is
    // nothing to offer but the settings row — a button that writes an empty string
    // would be worse than no button.
    const domain = status.settings.primaryDomain
    return mk(
      'store-unconfigured',
      domain
        ? fix('store-unconfigured', 'action', 'setVar', {
            root: 'sync_store.url',
            value: `https://sync.${domain}`,
          })
        : { ...NO_FIX, because: COPY['store-unconfigured'].because },
    )
  }
  // `ensure_sync_store` deploys the store when it is not up, and reconciles it when it
  // is, so the same script covers both — which is why this is not `buildSyncStore`.
  // That one builds the *image* locally, and is still offered where a pull failed.
  if (!exists(s.containerState)) return mk('store-absent', fix('store-absent', 'action', 'reloadRegistry'))
  if (s.containerState !== 'running') {
    return mk('store-stopped', fix('store-stopped', 'action', 'restart', { app: 'sync-store' }))
  }
  if (!s.reachable) {
    // A 401 is the store working perfectly and disagreeing about the credential, which
    // is a different sentence and a different button from "it did not answer".
    //
    // Read out of `detail` because that is the only place status.sh distinguishes the
    // four not-reachable causes. Matched loosely, on any of the three ways it can say
    // so, because a wording change upstream should cost the *specific* message and fall
    // back to "show me the log" — not silently start recommending a registry reload for
    // a store that is simply down.
    const refusing = /rejecting|401|unauthor/i.test(s.detail ?? '')
    return refusing
      ? mk('store-refusing', fix('store-refusing', 'action', 'reloadRegistry'))
      : mk('store-silent', fix('store-silent', 'action', 'logs', { app: 'sync-store' }))
  }

  // Answering. The remaining question is whether it is answering against the right list.
  const keys = s.keys
  if (keys?.readable) {
    const running = new Map(keys.running.map((k) => [k.name, k.fp]))
    const behind = keys.declared.filter((k) => !k.placeholder && running.get(k.name) !== k.fp)
    if (behind.length > 0) {
      return mk('store-locked-out', fix('store-locked-out', 'action', 'reloadRegistry'))
    }
  }
  return mk('store-ok', NO_FIX)
}

/**
 * One app's state, given a store that is answering.
 *
 * Order matters and is the numbered list in the module docblock: the cheapest, most
 * certain facts first, so a stopped container is never diagnosed as a key problem.
 */
function diagnoseApp(
  app: InfraApp,
  status: InfraStatus,
  now: number,
  blind: boolean,
): RegistryNode {
  const s = status.syncStore
  const declared = keyOf(s.keys?.declared, app.name)
  const running = keyOf(s.keys?.running, app.name)

  const evidence: RegistryNode['evidence'] = [
    { label: 'container', value: app.container },
    { label: 'health', value: app.health },
  ]
  if (app.startedAt) evidence.push({ label: 'started', value: app.startedAt })
  if (app.envPrefix) evidence.push({ label: 'prefix (manifest)', value: app.envPrefix })
  if (app.envPrefixRendered) evidence.push({ label: 'prefix (rendered)', value: app.envPrefixRendered })
  if (declared) evidence.push({ label: 'key declared', value: `sha256:${declared.fp}` })
  if (running) evidence.push({ label: 'key in registry', value: `sha256:${running.fp}` })
  if (app.syncTokenFingerprint) {
    evidence.push({ label: 'key the app presents', value: `sha256:${app.syncTokenFingerprint}` })
  }

  const said = readRegistrationLog(app.registrationLog)
  if (said.line) evidence.push({ label: 'its own log', value: said.line })

  const mk = (state: RegistryState, f: RegistryFix, note?: string | null): RegistryNode =>
    node('app', app.name, state, f, { evidence, lastSeen: app.lastSeen, note: note ?? null })

  const reconcile = (state: RegistryState): RegistryFix =>
    fix(state, 'action', 'install', {
      app: app.name,
      domain: app.domain ?? '',
      upstream: app.upstream ?? '',
    })

  // 1. No container beats everything. A stopped app has no registration problem, and
  //    "never installed" and "installed and stopped" are different sentences with
  //    different buttons — one installs, the other starts.
  if (!exists(app.container)) return mk('not-installed', reconcile('not-installed'))
  if (app.container !== 'running') {
    return mk('not-running', fix('not-running', 'action', 'restart', { app: app.name }))
  }

  // 2. Registered and fresh is the answer for most apps most of the time.
  if (app.registered && !app.stale) return mk('linked', NO_FIX)
  if (app.registered) return mk('stale', fix('stale', 'action', 'restart', { app: app.name }))

  // 3. It is not registered. Everything below is *why*, and only schema 10 can say.
  if (blind) return mk('unclear', fix('unclear', 'action', 'reloadRegistry'))

  if (!declared) return mk('key-missing', reconcile('key-missing'))
  if (declared.placeholder) {
    // `fill-secrets.sh` is what replaces a CHANGEME token with a real one. Reinstalling
    // would also do it — `sync_store_token_for` treats a placeholder as absent — but
    // this is the smaller operation and it names what is actually wrong.
    return mk('key-placeholder', fix('key-placeholder', 'action', 'fillSecrets', { app: app.name }))
  }

  // The three the key diff makes decidable, in order of what to fix first: the registry
  // is wrong, then the app is wrong.
  if (!running) return mk('key-unknown', fix('key-unknown', 'action', 'reloadRegistry'))
  if (running.fp !== declared.fp) return mk('key-rotated', fix('key-rotated', 'action', 'reloadRegistry'))
  if (app.syncTokenFingerprint && app.syncTokenFingerprint !== declared.fp) {
    return mk('key-stale', reconcile('key-stale'))
  }

  // 4. The keys are right, so the app's own configuration is the remaining suspect.
  //    These are structural and certain — read off the rendered env file's key NAMES,
  //    which status.sh already reports — so they come before anything inferred.
  if (app.envPrefix && app.envPrefixRendered && app.envPrefix !== app.envPrefixRendered) {
    return mk('prefix-drift', fix('prefix-drift', 'action', 'reconcileApp', { app: app.name }))
  }
  const prefix = app.envPrefixRendered ?? app.envPrefix
  const rendered = (suffix: string): boolean =>
    prefix ? app.envKeys.includes(`${prefix}${suffix}`) : true
  if (!app.domain) return mk('no-domain', reconcile('no-domain'))
  // `register()` refuses outright with no public URL, before any HTTP is attempted —
  // so this app has never made a single request and no amount of restarting it will
  // change that. This is the branch "Restart it" used to swallow.
  if (!rendered('_PUBLIC_URL')) return mk('no-public-url', reconcile('no-public-url'))
  if (!rendered('_SYNC_STORE_URL')) return mk('no-store-url', reconcile('no-store-url'))

  // 5. Nothing structural is wrong, so stop guessing and read what the app said. This
  //    is the only source that can name a cause we did not think of.
  if (said.kind === 'mcp-off') {
    return mk('mcp-off', fix('mcp-off', 'action', 'reconcileApp', { app: app.name }), said.line)
  }
  // The key NAME is rendered and the app still says it has no public URL, which means
  // the value is empty. Only the app can know that — status.sh reports key names and
  // deliberately never their values — so this is the branch that exists precisely
  // because reading the log catches what inspecting the box cannot.
  if (said.kind === 'no-public-url') {
    return mk('no-public-url', reconcile('no-public-url'), said.line)
  }
  if (said.kind === 'unreachable') {
    return mk(
      'app-cannot-reach',
      fix('app-cannot-reach', 'action', 'logs', { app: app.name }),
      said.line,
    )
  }

  // 6. Still arriving is a real answer, but only inside the window.
  const age = ageOf(app.startedAt, now)
  if (age !== null && age >= 0 && age < JOINING_WINDOW_MS) return mk('joining', NO_FIX)

  // 7. Its agent layer is up and has never mentioned the store, or has said nothing at
  //    all. Both mean the next move is to look, not to restart and hope.
  if (said.kind === 'registered') {
    // It believes it registered and the store disagrees — the one genuinely surprising
    // combination, and worth showing its own line for rather than inventing a cause.
    return mk('unregistered', fix('unregistered', 'action', 'logs', { app: app.name }), said.line)
  }
  return mk('never-tried', fix('never-tried', 'action', 'logs', { app: app.name }), said.line)
}

/**
 * A registry entry with no app behind it anywhere this box knows of.
 *
 * Matched against **every** declared app, not just the ones on this box. In a
 * two-server split Server B's apps register with Server A's store, so checking only
 * `thisBox` would accuse every app on the other machine of being an orphan and offer to
 * deregister it — the most damaging possible false positive on this screen.
 *
 * The residual case is an app declared *only* in another box's secrets.yaml, which this
 * one has genuinely never heard of. That is indistinguishable from a real orphan from
 * here, and the fix is a rehearsable, reversible deregistration, so it fails toward the
 * safe side rather than being suppressed.
 */
function diagnoseOrphans(status: InfraStatus, known: Set<string>): RegistryNode[] {
  return status.syncStore.servers
    .filter((s) => !known.has(s.name))
    .map((s) =>
      node('app', s.name, 'orphan', fix('orphan', 'action', 'deregister', { name: s.name }), {
        lastSeen: s.lastSeen,
        evidence: [{ label: 'base url', value: s.baseUrl }],
      }),
    )
}

function captionOf(store: RegistryNode, apps: RegistryNode[]): string {
  if (apps.length === 0) return `Registry map. The registry is ${store.summary.toLowerCase()}`
  const linked = apps.filter((a) => a.state === 'linked').length
  const broken = apps.filter((a) => a.fix.kind !== 'none').length
  const parts = [`${apps.length} app${apps.length === 1 ? '' : 's'}`, `${linked} linked`]
  if (broken > 0) parts.push(`${broken} needing attention`)
  return `Registry map. ${parts.join(', ')}.`
}

/**
 * Collapse every node's fix into the single most valuable one.
 *
 * Rule 3. Identical `(actionId, params)` pairs are one button that names how many apps
 * it repairs — otherwise a box where one stale key list locks out ten apps renders ten
 * identical buttons, which is the same wall of text in a different shape.
 *
 * The store's fix always wins when it has one: nothing an app can do matters while the
 * registry itself is the problem.
 */
function nextFix(store: RegistryNode, apps: RegistryNode[]): RegistryDiagnosis['next'] {
  if (store.fix.kind !== 'none') {
    const shares = apps.filter((a) => a.fix.actionId === store.fix.actionId).map((a) => a.id)
    return { fix: store.fix, affects: ['registry', ...shares] }
  }

  const groups = new Map<string, { fix: RegistryFix; affects: string[] }>()
  for (const app of apps) {
    if (app.fix.kind === 'none') continue
    const key = `${app.fix.actionId}|${JSON.stringify(app.fix.params)}`
    const found = groups.get(key)
    if (found) found.affects.push(app.id)
    else groups.set(key, { fix: app.fix, affects: [app.id] })
  }
  if (groups.size === 0) return null

  // Most apps repaired wins; ties go to the more severe node, so a `danger` cause is
  // never buried under an equally-sized `warn` one.
  const severity = (id: string): number => {
    const found = apps.find((a) => a.id === id)
    return found?.tone === 'danger' ? 2 : found?.tone === 'warn' ? 1 : 0
  }
  return [...groups.values()].sort(
    (a, b) => b.affects.length - a.affects.length || severity(b.affects[0]) - severity(a.affects[0]),
  )[0]
}

export function diagnose(status: InfraStatus, opts: { now?: number } = {}): RegistryDiagnosis {
  const now = opts.now ?? Date.now()
  const caveats: string[] = []

  // Blind means "cannot name the cause", and it has two sources that must both be said
  // out loud rather than silently producing a confident-looking wrong answer.
  const oldScript = status.schema < REGISTRY_SCHEMA
  const noKeys = !status.syncStore.keys?.readable
  if (oldScript) {
    caveats.push(
      `This box’s status script is older than this build (schema ${status.schema || 'none'} of ${REGISTRY_SCHEMA}), ` +
        'so a registration failure cannot be traced to its cause. Update infra to get the precise reason.',
    )
  } else if (noKeys) {
    caveats.push(
      status.secretsReadable
        ? 'The registry’s own key list could not be read, so a registration failure cannot be traced to its cause.'
        : 'secrets.yaml is not readable as this user, so a registration failure cannot be traced to its cause. Enter the root password above.',
    )
  }
  const blind = oldScript || noKeys

  const store = diagnoseStore(status)

  // Only apps that belong on this box, and only ones that are registry participants at
  // all. `thisBox` already encodes the generous reading of an unset `server:` label, so
  // nothing is hidden on the strength of a field that had no meaning until recently.
  //
  // The participation test matters as much as the box test: an app with no MCP surface
  // is *supposed* never to appear in the registry, and listing it here as unregistered
  // would be inventing a fault. Three signals, any one of which settles it — it is in
  // the registry, it has been given a key, or its rendered env carries a token to
  // present.
  const declaredKeys = status.syncStore.keys?.declared
  const here = status.apps.filter((a) => {
    if (!a.thisBox || !(a.declared || exists(a.container))) return false
    return (
      a.registered ||
      Boolean(keyOf(declaredKeys, a.name)) ||
      a.envKeys.some((k) => k.endsWith('_SYNC_STORE_TOKEN'))
    )
  })

  // Rule 1. A store that is not answering makes every app's registration unknowable, so
  // do not guess at one — but a store that is *refusing* or *locked out* is precisely
  // the case where the per-app key diff is the answer, so let those through.
  const storeBlocks =
    store.state === 'store-unconfigured' ||
    store.state === 'store-absent' ||
    store.state === 'store-stopped' ||
    store.state === 'store-silent'

  const apps = storeBlocks
    ? here.map((app) =>
        node('app', app.name, exists(app.container) ? 'unclear' : 'not-installed', NO_FIX, {
          lastSeen: app.lastSeen,
          evidence: [{ label: 'container', value: app.container }],
        }),
      )
    : here.map((app) => diagnoseApp(app, status, now, blind))

  const orphans = storeBlocks
    ? []
    : diagnoseOrphans(status, new Set(status.apps.map((a) => a.name)))
  const all = [...apps, ...orphans]

  return {
    store,
    apps: all,
    next: nextFix(store, all),
    certain: !blind,
    caveats,
    caption: captionOf(store, all),
  }
}
