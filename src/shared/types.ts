/** Types shared across main, preload and renderer — the IPC vocabulary. */

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
  /** One narrated step of a long-running operation (see `OpLogEntry`). */
  | { kind: 'op'; opId: string; entry: OpLogEntry }
  | { kind: 'op-done'; opId: string; ok: boolean; error?: string }

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
  server: string
  command: string
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
   * Include low-level detail in operation logs: exact commands, raw output, host
   * key fingerprints, auth methods offered. On by default — this is a tool for
   * seeing what happened, and the quiet version is the one you have to opt into.
   */
  verboseLogging: boolean
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
  verboseLogging: true,
  localEcho: 'auto',
  localEchoThresholdMs: 30,
  terminalSuggestions: true,
  theme: DEFAULT_THEME,
}

// --- infrastructure ---------------------------------------------------------

/**
 * The `deploy/status.sh` document version this build knows how to read.
 *
 * Shared rather than living in main, because the renderer is what has to decide
 * whether the report it is about to draw can be trusted. Raise it in step with
 * `amber-infra`'s `status.sh`.
 */
export const EXPECTED_SCHEMA = 6

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
}

/**
 * One app this checkout can install.
 *
 * The repo is the catalogue: `install.sh` refuses any app without a
 * `<name>/docker-compose.prod.yml`, so that file's presence is the definition rather
 * than a hint — and it already carries the pinned image and the loopback port, which
 * is everything an install needs except a hostname.
 */
export interface CatalogueEntry {
  name: string
  image: string | null
  /** e.g. "127.0.0.1:8000", read from the compose file's port binding. */
  upstream: string | null
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
