/** Types shared across main, preload and renderer — the IPC vocabulary. */

import type { BloomLink, BloomRunEvent } from './bloom'
import type { ExtensionSummary } from './extensions'
import type { AudioChunkFrame, ServerFrame } from './protocol'
import { DEFAULT_THEME, type ThemeId } from './theme'

// --- connection -------------------------------------------------------------

export type ConnState =
  | 'idle' // never connected, or deliberately disconnected
  | 'connecting'
  | 'open'
  | 'reconnecting' // dropped, backing off before the next attempt
  | 'error' // handshake refused (usually a bad token); not retrying

export interface ConnectionStatus {
  state: ConnState
  sessionId: string | null
  resumed: boolean
  /** Human-readable context — a close code, a socket error, "bad token". */
  detail?: string
  /** ms until the next reconnect attempt, when `state === 'reconnecting'`. */
  retryInMs?: number
  attempt?: number
}

// --- the main -> renderer event stream --------------------------------------

/**
 * One channel carries everything main knows. A discriminated union beats a dozen
 * named channels: the preload subscription is written once, and adding a frame
 * type later needs no preload change.
 */
export type ApertureEvent =
  | { kind: 'frame'; frame: ServerFrame }
  | { kind: 'audio'; buffer: ArrayBuffer; meta: AudioChunkFrame | null }
  | { kind: 'connection'; status: ConnectionStatus }
  | { kind: 'audit'; entry: AuditEntry }
  | { kind: 'trace'; entry: TraceEntry }
  /** The full set of commands waiting on a human — replaces the previous set. */
  | { kind: 'approvals'; pending: PendingApproval[] }
  /**
   * What is installed and what it is allowed to do. The whole picture every time, like
   * `bloom-link` — a delta could leave the Settings page showing a permission as granted
   * after it was revoked, which is the one thing a consent screen must never do.
   */
  | { kind: 'extensions'; summaries: ExtensionSummary[] }
  /** One narrated step of a long-running operation (see `OpLogEntry`). */
  | { kind: 'op'; opId: string; entry: OpLogEntry }
  | { kind: 'op-done'; opId: string; ok: boolean; error?: string }
  /**
   * Where we stand with Bloom. The whole record every time, never a delta, so a
   * dropped event cannot leave the sidebar showing a state that has moved on.
   */
  | { kind: 'bloom-link'; link: BloomLink }
  /**
   * One entry in a Bloom run's trace. `runId` rides on the envelope rather than in
   * the payload so the reducer can key its bucket without unwrapping — and because
   * several runs can be in flight at once.
   */
  | { kind: 'bloom-run'; runId: string; event: BloomRunEvent }
  /**
   * A tool call Amber made turned out to have started a Bloom run.
   *
   * Amber cannot say this herself: `bloom__build_agent` blocks for the whole build
   * and only returns the run id at the end — by which time the interesting part is
   * over. So main matches the two after the fact (see `main/bloom/attach.ts`) and
   * this is how the pairing reaches the card, which then grows a live timeline.
   */
  | { kind: 'activity-run'; callId: string; runId: string }
  /**
   * A browser finished an OAuth flow and handed control back via `aperture://`.
   *
   * Carries only which provider it was, and even that is a hint: the URL is
   * attacker-reachable, so the renderer answers by re-reading the connection status
   * from Bloom, which is the only thing that knows what actually happened.
   */
  | { kind: 'bloom-oauth'; provider: string | null }

// --- operation logs ---------------------------------------------------------

/**
 * `debug` lines carry the low-level detail — the exact command, raw stdout, the
 * host key — and are only emitted when `verboseLogging` is on. Everything else is
 * always emitted: knowing which step failed should never be opt-in.
 */
export type OpLogLevel = 'info' | 'ok' | 'warn' | 'error' | 'debug'

export interface OpLogEntry {
  id: string
  ts: number
  level: OpLogLevel
  message: string
  /** Verbatim output, a command, a fingerprint. Rendered monospace. */
  detail?: string
}

