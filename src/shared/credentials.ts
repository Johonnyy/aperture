/**
 * The credential vault's logic, with no Electron in it.
 *
 * In `shared/` rather than beside the store because the renderer needs it too: the
 * readiness checklist and the Install button have to agree about what "ready" means,
 * and a second copy of that arithmetic in the UI is exactly how a button and the truth
 * drift apart.
 *
 * Split out from `credential-store.ts` so `scripts/verify-credentials.mjs` can drive
 * the parts that are easy to get quietly wrong — the destructure that keeps ciphertext
 * out of the renderer, and the arithmetic behind "3 of 4 ready" — with plain Node.
 * Everything that touches `safeStorage` or `app.getPath` lives on the other side.
 *
 * What a credential IS here: a value the user already holds from somewhere else in
 * the world. An OpenRouter key, a Spotify client secret. The vault never *invents*
 * one — `install.sh`'s rule is that a value invented at a prompt is a value that is
 * not in the backup, and the same applies to one invented by a GUI. Generated secrets
 * are generated on the box, by `install/fill-secrets.sh`.
 *
 * The point of the whole thing is `credentialId`. An app's manifest says
 * `credential: openrouter-api-key` against `AMBER_OPENROUTER_API_KEY`, and Bloom's
 * says the same id against `BLOOM_OPENROUTER_API_KEY`. One saved value, two apps, two
 * different env var names — and eight apps later you still have not typed it twice.
 */

import type { CredentialSummary } from './types'

export type { CredentialSummary }

/** What is actually on disk. `encryptedValue` must never leave the main process. */
export interface StoredCredential extends Omit<CredentialSummary, 'readable'> {
  /** Base64 `safeStorage` ciphertext. */
  encryptedValue: string
}

export interface VaultShape {
  credentials: StoredCredential[]
}

/**
 * Strip the ciphertext. **This destructure is the security boundary** — the same one
 * `ssh/key-store.ts:listKeys` draws, and it is worth stating twice because it is one
 * character away from not being there.
 */
export function publicView(record: StoredCredential, readable: boolean): CredentialSummary {
  const { encryptedValue: _omit, ...rest } = record
  return { ...rest, readable }
}

/**
 * Whether a key name alone says "never render this".
 *
 * Mirrors the suffix rule `deploy/status.sh` uses to decide which values to omit from
 * the report, and is the fallback for a key no manifest describes — a box predating
 * manifests, or a variable somebody added by hand. One copy, because a UI masking on a
 * different rule than the one that withheld the value is a UI that shows a secret.
 */
export function looksSecret(name: string): boolean {
  return /(_KEY|_KEYS|_TOKEN|_SECRET|_PASSWORD|_PASS)$/.test(String(name ?? ''))
}

/**
 * Normalise a credential id to the shape manifests use, so a value saved as
 * "OpenRouter API Key" still matches `credential: openrouter-api-key`.
 *
 * Lower-kebab, and CI enforces the same shape on the manifest side
 * (`manifest_lint`'s check 7), so the two cannot drift into never matching.
 */
export function normalizeId(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Every saved credential for an id, newest first.
 *
 * Returns a list rather than a single match because two are legitimate — a work key
 * and a personal one. One match auto-fills; several make the row ask which, and that
 * choice stays component state so there is no stale preference to go wrong later.
 */
export function matchFor(credentialId: string, records: CredentialSummary[]): CredentialSummary[] {
  const want = normalizeId(credentialId)
  if (!want) return []
  return records
    .filter((r) => normalizeId(r.credentialId) === want)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.uid.localeCompare(b.uid))
}

/** One manifest key, as the readiness calculation needs to see it. */
export interface ManifestKey {
  name: string
  kind: string
  credential?: string | null
  label?: string | null
  helpUrl?: string | null
  group?: string | null
  required?: boolean
  /**
   * The manifest's default for a `config` key.
   *
   * Load-bearing, not decoration: `declare.sh` seeds it into the stanza, so a config
   * key WITH a default is already answered and must never block an install. Leaving
   * this off the type is what let that happen — see the `config` branch below.
   */
  default?: string | null
  /**
   * The manifest's one-line reason this key exists.
   *
   * Carried through rather than dropped because the checklist is not the only reader
   * any more: the configuration list shows every key an installed app has, and a name
   * like `AMBER_FEATURE_SIGNALS` is not self-explaining to the person deciding whether
   * to change it.
   */
  why?: string | null
  /** Never render this as text. Authoritative over the name-suffix guess. */
  secret?: boolean
}

