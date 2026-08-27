import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isMuted, parseAudioState } from '../../shared/audio-state'
import type { DeviceRecord } from '../../shared/protocol'
import { cn } from '../cn'
import { useStore } from '../store'
import { Dot } from '../viz/primitives'
import {
  ACTIONS,
  isEmpty,
  parseApps,
  surfaceFor,
  type DeviceSurface,
  type GenericControl,
} from './controls'

/**
 * The machines Amber can reach, as instruments rather than menus.
 *
 * ## Why this is not a list of actions
 *
 * The first version rendered one labelled row per capability: a heading, a sentence of
 * description, a control. That reads as a menu of verbs, and it buries the only thing
 * you actually came to see. A machine's volume is a *value it currently has*; the
 * interface should show the value and let you move it. So the level is the largest thing
 * on a card, read live from the machine when the panel opens, and the words are gone.
 *
 * Power sits apart, at the top right, small. It is rare and consequential, and putting
 * "Shut down" at the same visual rank as a volume slider is how someone hits it while
 * reaching for something else.
 *
 * ## Bespoke where it earns it, generic everywhere else
 *
 * `surfaceFor` sorts capabilities into audio, power, apps and *other*. That last bucket
 * is the important one: a device this build has never heard of — a phone announcing
 * `notify.toast`, TouchDesigner announcing `td.trigger` — still renders from its declared
 * schema. Hardcoding the panel to `system-control` would make every new capability a
 * release of this file.
 *
 * ## Reading state back
 *
 * There is no structured channel for a reading: a `tool_result` is a string. So
 * `describeAudio` in `shared/audio-state.ts` is a contract and this parses it back. Every
 * write re-reports the resulting state, so what you see is what the machine says is true
 * rather than what was asked for. Those differ more often than you would expect.
 *
 * ## Non-agentic
 *
 * A tap sends `device_control_request` straight to Amber and never touches a model — no
 * tokens, no latency. It lands on the *same* dispatch her `device_control` tool uses, so
 * a machine muted by clicking and one muted by asking are the same operation.
 *
 * Ordinary actions never prompt. A destructive one still prompts on the machine it
 * targets, and that is not redundant even when you tapped it yourself: the request
 * arrives there as an ordinary `tool_call` carrying no record of who started it. Rather
 * than add a "the user really meant it" flag, which anything could claim and is therefore
 * worth nothing, the target simply always asks before powering itself off.
 */