/**
 * A line in the Status Panel's live trace. Distinct from `AuditEntry`: the trace is
 * an ephemeral view of a turn unfolding, the audit log is durable history of what
 * Amber ran.
 */
export interface TraceEntry {
  id: string
  ts: number
  level: 'info' | 'warn' | 'error'
  label: string
  detail?: string
  /**
   * Who produced this line, so the log can be filtered.
   *
   * The column deliberately stays *one* interleaved list — Amber is what kicks off a
   * Bloom run, and two columns would put cause and effect side by side. But until now
   * a Bloom line was identifiable only by the `bloom: ` prefix baked into its label,
   * which is a string to grep rather than a field to filter on.
   */
  source?: 'amber' | 'bloom' | 'bridge' | 'app'
}

// --- ssh --------------------------------------------------------------------

export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  /** References a private key in the safeStorage vault. Null until one is installed. */
  keyId: string | null
  /** Host key fingerprint, pinned on first connect (TOFU). Mismatches are refused. */
  fingerprint?: string
}

/** A stored key pair. The private half lives only in the encrypted vault. */
export interface KeyRecord {
  id: string
  label: string
  publicKey: string
  createdAt: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
  /** Set when the run failed before/outside the command itself (connect, timeout). */
  error?: string
}

// --- audit ------------------------------------------------------------------

export type AuditOutcome =
  | 'approved' // human approved, then it ran
  | 'auto' // confirmation was off, ran immediately
  | 'denied' // human said no
  | 'timeout' // nobody approved in time
  | 'error' // ran (or tried to) and failed

export interface AuditEntry {
  /** Amber's correlation id for the tool call. Opaque. */
  id: string
  ts: number
  server: string
  command: string
  outcome: AuditOutcome
  exitCode?: number
  /** Truncated — the audit log is a record, not a transcript. */
  output?: string
  durationMs?: number
}

/** A tool call waiting on a human. Surfaced in the Status Panel. */
export interface PendingApproval {
  id: string
  /**
   * What is waiting to be approved — a capability key like `ssh-terminal.run_command`
   * or `system-control.power.shutdown`.
   *
   * Widened from the old `{server, command}` pair when the bridge stopped being
   * SSH-only. `server` and `command` survive as optional fields so the existing card
   * can keep showing a command the way it always has, rather than every approval
   * collapsing to a generic line the day a second capability shipped.
   */
  action: string
  /** One line describing the arguments, already rendered for display. */
  detail: string
  server?: string
  command?: string
  requestedAt: number
  /** Wall-clock deadline; past it the bridge answers Amber itself. */
  expiresAt: number
}

// --- settings ---------------------------------------------------------------

