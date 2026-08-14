/** Types shared across main, preload and renderer — the IPC vocabulary. */

import type { AudioChunkFrame, ServerFrame } from './protocol'

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
}

export const DEFAULT_SETTINGS: Settings = {
  amberUrl: 'ws://localhost:8000/ws',
  authToken: '',
  autoReconnect: true,
  confirmBeforeExec: true,
  playAudio: true,
}