export function DevicesView({
  onOpenExtensions,
}: {
  onOpenExtensions?: () => void
} = {}): React.JSX.Element {
  const devices = useStore((s) => s.devices)
  const results = useStore((s) => s.deviceResults)
  const connected = useStore((s) => s.connection.state) === 'open'

  const [selfId, setSelfId] = useState<string | null>(null)
  const [nicknames, setNicknames] = useState<Record<string, string>>({})

  useEffect(() => {
    // Guarded because the renderer hot-reloads and the preload does not: during
    // development this component can mount against a preload from before the method
    // existed, and an unguarded call takes the whole view down with a TypeError. A
    // missing method means the feature is absent, not that the panel should fail.
    void window.aperture.devices.identity?.().then((id) => setSelfId(id.deviceId))
    void window.aperture.devices.nicknames?.().then(setNicknames)
  }, [])

  const run = useCallback(
    (deviceId: string, action: string, args?: Record<string, unknown>): string =>
      window.aperture.devices.control(deviceId, action, args),
    [],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 py-7">
        <header className="mb-6 flex items-baseline gap-3">
          <h1 className="text-lg font-medium text-ink">Devices</h1>
          <span className="text-meta text-muted">
            {connected ? `${devices.length} reachable` : 'not connected'}
          </span>
        </header>

        {!connected && (
          <Empty>
            Amber is not connected, so the fleet is unknown. This fills in when the
            connection returns.
          </Empty>
        )}

        {connected && devices.length === 0 && (
          <Empty>
            Nothing has announced itself. This machine announces on connect, so if it is
            missing, device control is switched off on Amber.
          </Empty>
        )}

        <div className="flex flex-col gap-4">
          {devices.map((device) => (
            <DeviceCard
              key={device.device_id}
              device={device}
              isSelf={device.device_id === selfId}
              nickname={nicknames[device.device_id]}
              results={results}
              onRun={run}
              onOpenExtensions={onOpenExtensions}
              onRename={async (name) => {
                // Renaming *this* machine goes through the real device name, which is
                // re-announced, so Amber learns it and "sleep the loft mac" resolves.
                // Another machine only gets a local alias: this install cannot rename a
                // computer it does not run on, and Amber never sees a nickname.
                if (device.device_id === selfId) {
                  await window.aperture.devices.rename?.(name)
                } else {
                  const updated = await window.aperture.devices.setNickname?.(
                    device.device_id,
                    name,
                  )
                  if (updated) setNicknames(updated)
                }
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mb-4 max-w-prose text-body text-muted">{children}</p>
}

type Answer = { ok: boolean; result?: string; error?: string } | undefined

function DeviceCard({
  device,
  isSelf,
  nickname,
  results,
  onRun,
  onRename,
  onOpenExtensions,
}: {
  device: DeviceRecord
  isSelf: boolean
  nickname?: string
  results: Record<string, { ok: boolean; result?: string; error?: string }>
  onRun: (deviceId: string, action: string, args?: Record<string, unknown>) => string
  onRename: (name: string) => Promise<void>
  onOpenExtensions?: () => void
}): React.JSX.Element {
  const surface = useMemo(() => surfaceFor(device.capabilities), [device.capabilities])

  // Every request this card started, so it reads only its own answers. Keyed by action:
  // a second volume change supersedes the first, which is what you want when someone
  // drags twice before the machine has replied.
  const [sent, setSent] = useState<Record<string, string>>({})
  const answerFor = useCallback(
    (action: string): Answer => results[sent[action] ?? ''],
    [results, sent],
  )

  const send = useCallback(
    (action: string, args?: Record<string, unknown>): void => {
      const id = onRun(device.device_id, action, args)
      setSent((current) => ({ ...current, [action]: id }))
    },
    [device.device_id, onRun],
  )

  const failure = useMemo(() => {
    for (const id of Object.values(sent)) {
      const answer = results[id]
      if (answer && !answer.ok) return answer.error ?? 'That did not work.'
    }
    return null
  }, [results, sent])

  return (
    <section className="rounded-field border border-line bg-raised elev-panel">
      <Identity
        device={device}
        isSelf={isSelf}
        nickname={nickname}
        onRename={onRename}
        power={surface.power}
        onRun={send}
      />

      {isEmpty(surface) ? (
        <NoCapabilities device={device} isSelf={isSelf} onOpenExtensions={onOpenExtensions} />
      ) : (
        <div className="flex flex-col divide-y divide-line border-t border-line">
          {surface.audio && <Output audio={surface.audio} answerFor={answerFor} onRun={send} />}
          {surface.apps && <Apps apps={surface.apps} answerFor={answerFor} onRun={send} />}
          {surface.other.length > 0 && <Other controls={surface.other} onRun={send} />}
        </div>
      )}

      {failure && (
        <p className="border-t border-line px-5 py-2.5 text-meta text-danger">{failure}</p>
      )}
    </section>
  )
}

// --- identity ---------------------------------------------------------------

function Identity({
  device,
  isSelf,
  nickname,
  onRename,
  power,
  onRun,
}: {
  device: DeviceRecord
  isSelf: boolean
  nickname?: string
  onRename: (name: string) => Promise<void>
  power: GenericControl[]
  onRun: (action: string, args?: Record<string, unknown>) => void
}): React.JSX.Element {
  const shown = nickname || device.name
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(shown)

  const commit = (): void => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== shown) void onRename(draft.trim())
  }

  return (
    <header className="flex items-center gap-3 px-5 py-4">
      <Dot tone="ok" />

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            // Escape restores before blurring, so a rename you backed out of cannot land
            // on the way out.
            if (e.key === 'Escape') {
              setDraft(shown)
              setEditing(false)
            }
          }}
          className="min-w-0 flex-1 rounded-control border border-accent-deep bg-ground px-2 py-0.5 text-body text-ink outline-none"
          aria-label="Device name"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(shown)
            setEditing(true)
          }}
          title={
            isSelf
              ? 'Rename this machine. Amber learns the new name.'
              : `Nickname, kept on this machine. Amber still knows it as "${device.name}".`
          }
          className="-mx-1 min-w-0 truncate rounded-control px-1 text-body font-medium text-ink transition-colors hover:bg-ink/5"
        >
          {shown}
        </button>
      )}

      <span className="shrink-0 text-meta text-muted">{device.platform}</span>

      {nickname && !isSelf && (
        // Amber matches on the announced name, so a nickname living only here would fail
        // silently if you said it out loud. Keep both visible rather than hide the gap.
        <span className="shrink-0 text-meta text-muted">Amber: {device.name}</span>
      )}
      {isSelf && (
        <span className="shrink-0 rounded-control bg-accent/15 px-1.5 py-0.5 text-meta text-accent-hi">
          this machine
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {power.map((action) => (
          <button
            key={action.action}
            type="button"
            onClick={() => onRun(action.action)}
            title={action.description}
            className="rounded-control border border-line px-2.5 py-1 text-meta text-muted transition-colors hover:border-danger/50 hover:bg-danger/10 hover:text-danger"
          >
            {action.label}
          </button>
        ))}
      </div>
    </header>
  )
}