export interface Settings {
  amberUrl: string
  authToken: string
  /** Reconnect automatically on an unexpected drop. */
  autoReconnect: boolean
  /** Gate Amber-initiated commands behind a click. On by default, deliberately. */
  confirmBeforeExec: boolean
  /** Play Amber's synthesized speech. Off is useful when working in a shared space. */
  playAudio: boolean
  /**
   * How Amber should sound, sent as a `set_voice` patch on every connect.
   *
   * The empty string and `0` mean **"don't override"** — that key is left out of the
   * patch entirely and Amber's own `AMBER_TTS_*` default stands. That sentinel is the
   * whole design: a fresh Aperture must not silently overwrite a voice someone chose
   * on the box, and "Use Amber's settings" has to be a state you can return to, not
   * just a value that happens to match today.
   *
   * The `voice` frame reports what is actually in effect, which is what the UI shows;
   * these four are only ever a request.
   */
  ttsVoice: string
  ttsModel: string
  /**
   * Which brain this machine asks for, as one of Amber's keywords (`coding`,
   * `fast`, …) — or a literal `vendor/model` id.
   *
   * `''` means **"don't override"**, exactly like `ttsVoice`: the key goes out as an
   * explicit `null` and Amber uses its own `AMBER_LLM_TIER`. That sentinel is what
   * keeps "Amber's own choice" a state you can return to rather than a value that
   * happens to match today.
   *
   * Per-connection and held on Amber's session, so it is re-sent on every `ready`.
   * What a keyword *points at* is not stored here at all — that lives in Amber's
   * database and the sync store, because it is shared with every other app.
   */
  llmKeyword: string
  /** 0.25–4.0, or 0 for Amber's default. 1.0 is unhurried; ~1.2 is conversational. */
  ttsSpeed: number
  /** Prose direction ("warm, brisk"). Only the `gpt-4o-*` models act on it. */
  ttsInstructions: string
  /**
   * Include low-level detail in operation logs: exact commands, raw output, host
   * key fingerprints, auth methods offered. On by default — this is a tool for
   * seeing what happened, and the quiet version is the one you have to opt into.
   */
  verboseLogging: boolean
  /**
   * Show every action, not just the one that moves you forward.
   *
   * Off by default, and deliberately NOT the same flag as `verboseLogging`. Those two
   * read like one idea and are not: verbose is about how much a running operation
   * narrates, and it defaults ON because knowing which step failed should never be
   * opt-in. This is about how many buttons exist, and must default OFF, because
   * reducing the surface is the entire point of it.
   *
   * Sharing one flag would force a choice between silencing the op log by default and
   * showing all two dozen actions by default — a regression either way.
   *
   * What it reveals: pin/rollback/rename, the raw env editor, the registry, backups,
   * the deploy journal, Caddy, and the un-composed install/uninstall/declare actions.
   * What stays visible without it: install, update, restart, remove.
   */
  advancedMode: boolean
  /**
   * Draw typed characters before the remote pty echoes them back.
   *
   * `auto` measures the round-trip and only predicts above `localEchoThresholdMs` —
   * on a nearby box the echo already beats a prediction, so guessing would be a
   * flicker for nothing. `off` is the escape hatch and the A/B control.
   */
  localEcho: 'auto' | 'off'
  localEchoThresholdMs: number
  /** Offer completions in the terminal (history, commands, paths, known flags). */
  terminalSuggestions: boolean
  /**
   * The colour theme. Lives here rather than in the renderer's localStorage — unlike
   * the sidebar's collapsed state, main needs this one too, to paint the window
   * background before a renderer exists. Two stores for one value would drift, and
   * the symptom would be a startup flash nobody can reproduce.
   */
  theme: ThemeId
}

export const DEFAULT_SETTINGS: Settings = {
  amberUrl: 'ws://localhost:8000/ws',
  authToken: '',
  autoReconnect: true,
  confirmBeforeExec: true,
  playAudio: true,
  ttsVoice: '',
  ttsModel: '',
  llmKeyword: '',
  ttsSpeed: 0,
  ttsInstructions: '',
  verboseLogging: true,
  advancedMode: false,
  localEcho: 'auto',
  localEchoThresholdMs: 30,
  terminalSuggestions: true,
  theme: DEFAULT_THEME,
}

// --- credentials ------------------------------------------------------------

/**
 * One saved credential, as everything outside the main process sees it.
 *
 * Beside `KeyRecord` because it is the same kind of thing — a vault entry whose
 * secret half never crosses `contextBridge`. Note there is no value field, and no IPC
 * channel that would return one: a credential is decrypted in main at the moment an
 * install needs it and goes straight into the SSH heredoc.
 */
export interface CredentialSummary {
  /** Primary key. Distinct from `credentialId` so two OpenRouter keys can coexist. */
  uid: string
  /**
   * The id an app's manifest matches on, e.g. `openrouter-api-key`.
   *
   * This is the whole feature: Amber's manifest names it against
   * `AMBER_OPENROUTER_API_KEY` and Bloom's against `BLOOM_OPENROUTER_API_KEY`, so one
   * saved value fills both — and the eight apps after them.
   */
  credentialId: string
  /** The user's own words, e.g. "OpenRouter (personal)". */
  label: string
  createdAt: number
  updatedAt: number
  /**
   * Decryptable on THIS machine, right now — derived on read, never persisted, the
   * way `bloom/link.ts` derives `hasToken`. `safeStorage` binds ciphertext to the OS
   * account, so a vault carried to another machine lists entries it cannot open; this
   * turns that into a row saying "re-enter" rather than an install that fails later.
   */
  readable: boolean
}

