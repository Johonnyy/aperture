import { PEERS_SCHEMA, type BearerKey, type InfraApp, type InfraStatus } from './types'

/**
 * Who can call whom, and the one thing to press about it.
 *
 * THE PROBLEM THIS EXISTS FOR. Bloom was deployed, registered, healthy, mounting its
 * MCP server, and answering 401 to an unauthenticated probe — every green light the
 * Registry card can show. Amber still had no tool for it. `AMBER_MCP_PEERS` was
 * empty, and `app/brain.py` builds her peer broker from that string alone, so the
 * whole MCP client was never constructed. Nothing was degraded. Nothing errored.
 * Nothing anywhere said "this peer is unreachable", because from Amber's side there
 * was no peer to be unreachable — a peer that is not listed is offered as no tools
 * at all.
 *
 * Registration and peering are DIFFERENT RELATIONS and the Registry card only sees
 * the first. `registry.ts` answers "did this app tell the store it exists"; this file
 * answers "can this app be called, by that app, right now". An app can be perfect on
 * the first and absent on the second, which is the state that cost a week.
 *
 * THE RULES, inherited from `registry.ts` because they are what makes that surface
 * work, and the same failure would otherwise regrow here:
 *
 *   1. Every state has exactly one fix. Not a list.
 *   2. The cheapest, most certain facts first. A stopped callee is never diagnosed
 *      as a token problem.
 *   3. Copy is data. Every sentence is in `COPY`, length-capped by the verify script,
 *      so the paragraph cannot come back one edit at a time.
 *   4. Degrade, never hide. On a box below schema 12 every pairing reads `unclear`
 *      with the same safe button, plus one line about updating the checkout.
 *   5. Fingerprints, never tokens. Every comparison here is between two digests that
 *      `status.sh` computed on the box. Nothing in this module has ever seen a
 *      credential, and `verify-peers.mjs` asserts that of the evidence it emits.
 *
 * WHAT MAKES A PAIRING CANDIDATE. Not a hardcoded list, and not "every app times
 * every app". The manifests already declare it: an app with a `peer_map` key is a
 * caller, and an app with a `generated:token` key whose `peers:` names that caller is
 * a callee. Amber declares `AMBER_MCP_PEERS` (peer_map); Bloom declares
 * `BLOOM_MCP_KEYS` with `peers: [amber]`. That is the pairing, stated by both ends,
 * and it is why this surface needs no configuration of its own.
 *
 * Anything already in a caller's live peer map is also included even when no manifest
 * declares it — rule 4. A hand-wired peer that nothing knows about is exactly the
 * case worth showing.
 *
 * Pure: no React, no Electron, no `window`, no clock except the injected one, so
 * `scripts/verify-peers.mjs` can drive it under plain Node.
 */

/** Every distinguishable condition of one caller→callee pairing. Closed set. */
export type PeerState =
  | 'linked'
  // wiring
  | 'unwired' // the caller's map does not mention the callee at all
  | 'pending' // secrets.yaml agrees; the running container has not been re-rendered
  | 'token-mismatch' // both ends wired, different bearers — a 401 on every call
  | 'token-absent' // the callee is listed and the caller presents nothing
  | 'url-endpoint' // the map holds an endpoint, not an origin — /mcp/mcp/ and a 404
  | 'url-drift' // points somewhere other than where the callee actually is
  | 'token-shared' // >1 peer, one token slot, and they need different values
  // the far end
  | 'callee-not-installed'
  | 'callee-not-running'
  | 'callee-closed' // it accepts no bearers, so it mounts no MCP server
  // the near end
  | 'caller-not-running'
  // we cannot say
  | 'unclear' // schema < 12, or secrets unreadable

export type PeerTone = 'ok' | 'warn' | 'danger' | 'muted'

export interface PeerFix {
  /** `action` runs through `useRunner`; `none` renders no button at all. */
  kind: 'action' | 'none'
  /** An id in `ACTIONS`. Null unless `kind === 'action'`. */
  actionId: string | null
  params: Record<string, string>
  /** Imperative, on the button. Capped at 28 chars by the verify script. */
  label: string
  /** One sentence under the button. Capped at 120 chars. */
  because: string
}