// --- output -----------------------------------------------------------------

function Output({
  audio,
  answerFor,
  onRun,
}: {
  audio: NonNullable<DeviceSurface['audio']>
  answerFor: (action: string) => Answer
  onRun: (action: string, args?: Record<string, unknown>) => void
}): React.JSX.Element {
  // Whichever audio action reported most recently. Every write re-reports, so a set and
  // a read are the same kind of update and there is one place to read state from.
  const reported = useMemo(() => {
    for (const action of [ACTIONS.audioSet, ACTIONS.audioMute, ACTIONS.audioGet]) {
      const answer = answerFor(action)
      if (answer?.ok && answer.result) {
        const state = parseAudioState(answer.result)
        if (state.level !== null) return state
      }
    }
    return null
  }, [answerFor])

  // What you have set, held until the machine confirms it.
  //
  // The subtlety that makes or breaks the feel: this must **not** be cleared on release.
  // Clearing it there drops the thumb back to the last reading for however long the
  // round trip takes — which on Windows is a PowerShell spawn, so the better part of a
  // second — and the slider visibly snaps to the old value and then jumps to the new
  // one. The local value stands until a *newer* reading arrives to replace it.
  const [local, setLocal] = useState<number | null>(null)
  const settled = answerFor(ACTIONS.audioSet)
  useEffect(() => {
    // Only once an answer actually exists. Sending mints a new request id whose result
    // is briefly `undefined`, and treating that as "settled" would reintroduce the snap.
    if (settled) setLocal(null)
  }, [settled])

  const level = local ?? reported?.level ?? null
  // Muted *is* level zero, so the speaker and the slider read the same number and can
  // never contradict each other. `null` is a failed read, which is a different thing and
  // shows as a dash rather than as silence.
  const muted = level !== null && isMuted({ level })

  const read = useRef(false)
  useEffect(() => {
    // One read when the card appears. The panel has to open showing the machine's real
    // level rather than a zero that looks exactly like silence.
    if (read.current || !audio.canRead) return
    read.current = true
    onRun(ACTIONS.audioGet)
  }, [audio.canRead, onRun])

  // Sent on release, not on every pixel. Each change is a round trip that spawns a
  // process on the far machine, so streaming a drag would queue dozens of them and the
  // volume would keep moving long after you let go. The thumb still follows the pointer
  // the whole time; only the commit waits.
  const commit = (value: number): void => {
    setLocal(value)
    onRun(ACTIONS.audioSet, { level: value })
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-end justify-between">
        <span className="text-meta tracking-wide text-muted uppercase">Output</span>
        <span
          className={cn(
            'font-mono text-2xl leading-none tabular-nums transition-colors',
            level === null || muted ? 'text-muted' : 'text-ink',
          )}
        >
          {level === null ? '—' : `${level}%`}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {audio.canMute && (
          <button
            type="button"
            onClick={() => onRun(ACTIONS.audioMute, { muted: !muted })}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute' : 'Mute'}
            title={muted ? 'Unmute' : 'Mute'}
            className={cn(
              'shrink-0 rounded-control border px-2 py-1.5 transition-colors',
              muted
                ? 'border-warn/50 bg-warn/10 text-warn'
                : 'border-line text-muted hover:bg-ink/5 hover:text-ink',
            )}
          >
            <SpeakerIcon muted={muted} />
          </button>
        )}

        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={level ?? 0}
          disabled={!audio.canSet || level === null}
          onChange={(e) => setLocal(Number(e.currentTarget.value))}
          onMouseUp={(e) => commit(Number(e.currentTarget.value))}
          onTouchEnd={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => {
            if (e.key.startsWith('Arrow')) commit(Number(e.currentTarget.value))
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-accent disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Output volume"
        />
      </div>
    </div>
  )
}

function SpeakerIcon({ muted }: { muted: boolean }): React.JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7.5h2.5L10 4.5v11L6.5 12.5H4z" />
      {muted ? (
        <path d="M13 8l4 4M17 8l-4 4" />
      ) : (
        <path d="M12.8 7.4a3.6 3.6 0 0 1 0 5.2M15.2 5.4a7 7 0 0 1 0 9.2" />
      )}
    </svg>
  )
}

// --- apps -------------------------------------------------------------------