// --- infrastructure ---------------------------------------------------------

/**
 * The `deploy/status.sh` document version this build **requires**.
 *
 * Shared rather than living in main, because the renderer is what has to decide
 * whether the report it is about to draw can be trusted.
 *
 * This is a **hard gate**: below it, `InfraView` replaces the entire installed UI
 * with "the box's status script is out of date". So raise it only when an older
 * document would make this build draw something *wrong*, not merely something less
 * complete. 8 is where that line sits today — a schema-7 box lists `caddy` and
 * `sync-store` in the catalogue as though they were installable apps.
 *
 * It sat at 6 while boxes emitted 8, which is the harmless direction but still a lie:
 * the check is `schema < EXPECTED_SCHEMA`, so nothing ever warned and the constant
 * quietly stopped describing anything.
 */
export const EXPECTED_SCHEMA = 8

/**
 * The document version that carries per-app manifests — feature-detected, never gated.
 *
 * Everything schema 9 adds (`manifest`, `envPrefix`, `envPrefixDeclared`,
 * `envPrefixRendered`) is *additive*, so a box without it can still be managed; it
 * just falls back to the env editor instead of the readiness checklist. Making this a
 * second constant rather than raising `EXPECTED_SCHEMA` is deliberate: raising the
 * hard gate would blank the Servers tab on every box that has not run "Update infra"
 * yet, to buy a checklist. Check `status.schema >= MANIFEST_SCHEMA` at the point of
 * use and degrade, rather than refusing to draw the page.
 */
export const MANIFEST_SCHEMA = 9

/**
 * The document version that reports the registry's key list — feature-detected, never
 * gated, for exactly the reason above.
 *
 * Schema 10 adds `syncStore.keys` (what secrets.yaml declares and what the running
 * container was actually *started* with, both as fingerprints), `syncStore.startedAt`
 * and per-app `startedAt` / `syncTokenFingerprint`. Those are what let the registry
 * map name a single cause instead of listing four. Without them it still draws — every
 * app reads `unclear`, and the offered fix is the one that is safe either way.
 */
export const REGISTRY_SCHEMA = 10

/**
 * The document version that reports the registry's own image — feature-detected,
 * never gated, for the reason above.
 *
 * Schema 11 adds `syncStore.imagePinned` / `imageDeclared` / `imageRunning`. Below it
 * the version row simply doesn't draw; the update control still does, because updating
 * a registry whose version you cannot read is exactly the situation you want it for.
 */
export const SYNC_STORE_IMAGE_SCHEMA = 11

/**
 * The document version that can see PEERING at all.
 *
 * Schema 12 adds `apps[].peers` / `peerTokenFingerprint` / `bearerKeys` and
 * `syncStore.servers[].tokenFp`. Below it the peer surface degrades to a single
 * `unclear` row per pairing rather than disappearing: "this box's script cannot tell
 * you" is a finding, and hiding it would leave the screen looking like there is
 * nothing to wire — which is exactly the state that made Bloom invisible for a week.
 */
export const PEERS_SCHEMA = 12

/**
 * What a box still carries from before it was containerised.
 *
 * This repo assumes it owns 80, 443 and each app's loopback port; a Caddy or an Amber
 * installed straight onto the host owns them first. `install.sh` refuses in that
 * situation, correctly — but a refusal several minutes into a run is a poor way to
 * learn something knowable at a glance.
 */