export interface ReadinessItem {
  name: string
  kind: string
  label: string
  credential: string | null
  helpUrl: string | null
  group: string | null
  required: boolean
  /** The manifest default, so the checklist can show and offer to override it. */
  default: string | null
  /** The manifest's reason this key exists, for a list that is read, not just counted. */
  why: string | null
  /** Never displayed. The manifest's word, falling back to the name-suffix rule. */
  secret: boolean
  /**
   * How this key will get its value, and whether anything is still needed.
   *
   * Only `needed` blocks. `default` is a config key that `declare.sh` will seed from
   * the manifest — worth showing, because you may want to override it, but answered.
   */
  state: 'set' | 'generated' | 'derived' | 'from-vault' | 'default' | 'needed'
  /** Candidate vault entries, when `state` is `from-vault` or `needed`. */
  matches: CredentialSummary[]
}

export interface Readiness {
  items: ReadinessItem[]
  /** Counts over *required* keys only — the ones that actually block an install. */
  ready: number
  total: number
  /** Required, supplied, and nothing to fill it with. What the row complains about. */
  missing: ReadinessItem[]
}

/**
 * "3 of 4 ready — needs OpenRouter".
 *
 * Only `required` keys are counted, and `derived` keys are never counted at all: they
 * are written by `install.sh` after the env is rendered, so listing one as something a
 * human has to go and find is how you send someone hunting for a value that is about
 * to be overwritten.
 *
 * `envValues` is what `apps.<n>.env` already holds, by key name — a value that is set
 * and is not a placeholder is done, whoever put it there.
 */
export function readinessOf(
  keys: ManifestKey[],
  envValues: Record<string, { set: boolean; placeholder: boolean }>,
  vault: CredentialSummary[],
): Readiness {
  const items: ReadinessItem[] = keys.map((k) => {
    const required = k.required !== false
    const env = envValues[k.name]
    const filled = Boolean(env?.set && !env.placeholder)
    const matches = k.credential ? matchFor(k.credential, vault) : []

    let state: ReadinessItem['state']
    if (k.kind === 'derived') state = 'derived'
    else if (filled) state = 'set'
    else if (k.kind.startsWith('generated:')) state = 'generated'
    else if (k.kind === 'peer_token' || k.kind === 'peer_map') state = 'generated'
    // A config key is answered by its own default, which `declare.sh` seeds. Without
    // this branch it fell through to `needed` — and because a config key names no
    // credential, the checklist offered no way to enter one either. BLOOM_DB_PATH and
    // BLOOM_FEATURE_OAUTH both blocked Install with no button that would unblock it.
    else if (k.kind === 'config')
      state = k.default !== null && k.default !== undefined && k.default !== ''
        ? 'default'
        : 'needed'
    else if (matches.some((m) => m.readable)) state = 'from-vault'
    else state = 'needed'

    return {
      name: k.name,
      kind: k.kind,
      label: k.label || k.name,
      credential: k.credential ?? null,
      helpUrl: k.helpUrl ?? null,
      group: k.group ?? null,
      default: k.default ?? null,
      why: k.why ?? null,
      // The manifest is authoritative when it says anything; otherwise the same suffix
      // rule `status.sh` applies, so a key with no manifest entry is still masked.
      secret: k.secret ?? looksSecret(k.name),
      required,
      state,
      matches,
    }
  })

  // `derived` is excluded from the denominator as well as the numerator — "3 of 4"
  // has to be a count of things you could do something about, or it never reaches 4/4.
  const counted = items.filter((i) => i.required && i.state !== 'derived')
  const ready = counted.filter((i) => i.state !== 'needed').length
  return {
    items,
    ready,
    total: counted.length,
    missing: counted.filter((i) => i.state === 'needed'),
  }
}
