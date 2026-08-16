import { useMemo } from 'react'

import { diagnosePeers, type PeerPairing } from '../../shared/peers'
import type { InfraStatus } from '../../shared/types'
import { Chip, SmallButton } from './parts'
import type { Params } from './useRunner'

/**
 * Who can call whom, under the map that shows who is registered.
 *
 * It lives inside the Registry card rather than beside it because the two answer
 * questions that look identical and are not, and putting them apart is what let the
 * difference go unnoticed. The map answers "did this app tell the store it exists".
 * This answers "can that app actually call it". Bloom was a perfect green line to the
 * trunk — registered, healthy, MCP mounted, 401 to an unauthenticated probe — while
 * Amber had no tool for it at all, because her peer map was empty. Nothing was
 * degraded and nothing errored: an unlisted peer is offered as no tools, so there is
 * no failure anywhere to report.
 *
 * So this is a second set of edges over the same nodes, and the one thing it must
 * never do is imply the first. A row here saying "connected" is about the peer link
 * and nothing else.
 *
 * WHAT IT IS NOT. Not a form. There is no field for a URL and none for a token,
 * because both are derivable on the box and typing either is how this gets broken —
 * the map takes an origin and not the endpoint the client builds from it, and the
 * bearer is the token half of a `name:token` pair. `connect-peer.sh` reads the
 * pairing out of the two manifests and mints or reuses the credential in place. The
 * button sends two app names.
 *
 * Every sentence and every button comes from `shared/peers.ts`, length-capped by
 * `scripts/verify-peers.mjs`. Nothing is composed here — this file is layout.
 */
export function PeerLinks({
  status,
  run,
  advanced,
  needsPassword,
  /** True when the registry above already claimed the one primary button. */
  registryHasAction,
}: {
  status: InfraStatus
  run: (actionId: string, title: string, params?: Params) => void
  advanced: boolean
  needsPassword: boolean
  registryHasAction: boolean
}): React.JSX.Element | null {
  const peers = useMemo(() => diagnosePeers(status), [status])

  // Nothing declares a peer on this box. Not an error and not worth a row — an app
  // with no MCP surface is *supposed* to have no peers, and inventing an empty
  // section for it would read as something left undone.
  if (peers.pairings.length === 0 && peers.caveats.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="w-24 shrink-0 text-meta text-muted">peers</span>
        <p className="min-w-0 flex-1 text-micro leading-relaxed text-muted">
          Who may call whom. Separate from registering: an app can be linked above and
          still be uncallable, because an unlisted peer is offered as no tools at all.
        </p>
      </div>

      {peers.caveats.map((caveat) => (
        <p key={caveat} className="text-meta leading-relaxed text-muted">
          {caveat}
        </p>
      ))}

      <ul className="flex flex-col gap-1">
        {peers.pairings.map((pairing) => (
          <PeerRow
            key={pairing.id}
            pairing={pairing}
            advanced={advanced}
            needsPassword={needsPassword}
            run={run}
            // Rule from `SmallButton`: two primaries is none. The registry's own fix
            // outranks any peer fix — nothing about who may call whom matters while
            // the thing they all register with is broken — so this only ever claims
            // the emphasis the card is not already using.
            primary={!registryHasAction && peers.next?.affects[0] === pairing.id}
          />
        ))}
      </ul>

      {peers.pairings.length === 0 && (
        <p className="text-xs text-muted">No app on this box declares a peer.</p>
      )}

      <p aria-live="polite" className="sr-only">
        {peers.caption}
      </p>
    </div>
  )
}

/**
 * One pairing, as a row.
 *
 * A plain `<li>` for the same reason the registry rows are: there is nothing to
 * activate here except the fix, so wrapping the line in a control would offer a
 * screen reader an action that does nothing. It reads as a sentence — "amber → bloom,
 * not connected — it has no tool for it" — followed by the button that repairs it.
 */
function PeerRow({
  pairing,
  advanced,
  needsPassword,
  run,
  primary,
}: {
  pairing: PeerPairing
  advanced: boolean
  needsPassword: boolean
  run: (actionId: string, title: string, params?: Params) => void
  primary: boolean
}): React.JSX.Element {
  const TONE = {
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
    muted: 'text-muted',
  } as const

  const title = `${pairing.from} → ${pairing.to}`

  return (
    <li className="flex flex-col gap-1 rounded-field border border-line px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 font-mono text-meta text-ink">
          {pairing.from}
          <span className="px-1 text-muted">→</span>
          {pairing.to}
        </span>
        <span className={`min-w-0 flex-1 text-meta ${TONE[pairing.tone]}`}>{pairing.summary}</span>

        {/* The second path to the same peer, and the reason it is a chip rather than a
            state: the registry holds a credential for this callee that matches what it
            accepts, so an agent resolving through discovery could call it with no env
            file at all. Amber does not — `build_broker` passes an explicit resolver,
            which short-circuits the registry — so this is what will work after that
            ships, not now. Saying "connected" on the strength of it would be a lie
            with a deploy in the middle. */}
        {pairing.discoverable && pairing.state !== 'linked' && (
          <Chip tone="muted">discoverable</Chip>
        )}

        {pairing.fix.kind === 'action' && (
          <SmallButton
            primary={primary}
            disabled={needsPassword}
            title={needsPassword ? 'Enter the sudo password above first.' : pairing.fix.because}
            onClick={() => run(pairing.fix.actionId!, `${pairing.fix.label} — ${title}`, pairing.fix.params)}
          >
            {pairing.fix.label}
          </SmallButton>
        )}

        {/* Revocation, and gated behind Advanced for that reason. It removes the
            caller's bearer from the callee rather than only unlinking — a credential
            left behind that nothing accounts for is the objection `renameApp` makes —
            so it is not a thing to have one click from a healthy row. */}
        {advanced && pairing.state !== 'unwired' && (
          <SmallButton
            danger
            disabled={needsPassword}
            title="Remove the link and revoke the bearer the caller was given."
            onClick={() => run('disconnectPeer', `Disconnect — ${title}`, { from: pairing.from, to: pairing.to })}
          >
            Disconnect
          </SmallButton>
        )}
      </div>

      {pairing.fix.kind === 'action' && (
        <p className="text-nano leading-relaxed text-muted">{pairing.fix.because}</p>
      )}

      {advanced && pairing.evidence.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-nano text-muted">
          {pairing.evidence.map((item) => (
            <div key={item.label} className="contents">
              <dt className="text-right">{item.label}</dt>
              <dd className="min-w-0 wrap-break-word">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}