/**
 * One hostname this box needs, checked against reality.
 *
 * Resolved through the box's OWN resolver, because that is the one Caddy will use —
 * checking from anywhere else answers a different question. `pointsHere` is true when
 * ANY returned address matches, so a round-robin record is not a false alarm.
 */
export interface DnsRecord {
  name: string
  /** Which app needs it, or "the registry". */
  why: string
  addresses: string[]
  pointsHere: boolean
}

export interface HostServices {
  /** The process holding the port, from `ss`. Null when nothing does. */
  port80: string | null
  port443: string | null
  /** Whether *our* container is the one holding them — both look like "caddy". */
  caddyContainer: boolean
  /** systemd units named after things this repo containerises. */
  units: string[]
}

/**
 * One entry under `apps.<name>.env` in `secrets.yaml` — the *editable source*, not
 * the rendered `.env` beside the container.
 *
 * `value` is null for anything `status.sh` classifies as a secret, and that is the
 * point: an editor does not need to read an API key in order to replace it, so the
 * status document never carries one and stays safe to poll and log. `set` and
 * `placeholder` describe the current value without disclosing it.
 */
export interface EnvVar {
  name: string
  secret: boolean
  /**
   * `install.sh` computes this and writes it into the rendered `.env` *after*
   * rendering secrets.yaml, so whatever is here is overwritten every install —
   * `*_PUBLIC_URL`, `*_SYNC_STORE_URL`, `*_SYNC_STORE_TOKEN`, `AMBER_UPDATE_COMMAND`.
   * Editing one is pointless, and listing a placeholder in one as an outstanding task
   * sends you hunting for a value that is about to be replaced.
   */
  derived: boolean
  /** Still holds a CHANGEME. Rendered into the app's `.env` verbatim if left. */
  placeholder: boolean
  set: boolean
  value: string | null
  /** From schema 9, when the app has a manifest: what it says about this key. */
  kind?: string | null
  credential?: string | null
  label?: string | null
  required?: boolean
}

/**
 * One app as `amber-infra`'s `deploy/status.sh --json` reports it.
 *
 * The union of what `secrets.yaml` declares and what Docker is actually running, so
 * something deployed by hand still appears — and so `imagePinned` vs `imageRunning`
 * drift is visible rather than inferred.
 */
export interface InfraApp {
  name: string
  domain: string | null
  upstream: string | null
  imagePinned: string | null
  imageRunning: string | null
  /** Docker's container state: running, exited, created, missing… */
  container: string
  /** healthy | unhealthy | starting | none | missing */
  health: string
  envFile: string | null
  composeFile: string | null
  /** Present in the sync-store registry, and when it last checked in. */
  registered: boolean
  lastSeen: string | null
  stale: boolean
  /** HTTP status of https://<domain>/health, or null if it did not answer. */
  httpStatus: number | null
  /**
   * Which box this app belongs on, from `apps.<name>.server`. Null when unset.
   *
   * Until now this field was a comment with syntax — nothing in amber-infra read it.
   * It means something here, which is exactly why `thisBox` is generous about it.
   */
  server: string | null
  /**
   * Whether it belongs on the box being viewed.
   *
   * True when the labels match *and* when either side is unset. An app is never
   * hidden on the strength of a field that had no meaning yesterday.
   */
  thisBox: boolean
  /** Has an `apps.<name>` stanza in this box's secrets.yaml. */
  declared: boolean
  /** The checkout carries `<name>/docker-compose.prod.yml`, so install.sh can deploy it. */
  available: boolean
  /** Env keys present in the *rendered* .env — what the container actually has. */
  envKeys: string[]
  /** The editable source in secrets.yaml. Diverges from `envKeys` until reconciled. */
  env: EnvVar[]
  /**
   * The app's own account of what it needs. Present from schema 9; null on an older
   * box or an app with no manifest, in which case the UI falls back to the env editor.
   */
  manifest?: ManifestDoc | null
  /** From the manifest — authoritative. */
  envPrefix?: string | null
  /** From `apps.<n>.env_prefix`, kept only as a cross-check. */
  envPrefixDeclared?: string | null
  /**
   * What install.sh actually wrote into the live `.env`.
   *
   * The three can disagree, and that disagreement *is* the bug this release exists to
   * make visible: an app reading one namespace while its keys sit in another starts,
   * serves, and never registers, with nothing anywhere saying so.
   */
  envPrefixRendered?: string | null
  /**
   * When the container last started, ISO-8601. Present from schema 10.
   *
   * Registration happens on startup and then only every 300 seconds, so "not
   * registered" twenty seconds after a restart and "not registered" an hour after one
   * are different findings with different answers. This is the only field that tells
   * them apart, and without it the honest thing to say was "give it a moment" — which
   * is what the old Bloom card said, forever, including when waiting was hopeless.
   */
  startedAt?: string | null
  /**
   * Fingerprint of the `*_SYNC_STORE_TOKEN` in this app's *rendered* env file.
   *
   * Compared against the `sync_store.keys` entry of the same name it separates two
   * failures that present identically: the registry never heard of this key, and the
   * app is still presenting an older one. The first is fixed at the registry, the
   * second at the app.
   */
  syncTokenFingerprint?: string | null
  /**
   * The app's own last words about registering. Present from schema 10.
   *
   * `agent_mcp`'s `register()` logs and swallows every failure by contract, so the
   * reason an app never registered reaches no other surface — not the store, not this
   * document, not the GUI. It exists only in the container's log. Reading it here is
   * what turns "it never checked in" from a dead end into a sentence naming the repair,
   * because the app already said what went wrong and nobody was listening.
   *
   * Bounded and redacted on the box: last 4 matching lines, 300 chars each, any
   * token-shaped run replaced.
   */
  registrationLog?: string[]

