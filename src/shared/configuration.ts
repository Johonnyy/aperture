/**
 * One app's configuration surface, as a single answerable list.
 *
 * Two sources describe an app's environment and neither is the whole story. The
 * **manifest** says what the app *needs* — every key, who is supposed to fill it, what
 * it is for. `secrets.yaml` says what has actually been *written*. Reading either alone
 * produces a specific wrong answer:
 *
 *   - env alone cannot show a key that nothing has written yet, which is exactly the
 *     class the operator is looking for. A missing row and a satisfied one are both
 *     "no problem visible".
 *   - the manifest alone cannot show a key someone added by hand, or tell a real value
 *     from a `CHANGEME`.
 *
 * So this joins them by name and classifies each row by *what you would do about it*,
 * which is the only grouping that makes the list shorter rather than longer:
 *
 *   needed    nothing usable is set, and the box will not invent one — you supply it
 *   settings  set, yours to change, not a secret
 *   secrets   set, yours to replace, never displayed
 *   managed   install.sh derives it or the box generates it — read-only, and saying
 *             otherwise sends someone hunting for a value about to be overwritten
 *
 * `live` is the third fact, and the one with no other home: `secrets.yaml` is the
 * source and the container reads a *rendered* `.env`. A row that is set but not live is
 * an edit that has not been reconciled — the same "looks green, isn't what you think"
 * shape as the image-tag drift on the card above it.
 *
 * In `shared/` with no Electron import, for the same reason `credentials.ts` is: the
 * classification decides what the operator is told is wrong, and `verify-configuration`
 * drives it with plain Node.
 */

import { looksSecret } from './credentials'
import type { Readiness, ReadinessItem } from './credentials'
import type { EnvVar } from './types'

export type ConfigGroup = 'needed' | 'settings' | 'secrets' | 'managed'

export interface ConfigRow {
  name: string
  /** What the app's manifest says about this key. Null on a box with no manifest. */
  item: ReadinessItem | null
  /** What `secrets.yaml` holds. Null when only the manifest knows this key. */
  env: EnvVar | null
  group: ConfigGroup
  /** Present in the *rendered* `.env` the running container actually read. */
  live: boolean
  /** Never rendered as text, whoever said so — manifest, status.sh, or the suffix. */
  secret: boolean
  /** A real value is written and it is not a placeholder. */
  filled: boolean
  /** A saved vault entry could fill this in one click. */
  fillable: boolean
  /** Blocks: the app is declared to need it and nothing will supply it. */
  required: boolean
  /** The manifest's one-line reason this key exists, when it gives one. */
  why: string | null
}

export interface ConfigView {
  rows: ConfigRow[]
  needed: ConfigRow[]
  settings: ConfigRow[]
  secrets: ConfigRow[]
  managed: ConfigRow[]
  /**
   * Written in `secrets.yaml`, absent from the running `.env`.
   *
   * The one state that looks like nothing at all: the value is right there in the
   * editor, and the container has never seen it.
   */
  pending: ConfigRow[]
  /** Needed *and* required — what actually stops this app working. */
  blocking: ConfigRow[]
}

export { looksSecret }

/**
 * Who fills this, from whichever source knows.
 *
 * `kind` is deliberately a string rather than a union — an Aperture reading a newer
 * manifest must degrade rather than crash, so an unrecognised kind falls through to
 * being treated as something you supply.
 */
function kindOf(item: ReadinessItem | null, env: EnvVar | null): string | null {
  return item?.kind ?? env?.kind ?? null
}

function isGenerated(kind: string | null): boolean {
  if (!kind) return false
  return kind.startsWith('generated:') || kind === 'peer_token' || kind === 'peer_map'
}

function groupOf(
  item: ReadinessItem | null,
  env: EnvVar | null,
  opts: { derived: boolean; generated: boolean; secret: boolean; filled: boolean },
): ConfigGroup {
  // Derived first and unconditionally. `install.sh` rewrites these *after* rendering
  // secrets.yaml, so whatever is there now is about to be replaced — listing one as an
  // outstanding task is how you send someone looking for a value that does not exist.
  if (opts.derived) return 'managed'

  const state = item?.state
  // The box will generate it on the next install, whether or not it is there now.
  if (state === 'generated') return 'managed'
  // `from-vault` sits here rather than under "ready": the question this list answers is
  // what the app *has*, and a key that only a saved credential could supply is one the
  // app does not have yet. It reads differently from the rest of the group — one click
  // rather than go and find a value — which is what `fillable` is for.
  if (state === 'needed' || state === 'from-vault') return 'needed'
  // No manifest to consult: a placeholder or an absent value is the only signal left.
  if (!item && !opts.filled) return 'needed'
  if (opts.generated) return 'managed'
  return opts.secret ? 'secrets' : 'settings'
}

/**
 * Join the manifest and `secrets.yaml` into one classified list.
 *
 * `envKeys` is the *rendered* `.env` — what the container was started with. Pass an
 * empty array for an app that is not deployed; every row then reads "not live", which
 * is true and which the UI suppresses rather than reporting as drift.
 */
export function buildConfigView(
  env: EnvVar[],
  envKeys: string[],
  readiness: Readiness | null,
): ConfigView {
  const byName = new Map<string, EnvVar>()
  for (const v of env) byName.set(v.name, v)
  const items = new Map<string, ReadinessItem>()
  for (const i of readiness?.items ?? []) items.set(i.name, i)

  // Manifest order first — it is the app's own account of itself, grouped by concern —
  // then anything only secrets.yaml knows about, which is by definition unexpected and
  // therefore worth appearing at the end rather than interleaved.
  const names = [...items.keys(), ...[...byName.keys()].filter((n) => !items.has(n))]

  const live = new Set(envKeys)
  const rows: ConfigRow[] = names.map((name) => {
    const item = items.get(name) ?? null
    const value = byName.get(name) ?? null
    const kind = kindOf(item, value)
    const derived = value?.derived === true || kind === 'derived'
    const generated = isGenerated(kind)
    const secret = value?.secret ?? item?.secret ?? looksSecret(name)
    const filled = Boolean(value?.set && !value.placeholder)

    return {
      name,
      item,
      env: value,
      group: groupOf(item, value, { derived, generated, secret, filled }),
      live: live.has(name),
      secret,
      filled,
      fillable: item?.state === 'from-vault',
      // A key nothing describes is required only in the weak sense that it is there.
      // Defaulting it to `true` would paint every hand-added row as blocking.
      required: item ? item.required : false,
      why: item?.why ?? null,
    }
  })

  const of = (group: ConfigGroup): ConfigRow[] => rows.filter((r) => r.group === group)
  const needed = of('needed')

  return {
    rows,
    needed,
    settings: of('settings'),
    secrets: of('secrets'),
    managed: of('managed'),
    // Only meaningful once something is running. `envKeys` is empty for an app that is
    // not deployed, and calling every row "pending" there would be an alarm about the
    // ordinary state of not having installed it yet.
    pending: envKeys.length === 0 ? [] : rows.filter((r) => r.env !== null && !r.live),
    blocking: needed.filter((r) => r.required),
  }
}
