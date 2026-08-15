import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { diagnose, type RegistryNode } from '../../shared/registry'
import type { InfraStatus } from '../../shared/types'
import { Card, Chip, Field, SmallButton } from './parts'
import { layoutOf } from './registry-layout'
import { RegistryMap } from './RegistryMap'
import type { Params } from './useRunner'

/**
 * The registry, as a thing you can look at.
 *
 * This is ungated and near the top of the page on purpose. There was no way to see the
 * registry at all before — the only surface was a flat list behind Advanced mode — so
 * "what is linked and what is not" was a question the app could not answer, while a
 * paragraph inside one app's card tried to explain a specific failure in prose.
 *
 * The division of labour here is the point:
 *
 *   the map     — the glance. Which lines reach the trunk.
 *   the button  — the single next action, collapsed across every app that shares it.
 *   the list    — the semantics, one line each, and the whole a11y contract.
 *   Advanced    — the machinery: fingerprints, the store's own detail string, and the
 *                 raw controls. Everything that used to be a paragraph lives here now.
 *
 * No polling. `readStatus` is a fresh SSH connection per call, and `useRunner` already
 * refreshes when an action finishes — which is the moment the map changes.
 */
export function RegistryCard({
  status,
  run,
  advanced,
  needsPassword,
}: {
  status: InfraStatus
  run: (actionId: string, title: string, params?: Params) => void
  advanced: boolean
  needsPassword: boolean
}): React.JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [width, setWidth] = useState(640)
  const frame = useRef<HTMLDivElement>(null)

  // Measured rather than scaled: a viewBox that stretched to fit would shrink 11px
  // labels to 7px on a narrow window, which is the one thing a diagnostic must not do.
  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  const map = useMemo(() => diagnose(status), [status])
  const layout = useMemo(() => layoutOf(map.apps.length, width), [map.apps.length, width])

  const all = [map.store, ...map.apps]

  return (
    <Card
      title="Registry"
      hint={
        status.syncStore.url
          ? `${status.syncStore.url} — what every agent reads to find its peers.`
          : 'No registry configured for this box.'
      }
    >
      {map.caveats.map((caveat) => (
        <p key={caveat} className="text-meta leading-relaxed text-muted">
          {caveat}
        </p>
      ))}

      <div ref={frame} className="w-full overflow-x-auto">
        <figure className="m-0">
          <RegistryMap
            map={map}
            layout={layout}
            activeId={activeId}
            onHover={setActiveId}
            onSelect={setActiveId}
          />
          {/* One caption, doing both jobs. It describes the diagram, and `aria-live`
              makes a refresh that changes the picture announce itself instead of
              silently redrawing. Two elements carrying the same sentence meant a screen
              reader heard it twice, and anyone selecting the card copied it twice. */}
          <figcaption aria-live="polite" className="sr-only">
            {map.caption}
          </figcaption>
        </figure>
      </div>

      {/* The one action. `SmallButton`'s `primary` docblock says to reserve it — two
          primaries is none — which is exactly why `next` is collapsed in the pure
          module rather than one button being rendered per broken app. */}
      {map.next?.fix.kind === 'action' && (
        <div className="flex flex-wrap items-center gap-2 rounded-field border border-accent-deep bg-accent/10 p-2.5">
          <SmallButton
            primary
            disabled={needsPassword}
            title={needsPassword ? 'Enter the sudo password above first.' : undefined}
            onClick={() =>
              run(map.next!.fix.actionId!, map.next!.fix.label, map.next!.fix.params)
            }
          >
            {map.next.fix.label}
          </SmallButton>
          <span className="min-w-0 flex-1 text-micro leading-relaxed text-muted">
            {map.next.fix.because}
            {map.next.affects.length > 1 && ` Repairs ${map.next.affects.length} of these.`}
          </span>
        </div>
      )}

      {map.next?.fix.kind === 'password' && (
        <p className="text-meta text-warn">{map.next.fix.because}</p>
      )}

      {/* The store's own row is always here, including on a box with no apps — "the
          registry is fine and there is nothing to link" and "there is nothing here at
          all" are different things to learn. */}
      <ul className="flex flex-col gap-1">
        {all.map((node) => (
          <Row
            key={node.id}
            node={node}
            active={activeId === node.id}
            needsPassword={needsPassword}
            run={run}
            onHover={setActiveId}
          />
        ))}
      </ul>
      {map.apps.length === 0 && (
        <p className="text-xs text-muted">Nothing is declared on this box yet.</p>
      )}

      {advanced && <Machinery status={status} nodes={all} run={run} disabled={needsPassword} />}
    </Card>
  )
}

/**
 * One node, as a row.
 *
 * This is the content, and the diagram above is the picture of it — which is why the
 * row is a plain `<li>` and not a button. Wrapping it in one would put a control on
 * screen whose only effect is to highlight a decoration, and a screen reader would be
 * offered an action that does nothing. As text it simply reads: "bloom — the registry
 * has never been told this app's key", followed by the button that fixes it.
 *
 * Hover ties the row to its node in both directions. That is an enhancement for a
 * pointer, and nothing depends on it.
 */