  // --- peering. Present from schema 12; see PEERS_SCHEMA. --------------------
  //
  // Registration and peering are different relations, and this document could only
  // see the first. An app can be registered, healthy and mounting its MCP server —
  // every green light schema 10 could show — while the one agent that matters has no
  // tool for it, because that agent's peer map is empty. Nothing is degraded in that
  // state and nothing errors: an unlisted peer is offered as no tools at all.

  /**
   * Who this app CALLS, parsed from the peer map in its **live** `.env`.
   *
   * Live rather than declared, because that is what the running container is acting
   * on. The gap between this and secrets.yaml is precisely the "wired, not yet
   * reconciled" state, which needs a different sentence from "not wired".
   */
  peers?: PeerLink[]
  /**
   * Digest of the single bearer this app presents to every peer in `peers`.
   *
   * Singular, and that is a real constraint rather than a simplification here:
   * `agent_mcp.load_static_peers(spec, token)` applies one token to the whole map, so
   * two peers wanting different credentials is not expressible. Comparing this
   * against a callee's `bearerKeys` entry is what turns a 401 into a named state.
   */
  peerTokenFingerprint?: string | null
  /** Who this app ACCEPTS, per declared token list. */
  bearerKeys?: BearerKey[]
  /** The env key holding the peer map, from the manifest's `peer_map` kind. */
  peerMapKey?: string | null
  /** The env key holding the peer bearer, from the manifest's `peer_token` kind. */
  peerTokenKey?: string | null
}

/** One entry in an app's peer map — a name and where it points. */
export interface PeerLink {
  name: string
  /** As written in the env file. Should be a bare origin, no path. */
  baseUrl: string
  /**
   * What `agent_runtime`'s MCP client will actually open: base + `/mcp/`.
   *
   * Resolved on the box by the same rule the client uses, and reported rather than
   * left to be imagined, because the most common hand-written mistake — pasting the
   * endpoint instead of the origin — produces `/mcp/mcp/` and a 404 that reads
   * exactly like the peer being down. Null when the entry has no URL at all.
   */
  endpoint: string | null
}

