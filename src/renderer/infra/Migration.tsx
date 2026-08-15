import type { InfraStatus } from '../../shared/types'
import { DnsRecords } from './Dns'
import { Card, Chip, SmallButton } from './parts'
import type { Params } from './useRunner'

/**
 * A box that predates containerisation, and the order to unpick it in.
 *
 * `install.sh` refuses to run alongside a host Caddy or a host Amber, and it is right
 * to: the edge uses `network_mode: host` and cannot bind a port the host copy already
 * owns. But finding that out four minutes into a run — after the firewall has been
 * rewritten — is a bad way to learn it, and the refusal alone does not tell you what
 * order to do things in.
 *
 * The order is the content here. Two of these steps are irreversible in the sense
 * that matters: stopping the host Caddy takes the site offline, and the database has
 * to move *before* the container starts or it comes up empty.
 */
export function Migration({
  status,
  run,
  onOpenTerminal,
  disabled,
}: {
  status: InfraStatus
  run: (actionId: string, title: string, params?: Params) => void
  onOpenTerminal: (command?: string) => void
  disabled: boolean
}): React.JSX.Element | null {
  const host = status.hostServices
  // Something holds the edge ports and it is not our container.
  const hostCaddy = Boolean(host.port80 || host.port443) && !host.caddyContainer
  const hostAmber = host.units.includes('amber')
  if (!hostCaddy && !hostAmber) return null

  const amberDeployed = status.apps.some((a) => a.name === 'amber' && a.container !== 'missing')
  // The first app belonging here that is declared and not running — what the last
  // step is actually about. Amber first when she is one of them, because on a core
  // box her install is what stands up the edge and the registry too.
  const pending = status.apps.filter(
    (a) => a.thisBox && a.declared && a.container === 'missing',
  )
  const next = pending.find((a) => a.name === 'amber') ?? pending[0]

  return (
    <Card
      title="This box still has a pre-container deployment"
      hint="install.sh will refuse until these are out of the way. The order matters."
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {host.port80 && <Chip tone="warn">:80 {host.port80}</Chip>}
        {host.port443 && <Chip tone="warn">:443 {host.port443}</Chip>}
        {host.units.map((u) => (
          <Chip key={u} tone="warn">
            {u}.service
          </Chip>
        ))}
      </div>

      <ol className="flex flex-col gap-2.5">
        <Step n={1} title="Point DNS at this box">
          <p>
            Caddy asks for a certificate the moment its site block appears, and Let's
            Encrypt rate-limits failures per domain — so a wrong A record costs an hour
            of not being able to retry, not one failed install. Do this first; it needs
            time to propagate anyway.
          </p>
          <DnsRecords status={status} />
        </Step>

        {hostAmber && !amberDeployed && (
          <Step n={2} title="Move Amber's database onto the container volume">
            <p>
              <code>amber.db</code> is WAL-mode SQLite with three co-tenant writers, so
              a <code>cp</code> of it is a corrupt snapshot. The migration uses{' '}
              <code>sqlite3 .backup</code> and verifies with{' '}
              <code>PRAGMA integrity_check</code>. It stops the systemd unit and leaves
              it installed — that is your rollback (<code>systemctl start amber</code>).
              Do it <em>before</em> the container starts, or she comes up with no memory.
            </p>
            <div className="flex flex-wrap gap-2">
              <SmallButton
                disabled={disabled}
                onClick={() => run('migrateAmberDb', 'Migrate Amber onto the container volume')}
              >
                Migrate Amber DB
              </SmallButton>
              <SmallButton onClick={() => onOpenTerminal('sudo systemctl disable --now amber')}>
                Disable amber.service
              </SmallButton>
            </div>
          </Step>
        )}

        {hostCaddy && (
          <Step n={hostAmber && !amberDeployed ? 3 : 2} title="Stop the host Caddy">
            <p>
              This is the downtime window: whatever it currently serves goes offline
              until the containerised edge is up. Copy anything you still need out of{' '}
              <code>/etc/caddy/Caddyfile</code> first — this repo overwrites that file.
            </p>
            <div className="flex flex-wrap gap-2">
              <SmallButton onClick={() => onOpenTerminal('sudo cat /etc/caddy/Caddyfile')}>
                Read the old Caddyfile
              </SmallButton>
              <SmallButton onClick={() => onOpenTerminal('sudo systemctl disable --now caddy')}>
                Disable caddy.service
              </SmallButton>
            </div>
          </Step>
        )}

        <Step n={hostCaddy && hostAmber && !amberDeployed ? 4 : 3} title="Install">
          <p>
            This is the step that builds the box: on a core server it also brings up
            the Caddy edge and the sync-store, which is why both read as down until it
            has run. Rehearse first — the dry run re-checks the ports, the images and
            the DNS, so it says plainly whether the steps above actually took.
          </p>
          {/* A numbered list that ends in "install it" and then offers no way to is
              not a list of steps, it is a list of steps minus the last one. */}
          {next ? (
            <div className="flex flex-wrap items-center gap-2">
              <SmallButton
                primary
                disabled={disabled || !next.domain}
                title={
                  next.domain
                    ? `install.sh --app ${next.name} --domain ${next.domain}`
                    : `No domain set for ${next.name}`
                }
                onClick={() =>
                  run('install', `Install ${next.name}`, {
                    app: next.name,
                    domain: next.domain ?? '',
                    upstream: next.upstream ?? '',
                  })
                }
              >
                Install {next.name}
              </SmallButton>
              <span className="text-[10px] text-muted">
                rehearses first — nothing changes until you confirm
              </span>
            </div>
          ) : (
            <p className="text-muted">
              Everything assigned to this box is already deployed.
            </p>
          )}
        </Step>
      </ol>
    </Card>
  )
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  /** Reserved for when a step can be detected as complete rather than assumed. */
  done?: boolean
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line text-[10px] text-muted">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[12px] text-ink">{title}</span>
        <div className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-muted [&_code]:text-ink/70">
          {children}
        </div>
      </div>
    </li>
  )
}