export interface PeerPairing {
  /** Stable across refreshes, and what the UI keys rows on. */
  id: string
  from: string
  to: string
  state: PeerState
  tone: PeerTone
  /** One line of fact. Capped at 64 chars, which is what stops it being a paragraph. */
  summary: string
  fix: PeerFix
  /** Where the caller currently points, verbatim from its live env. Null when unset. */
  baseUrl: string | null
  /**
   * Whether the REGISTRY would also resolve this pairing.
   *
   * A second, independent path to the same peer: the store holds a token per server
   * and discovery hands it out, so an agent that resolves through the registry needs
   * no env map at all. Amber does not read it yet — `build_broker` passes an explicit
   * resolver, which short-circuits `agent_mcp.registry.resolve` entirely — so this is
   * reported, not counted as linked. It is the difference between "wired for today"
   * and "wired for after the next deploy".
   */
  discoverable: boolean
  /** Advanced mode only. Fingerprints and non-secret strings, asserted by the verify script. */
  evidence: Array<{ label: string; value: string }>
}

export interface PeerDiagnosis {
  pairings: PeerPairing[]
  /** The one action for the whole surface, and everything it repairs. */
  next: { fix: PeerFix; affects: string[] } | null
  certain: boolean
  /** Why it is not certain. Rendered above the list, never inside it. */
  caveats: string[]
  /** For the `sr-only` caption and the polite live region. */
  caption: string
}

const NO_FIX: PeerFix = { kind: 'none', actionId: null, params: {}, label: '', because: '' }

/**
 * Every sentence in the surface, in one table.
 *
 * `label`/`because` are the button and its one line. Nothing here may grow into a
 * second sentence — `verify-peers.mjs` enforces the caps.
 */
const COPY: Record<PeerState, { summary: string; label: string; because: string }> = {
  linked: { summary: 'Connected.', label: '', because: '' },

  unwired: {
    summary: 'Not connected — it has no tool for it.',
    label: 'Connect',
    because: 'An unlisted peer is offered as no tools at all, which is why nothing reports an error.',
  },
  pending: {
    summary: 'Connected in config; not yet running with it.',
    label: 'Apply it',
    because: 'secrets.yaml is the source and the container reads a rendered .env — installing writes it.',
  },
  'token-mismatch': {
    summary: 'Connected, with the wrong bearer — every call is refused.',
    label: 'Repair the link',
    because: 'The token it presents is not the one the far end accepts, so this is a 401 and nothing else.',
  },
  'token-absent': {
    summary: 'Listed as a peer, with no bearer to present.',
    label: 'Repair the link',
    because: 'The far end fails closed, so every call is refused before it does any work.',
  },
  'url-endpoint': {
    summary: 'Points at the endpoint instead of the host.',
    label: 'Repair the link',
    because: 'The client appends /mcp/ itself, so this resolves to /mcp/mcp/ and a 404 that looks like it is down.',
  },
  'url-drift': {
    summary: 'Points somewhere other than where it is.',
    label: 'Repair the link',
    because: 'The registry has a different address for it, and that is the one everything else uses.',
  },
  'token-shared': {
    summary: 'Two peers, and only one bearer to present.',
    label: 'Repair the link',
    because: 'One token is applied to every peer, so all but one answer 401 while the config looks right.',
  },

  'callee-not-installed': {
    summary: 'Nothing to call — it is not installed here.',
    label: 'Install it',
    because: 'There is no container behind this name yet.',
  },
  'callee-not-running': {
    summary: 'Nothing to call — it is not running.',
    label: 'Start it',
    because: 'A stopped app answers nothing, however well the link is wired.',
  },
  'callee-closed': {
    summary: 'It accepts no bearers, so it serves no tools.',
    label: 'Repair its configuration',
    because: 'With an empty key list agent-mcp-py fails closed and never mounts an MCP server.',
  },

  'caller-not-running': {
    summary: 'Not running, so it is calling nothing.',
    label: 'Start it',
    because: 'The link may be perfect; nothing is using it.',
  },

  unclear: {
    summary: 'Cannot be read from here.',
    label: 'Connect',
    because: 'Safe and idempotent either way, and it repairs the most common cause of this.',
  },
}