/**
 * One `generated:token` key on an app, and who may present a bearer from it.
 *
 * A list rather than a single field because an app legitimately keeps more than one:
 * Bloom separates `BLOOM_MCP_KEYS` (peer agents, which spend money) from
 * `BLOOM_ADMIN_KEYS` (the GUI, which edits configuration), so that one leaked token
 * cannot buy both. Which list a given caller belongs to is declared in the manifest's
 * `peers:`, never guessed from the key's name.
 */
export interface BearerKey {
  key: string
  /** Caller names the manifest says this list is for. */
  peers: string[]
  /** The entries actually present, as name + fingerprint. Never a token. */
  entries: SyncStoreKey[]
}

/**
 * One bearer key the registry knows about, as a name and a fingerprint.
 *
 * Never a token. `fp` is the first 8 hex of its sha256 — the same label
 * `sync-store/app/auth.py` stamps on a caller presenting a bare token, chosen so a
 * fingerprint here and one in the store's own log are the same string.
 */
export interface SyncStoreKey {
  name: string
  fp: string
  /** The value is still a CHANGEME placeholder, so it was never really set. */
  placeholder: boolean
}

/**
 * One app this checkout can install.
 *
 * The repo is the catalogue: `install.sh` refuses any app without a
 * `<name>/docker-compose.prod.yml`, so that file's presence is the definition rather
 * than a hint — and it already carries the pinned image and the loopback port, which
 * is everything an install needs except a hostname.
 */
/** One key an app declares it needs, as `status.sh` reports it. */
export interface ManifestKey {
  name: string
  /**
   * Who fills it: `generated:*` the box, `supplied` you, `derived` install.sh,
   * `config` a default, `peer_map`/`peer_token` cross-app wiring.
   *
   * Typed as a string rather than a union on purpose — an Aperture reading a newer
   * manifest must degrade, not crash, so an unrecognised kind is treated as
   * `supplied` at the point of use.
   */
  kind: string
  /** The vault id that fills this, when anything can. */
  credential: string | null
  label: string
  helpUrl: string | null
  why: string | null
  group: string | null
  source: string | null
  default: string | null
  required: boolean
  secret: boolean
}

/** An app's own account of what it needs. Null when its checkout has no manifest. */
export interface ManifestDoc {
  version: number
  /** Authoritative. The reason there is no prefix field in this UI any more. */
  envPrefix: string
  role: string | null
  release: { repo: string | null; package: string | null } | null
  keys: ManifestKey[]
}

export interface CatalogueEntry {
  name: string
  image: string | null
  /** e.g. "127.0.0.1:8000", read from the compose file's port binding. */
  upstream: string | null
  /** Present from schema 9. Lets a not-yet-declared app show its checklist. */
  manifest: ManifestDoc | null
}

