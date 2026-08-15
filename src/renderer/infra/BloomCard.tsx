import { useState } from 'react'

import { containerExists } from '../../shared/bloom'
import type { InfraStatus } from '../../shared/types'
import { useStore } from '../store'
import { Card, Chip, SmallButton } from './parts'
import type { Params } from './useRunner'

/**
 * Linking Bloom, from the box it runs on.
 *
 * This lives in the Servers tab rather than beside Bloom's own settings for one
 * reason: reading the admin key means reading a root-only file, and the sudo
 * password exists here — held in this view's state for as long as it is open, sent
 * per action, never stored. Putting a Link button anywhere else would mean either
 * persisting a root password or asking for it in a second place with a second
 * lifetime.
 *
 * The domain comes from the status document rather than being derived here. That
 * document reports `apps.bloom.domain` already, and grepping secrets.yaml for it
 * would be a second, worse YAML parser for a value we are holding.
 *
 * What the probe adds is the one thing the status document is designed *never* to
 * carry: a secret. `EnvVar.value` is null for anything classified as one, precisely
 * so the document stays safe to poll and log.
 */
export function BloomCard({
  status,
  serverId,
  sudoPassword,
  needsPassword,
  run,
}: {
  status: InfraStatus
  serverId: string
  sudoPassword: () => string | undefined
  needsPassword: boolean
  run: (actionId: string, title: string, params?: Params) => void
}): React.JSX.Element | null {
  const link = useStore((s) => s.bloomLink)
  const setBloomLink = useStore((s) => s.setBloomLink)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const app = status.apps.find((a) => a.name === 'bloom')
  // Nothing to say on a box that has never heard of Bloom. The Catalogue card next
  // door is what offers to install it.
  if (!app) return null

  const deployed = containerExists(app.container)
  const linkedHere = link.serverId === serverId && link.state !== 'unlinked'

  /**
   * Three states, in order, each keyed on something actually visible.
   *
   * The first cut of this gated everything on one `misconfigured` flag derived from
   * `!registered`, and that was a dead end: the repair writes secrets.yaml, but
   * `registered` only flips after a reinstall, a restart and a successful heartbeat.
   * So the warning stayed up and Link stayed disabled with no way forward — the
   * repair reported success and the card looked identical.
   *
   * The fix is to read the drift the status document already reports. `env` is what
   * secrets.yaml *declares*; `envKeys` is what the rendered .env actually *has*. The
   * gap between them is precisely "edited but not yet reconciled", which is the step
   * that was missing.
   *
   *   declared? no  -> repair
   *   declared but not rendered? -> reconcile
   *   rendered -> link
   *
   * Link is gated on the *rendered* key because that is the file the SSH probe
   * reads. Anything else would offer a button that cannot work.
   */
  const ADMIN_KEY = 'BLOOM_ADMIN_KEYS'
  const declaredKeys = app.env.map((v) => v.name)
  const adminDeclared = declaredKeys.includes(ADMIN_KEY)
  const adminRendered = app.envKeys.includes(ADMIN_KEY)

  const needsRepair = deployed && !adminDeclared
  const needsReconcile = deployed && adminDeclared && !adminRendered
  const canLink = deployed && adminRendered
  // Everything is in place and it still has not checked in. A different problem —
  // most likely the sync store itself — so say that rather than blaming the prefix.
  const stillUnregistered = canLink && !app.registered

  const missingModelKey =
    adminDeclared && !declaredKeys.includes('BLOOM_OPENROUTER_API_KEY')

  const installParams: Params = {
    app: 'bloom',
    domain: app.domain ?? '',
    upstream: app.upstream ?? '',
  }

  const doLink = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await window.aperture.bloom.discover(
      serverId,
      app.domain ?? '',
      sudoPassword(),
    )
    setBusy(false)
    if (result.link) setBloomLink(result.link)
    if (!result.ok) setError(result.error ?? 'Could not link Bloom.')
  }

  return (
    <Card
      title="Bloom"
      hint="Reads the admin key off this box so the Bloom tab can manage its agents."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={deployed ? (app.container === 'running' ? 'ok' : 'warn') : 'muted'}>
          {app.container}
        </Chip>
        {app.domain && <span className="font-mono text-meta text-muted">{app.domain}</span>}
        {linkedHere && <Chip tone={link.state === 'linked' ? 'ok' : 'warn'}>{link.state}</Chip>}
      </div>

      {error && <p className="text-meta text-danger">{error}</p>}

      {/* Step 1: the keys are not even declared. */}
      {needsRepair && (
        <div className="flex flex-col gap-2 rounded-field border border-warn/50 bg-warn/10 p-2.5">
          <p className="text-xs text-warn">
            Bloom is running but has no admin key declared, so nothing can manage it
            and it has nothing to register with. The usual cause is a missing
            <code> env_prefix</code>: install.sh then writes its keys as
            <code> AGENT_MCP_*</code>, which Bloom ignores rather than rejects.
          </p>
          <p className="text-micro text-muted">
            The rehearsal reads the prefix and the rendered env file on the box and
            reports what it actually finds, before changing anything.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* `repairBloom` used to live here: ~100 lines of hand-written repair
                for this one app's stanza. It is now `declare.sh --reconcile --adopt`,
                which renames any key carrying the wrong prefix — keeping its value,
                because a token a peer already holds must survive being renamed — and
                generates whatever the manifest says the box can. The same command
                fixes the next app that lands here, which the bespoke one could not. */}
            <SmallButton
              primary
              disabled={needsPassword}
              title={needsPassword ? 'Enter the sudo password above first.' : undefined}
              onClick={() => run('reconcileApp', "Reconcile Bloom's configuration", { app: 'bloom' })}
            >
              Repair configuration
            </SmallButton>
            <span className="text-micro text-muted">
              Keeps your existing token; generates the admin and encryption keys.
            </span>
          </div>
        </div>
      )}

      {/* Step 2: repaired, but the container is still running the old env. This is
          the step the first version of this card left out entirely. */}
      {needsReconcile && (
        <div className="flex flex-col gap-2 rounded-field border border-accent-deep bg-accent/10 p-2.5">
          <p className="text-xs text-accent-hi">
            Repaired. The new keys are in secrets.yaml but not yet in Bloom&apos;s env
            file, so the running container has not seen them — reconcile to render
            them and restart it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <SmallButton
              primary
              disabled={needsPassword || !app.domain}
              title={needsPassword ? 'Enter the sudo password above first.' : undefined}
              onClick={() => run('install', 'Reconcile bloom', installParams)}
            >
              Reconcile Bloom
            </SmallButton>
            <span className="text-micro text-muted">
              Then link. Amber needs reconciling too if her peer settings changed.
            </span>
          </div>
        </div>
      )}

      {/* Step 3: everything is in place and it still has not checked in. Different
          problem, so different words — do not keep blaming the prefix. */}
      {/* Bloom is healthy and holds a registry token, and the registry still refuses
          it. The cause is almost always on the registry side and it is not obvious:
          the sync-store reads SYNC_STORE_KEYS once, at startup, so an app whose token
          was minted after the store last started is simply unknown to it. Every
          registration attempt is a 401 that nothing surfaces.

          This used to say "check the sync store itself" and stop there, with the
          Re-link button sitting underneath it — which reads as the remedy and is not
          one. Re-link re-reads BLOOM_ADMIN_KEYS so *Aperture* can manage Bloom; it
          has nothing to do with whether Bloom can reach the registry. */}
      {stillUnregistered && (
        <div className="flex flex-col gap-2 rounded-field border border-warn/50 bg-warn/10 p-2.5">
          <p className="text-xs leading-relaxed text-warn">
            Bloom has its keys but has not registered. It registers on startup and on a
            heartbeat, so give it a moment after a restart.
          </p>
          <p className="text-micro leading-relaxed text-muted">
            If it persists, the registry has most likely never been told about Bloom:
            the sync-store loads its key list at startup, so an app declared after it
            last started is rejected until it reloads. Re-running the install reloads
            the key list and restarts the store only if it actually changed.
            <strong className="text-ink">
              {' '}
              Update the amber-infra checkout on this box first
            </strong>{' '}
            — an older install.sh minted the token after starting the store and could
            not fix this.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <SmallButton
              primary
              disabled={needsPassword || !app.domain}
              title={
                needsPassword
                  ? 'Enter the sudo password above first.'
                  : 'Re-runs install.sh for Bloom, which reconciles the registry key list'
              }
              onClick={() => run('install', 'Reconcile bloom and the registry', installParams)}
            >
              Reload the registry
            </SmallButton>
            <span className="text-micro text-muted">
              Re-link below is a different thing — it refreshes Aperture&apos;s admin
              key, not Bloom&apos;s registry token.
            </span>
          </div>
        </div>
      )}

      {missingModelKey && (
        <p className="text-xs text-muted">
          No <code>BLOOM_OPENROUTER_API_KEY</code> yet — agents will not run without
          one. Add it in the app&apos;s env below, then re-install.
        </p>
      )}

      {!deployed ? (
        <p className="text-xs text-muted">
          Declared but not deployed here. Install it first, then link.
        </p>
      ) : !app.domain ? (
        <p className="text-xs text-muted">
          No domain recorded for Bloom on this box, so there is no address to reach it
          on. Set <code>apps.bloom.domain</code> in secrets.yaml and re-read.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <SmallButton
            primary={!linkedHere && canLink}
            disabled={busy || needsPassword || !canLink}
            title={
              needsRepair
                ? 'Repair the configuration first — there is no admin key to read yet.'
                : needsReconcile
                  ? 'Reconcile first — the key is in secrets.yaml but not yet in the env file this reads.'
                  : needsPassword
                    ? 'Enter the sudo password above — the admin key is in a root-only file.'
                    : undefined
            }
            onClick={() => void doLink()}
          >
            {busy ? 'Reading…' : linkedHere ? 'Re-link' : 'Link Bloom'}
          </SmallButton>
          <span className="text-xs text-muted">
            {linkedHere
              ? 'Re-read the key if it has been rotated.'
              : 'Adds the Bloom tab to the sidebar.'}
          </span>
        </div>
      )}
    </Card>
  )
}