function Apps({
  apps,
  answerFor,
  onRun,
}: {
  apps: NonNullable<DeviceSurface['apps']>
  answerFor: (action: string) => Answer
  onRun: (action: string, args?: Record<string, unknown>) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const listed = answerFor(ACTIONS.appsList)
  const running = listed?.ok && listed.result ? parseApps(listed.result) : []

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="text-meta tracking-wide text-muted uppercase">Applications</span>
        {apps.canList && (
          <button
            type="button"
            onClick={() => {
              // Read on open, not with the card: a process list is a screen of output
              // nobody asked for, on every device, every time you glance at this tab.
              if (!open) onRun(ACTIONS.appsList)
              setOpen(!open)
            }}
            className="rounded-control px-2 py-0.5 text-meta text-muted transition-colors hover:bg-ink/5 hover:text-ink"
          >
            {open ? 'Hide' : running.length > 0 ? `${running.length} running` : 'Show'}
          </button>
        )}
      </div>

      {open && (
        <>
          {running.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {running.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    disabled={!apps.canClose}
                    onClick={() => onRun(ACTIONS.appsClose, { name })}
                    // Closing from the list rather than a text field: the name is already
                    // correct, so nothing has to be typed or spelled.
                    title={apps.canClose ? `Close ${name}` : name}
                    className={cn(
                      'rounded-control border border-line bg-ground px-2 py-0.5 font-mono text-meta text-muted transition-colors',
                      apps.canClose && 'hover:border-danger/50 hover:text-danger',
                    )}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {apps.canLaunch && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!path.trim()) return
                onRun(ACTIONS.appsLaunch, { path: path.trim() })
                setPath('')
              }}
            >
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                // A path, not a name. Launching "Spotify" by name is a per-platform
                // problem this build does not pretend to solve, so the field says so.
                placeholder="Full path to open"
                className="min-w-0 flex-1 rounded-control border border-line bg-ground px-2 py-1 font-mono text-meta text-ink outline-none focus:border-accent-deep"
              />
              <button
                type="submit"
                className="shrink-0 rounded-control border border-line px-2.5 py-1 text-meta text-muted transition-colors hover:bg-ink/5 hover:text-ink"
              >
                Open
              </button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

// --- anything this build has never heard of ---------------------------------

function Other({
  controls,
  onRun,
}: {
  controls: GenericControl[]
  onRun: (action: string, args?: Record<string, unknown>) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 px-5 py-4">
      {controls.map((control) => (
        <div key={control.action} className="flex items-center gap-3">
          <span
            className="min-w-0 flex-1 truncate text-body text-ink"
            title={control.description}
          >
            {control.label}
          </span>
          {control.spec.kind === 'slider' ? (
            <input
              type="range"
              min={control.spec.min}
              max={control.spec.max}
              step={control.spec.step ?? 1}
              onMouseUp={(e) =>
                onRun(control.action, {
                  [(control.spec as { arg: string }).arg]: Number(e.currentTarget.value),
                })
              }
              className="h-1.5 w-40 cursor-pointer appearance-none rounded-full bg-line accent-accent"
              aria-label={control.label}
            />
          ) : control.spec.kind === 'toggle' ? (
            <input
              type="checkbox"
              onChange={(e) =>
                onRun(control.action, {
                  [(control.spec as { arg: string }).arg]: e.currentTarget.checked,
                })
              }
              className="accent-accent"
              aria-label={control.label}
            />
          ) : (
            <button
              type="button"
              onClick={() => onRun(control.action)}
              className={cn(
                'shrink-0 rounded-control border border-line px-2.5 py-1 text-meta text-muted transition-colors',
                control.destructive
                  ? 'hover:border-danger/50 hover:bg-danger/10 hover:text-danger'
                  : 'hover:bg-ink/5 hover:text-ink',
              )}
            >
              {control.spec.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function NoCapabilities({
  device,
  isSelf,
  onOpenExtensions,
}: {
  device: DeviceRecord
  isSelf: boolean
  onOpenExtensions?: () => void
}): React.JSX.Element {
  return (
    <div className="border-t border-line px-5 py-4">
      {/* Two different situations, and only one is yours to fix. Telling someone to grant
          a permission for a machine across the room, without saying it has to be done
          over there, is worse than saying nothing. */}
      <p className="max-w-prose text-body text-muted">
        {isSelf
          ? 'Extensions start with no permissions, so nothing is offered until you say what this machine may do.'
          : `${device.name} has granted no extension permissions. That is done in Aperture on that machine.`}
      </p>
      {isSelf && onOpenExtensions && (
        <button
          type="button"
          onClick={onOpenExtensions}
          className="mt-2.5 rounded-control border border-line px-2.5 py-1 text-meta text-muted transition-colors hover:bg-ink/5 hover:text-ink"
        >
          Choose what this machine may do
        </button>
      )}
    </div>
  )
}
