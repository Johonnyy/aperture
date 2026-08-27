/**
 * Turning a device's announced capabilities into controls to render.
 *
 * The panel is **generated**, never hardcoded. A volume slider exists for a device that
 * announced `system-control.audio.set_volume` and for no other reason, so the day
 * Aperture mobile ships announcing only `notify.toast`, its card renders one button and
 * nothing in this repo changes. Hardcoding the controls would make every new device a
 * desktop release.
 *
 * Pure — no React, no Electron — so `verify:devices-panel` can exercise it. The rules
 * below each have a wrong answer that produces a confidently misleading UI rather than
 * an error, which is why they are tested rather than eyeballed.
 */

import type { ControlSpec, DeviceCapability } from '../../shared/extensions'

export interface DeviceControl {
  /** The dotted capability key to send. */
  action: string
  label: string
  description: string
  destructive: boolean
  spec: ControlSpec
}

/** Prettify `power.sleep` into `Sleep` when a device didn't declare a control. */
function fallbackLabel(action: string): string {
  const tail = action.slice(action.indexOf('.') + 1)
  const words = tail.replace(/[._]/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Infer a control when the device didn't declare one.
 *
 * A device we don't control — a phone, a script, something not written yet — can
 * legitimately announce a bare capability with no `control` hint, and refusing to render
 * it would make the panel silently incomplete. So: no arguments means a button, one
 * bounded number means a slider, one boolean means a toggle, and anything else stays a
 * button that sends its defaults.
 *
 * A capability marked `destructive` always renders as a danger button regardless of
 * shape — the weight of the control has to match the consequence, and inferring a
 * cheerful toggle for "shut down" is precisely the mistake worth designing out.
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

export function controlsFor(capabilities: DeviceCapability[]): DeviceControl[] {
  return capabilities.map((capability) => ({
    action: capability.action,
    label: fallbackLabel(capability.action),
    description: capability.description ?? '',
    destructive: Boolean(capability.destructive),
    spec: controlFor(capability),
  }))
}

/**
 * Group controls by their extension, so a card reads as "System Control: Sleep, Shut
 * down" rather than a flat row of buttons whose provenance is invisible.
 */
export function groupByExtension(
  controls: DeviceControl[],
): { extensionId: string; controls: DeviceControl[] }[] {
  const groups = new Map<string, DeviceControl[]>()
  for (const control of controls) {
    const dot = control.action.indexOf('.')
    const extensionId = dot > 0 ? control.action.slice(0, dot) : control.action
    const existing = groups.get(extensionId)
    if (existing) existing.push(control)
    else groups.set(extensionId, [control])
  }
  return [...groups].map(([extensionId, grouped]) => ({ extensionId, controls: grouped }))
}

/** Turn an extension id into something to print. `system-control` -> `System control`. */
export function extensionLabel(extensionId: string): string {
  const words = extensionId.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