const TONE: Record<PeerState, PeerTone> = {
  linked: 'ok',
  unwired: 'warn',
  pending: 'warn',
  'token-mismatch': 'danger',
  'token-absent': 'danger',
  'url-endpoint': 'danger',
  'url-drift': 'danger',
  'token-shared': 'danger',
  'callee-not-installed': 'muted',
  'callee-not-running': 'muted',
  'callee-closed': 'danger',
  'caller-not-running': 'muted',
  unclear: 'warn',
}

function exists(container: string): boolean {
  return container !== 'missing' && container !== ''
}

function fix(
  state: PeerState,
  kind: PeerFix['kind'],
  actionId: string | null,
  params: Record<string, string> = {},
): PeerFix {
  const copy = COPY[state]
  return { kind, actionId, params, label: copy.label, because: copy.because }
}

/**
 * The bearer list on `callee` that `caller` is supposed to present a token from.
 *
 * Chosen by the manifest's `peers:`, never by the key's name. Bloom keeps
 * BLOOM_MCP_KEYS and BLOOM_ADMIN_KEYS deliberately apart — peer agents spend money,
 * the GUI edits configuration, and one leaked token must not buy both — so guessing
 * between them by name would be guessing about blast radius.
 */
export function bearerListFor(callee: InfraApp, caller: string): BearerKey | undefined {
  return (callee.bearerKeys ?? []).find((k) => k.peers.includes(caller))
}

/** A URL that names the MCP endpoint rather than the origin it is mounted on. */
function looksLikeEndpoint(url: string): boolean {
  const trimmed = url.replace(/\/+$/, '')
  return trimmed.endsWith('/mcp')
}

/** Compare two origins for equality, ignoring a trailing slash and case of the host. */
function sameOrigin(a: string, b: string): boolean {
  const norm = (u: string): string => u.trim().replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b) && norm(a) !== ''
}

/**
 * One pairing's state, in order of certainty.
 *
 * The order is the design, and it is the same argument `registry.ts` makes: a
 * container that does not exist has no token problem, so structural facts are settled
 * before anything is inferred from a fingerprint.
 */
