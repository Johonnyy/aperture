import type { InfraStatus } from '../../shared/types'
import { Chip } from './parts'

/**
 * The records this box needs, and whether they are actually right.
 *
 * The list used to be derived here from the app config — which meant it could tell
 * you what to create and never whether you had. `status.sh` resolves each name on the
 * box itself now, through the resolver Caddy will use, and reports what came back.
 * So this renders a verdict rather than a shopping list.
 *
 * Scope is decided over there too: apps assigned to this box, plus
 * `sync.<primary_domain>` on a core box. Not the apex — every Caddy site block names
 * one explicit hostname, so nothing serves it. Not other servers' apps — they get
 * their records on the box that installs them.
 */
export function DnsRecords({ status }: { status: InfraStatus }): React.JSX.Element {
  const { publicIp, records } = status.dns
  const wrong = records.filter((r) => !r.pointsHere)

  if (records.length === 0) {
    return (
      <p className="text-meta text-muted">
        Nothing here needs a record yet. Each app gets one when you install it.
      </p>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {publicIp ? (
          <span className="font-mono text-micro text-muted">this box is {publicIp}</span>
        ) : (
          <Chip tone="warn">public IP unknown — records not verified</Chip>
        )}
        {publicIp && wrong.length === 0 && <Chip tone="ok">all records point here</Chip>}
        {publicIp && wrong.length > 0 && (
          <Chip tone="danger">
            {wrong.length} of {records.length} wrong
          </Chip>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {records.map((r) => (
          <li key={r.name} className="flex flex-wrap items-baseline gap-2">
            <span className="w-3 shrink-0 text-meta">
              {!publicIp ? (
                <span className="text-muted">·</span>
              ) : r.pointsHere ? (
                <span className="text-ok">✓</span>
              ) : (
                <span className="text-danger">✗</span>
              )}
            </span>
            <span className="font-mono text-meta text-ink">A {r.name}</span>
            <span className="text-micro text-muted">{r.why}</span>
            {r.addresses.length === 0 ? (
              <Chip tone="danger">does not resolve</Chip>
            ) : (
              !r.pointsHere &&
              publicIp && (
                <span className="font-mono text-micro text-danger">
                  → {r.addresses.join(' ')}
                </span>
              )
            )}
          </li>
        ))}
      </ul>

      {publicIp && wrong.length > 0 && (
        <p className="text-meta text-accent">
          Fix these before installing. Caddy requests a certificate the moment a site
          block appears, and Let’s Encrypt rate-limits failures per domain — so
          installing now costs an hour of not being able to retry, not one failed
          install. <code className="text-ink/70">install.sh</code> refuses on this
          too; pass <code className="text-ink/70">--skip-dns-check</code> only if this
          is genuinely behind a proxy.
        </p>
      )}
      <p className="text-meta text-muted">
        Only these. The apex{' '}
        <code className="text-ink/70">
          {status.settings.primaryDomain ?? 'your domain'}
        </code>{' '}
        needs nothing — nothing here serves it.
      </p>
    </>
  )
}
