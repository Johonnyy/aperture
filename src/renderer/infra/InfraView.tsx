import { useCallback, useEffect, useRef, useState } from 'react'

import { EXPECTED_SCHEMA, type InfraStatus, type ServerConfig } from '../../shared/types'
import { AppCard } from './AppCard'
import { Catalogue } from './Catalogue'
import { DnsRecords } from './Dns'
import { Card, Chip, Field, SmallButton } from './parts'
import { BloomCard } from './BloomCard'
import { Migration } from './Migration'
import { Setup } from './Setup'
import { useRunner } from './useRunner'

/** Kept in step with `main/infra/actions.ts`, which defaults to the same value. */
const DEFAULT_REPO = 'https://github.com/Johonnyy/amber-infra.git'

/**
 * Managing one box's amber-infra deployment.
 *
 * Everything here is composed flags for scripts that already exist on the server —
 * `install.sh`, `rollback.sh`, `update-amber.sh` — read back through
 * `deploy/status.sh --json`. There is no second implementation of what any of them
 * decides, which is the same rule Amber's MCP server follows by dispatching through
 * her own tool registry: if a human can do it, the GUI does it by doing the same
 * thing, not by doing something equivalent.
 */
export function InfraView({
  server,
  onBack,
  onOpenTerminal,
}: {
  server: ServerConfig
  onBack: () => void
  /** Opens a shell here, optionally with a command typed in but not yet run. */
  onOpenTerminal: (command?: string) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<InfraStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordless, setPasswordless] = useState(false)
  const [password, setPassword] = useState('')
  const [repo, setRepo] = useState(DEFAULT_REPO)

  // Read through a ref so the runner's identity doesn't change on every keystroke
  // in the password field, which would remount the operation log mid-install.
  const passwordRef = useRef(password)
  passwordRef.current = password
  const sudoPassword = useCallback(() => passwordRef.current || undefined, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await window.aperture.infra.status(server.id, passwordRef.current || undefined)
    setPasswordless(res.passwordlessSudo === true)
    if (res.ok && res.status) setStatus(res.status)
    else setError(res.error ?? 'Could not read the box.')
    setLoading(false)
  }, [server.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const { dialog, run } = useRunner(server.id, sudoPassword, refresh)
  const needsPassword = !passwordless && !password

  // `thisBox` is generous by design — an app with no `server` set counts as here —
  // so nothing disappears because of a field that meant nothing until recently.
  const here = status?.apps.filter((a) => a.thisBox) ?? []
  const elsewhere = status?.apps.filter((a) => !a.thisBox) ?? []

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto px-6 py-6">
      <header className="flex items-center gap-3">
        <SmallButton onClick={onBack}>← Servers</SmallButton>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{server.name}</h2>
          <p className="truncate font-mono text-meta text-muted">
            {server.username}@{server.host}
          </p>
        </div>
        {/* Refresh re-reads; Update pulls. Two different things that are easy to
            conflate, so both are here and named for what they do — the state this
            screen shows is only ever as current as the checkout it came from. */}
        <SmallButton onClick={() => void refresh()}>{loading ? 'Reading…' : 'Refresh'}</SmallButton>
        {status?.installed && (
          <SmallButton
            disabled={needsPassword}
            title="git pull the amber-infra checkout on this box, then verify status.sh runs"
            onClick={() => run('bootstrap', 'Update amber-infra', { repo: repo.trim() })}
          >
            Update infra
          </SmallButton>
        )}
      </header>

      {error && (
        <p className="rounded-field border border-danger/40 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {/* --- privilege ---
          Asked for once, held in this component's state for as long as the view is
          open, and sent per operation. It never reaches servers.json, an op entry or
          the audit log — same contract as the key-install password. */}
      {!passwordless && (
        <Card
          title="Root access"
          hint="install.sh, rollback.sh and update-amber.sh all need it. Used per operation and never stored."
        >
          <div className="flex items-center gap-2">
            <Field
              type="password"
              value={password}
              onChange={setPassword}
              placeholder={`sudo password for ${server.username}`}
              onEnter={() => void refresh()}
            />
            <SmallButton disabled={!password} onClick={() => void refresh()}>
              Re-read as root
            </SmallButton>
            {password && <Chip tone="ok">held while this view is open</Chip>}
          </div>
          <p className="text-meta text-muted">
            secrets.yaml is 0600 root, so without this the report falls back to what
            Docker alone can see — domains, pinned tags and env key names are missing.
          </p>
        </Card>
      )}
      {passwordless && (
        <p className="text-meta text-muted">
          {server.username} has passwordless sudo here — no password needed.
        </p>
      )}

      {status && !status.installed && (
        <Card
          title="amber-infra is not on this box"
          hint="Clone the repo, then install an app. Every step rehearses first."
        >
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-meta text-muted">
            {status.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Field value={repo} onChange={setRepo} placeholder={DEFAULT_REPO} />
            <SmallButton
              disabled={needsPassword}
              title={needsPassword ? 'Enter the sudo password first' : undefined}
              onClick={() => run('bootstrap', 'Install amber-infra', { repo: repo.trim() })}
            >
              Install amber-infra
            </SmallButton>
            {/* An existing checkout with a hand edit cannot be fast-forwarded, and
                that edit is not ours to throw away. The rehearsal shows the diff. */}
            <SmallButton
              disabled={needsPassword}
              title="Use this if the update refused because /opt/amber-infra has local modifications"
              onClick={() => run('stashAndUpdate', 'Stash local changes and update')}
            >
              Stash &amp; update
            </SmallButton>
          </div>
          <p className="text-meta text-muted">
            After this lands, add the first app with <code className="text-ink/70">install.sh</code>{' '}
            — it writes <code className="text-ink/70">/etc/amber-infra/secrets.yaml</code> for you to
            fill in, then refuses to go further until you have. That is deliberate: a
            secret invented at a prompt is a secret that is not in your backups.
          </p>
        </Card>
      )}

      {/* An out-of-date status.sh reports fewer fields, and a field it never emits is
          indistinguishable from one that is false — so the setup flow would sit on a
          step that is already done and no amount of pressing the button would move
          it. Say that, and offer the one action that fixes it. */}
      {status?.installed && status.schema < EXPECTED_SCHEMA && (
        <Card
          title="The box's status script is out of date"
          hint={`It reports schema ${status.schema || 'none'}; this build reads ${EXPECTED_SCHEMA}.`}
        >
          <p className="text-xs leading-relaxed text-muted">
            Everything below is being read from a script that does not report all the
            fields this screen uses, so it will show capabilities as missing whether they
            are or not. Update the checkout first — it also repairs the file modes an
            earlier bootstrap changed.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <SmallButton
              disabled={needsPassword}
              onClick={() => run('bootstrap', 'Update amber-infra', { repo: repo.trim() })}
            >
              Update amber-infra
            </SmallButton>
            <SmallButton
              disabled={needsPassword}
              title="Use this if the update refuses because of local edits"
              onClick={() => run('stashAndUpdate', 'Stash local changes and update')}
            >
              Stash &amp; update
            </SmallButton>
          </div>
        </Card>
      )}

      {status?.installed && status.schema >= EXPECTED_SCHEMA && (
        <>
          <BloomCard
            status={status}
            serverId={server.id}
            sudoPassword={sudoPassword}
            needsPassword={needsPassword}
            run={run}
          />

          <Migration
            status={status}
            run={run}
            onOpenTerminal={onOpenTerminal}
            disabled={needsPassword}
          />

          {status.dns.records.length > 0 && (
            <Card
              title="DNS"
              hint="Checked from this box, through the resolver Caddy will use."
            >
              <DnsRecords status={status} />
            </Card>
          )}

          <Setup
            status={status}
            run={run}
            onOpenTerminal={onOpenTerminal}
            disabled={needsPassword}
          />

          {/* --- this box ---
              Identity first, because every list below is scoped by it. The server
              label is what decides whether an app belongs here. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {status.settings.role && <Chip>role: {status.settings.role}</Chip>}
            {status.serverLabel && <Chip>server {status.serverLabel}</Chip>}
            {status.settings.primaryDomain && <Chip>{status.settings.primaryDomain}</Chip>}
            {status.commit && <Chip>infra @ {status.commit}</Chip>}
            {status.docker && <Chip>{status.docker}</Chip>}
            <Chip tone={status.caddy.running ? 'ok' : 'danger'}>
              caddy {status.caddy.running ? status.caddy.health : 'down'}
            </Chip>
            <Chip tone={status.syncStore.reachable ? 'ok' : 'warn'} >
              sync-store {status.syncStore.reachable ? 'reachable' : (status.syncStore.detail ?? 'unreachable')}
            </Chip>
            {!status.secretsReadable && <Chip tone="warn">secrets unreadable</Chip>}
          </div>

          {status.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-field border border-line px-3 py-2">
              {status.warnings.map((w) => (
                <li key={w} className="text-meta text-accent">
                  {w}
                </li>
              ))}
            </ul>
          )}

          {/* --- apps, split by the three facts that are not the same fact ---
              Deployed here, declared for here but not running, available in the
              checkout, and assigned elsewhere. Conflating them was what made this
              page list a finance app for another server as work outstanding on this
              one. */}
          {/* The registry is deployed by install.sh rather than as an app, so a
              failure to pull its image has nowhere else to surface. Offer the escape
              hatch right where the problem is reported. */}
          {status.settings.role === 'core' && status.syncStore.containerState === 'missing' && (
            <Card
              title="The sync-store is not running"
              hint="install.sh brings it up on a core box — unless it cannot get the image."
            >
              <p className="text-meta leading-relaxed text-muted">
                If the install stopped at <em>cannot pull</em>, the tag either never
                published or the GHCR package is private — a box pulling
                unauthenticated cannot tell those apart. Its source is in this
                checkout, so it can be built here instead. An image built here exists
                only here, which is fine for one server and wrong for two.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <SmallButton
                  disabled={needsPassword}
                  onClick={() => run('buildSyncStore', 'Build the sync-store image here')}
                >
                  Build it here
                </SmallButton>
                <span className="text-micro text-muted">
                  then Install, which uses the local image without pulling
                </span>
              </div>
            </Card>
          )}

          <Card
            title="Apps on this box"
            hint="Pinned tag vs running tag is the line worth reading."
          >
            {here.length === 0 ? (
              <p className="text-xs text-muted">
                Nothing assigned to this box yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {here.map((app) => (
                  <AppCard
                    key={app.name}
                    app={app}
                    run={run}
                    onOpenTerminal={() => onOpenTerminal()}
                  />
                ))}
              </ul>
            )}
            <Catalogue status={status} run={run} disabled={needsPassword} />
          </Card>

          {elsewhere.length > 0 && (
            <Card
              title="Apps on other servers"
              hint="Each box has its own secrets.yaml, so an app that runs elsewhere usually should not be declared in this one."
            >
              <ul className="flex flex-col gap-1.5">
                {elsewhere.map((app) => (
                  <li key={app.name} className="flex flex-wrap items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-xs text-ink/70">
                      {app.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-meta text-muted">
                      {app.domain ?? '—'}
                    </span>
                    <Chip>server {app.server}</Chip>
                    {!app.available && <Chip tone="warn">not in this checkout</Chip>}
                    {app.declared && app.container === 'missing' && (
                      <SmallButton
                        danger
                        disabled={needsPassword}
                        title="Delete its stanza from THIS box's secrets.yaml. The other box keeps its own."
                        onClick={() =>
                          run('undeclareApp', `Remove the ${app.name} declaration`, {
                            app: app.name,
                          })
                        }
                      >
                        Remove declaration
                      </SmallButton>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Until the box is actually serving something, these are four empty cards
              describing a destination. The setup panel above is the route. */}
          {here.some((a) => a.container !== 'missing') && (
            <>
              <Card
                title="Edge"
                hint="One Caddy per box, one snippet per app. Validation runs before every reload."
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {status.caddy.sites.length === 0 && (
                    <span className="text-xs text-muted">no snippets</span>
                  )}
                  {status.caddy.sites.map((site) => (
                    <Chip key={site}>{site}</Chip>
                  ))}
                  <div className="flex-1" />
                  <SmallButton
                    disabled={needsPassword}
                    onClick={() => run('caddyReload', 'Reload Caddy')}
                  >
                    Validate &amp; reload
                  </SmallButton>
                </div>
              </Card>

                  <Settings status={status} run={run} disabled={needsPassword} />

              <Registry status={status} run={run} disabled={needsPassword} />

              <Card title="Backups" hint={status.backups.target ?? undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={status.backups.count > 0 ? 'ok' : 'warn'}>
                    {status.backups.count} snapshot{status.backups.count === 1 ? '' : 's'}
                  </Chip>
                  {status.backups.newest && <Chip>newest {status.backups.newest}</Chip>}
                  <div className="flex-1" />
                  <SmallButton
                    disabled={needsPassword}
                    onClick={() => run('backupNow', 'Back up now')}
                  >
                    Back up now
                  </SmallButton>
                  <SmallButton
                    disabled={needsPassword}
                    onClick={() => run('migrateAmberDb', 'Migrate Amber onto the container volume')}
                  >
                    Migrate Amber DB
                  </SmallButton>
                </div>
              </Card>
            </>
          )}

          {status.history.length > 0 && (
            <Card title="Deploy journal" hint="Newest first. Written by rollback.sh and update-amber.sh.">
              <ul className="flex flex-col gap-1 font-mono text-micro">
                {status.history.map((h, i) => (
                  <li key={`${h.ts}-${i}`} className="flex gap-2 text-muted">
                    <span className="shrink-0">{h.ts}</span>
                    <span className="shrink-0 text-ink/70">{h.service}</span>
                    <span className="truncate">
                      {h.from} → {h.to}
                    </span>
                    <span className={h.result === 'ok' ? 'text-ok' : 'text-accent'}>{h.result}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {dialog}
    </section>
  )
}

function Settings({
  status,
  run,
  disabled,
}: {
  status: InfraStatus
  run: (actionId: string, title: string, params?: Record<string, string>) => void
  disabled: boolean
}): React.JSX.Element {
  const FIELDS = [
    { key: 'acme_email', label: 'ACME email', value: status.settings.acmeEmail, hint: "Let's Encrypt sends expiry notices here" },
    { key: 'primary_domain', label: 'Primary domain', value: status.settings.primaryDomain, hint: 'the sync-store is served at sync.<this>' },
    { key: 'timezone', label: 'Timezone', value: status.settings.timezone, hint: 'e.g. America/New_York' },
    { key: 'server', label: 'Server label', value: status.serverLabel, hint: 'matched against each app’s server: field' },
  ] as const

  return (
    <Card title="Settings" hint="The infra: block in secrets.yaml. Not secrets, so shown in the clear.">
      <ul className="flex flex-col gap-2">
        {FIELDS.map((field) => (
          <SettingRow key={field.key} field={field} run={run} disabled={disabled} />
        ))}
        {/* Not under infra:, but the same kind of thing and the one most likely to be
            left behind when the apex changes — install.sh serves the store at
            sync.<primary_domain> while every app is told to use this literal. */}
        <SettingRow
          field={{
            key: 'sync_store.url',
            label: 'Sync-store URL',
            value: status.syncStore.url,
            hint: 'must equal https://sync.<primary domain>',
          }}
          root
          run={run}
          disabled={disabled}
        />
      </ul>
    </Card>
  )
}

function SettingRow({
  field,
  root,
  run,
  disabled,
}: {
  field: { key: string; label: string; value: string | null; hint: string }
  /** A top-level path like `sync_store.url` rather than a key under `infra:`. */
  root?: boolean
  run: (actionId: string, title: string, params?: Record<string, string>) => void
  disabled: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState(field.value ?? '')
  const changed = draft !== (field.value ?? '')
  const save = (): void => {
    if (changed) {
      run('setVar', `Set ${root ? field.key : `infra.${field.key}`}`, {
        ...(root ? { root: field.key } : { setting: field.key }),
        value: draft,
      })
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-32 shrink-0 text-meta text-muted" title={field.hint}>
        {field.label}
      </span>
      <Field value={draft} onChange={setDraft} placeholder={field.hint} onEnter={save} />
      <SmallButton disabled={disabled || !changed} onClick={save}>
        Save
      </SmallButton>
    </li>
  )
}

function Registry({
  status,
  run,
  disabled,
}: {
  status: InfraStatus
  run: (actionId: string, title: string, params?: Record<string, string>) => void
  disabled: boolean
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [token, setToken] = useState('')

  return (
    <Card
      title="Registry"
      hint={
        status.syncStore.url
          ? `${status.syncStore.url} — what every agent reads to find its peers.`
          : 'No sync-store configured.'
      }
    >
      {/* The store is not an app and deliberately has no app card, so its two
          controls live here. Restart matters more than it looks: the container reads
          SYNC_STORE_KEYS at startup, so regenerating tokens without restarting is
          what produces a 401 that reads like the store being down. */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={status.syncStore.reachable ? 'ok' : 'warn'}>
          {status.syncStore.containerState}
        </Chip>
        {status.syncStore.detail && (
          <span className="text-meta text-accent">{status.syncStore.detail}</span>
        )}
        <div className="flex-1" />
        <SmallButton
          disabled={disabled}
          title="Needed after regenerating tokens — SYNC_STORE_KEYS is read at startup"
          onClick={() => run('restart', 'Restart the sync-store', { app: 'sync-store' })}
        >
          Restart
        </SmallButton>
        <SmallButton
          disabled={disabled}
          onClick={() => run('logs', 'Logs — sync-store', { app: 'sync-store' })}
        >
          Logs
        </SmallButton>
      </div>

      {status.syncStore.servers.length === 0 ? (
        <p className="text-xs text-muted">Nothing registered, or the store did not answer.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {status.syncStore.servers.map((s) => (
            <li key={s.name} className="flex items-center gap-2 font-mono text-meta">
              <span className="w-24 shrink-0 truncate text-ink">{s.name}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{s.baseUrl}</span>
              {s.stale && <Chip tone="warn">stale</Chip>}
              <span className="shrink-0 text-micro text-muted">{s.lastSeen ?? '—'}</span>
              <SmallButton
                danger
                disabled={disabled}
                onClick={() => run('deregister', `Deregister ${s.name}`, { name: s.name })}
              >
                ✕
              </SmallButton>
            </li>
          ))}
        </ul>
      )}

      {/* The one column the registration upsert deliberately never writes: a
          300-second heartbeat would otherwise wipe every peer credential in the
          ecosystem five minutes after it was set. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Field value={name} onChange={setName} placeholder="server name" />
        <Field type="password" value={token} onChange={setToken} placeholder="peer token" />
        <SmallButton
          disabled={disabled || !name.trim() || !token.trim()}
          onClick={() => run('setPeerToken', `Set the peer token for ${name.trim()}`, {
            name: name.trim(),
            token: token.trim(),
          })}
        >
          Set peer token
        </SmallButton>
      </div>
    </Card>
  )
}