function diagnosePair(
  caller: InfraApp,
  callee: InfraApp,
  status: InfraStatus,
  blind: boolean,
): PeerPairing {
  const registered = status.syncStore.servers.find((s) => s.name === callee.name)
  const link = (caller.peers ?? []).find((p) => p.name === callee.name)
  const bearers = bearerListFor(callee, caller.name)
  const expected = bearers?.entries.find((e) => e.name === caller.name)
  const presented = caller.peerTokenFingerprint ?? null

  const evidence: Array<{ label: string; value: string }> = [
    { label: `${caller.name} container`, value: caller.container },
    { label: `${callee.name} container`, value: callee.container },
  ]
  if (caller.peerMapKey) evidence.push({ label: 'peer map key', value: caller.peerMapKey })
  if (link) evidence.push({ label: 'points at', value: link.baseUrl || '(empty)' })
  if (link?.endpoint) evidence.push({ label: 'resolves to', value: link.endpoint })
  if (registered) evidence.push({ label: 'registered at', value: registered.baseUrl })
  if (bearers) evidence.push({ label: 'accepted on', value: bearers.key })
  if (expected) evidence.push({ label: 'expects', value: `sha256:${expected.fp}` })
  if (presented) evidence.push({ label: 'presents', value: `sha256:${presented}` })
  if (registered?.tokenFp) evidence.push({ label: 'registry holds', value: `sha256:${registered.tokenFp}` })

  // Discovery is a second, independent path to the same peer: the store's own token
  // for the callee, matching what the callee accepts. Reported, never counted as
  // linked, because Amber's `build_broker` passes an explicit resolver and so never
  // consults the registry — this is what will work after that ships, not now.
  const discoverable = Boolean(
    registered?.tokenFp && expected && registered.tokenFp === expected.fp,
  )

  const mk = (state: PeerState, f: PeerFix): PeerPairing => ({
    id: `${caller.name}->${callee.name}`,
    from: caller.name,
    to: callee.name,
    state,
    tone: TONE[state],
    summary: COPY[state].summary,
    fix: f,
    baseUrl: link?.baseUrl || null,
    discoverable,
    evidence,
  })

  const connect = (state: PeerState): PeerFix =>
    fix(state, 'action', 'connectPeer', { from: caller.name, to: callee.name })

  // 1. Is there anything at the far end to call? Cheapest and most certain, and the
  //    two cases have different buttons — one installs, the other starts.
  if (!exists(callee.container)) {
    return mk(
      'callee-not-installed',
      fix('callee-not-installed', 'action', 'installApp', {
        app: callee.name,
        domain: callee.domain ?? '',
        upstream: callee.upstream ?? '',
      }),
    )
  }
  if (callee.container !== 'running') {
    return mk('callee-not-running', fix('callee-not-running', 'action', 'restart', { app: callee.name }))
  }

  // 2. Does the far end serve tools at all? An empty bearer list is not a peering
  //    problem to be repaired from this side: agent-mcp-py fails closed, so the app
  //    mounts no MCP server and there is nothing to connect TO.
  if (!blind && bearers && bearers.entries.length === 0) {
    return mk('callee-closed', fix('callee-closed', 'action', 'reconcileApp', { app: callee.name }))
  }

  // 3. Below schema 12 nothing further is knowable. Offered the same safe repair,
  //    which is idempotent and correct whatever the real cause turns out to be.
  if (blind) return mk('unclear', connect('unclear'))

  // 4. Not wired at all — the state this whole surface exists for.
  if (!link) return mk('unwired', connect('unwired'))

  // 5. Wired. Everything below is about whether it can actually work.
  if (looksLikeEndpoint(link.baseUrl)) return mk('url-endpoint', connect('url-endpoint'))
  if (registered && link.baseUrl && !sameOrigin(link.baseUrl, registered.baseUrl)) {
    return mk('url-drift', connect('url-drift'))
  }

  if (!presented) return mk('token-absent', connect('token-absent'))
  if (expected && presented !== expected.fp) {
    // One token slot, several peers, and the value is right for one of them: the
    // ceiling in load_static_peers rather than a mistake anyone made. Named
    // separately because "repair this link" would break the peer it currently works
    // for, and saying so is the only honest thing this screen can do.
    const others = (caller.peers ?? []).filter((p) => p.name !== callee.name)
    if (others.length > 0) return mk('token-shared', connect('token-shared'))
    return mk('token-mismatch', connect('token-mismatch'))
  }

  // 6. The caller is right, and may not be running it yet. Checked here rather than
  //    first because a stopped caller with a BROKEN link should say so — restarting
  //    it would change nothing, and "start it" would be a button that cannot work.
  if (!exists(caller.container) || caller.container !== 'running') {
    return mk('caller-not-running', fix('caller-not-running', 'action', 'restart', { app: caller.name }))
  }

  return mk('linked', NO_FIX)
}

/**
 * A pairing whose caller has the link in secrets.yaml but not in its live `.env`.
 *
 * `peers` is read from the rendered file, so a freshly connected peer is simply
 * absent there and would read as `unwired` — offering Connect again, which would
 * appear to do nothing, forever. The declared side is what distinguishes "the write
 * landed and has not been applied" from "the write never happened", and it is the
 * one state whose fix is install rather than connect.
 */
function declaredButNotLive(caller: InfraApp, callee: string): boolean {
  if (!caller.peerMapKey) return false
  const declared = caller.env.find((e) => e.name === caller.peerMapKey)
  const value = declared?.value ?? ''
  if (!value) return false
  return value
    .split(',')
    .map((entry) => entry.split('=')[0]?.trim())
    .includes(callee)
}

function captionOf(pairings: PeerPairing[]): string {
  if (pairings.length === 0) return 'No app on this box declares a peer.'
  const linked = pairings.filter((p) => p.state === 'linked').length
  const broken = pairings.filter((p) => p.fix.kind !== 'none').length
  const parts = [
    `${pairings.length} pairing${pairings.length === 1 ? '' : 's'}`,
    `${linked} connected`,
  ]
  if (broken > 0) parts.push(`${broken} needing attention`)
  return `Peer connections. ${parts.join(', ')}.`
}

