import type { CatalogueModel } from '../../shared/models'

/**
 * What models exist to point a keyword at, from OpenRouter's public catalogue.
 *
 * Fetched here rather than through Amber for two reasons. It is a *browsing* concern
 * — the list is only ever read to fill a picker, and Amber would just be a proxy with
 * an extra frame — and the endpoint needs no key, so asking it directly costs nothing
 * and works before Amber is even reachable. The renderer cannot call it itself: the
 * CSP forbids it, and main is where the app's network access already lives.
 *
 * **A suggestion list, never a constraint.** The field it fills stays free text, so a
 * model published this morning is usable this morning. A failed fetch therefore
 * degrades to typing an id, which is exactly the pre-catalogue behaviour.
 *
 * Cached for the process's life: the catalogue changes on the order of weeks and this
 * is a settings page, not a feed.
 */
const ENDPOINT = 'https://openrouter.ai/api/v1/models'
const TIMEOUT_MS = 8_000

let cache: CatalogueModel[] | null = null
let inFlight: Promise<CatalogueModel[]> | null = null

interface RawModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown }
}

function toModel(raw: RawModel): CatalogueModel | null {
  if (typeof raw?.id !== 'string' || !raw.id.includes('/')) return null
  // OpenRouter prices are USD per token, as strings. Per million is the unit anyone
  // actually compares in, and the conversion belongs here rather than in three
  // places in the UI.
  const perToken = Number(raw.pricing?.prompt)
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    promptPrice: Number.isFinite(perToken) ? perToken * 1_000_000 : null,
    contextLength:
      typeof raw.context_length === 'number' ? raw.context_length : null,
  }
}

export async function listModels(refresh = false): Promise<CatalogueModel[]> {
  if (cache && !refresh) return cache
  // Collapse a burst — opening Settings twice must not mean two fetches.
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const response = await fetch(ENDPOINT, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as { data?: RawModel[] }
      const models = (body.data ?? [])
        .map(toModel)
        .filter((m): m is CatalogueModel => m !== null)
        .sort((a, b) => a.id.localeCompare(b.id))
      cache = models
      return models
    } catch {
      // Never throws. An unreachable catalogue is a suggestion list that is empty,
      // not a settings page that fails to open.
      return cache ?? []
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}
