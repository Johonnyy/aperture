/**
 * This machine's TouchDesigner setup, and the scene list last read from it.
 *
 * Its own file rather than a key in `settings.json`, the same call `extensions.json`
 * and `nicknames.json` make: clearing app preferences must not silently re-point which
 * project Amber launches.
 *
 * **Flat at the top level**, because `JsonStore.read` merges exactly one level over its
 * defaults. `projects` and `cachedScenes` are top-level arrays replaced wholesale, which
 * is fine; a second level of nesting would arrive from an older build partial and be
 * typed as complete.
 *
 * ## Two behaviours here are correctness, not housekeeping
 *
 * `setScenes` returns **whether the list actually changed**, and only a change triggers
 * a re-announce. A project is free to echo its scene list on every `switch_scene`, and
 * without this every scene tap would put a `device_announce` on the wire.
 *
 * Changing the port or the project **clears the cache**. A scene list belonging to a
 * different `.toe` is not merely stale, it is wrong, and it would reach Amber's system
 * prompt and be spoken with confidence.
 */

import { randomUUID } from 'node:crypto'

import type { TdConfig, TdProject } from '../../../shared/touchdesigner'
import { JsonStore } from '../../store'
import { normalizePort, TD_DEFAULT_PORT } from './bridge'
import { nameTaken, normalizeProjects } from './projects'
import { normalizeScenes, sameScenes } from './scenes'

export type { TdConfig }

const DEFAULTS: TdConfig = {
  executablePath: '',
  processName: '',
  bridgePort: TD_DEFAULT_PORT,
  projects: [],
  defaultProjectId: '',
  cachedScenes: [],
  scenesUpdatedAt: 0,
}

let store: JsonStore<TdConfig> | null = null

/** Lazily: `app.getPath('userData')` is invalid before the app is ready. */
function config(): JsonStore<TdConfig> {
  if (store) return store
  store = new JsonStore<TdConfig>('touchdesigner.json', { ...DEFAULTS })
  return store
}

/** Normalized on **read** as well as write — the file is hand-editable. */
export function getTdConfig(): TdConfig {
  const raw = config().get()
  return {
    executablePath: typeof raw.executablePath === 'string' ? raw.executablePath.trim() : '',
    processName: typeof raw.processName === 'string' ? raw.processName.trim() : '',
    bridgePort: normalizePort(raw.bridgePort),
    projects: normalizeProjects(raw.projects),
    defaultProjectId: typeof raw.defaultProjectId === 'string' ? raw.defaultProjectId : '',
    cachedScenes: normalizeScenes(raw.cachedScenes),
    scenesUpdatedAt: typeof raw.scenesUpdatedAt === 'number' ? raw.scenesUpdatedAt : 0,
  }
}

export function listScenes(): string[] {
  return getTdConfig().cachedScenes
}

export function listProjects(): TdProject[] {
  return getTdConfig().projects
}

/**
 * Patch the machine-level settings.
 *
 * Returns whether the scene cache was dropped, so the caller knows a re-announce is
 * owed: the announced `enum` just changed.
 */
export function updateTdSettings(
  patch: Partial<Pick<TdConfig, 'executablePath' | 'processName' | 'bridgePort' | 'defaultProjectId'>>,
): { config: TdConfig; scenesCleared: boolean } {
  const before = getTdConfig()
  const next: Partial<TdConfig> = {}

  if (patch.executablePath !== undefined) next.executablePath = String(patch.executablePath).trim()
  if (patch.processName !== undefined) next.processName = String(patch.processName).trim()
  if (patch.defaultProjectId !== undefined) next.defaultProjectId = String(patch.defaultProjectId)
  if (patch.bridgePort !== undefined) next.bridgePort = normalizePort(patch.bridgePort)

  // A different port is a different project's scene list.
  const portChanged = next.bridgePort !== undefined && next.bridgePort !== before.bridgePort
  if (portChanged) {
    next.cachedScenes = []
    next.scenesUpdatedAt = 0
  }

  config().set(next)
  return { config: getTdConfig(), scenesCleared: portChanged && before.cachedScenes.length > 0 }
}

export function addProject(input: { name: string; path: string }): { project: TdProject } | { error: string } {
  const name = String(input.name ?? '').trim()
  if (!name) return { error: 'A project needs a name.' }
  const projects = listProjects()
  if (nameTaken(projects, name)) return { error: `There is already a project called "${name}".` }

  const project: TdProject = { id: randomUUID(), name, path: String(input.path ?? '').trim() }
  config().set({ projects: [...projects, project] })
  return { project }
}

export function updateProject(
  id: string,
  patch: Partial<Omit<TdProject, 'id'>>,
): { project: TdProject } | { error: string } {
  const projects = listProjects()
  const existing = projects.find((p) => p.id === id)
  if (!existing) return { error: 'That project is no longer configured.' }

  const name = patch.name !== undefined ? String(patch.name).trim() : existing.name
  if (!name) return { error: 'A project needs a name.' }
  if (nameTaken(projects, name, id)) return { error: `There is already a project called "${name}".` }
  const path = patch.path !== undefined ? String(patch.path).trim() : existing.path

  // `id` is re-pinned after the spread so a patch cannot rewrite it, as `updateServer` does.
  const next = projects.map((p) => (p.id === id ? { ...p, name, path, id: p.id } : p))
  config().set({ projects: next })
  return { project: next.find((p) => p.id === id) as TdProject }
}

export function removeProject(id: string): TdProject[] {
  const before = getTdConfig()
  const projects = before.projects.filter((p) => p.id !== id)
  const patch: Partial<TdConfig> = { projects }
  if (before.defaultProjectId === id) patch.defaultProjectId = ''
  config().set(patch)
  return projects
}

/**
 * Record a freshly-read scene list.
 *
 * Returns whether anything changed. That boolean is the only thing standing between a
 * chatty project and a re-announce on every command.
 */
export function setScenes(next: readonly string[], now: number = Date.now()): boolean {
  const scenes = normalizeScenes(next)
  const before = getTdConfig().cachedScenes
  const changed = !sameScenes(before, scenes)
  config().set({ cachedScenes: scenes, scenesUpdatedAt: now })
  return changed
}

/**
 * The link between a handler and the `ToolBridge`.
 *
 * A handler receives only `ctx {platform, timeoutMs, callId}` and has no way to reach
 * the bridge, so `src/main/index.ts` subscribes here once and re-announces. Listeners
 * are additive and never throw outward: a failed announce must not fail the tool call
 * that triggered it.
 */
type Listener = () => void
const listeners = new Set<Listener>()

export function onScenesChanged(listener: Listener): void {
  listeners.add(listener)
}

export function notifyScenesChanged(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // The announce is best-effort; the tool result is already on the wire.
    }
  }
}

