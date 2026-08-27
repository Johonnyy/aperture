import { useEffect, useState } from 'react'

import type { DeviceRecord } from '../../shared/protocol'
import { cn } from '../cn'
import { useStore } from '../store'
import {
  controlsFor,
  extensionLabel,
  groupByExtension,
  type DeviceControl,
} from './controls'

/**
 * Every machine Amber can reach, and the controls each one says it has.
 *
 * **The controls are generated, never hardcoded.** A card shows a Sleep button because
 * that device announced `system-control.power.sleep`, and for no other reason. That is
 * what makes this future-proof for Aperture mobile: a phone announcing only
 * `notify.toast` renders one button, and nothing in this file changes. See
 * `controls.ts` for the derivation, which is pure and covered by `verify:devices`.
 *
 * This is the **non-agentic** entry point. A tap sends `device_control_request` straight
 * to Amber and never touches a model — no tokens, no latency, no chance of a
 * misinterpretation. It lands on the *same* dispatch her `device_control` tool uses, so
 * a machine slept by clicking and one slept by asking are the same operation, the way
 * `memory_action` and `forget_fact` are the same row.
 *
 * Deliberately no confirmation dialog here for a destructive action. A tap is already
 * deliberate, and re-asking for something just clicked is how people learn to approve
 * without reading. The confirmation lives where the ambiguity is — on the conversational
 * path — and on the target machine itself, which prompts locally before it acts.
 */
export function DevicesView(): React.JSX.Element {
  const devices = useStore((s) => s.devices)
  const results = useStore((s) => s.deviceResults)
  const connected = useStore((s) => s.connection.state) === 'open'
  const [identity, setIdentity] = useState<{ deviceId: string; deviceName: string } | null>(
    null,
  )
  // Which request id each control most recently produced, so a card can show what its
  // own button did rather than the last thing that happened anywhere.
  const [inFlight, setInFlight] = useState<Record<string, string>>({})

  useEffect(() => {
    void window.aperture.devices.identity().then(setIdentity)
  }, [])

  const send = (deviceId: string, action: string, args?: Record<string, unknown>): void => {
    const id = window.aperture.devices.control(deviceId, action, args)
    setInFlight((current) => ({ ...current, [`${deviceId}:${action}`]: id }))
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-6">
      <header className="mb-5">
        <h1 className="text-lg font-medium text-ink">Devices</h1>
        <p className="mt-1 max-w-prose text-body text-muted">
          Machines Amber can reach right now. Controls come from what each one says it
          can do, so a device that offers nothing shows nothing. A device has to be
          running and connected — there is no queue for one that is off.
        </p>
      </header>

      {!connected && (
        <Notice>
          Not connected to Amber, so the fleet is unknown. This list fills in once the
          connection comes back.
        </Notice>
      )}

      {connected && devices.length === 0 && (
        <Notice>
          No devices announced yet. This machine announces itself on connect — if it is
          not here, check that device control is switched on in Amber.
        </Notice>
      )}

      <div className="flex flex-col gap-3">
        {devices.map((device) => (
          <DeviceCard
            key={device.device_id}
            device={device}
            isSelf={device.device_id === identity?.deviceId}
            results={results}
            inFlight={inFlight}
            onRun={send}
          />
        ))}
      </div>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="mb-4 rounded-field border border-line bg-raised px-3 py-2.5 text-body text-muted">
      {children}
    </p>
  )
}

function DeviceCard({
  device,
  isSelf,
  results,
  inFlight,
  onRun,
}: {
  device: DeviceRecord
  isSelf: boolean
  results: Record<string, { ok: boolean; result?: string; error?: string }>
  inFlight: Record<string, string>
  onRun: (deviceId: string, action: string, args?: Record<string, unknown>) => void
}): React.JSX.Element {
  const groups = groupByExtension(controlsFor(device.capabilities))

  return (
    <section className="rounded-field border border-line bg-raised elev-panel">
      <header className="flex items-baseline gap-2 border-b border-line px-4 py-3">
        <h2 className="text-body font-medium text-ink">{device.name}</h2>
        <span className="text-meta text-muted">{device.platform}</span>
        {isSelf && (
          // Worth saying plainly: "shut down" on this card shuts down the machine you
          // are reading it on, and nothing else on screen would tell you that.
          <span className="rounded-control bg-accent/15 px-1.5 py-0.5 text-meta text-accent-hi">
            this machine
          </span>
        )}
        {device.version && (
          <span className="ml-auto font-mono text-meta text-muted">v{device.version}</span>
        )}
      </header>

      {groups.length === 0 ? (
        <p className="px-4 py-3 text-body text-muted">
          Nothing to control. This device announced no capabilities — on Aperture that
          usually means no extension has been granted permission yet.
        </p>
      ) : (
        <div className="flex flex-col gap-4 px-4 py-3">
          {groups.map((group) => (
            <div key={group.extensionId}>
              <h3 className="mb-2 text-meta text-muted">
                {extensionLabel(group.extensionId)}
              </h3>
              <div className="flex flex-col gap-2">
                {group.controls.map((control) => (
                  <ControlRow
                    key={control.action}
                    control={control}
                    outcome={results[inFlight[`${device.device_id}:${control.action}`] ?? '']}
                    onRun={(args) => onRun(device.device_id, control.action, args)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ControlRow({
  control,
  outcome,
  onRun,
}: {
  control: DeviceControl
  outcome?: { ok: boolean; result?: string; error?: string }
  onRun: (args?: Record<string, unknown>) => void
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-body text-ink">{control.label}</p>
        {control.description && (
          <p className="mt-0.5 text-meta text-muted">{control.description}</p>
        )}
        {outcome && (
          <p
            className={cn(
              'mt-1 text-meta',
              outcome.ok ? 'text-ok' : 'text-danger',
            )}
          >
            {outcome.ok ? (outcome.result ?? 'Done.') : (outcome.error ?? 'Failed.')}
          </p>
        )}
      </div>
      <Control control={control} onRun={onRun} />
    </div>
  )
}

function Control({
  control,
  onRun,
}: {
  control: DeviceControl
  onRun: (args?: Record<string, unknown>) => void
}): React.JSX.Element {
  const { spec } = control

  if (spec.kind === 'slider') {
    return (
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        // Fired on release rather than on every pixel of drag: each change is a round
        // trip to another machine, and streaming them would queue dozens of actions
        // behind one gesture.
        onMouseUp={(event) => onRun({ [spec.arg]: Number(event.currentTarget.value) })}
        onTouchEnd={(event) => onRun({ [spec.arg]: Number(event.currentTarget.value) })}
        className="w-40 accent-[var(--color-accent)]"
        aria-label={spec.label}
      />
    )
  }

  if (spec.kind === 'toggle') {
    return (
      <input
        type="checkbox"
        onChange={(event) => onRun({ [spec.arg]: event.currentTarget.checked })}
        className="mt-1 accent-[var(--color-accent)]"
        aria-label={spec.label}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => onRun()}
      className={cn(
        'shrink-0 rounded-control border px-3 py-1 text-meta transition',
        spec.tone === 'danger'
          ? 'border-danger/50 bg-danger/10 text-danger hover:bg-danger/20'
          : 'border-line bg-ground text-ink hover:bg-accent/10',
      )}
    >
      {spec.label}
    </button>
  )
}