export interface InfraStatus {
  installed: boolean
  /**
   * Version of the document `deploy/status.sh` produced.
   *
   * 0 means the script on that box predates the field. It matters because a missing
   * field and a false one are indistinguishable in JSON: without this, an old script
   * makes every capability read as absent, and the setup flow gets stuck on a step
   * that has already been done.
   */
  schema: number
  repoRoot: string | null
  commit: string | null
  role: string | null
  primaryDomain: string | null
  docker: string | null
  compose: string | null
  /** False when status.sh ran without the privilege to read secrets.yaml. */
  secretsReadable: boolean
  /** Which of the tools the management view depends on are installed. */
  tools: { git: boolean; jq: boolean; yq: boolean; docker: boolean }
  secrets: {
    present: boolean
    readable: boolean
    path: string
    /** False while `infra.acme_email` is still the example's value. */
    acmeEmailSet: boolean
    /**
     * Placeholders still in the file, split by who can fill them: `generatable` say
     * `CHANGEME-openssl-rand-hex-32` and are a chore, `manual` are API keys nobody
     * here can invent. The split is what lets setup offer a button for one group and
     * a shopping list for the other.
     */
    placeholders: { generatable: string[]; manual: string[] }
  }
  /** Editable, non-secret settings under `infra:` in secrets.yaml. */
  settings: {
    acmeEmail: string | null
    primaryDomain: string | null
    timezone: string | null
    role: string | null
  }
  hostServices: HostServices
  /** This box's label, matched against each app's `server`. */
  serverLabel: string | null
  /** What this checkout can install, whether or not it is declared or deployed. */
  catalogue: CatalogueEntry[]
  /**
   * The records this box needs and whether they actually resolve to it.
   *
   * Listing what you need is not the same as checking it, and the difference is the
   * whole cost — Caddy asks for a certificate as soon as a site block appears, and
   * Let's Encrypt rate-limits failures per domain.
   */
  dns: { publicIp: string | null; records: DnsRecord[] }
  apps: InfraApp[]
  caddy: { running: boolean; health: string; sites: string[] }
  syncStore: {
    url: string | null
    reachable: boolean
    servers: SyncStoreServer[]
    containerState: string
    /** Why it is not answering, when it is not. Four causes, four different fixes. */
    detail: string | null
    /** When the store's container last started, ISO-8601. Present from schema 10. */
    startedAt?: string | null
    /**
     * What the deployed compose file runs. Present from schema 11.
     *
     * The registry's version was the one thing this tab could not show, which made it
     * the one thing you could not tell was out of date.
     */
    imagePinned?: string | null
    /**
     * What `sync_store.image` in secrets.yaml says it should be.
     *
     * Separate from `imagePinned` because they genuinely diverge: `ensure_sync_store`
     * writes the image into the deployed compose only when it first creates it, so a
     * hand-edited pin looks applied and is silently waiting for the next fresh install
     * to take effect. `deploy/update-sync-store.sh` writes both.
     */
    imageDeclared?: string | null
    /** What the running container was actually started from. */
    imageRunning?: string | null
    /**
     * The key list from both sides. Present from schema 10.
     *
     * The store reads `SYNC_STORE_KEYS` **once, at container start**, so "the token in
     * secrets.yaml" and "the token the store is checking against" are two different
     * facts, and every unexplained 401 in this ecosystem is the gap between them.
     * `declared` is the first, `running` the second.
     *
     * `readable` is true only when *both* sides were actually read. An empty list from
     * an unreadable secrets file and an empty list from a store with no keys are the
     * same JSON and emphatically not the same finding — without this flag the second
     * reading would paint every app as broken and point at the wrong repair.
     */
    keys?: {
      readable: boolean
      running: SyncStoreKey[]
      declared: SyncStoreKey[]
    }
  }
  history: DeployRecord[]
  backups: { target: string | null; count: number; newest: string | null }
  /** Anything status.sh could not determine, verbatim, so nothing fails silently. */
  warnings: string[]
}

export interface SyncStoreServer {
  name: string
  baseUrl: string
  lastSeen: string | null
  stale: boolean
  /**
   * Whether the registry holds a peer credential for this server. Schema 12.
   *
   * The store keeps one token per server, settable only through
   * `PUT /servers/{name}/token`, and hands it out on discovery — it is what
   * `agent_mcp.PeerRegistry.refresh` loads and what `agent_runtime`'s MCP client
   * sends as the outbound `Authorization`. So an agent that resolves peers through
   * the registry presents THIS, not the value in its own env file, and the two can
   * disagree with nothing anywhere saying so.
   *
   * Undefined on a box older than schema 12 — which is not the same as false, and is
   * why this is a separate field from `tokenFp` rather than inferred from it.
   */
  tokenSet?: boolean
  /** Fingerprint of that credential, or null when none is set. Never the token. */
  tokenFp?: string | null
}

export interface DeployRecord {
  ts: string
  service: string
  from: string
  to: string
  result: string
}

/** One entry in the action catalogue main will run over SSH. See `main/infra`. */
export interface InfraAction {
  id: string
  label: string
  /** Whether the underlying script accepts `--dry-run`. */
  rehearsable: boolean
  needsSudo: boolean
}
