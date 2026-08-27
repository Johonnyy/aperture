/**
 * Reading a device's announced capabilities as **state to render**, not verbs to list.
 *
 * The first version of this returned one control per capability and the panel drew them
 * as labelled rows. That is a menu, not a device: "Volume — Set this machine's output
 * volume — [slider]" makes you read a sentence to find out you can drag something. A
 * machine's volume is a *value it currently has*, and the interface should show the
 * value.
 *
 * So capabilities are partitioned into the shapes a device actually has — an output
 * with a level and a mute, power states, running applications — and whatever is left
 * over falls back to generic derivation. That fallback is load-bearing: it is what keeps
 * the panel honest for a device this build has never heard of. A phone announcing
 * `notify.toast`, or the TouchDesigner extension announcing `td.trigger`, still renders,
 * just without bespoke treatment. Hardcoding the panel to `system-control` would make
 * every new capability a release of *this* file.
 *
 * Pure: no React, no Electron, so `verify:devices` exercises the rules that would
 * otherwise fail by rendering something confidently wrong.
 */

import type { ControlSpec } from '../../shared/extensions'
import type { DeviceCapability } from '../../shared/protocol'

/** The capability keys this panel gives bespoke treatment. Everything else is generic. */
const AUDIO_GET = 'system-control.audio.get_volume'
const AUDIO_SET = 'system-control.audio.set_volume'
const AUDIO_MUTE = 'system-control.audio.mute'
const APPS_LIST = 'system-control.process.list'
const APPS_CLOSE = 'system-control.process.close'
const APPS_LAUNCH = 'system-control.process.launch'

const KNOWN = new Set([AUDIO_GET, AUDIO_SET, AUDIO_MUTE, APPS_LIST, APPS_CLOSE, APPS_LAUNCH])

export interface GenericControl {
  action: string
  label: string
  description: string
  destructive: boolean
  spec: ControlSpec
}

/** What a device offers, arranged the way it will be drawn. */
export interface DeviceSurface {
  /** Present when the device can report or change its output level. */
  audio: {
    canRead: boolean
    canSet: boolean
    canMute: boolean
  } | null
  /** Power states, in the order they should appear. Always destructive. */
  power: GenericControl[]
  apps: {
    canList: boolean
    canClose: boolean
    canLaunch: boolean
  } | null
  /** Anything this build has no bespoke rendering for. */
  other: GenericControl[]
}