/**
 * Collapse every pairing's fix into the single most valuable one.
 *
 * Same rule as the registry map: identical `(actionId, params)` pairs are one button.
 * `connectPeer` params differ per pairing, so in practice this picks the most severe
 * rather than merging — which is the honest outcome, since connecting two different
 * peers really is two operations.
 */
function nextFix(pairings: PeerPairing[]): PeerDiagnosis['next'] {
  const groups = new Map<string, { fix: PeerFix; affects: string[] }>()
  for (const p of pairings) {
    if (p.fix.kind === 'none') continue
    const key = `${p.fix.actionId}|${JSON.stringify(p.fix.params)}`
    const found = groups.get(key)
    if (found) found.affects.push(p.id)
    else groups.set(key, { fix: p.fix, affects: [p.id] })
  }
  if (groups.size === 0) return null

  const severity = (id: string): number => {
    const found = pairings.find((p) => p.id === id)
    return found?.tone === 'danger' ? 2 : found?.tone === 'warn' ? 1 : 0
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.affects.length - a.affects.length || severity(b.affects[0]) - severity(a.affects[0]),
  )[0]
}

export function diagnosePeers(status: InfraStatus): PeerDiagnosis {
  const caveats: string[] = []
  const oldScript = status.schema < PEERS_SCHEMA
  if (oldScript) {
    caveats.push(
      `This box’s status script is older than this build (schema ${status.schema || 'none'} of ${PEERS_SCHEMA}), ` +
        'so peer connections cannot be read. Update infra to see them.',
    )
  } else if (!status.secretsReadable) {
    caveats.push(
      'secrets.yaml is not readable as this user, so what each app accepts cannot be read. ' +
        'Enter the root password above.',
    )
  }
  const blind = oldScript || !status.secretsReadable

  const here = status.apps.filter((a) => a.thisBox && (a.declared || exists(a.container)))
  const byName = new Map(here.map((a) => [a.name, a]))

  // Callers are apps with a peer map key. On an older box that field is absent, so
  // fall back to any app that has declared peers — otherwise a schema-11 box would
  // show an empty surface rather than an honest "cannot tell".
  const callers = here.filter(
    (a) => a.peerMapKey || (a.peers ?? []).length > 0 || (blind && hasPeerMapKey(a)),
  )

  const pairings: PeerPairing[] = []
  for (const caller of callers) {
    // Declared pairings, from the manifests: every app that names this caller in a
    // bearer list is a peer it is expected to be able to reach.
    const declared = here.filter((c) => c.name !== caller.name && bearerListFor(c, caller.name))
    // Plus anything already in its live map that nothing declares — rule 4.
    const wired = (caller.peers ?? [])
      .map((p) => byName.get(p.name))
      .filter((c): c is InfraApp => c !== undefined && c.name !== caller.name)

    const seen = new Set<string>()
    for (const callee of [...declared, ...wired]) {
      if (seen.has(callee.name)) continue
      seen.add(callee.name)

      const pair = diagnosePair(caller, callee, status, blind)
      // The one state diagnosePair cannot see, because it reads the LIVE env only.
      if (pair.state === 'unwired' && declaredButNotLive(caller, callee.name)) {
        pairings.push({
          ...pair,
          state: 'pending',
          tone: TONE.pending,
          summary: COPY.pending.summary,
          fix: fix('pending', 'action', 'installApp', {
            app: caller.name,
            domain: caller.domain ?? '',
            upstream: caller.upstream ?? '',
          }),
        })
        continue
      }
      pairings.push(pair)
    }
  }

  pairings.sort((a, b) => a.id.localeCompare(b.id))

  return {
    pairings,
    next: nextFix(pairings),
    certain: !blind,
    caveats,
    caption: captionOf(pairings),
  }
}

/**
 * Whether an app looks like a peer caller on a box too old to say so directly.
 *
 * Name-based, and only reachable when `blind` — the manifest is authoritative
 * everywhere else. It exists so that updating the checkout is presented as the fix
 * for an unreadable surface rather than the surface being empty and looking finished.
 */
function hasPeerMapKey(app: InfraApp): boolean {
  return app.envKeys.some((k) => k.endsWith('_PEERS'))
}