function Row({
  node,
  active,
  needsPassword,
  run,
  onHover,
}: {
  node: RegistryNode
  active: boolean
  needsPassword: boolean
  run: (actionId: string, title: string, params?: Params) => void
  onHover: (id: string | null) => void
}): React.JSX.Element {
  const TONE = {
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
    muted: 'text-muted',
  } as const

  return (
    <li
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      className={`flex flex-col gap-1 rounded-field border px-2.5 py-1.5 transition ${
        active ? 'border-accent-deep' : 'border-line'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 shrink-0 truncate font-mono text-meta text-ink">{node.label}</span>
        <span className={`min-w-0 flex-1 text-meta ${TONE[node.tone]}`}>{node.summary}</span>
        {node.lastSeen && <Chip>seen {ago(node.lastSeen)}</Chip>}
        {node.fix.kind === 'action' && (
          <SmallButton
            disabled={needsPassword}
            title={needsPassword ? 'Enter the sudo password above first.' : node.fix.because}
            onClick={() =>
              run(node.fix.actionId!, `${node.fix.label} — ${node.label}`, node.fix.params)
            }
          >
            {node.fix.label}
          </SmallButton>
        )}
      </div>
      {/* The app's own words, not ours. Shown whenever we have them rather than only in
          Advanced mode: this is the one line that can name a cause nobody anticipated,
          and burying it is how "unregistered" stayed a dead end for so long. */}
      {node.note && (
        <p className="pl-26 font-mono text-nano leading-relaxed wrap-break-word text-muted">
          {node.note}
        </p>
      )}
    </li>
  )
}

/**
 * A timestamp as an age.
 *
 * `lastSeen` arrives as an ISO string, and the question it answers is "how long ago",
 * which a reader should not have to do subtraction in their head to get.
 */
function ago(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 90) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Everything that used to be prose.
 *
 * Advanced mode's own docblock names the registry as one of the things it reveals, and
 * this is the version of that promise that is worth keeping: the evidence each verdict
 * was reached from, plus the two raw controls the store has no app card for.
 *
 * Every value here is a fingerprint or a non-secret string. The pure module's `evidence`
 * field is asserted for that in `verify-registry.mjs`, because this is the one place
 * shaped like a leak.
 */
function Machinery({
  status,
  nodes,
  run,
  disabled,
}: {
  status: InfraStatus
  nodes: RegistryNode[]
  run: (actionId: string, title: string, params?: Params) => void
  disabled: boolean
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [token, setToken] = useState('')

  return (
    <details className="border-t border-line pt-2">
      <summary className="cursor-pointer text-meta text-muted">Why — the evidence</summary>

      <div className="mt-2 flex flex-col gap-3">
        {status.syncStore.detail && (
          <p className="text-meta text-accent">{status.syncStore.detail}</p>
        )}

        <ul className="flex flex-col gap-2">
          {nodes
            .filter((n) => n.evidence.length > 0)
            .map((node) => (
              <li key={node.id} className="flex flex-col gap-0.5">
                <span className="font-mono text-micro text-ink">
                  {node.label} · {node.state}
                </span>
                {node.evidence.map((e) => (
                  <span key={e.label} className="flex gap-2 font-mono text-nano text-muted">
                    <span className="w-36 shrink-0 truncate">{e.label}</span>
                    <span className="min-w-0 truncate">{e.value}</span>
                  </span>
                ))}
              </li>
            ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <SmallButton
            disabled={disabled}
            onClick={() => run('logs', 'Logs — registry', { app: 'sync-store' })}
          >
            Logs
          </SmallButton>
          <SmallButton
            disabled={disabled}
            title="Starts the container again. To make it re-read its key list, use Reload the registry."
            onClick={() => run('restart', 'Restart the registry', { app: 'sync-store' })}
          >
            Restart
          </SmallButton>
          <SmallButton
            disabled={disabled}
            title="Builds the registry image on this box, for when the pull failed."
            onClick={() => run('buildSyncStore', 'Build the registry image here')}
          >
            Build image here
          </SmallButton>
        </div>

        {/* The one column the registration upsert deliberately never writes: a
            300-second heartbeat would otherwise wipe every peer credential in the
            ecosystem five minutes after it was set. */}
        <div className="flex flex-wrap items-center gap-2">
          <Field value={name} onChange={setName} placeholder="server name" />
          <Field type="password" value={token} onChange={setToken} placeholder="peer token" />
          <SmallButton
            disabled={disabled || !name.trim() || !token.trim()}
            onClick={() =>
              run('setPeerToken', `Set the peer token for ${name.trim()}`, {
                name: name.trim(),
                token: token.trim(),
              })
            }
          >
            Set peer token
          </SmallButton>
        </div>
      </div>
    </details>
  )
}