/** Prettify `power.sleep` into `Sleep`. */
export function fallbackLabel(action: string): string {
  const tail = action.slice(action.indexOf('.') + 1)
  const words = tail.replace(/[._]/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Infer a control for a capability that declared none.
 *
 * A capability marked `destructive` always renders as a danger button regardless of
 * shape. The weight of a control has to match its consequence, and inferring a cheerful
 * toggle for "shut down" from an unlucky schema is the mistake worth designing out.
 * Otherwise: no arguments is a button, one bounded number is a slider, one boolean is a
 * toggle, anything else stays a button that sends its defaults.
 */
export function controlFor(capability: DeviceCapability): ControlSpec {
  const label = fallbackLabel(capability.action)
  if (capability.destructive) return { kind: 'button', label, tone: 'danger' }

  const schema = capability.input_schema as
    | { properties?: Record<string, { type?: string; minimum?: number; maximum?: number }> }
    | undefined
  const properties = schema?.properties ?? {}
  const names = Object.keys(properties)
  if (names.length !== 1) return { kind: 'button', label }

  const [arg] = names
  const property = properties[arg]
  if (
    property?.type === 'number' &&
    typeof property.minimum === 'number' &&
    typeof property.maximum === 'number'
  ) {
    return { kind: 'slider', label, arg, min: property.minimum, max: property.maximum }
  }
  if (property?.type === 'boolean') return { kind: 'toggle', label, arg }
  return { kind: 'button', label }
}

/**
 * Validate a `control` hint from the wire into something safe to render.
 *
 * A capability arrives from *another machine*, so its `control` is untrusted data, not a
 * `ControlSpec` we can cast to. A slider with a missing `max` renders a control with no
 * range; a `kind` we've never heard of renders nothing at all. Both are silent, and both
 * are avoided by validating and falling back to inference — which is also what makes the
 * hint optional rather than required.
 *
 * A **destructive** capability is never allowed a non-button control, whatever it asked
 * for: the weight of a control has to match its consequence, and a remote machine
 * describing "shut down" as a toggle must not get one.
 */
export function asControlSpec(value: unknown, destructive: boolean): ControlSpec | null {
  if (!value || typeof value !== 'object') return null
  const spec = value as Record<string, unknown>
  const label = typeof spec.label === 'string' && spec.label.trim() ? spec.label : null
  if (!label) return null

  if (spec.kind === 'button') {
    return { kind: 'button', label, tone: spec.tone === 'danger' || destructive ? 'danger' : 'default' }
  }
  if (destructive) return { kind: 'button', label, tone: 'danger' }

  if (spec.kind === 'toggle' && typeof spec.arg === 'string') {
    return { kind: 'toggle', label, arg: spec.arg }
  }
  if (
    spec.kind === 'slider' &&
    typeof spec.arg === 'string' &&
    typeof spec.min === 'number' &&
    typeof spec.max === 'number' &&
    spec.max > spec.min
  ) {
    return {
      kind: 'slider',
      label,
      arg: spec.arg,
      min: spec.min,
      max: spec.max,
      ...(typeof spec.step === 'number' && spec.step > 0 ? { step: spec.step } : {}),
    }
  }
  return null
}

function toGeneric(capability: DeviceCapability): GenericControl {
  const destructive = Boolean(capability.destructive)
  const declared = asControlSpec(capability.control, destructive)
  return {
    action: capability.action,
    label: declared?.label ?? fallbackLabel(capability.action),
    description: capability.description ?? '',
    destructive,
    spec: declared ?? controlFor(capability),
  }
}

export function surfaceFor(capabilities: DeviceCapability[]): DeviceSurface {
  const has = (action: string): boolean => capabilities.some((c) => c.action === action)

  const canRead = has(AUDIO_GET)
  const canSet = has(AUDIO_SET)
  const canMute = has(AUDIO_MUTE)

  const canList = has(APPS_LIST)
  const canClose = has(APPS_CLOSE)
  const canLaunch = has(APPS_LAUNCH)

  // Power is grouped by *consequence*, not by extension, because that is how someone
  // reads it: the two buttons that end your session belong together wherever they came
  // from. Sleep before shutdown — the reversible one first.
  const power = capabilities
    .filter((c) => c.destructive && /(^|\.)power\./.test(c.action))
    .map(toGeneric)
    .sort((a, b) => Number(a.action.includes('shutdown')) - Number(b.action.includes('shutdown')))

  const powerKeys = new Set(power.map((p) => p.action))
  const other = capabilities
    .filter((c) => !KNOWN.has(c.action) && !powerKeys.has(c.action))
    .map(toGeneric)

  return {
    audio: canRead || canSet || canMute ? { canRead, canSet, canMute } : null,
    power,
    apps: canList || canClose || canLaunch ? { canList, canClose, canLaunch } : null,
    other,
  }
}

/** True when the device announced nothing this panel can draw at all. */
export function isEmpty(surface: DeviceSurface): boolean {
  return !surface.audio && !surface.apps && surface.power.length === 0 && surface.other.length === 0
}

export const ACTIONS = {
  audioGet: AUDIO_GET,
  audioSet: AUDIO_SET,
  audioMute: AUDIO_MUTE,
  appsList: APPS_LIST,
  appsClose: APPS_CLOSE,
  appsLaunch: APPS_LAUNCH,
} as const

/**
 * Pull the application names back out of what `process.list` reported.
 *
 * The handler formats them as `Running: a, b, c.` — the same kind of contract
 * `describeAudio` is, and for the same reason: a `tool_result` is a string, so a list
 * has nowhere structured to travel.
 */
export function parseApps(message: string): string[] {
  const match = message.match(/^Running:\s*(.+?)\.?\s*$/s)
  if (!match) return []
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}
