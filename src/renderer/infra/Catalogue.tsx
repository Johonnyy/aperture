import { useState } from 'react'

import type { CatalogueEntry, InfraStatus } from '../../shared/types'
import { Chip, Field, SmallButton } from './parts'
import type { Params } from './useRunner'

/**
 * Apps this checkout can install that are not yet declared here.
 *
 * Apps are added to **amber-infra**, not to Aperture. A directory with a
 * `docker-compose.prod.yml` in it *is* the app existing — `install.sh` refuses
 * anything else, so the repo is not a hint about the catalogue, it is the catalogue.
 * This screen reads it and offers what is there; it never invents an entry.
 *
 * Which means the only thing missing at install time is a hostname. The image and the
 * loopback port come out of the compose file, so both fields below are prefilled and
 * only editable because a default is not a decision.
 *
 * Two steps rather than one, deliberately. Declaring writes `apps.<name>` into
 * secrets.yaml and mints its MCP token; installing is `install.sh`. Folding them
 * together would produce one rehearsal covering two different kinds of change, and
 * the config half is the half you might want without the deploy half — declaring an
 * app for server B from server A is a normal thing to do.
 */
export function Catalogue({
  status,
  run,
  disabled,
}: {
  status: InfraStatus
  run: (actionId: string, title: string, params?: Params) => void
  disabled: boolean
}): React.JSX.Element | null {
  const declared = new Set(status.apps.filter((a) => a.declared).map((a) => a.name))
  const offer = status.catalogue.filter((c) => !declared.has(c.name))
  if (offer.length === 0) return null

  return (
    <ul className="flex flex-col gap-2 border-t border-line pt-3">
      <li className="text-[11px] text-muted">
        In the amber-infra checkout but not declared here. Add apps to that repo, not to
        this screen.
      </li>
      {offer.map((entry) => (
        <Row key={entry.name} entry={entry} status={status} run={run} disabled={disabled} />
      ))}
    </ul>
  )
}

function Row({
  entry,
  status,
  run,
  disabled,
}: {
  entry: CatalogueEntry
  status: InfraStatus
  run: (actionId: string, title: string, params?: Params) => void
  disabled: boolean
}): React.JSX.Element {
  const primary = status.settings.primaryDomain
  const [domain, setDomain] = useState(primary ? `${entry.name}.${primary}` : '')
  const [server, setServer] = useState(status.serverLabel ?? '')
  const here = !server || server === status.serverLabel

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{entry.name}</span>
        {entry.image && <Chip>{entry.image}</Chip>}
        {entry.upstream && <Chip>{entry.upstream}</Chip>}
        <span className="text-[10px] text-muted">from the checkout</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Field value={domain} onChange={setDomain} placeholder={`${entry.name}.example.com`} />
        <Field value={server} onChange={setServer} placeholder="server label (a / b)" />
        <SmallButton
          disabled={disabled || !domain.trim()}
          title="Writes apps.<name> into secrets.yaml and generates its MCP token"
          onClick={() =>
            run('addApp', `Declare ${entry.name}`, {
              app: entry.name,
              domain: domain.trim(),
              upstream: entry.upstream ?? '',
              image: entry.image ?? '',
              server: server.trim(),
            })
          }
        >
          Declare
        </SmallButton>
      </div>

      {!here && (
        <p className="text-[10px] text-muted">
          Assigned to server {server}, so it will be declared but not offered for
          install here. Run the install from that box.
        </p>
      )}
    </li>
  )
}
