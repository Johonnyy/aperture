/**
 * Which `.toe` to open, resolved from a name a model may have said out loud.
 *
 * Mirrors `getServer(idOrName)` in `src/main/config.ts`: the UI addresses a project by
 * id, Amber addresses it by name, and accepting either keeps the bridge from having to
 * care. One deliberate improvement on that precedent — `getServer` does a bare `find`,
 * so two servers sharing a name silently resolve to the first. Here a name is how Amber
 * picks what to launch, so a duplicate is refused at the point of editing instead.
 *
 * Pure: no Electron, so `verify:touchdesigner` drives it directly.
 */

import type { TdProject } from '../../../shared/touchdesigner'

export type { TdProject }

/** Case- and whitespace-insensitive, so "Bedroom Rig" and "bedroom  rig" collide. */
export function foldName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * A defensive read: `touchdesigner.json` is user-editable, so a hand-broken row should
 * cost one project rather than a boot. Same stance `nicknames.ts` documents.
 */
export function normalizeProjects(value: unknown): TdProject[] {
  if (!Array.isArray(value)) return []
  const out: TdProject[] = []
  const seenIds = new Set<string>()
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const { id, name, path } = row as { id?: unknown; name?: unknown; path?: unknown }
    if (typeof id !== 'string' || !id.trim()) continue
    if (typeof name !== 'string' || !name.trim()) continue
    if (seenIds.has(id)) continue
    seenIds.add(id)
    out.push({ id, name: name.trim(), path: typeof path === 'string' ? path.trim() : '' })
  }
  return out
}

export function nameTaken(projects: readonly TdProject[], name: string, exceptId?: string): boolean {
  const folded = foldName(name)
  return projects.some((p) => p.id !== exceptId && foldName(p.name) === folded)
}

function listNames(projects: readonly TdProject[]): string {
  return projects.map((p) => p.name).join(', ')
}

/**
 * Resolve a reference, or say what the options were.
 *
 * Never guesses between candidates when the reference is absent and there is more than
 * one project and no default — opening the wrong rig is worse than asking. This mirrors
 * `resolve_name` in Amber's device registry, which refuses to pick for the same reason.
 */
export function resolveProject(
  projects: readonly TdProject[],
  ref: string | undefined,
  defaultId: string,
): { project: TdProject } | { error: string } {
  if (projects.length === 0) {
    return { error: 'No TouchDesigner project is configured on this machine. Add one in Settings → TouchDesigner.' }
  }

  const wanted = typeof ref === 'string' ? ref.trim() : ''
  if (wanted) {
    const byId = projects.find((p) => p.id === wanted)
    if (byId) return { project: byId }
    const folded = foldName(wanted)
    const byName = projects.find((p) => foldName(p.name) === folded)
    if (byName) return { project: byName }
    return { error: `There's no project called "${wanted}". Configured here: ${listNames(projects)}.` }
  }

  const fallback = projects.find((p) => p.id === defaultId)
  if (fallback) return { project: fallback }
  if (projects.length === 1) return { project: projects[0] }
  return { error: `Which project? This machine has ${listNames(projects)}, and no default is set.` }
}
