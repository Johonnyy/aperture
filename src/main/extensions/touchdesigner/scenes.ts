/**
 * The scene list, as data rather than as trust.
 *
 * Scene names come from a `.toe` file the user wrote, arrive over HTTP, and end up in
 * two places that both cost something to get wrong: an `enum` announced to Amber (and
 * from there into every turn's system prompt) and a row of buttons on every client in
 * the fleet. So they are normalized once, here, and the caps are deliberate — the
 * binding constraint is not `max_device_capabilities`, it is the 900 characters Amber
 * gives the whole fleet block.
 *
 * Pure: no Electron, no Node, so `verify:touchdesigner` drives it directly.
 */

/** Enough for a real rig, few enough that the fleet block survives it. */
export const MAX_SCENES = 24
export const MAX_SCENE_CHARS = 64

/** Strings only, trimmed, non-empty, bounded, deduped in first-seen order, capped. */
export function normalizeScenes(values: unknown, limit: number = MAX_SCENES): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const scene = value.trim()
    if (!scene || scene.length > MAX_SCENE_CHARS) continue
    if (seen.has(scene)) continue
    seen.add(scene)
    out.push(scene)
    if (out.length >= limit) break
  }
  return out
}

/** Order is meaningful — it is the order the buttons render in — so a reorder is a change. */
export function sameScenes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((scene, i) => scene === b[i])
}

/**
 * Pull a scene list out of whatever the project replied with.
 *
 * `null` means "the project did not mention scenes", which is different from "the
 * project has none" — the first must leave a cached list alone, the second must clear
 * it. That distinction is why this does not simply return `[]`.
 */
export function extractScenes(result: Record<string, unknown>): string[] | null {
  if (!result || typeof result !== 'object') return null
  if (!('scenes' in result)) return null
  const raw = (result as { scenes?: unknown }).scenes
  if (!Array.isArray(raw)) return null
  return normalizeScenes(raw)
}

/**
 * The capability whose `scene` argument the cached list feeds.
 *
 * A constant rather than a literal at the splice site so the string exists in exactly
 * one place: `registry.ts` decorates this key, `verify:touchdesigner` asserts the real
 * manifest produces an enum on it, and a rename that misses one of them fails the build
 * instead of silently announcing a plain string schema forever.
 */
export const TD_SWITCH_SCENE_KEY = 'touchdesigner.switch_scene'
