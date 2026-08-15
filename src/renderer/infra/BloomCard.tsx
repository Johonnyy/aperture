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
  // There is deliberately no `stillUnregistered` here any more. Registration is the
  // Registry card's subject, for every app; this card is about the ADMIN key, which is
  // a different credential for a different purpose — the GUI edits configuration, a
  // peer agent spends money, and one leaked token must not buy both.

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

      {/* Step 3 used to be here: five sentences about why Bloom might not have
          registered, hedged with "most likely" and "give it a moment", under a button
          whose own tooltip described a different operation. It was hedged because this
          card genuinely could not tell the causes apart — nothing reported the key list
          the registry was actually running.

          The Registry card at the top of this page can, now that status.sh reports both
          sides of that list. It says one line, offers one button, and does it for every
          app rather than only this one. Duplicating it here would put two different
          accounts of the same failure on one screen, which is how the "Reload the
          registry" and "Re-link" confusion started in the first place. */}

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
