import { useState } from 'react'

import type { CatalogueEntry, CredentialSummary, InfraStatus } from '../../shared/types'
import { MANIFEST_SCHEMA } from '../../shared/types'
import { Chip, Field, SmallButton } from './parts'
import { fillsFor, readinessFor, ReadinessList, ReadinessSummary } from './Readiness'
import type { Params } from './useRunner'

/**
 * Apps this checkout can install that are not yet declared here.
 *
 * Apps are added to **amber-infra**, not to Aperture. A directory with a
 * `docker-compose.prod.yml` and a `manifest.yaml` in it *is* the app existing, so the
 * repo is not a hint about the catalogue, it is the catalogue.
 *
 * **This screen no longer asks for an env prefix.** It used to: a free-text field
 * pre-filled from a hardcoded `{amber: AMBER_MCP, bloom: BLOOM_MCP}` map in this file,
 * with a note explaining that getting it wrong fails silently. That was the bug wearing
 * a label. The prefix is read from the app's own manifest, where CI checks it against
 * the names of the keys it governs, and it is shown here as a chip you cannot edit.
 *
 * Declare and install are also one button now, not two. They were split so you could
 * declare an app for another server without deploying it — which is real, and is what
 * the "assigned to server X" case below still does — but for the ordinary case the
 * split just meant knowing to press two things in order.
 */
export function Catalogue({
  status,
  run,
  disabled,
  credentials,
  onCredentialSaved,
}: {
  status: InfraStatus
  run: (actionId: string, title: string, params?: Params) => void
  disabled: boolean
  credentials: CredentialSummary[]
  onCredentialSaved: () => void
}): React.JSX.Element | null {
  const declared = new Set(status.apps.filter((a) => a.declared).map((a) => a.name))
  const offer = status.catalogue.filter((c) => !declared.has(c.name))
  if (offer.length === 0) return null

  return (
    <ul className="flex flex-col gap-2 border-t border-line pt-3">
      <li className="text-meta text-muted">
        In the amber-infra checkout but not installed here. Add apps to that repo, not
        to this screen.
      </li>
      {offer.map((entry) => (
        <Row
          key={entry.name}
          entry={entry}
          status={status}
          run={run}
          disabled={disabled}
          credentials={credentials}
          onCredentialSaved={onCredentialSaved}
        />
      ))}
    </ul>
  )
}

function Row({
  entry,
  status,
  run,
  disabled,
  credentials,
  onCredentialSaved,
}: {
  entry: CatalogueEntry
  status: InfraStatus
  run: (actionId: string, title: string, params?: Params) => void
  disabled: boolean
  credentials: CredentialSummary[]
  onCredentialSaved: () => void
}): React.JSX.Element {
  const primary = status.settings.primaryDomain
  const [domain, setDomain] = useState(primary ? `${entry.name}.${primary}` : '')
  const [server, setServer] = useState(status.serverLabel ?? '')
  const [chosen, setChosen] = useState<Record<string, string>>({})
  // Config values typed in the checklist, carried into the install as parameters.
  // Not secrets, so they travel in `Params` and are visible in the operation log.
  const [configs, setConfigs] = useState<Record<string, string>>({})
  const here = !server || server === status.serverLabel

  // Nothing is declared yet, so there are no values in secrets.yaml to weigh — the
  // checklist is the manifest against the vault, which is exactly the question worth
  // answering before you press Install.
  const readiness = readinessFor(entry.manifest, [], credentials)
  const blocked = Boolean(readiness && readiness.missing.some((m) => m.required))
  const stale = status.schema < MANIFEST_SCHEMA

  return (
    <li className="flex flex-col gap-2 rounded-control border border-line p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{entry.name}</span>
        {entry.image && <Chip>{entry.image}</Chip>}
        {entry.upstream && <Chip>{entry.upstream}</Chip>}
        {/* Read, not chosen. There is no way to type this wrong any more. */}
        {entry.manifest && <Chip>{entry.manifest.envPrefix}_*</Chip>}
        {readiness && <ReadinessSummary readiness={readiness} />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Field value={domain} onChange={setDomain} placeholder={`${entry.name}.example.com`} />
        {/* `infra.server` when the box has one, and legitimately blank when it does
            not — status.sh treats an unset or unrecognised label as "here". So the
            placeholder answers the question rather than asking it: an empty box
            labelled "server label (a / b)" is one you cannot fill without knowing the
            convention. */}
        <Field
          value={server}
          onChange={setServer}
          placeholder={status.serverLabel ?? 'this box'}
        />
      </div>

      <p className="text-micro text-muted">
        <span className="font-mono">{domain.trim() || 'the hostname'}</span> is what Caddy
        will serve and ask Let&apos;s Encrypt for, proxied to{' '}
        <span className="font-mono">{entry.upstream ?? 'its compose port'}</span>
        {status.serverLabel
          ? ` on box ${server.trim() || status.serverLabel}.`
          : ' on this box.'}{' '}
        Leave the second field alone unless this app belongs to a different server.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {here ? (
          <SmallButton
            primary
            disabled={disabled || !domain.trim() || blocked}
            title={
              blocked
                ? `Still needs ${readiness?.missing.map((m) => m.label).join(', ')}`
                : 'Declare it, generate its keys, fill the ones you have saved, and install it — rehearsed first'
            }
            onClick={() =>
              run('installApp', `Install ${entry.name}`, {
                app: entry.name,
                domain: domain.trim(),
                upstream: entry.upstream ?? '',
                server: server.trim(),
                fills: JSON.stringify(fillsFor(readiness, chosen)),
                configs: JSON.stringify(configs),
              })
            }
          >
            Install
          </SmallButton>
        ) : (
          <SmallButton
            disabled={disabled || !domain.trim()}
            title="Writes its stanza into secrets.yaml without deploying anything here"
            onClick={() =>
              run('declareApp', `Declare ${entry.name}`, {
                app: entry.name,
                domain: domain.trim(),
                upstream: entry.upstream ?? '',
                server: server.trim(),
              })
            }
          >
            Declare only
          </SmallButton>
        )}
      </div>

      {readiness && readiness.items.length > 0 && (
        <ReadinessList
          readiness={readiness}
          credentials={credentials}
          chosen={chosen}
          onChoose={(key, uid) => setChosen((c) => ({ ...c, [key]: uid }))}
          onSaved={onCredentialSaved}
          configs={configs}
          onConfig={(key, value) => setConfigs((c) => ({ ...c, [key]: value }))}
        />
      )}

      {!entry.manifest && (
        <p className="text-micro text-muted">
          {stale
            ? 'This box’s status.sh predates app manifests, so there is no checklist — update amber-infra to see one.'
            : `No ${entry.name}/manifest.yaml in the checkout, so nothing can say what this app needs. Add one beside its compose file.`}
        </p>
      )}

      {!here && (
        <p className="text-micro text-muted">
          Assigned to server {server}, so it will be declared but not installed here.
          Run the install from that box.
        </p>
      )}
    </li>
  )
}
