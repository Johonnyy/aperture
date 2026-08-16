import { useState } from 'react'

import { containerExists } from '../../shared/bloom'
import type { CredentialSummary, InfraApp } from '../../shared/types'
import { Configuration } from './Configuration'
import { Chip, Field, SmallButton } from './parts'
import { fillsFor, readinessFor, ReadinessList, ReadinessSummary } from './Readiness'
import { compareVersions, tagOf, type ReleaseInfo } from '../../shared/version'
import type { Params } from './useRunner'

/**
 * One deployed app.
 *
 * The line worth staring at is `imagePinned` vs `imageRunning`. They diverge when the
 * pin was bumped and nothing restarted, or when a container was started by hand — the
 * state where every dashboard says "healthy" and the code running is not the code you
 * think. Everything else on the card is context for that.
 *
 * `containerExists` used to live here. It moved to `shared/bloom.ts` when the Bloom
 * link needed the same predicate — a second copy of that list would be the same bug
 * it already caused once, with a delay fuse.
 */
export function AppCard({
  app,
  run,
  onOpenTerminal,
  advanced,
  credentials,
  onCredentialSaved,
  release,
  checkingRelease,
  onCheckReleases,
  defaults,
}: {
  app: InfraApp
  run: (actionId: string, title: string, params?: Params) => void
  onOpenTerminal: () => void
  /** Show the machinery: pin, roll back, rename, raw env, stop, logs. */
  advanced: boolean
  credentials: CredentialSummary[]
  onCredentialSaved: () => void
  /** The newest published version of this app, when its manifest names a repo. */
  release?: ReleaseInfo
  checkingRelease?: boolean
  /**
   * Re-ask GitHub for this app's newest release, ignoring the ten-minute cache.
   * Undefined when the manifest names no repo, which is the one case where there is
   * genuinely nothing to ask.
   */
  onCheckReleases?: () => void
  /** What upstream and server would be if the stanza does not say. */
  defaults?: { upstream?: string | null; server?: string | null }
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [purge, setPurge] = useState(false)
  // Config values typed in the checklist, carried into the install as parameters.
  // Not secrets, so they travel in `Params` and are visible in the operation log.
  const [configs, setConfigs] = useState<Record<string, string>>({})
  const [image, setImage] = useState('')
  const [tag, setTag] = useState('')
  const [rename, setRename] = useState('')

  /** Why an action is unavailable. Shown on hover, so it is never a dead button. */
  const gone = 'Nothing is deployed under this name — install it first.'

  const drift = Boolean(
    app.imagePinned && app.imageRunning && app.imagePinned !== app.imageRunning,
  )
  /**
   * Declared in secrets.yaml with nothing running.
   *
   * Two histories land here and cannot be told apart from the outside: an app that
   * was never installed, and one that `uninstall.sh` removed — it does `rm -rf` on
   * `/etc/amber-infra/<app>` but deliberately leaves the declaration, precisely so it
   * can be reinstalled. So the label says "not deployed", which is true of both,
   * rather than "never deployed", which is a claim about the past this cannot make.
   *
   * Not an error state either: no red dot, and the primary action is Install.
   */
  const notDeployed = !containerExists(app.container)
  /** Exists but is not up — Restart is the fix, not Install. */
  const stopped = containerExists(app.container) && app.container !== 'running'
  /** Nothing on disk to uninstall — so removing means removing the declaration. */
  const configOnly = notDeployed && !app.composeFile
  const params: Params = { app: app.name }
  const installParams: Params = {
    ...params,
    domain: app.domain ?? '',
    upstream: app.upstream ?? '',
  }

  // What this app still needs, from its own manifest weighed against what secrets.yaml
  // already holds and what the vault can supply. Null on a box whose status.sh predates
  // manifests, in which case the env editor below is still the whole story.
  const readiness = readinessFor(app.manifest, app.env, credentials)
  const blocked = Boolean(readiness && readiness.missing.some((m) => m.required))
  const composedInstall: Params = {
    ...installParams,
    fills: JSON.stringify(fillsFor(readiness, chosen)),
    configs: JSON.stringify(configs),
  }
  // The three prefixes disagreeing is the failure this release exists to make visible:
  // an app reading one namespace while its keys sit in another starts, serves and never
  // registers, with nothing anywhere saying so.
  /**
   * Three versions now exist, and they mean different things:
   *
   *   pinned   what secrets.yaml / the compose file say to run
   *   running  what the container is actually running — differs when the pin was
   *            bumped and nothing restarted (the existing `drift` above)
   *   latest   the newest published release
   *
   * So "restart to pick up the pin" and "a newer release exists" are different rows
   * with different buttons, and conflating them would offer an update to a version
   * already sitting on the disk.
   *
   * Watchtower apps are excluded from the Update button entirely: they run the moving
   * `:stable` tag and update themselves, so a manual button would be fighting an
   * auto-updater. `role` in the manifest is what makes that decidable.
   */
  const pinnedTag = tagOf(app.imagePinned)
  const autoUpdates = app.manifest?.role === 'app'
  const versus = compareVersions(pinnedTag, release?.latest ?? null)
  const canUpdate = !notDeployed && !autoUpdates && versus === 'behind'

  const prefixDrift =
    app.envPrefix &&
    ((app.envPrefixDeclared && app.envPrefixDeclared !== app.envPrefix) ||
      (app.envPrefixRendered && app.envPrefixRendered !== app.envPrefix))

  return (
    <li className="rounded-panel border border-line bg-raised/50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          title={`container ${app.container} · health ${app.health}`}
          className={[
            'h-2 w-2 shrink-0 rounded-full',
            // Absent is not broken. A red dot on something you deliberately removed
            // reads as a fault and sends you looking for one.
            notDeployed
              ? 'bg-line'
              : app.health === 'healthy'
                ? 'bg-ok'
                : app.container === 'running'
                  ? 'bg-accent'
                  : 'bg-danger',
          ].join(' ')}
        />

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm">
            {app.name}
            {app.domain && (
              <a
                href={`https://${app.domain}`}
                target="_blank"
                rel="noreferrer"
                className="truncate font-mono text-meta text-muted hover:text-accent-hi"
              >
                {app.domain}
              </a>
            )}
          </p>
          <p className="truncate font-mono text-meta text-muted">
            {app.imagePinned ?? 'no pinned image'}
          </p>
          {!notDeployed && (
            <p className="truncate text-meta">
              {autoUpdates ? (
                <span className="text-muted">auto-updates via Watchtower</span>
              ) : versus === 'behind' ? (
                <span className="text-accent">
                  v{pinnedTag} → v{release?.latest} available
                </span>
              ) : versus === 'up-to-date' ? (
                <span className="text-muted">v{pinnedTag} · up to date</span>
              ) : versus === 'ahead' ? (
                <span className="text-muted">
                  v{pinnedTag} · newer than the latest release (v{release?.latest})
                </span>
              ) : (
                // Never "up to date". A check that could not run is not evidence.
                <span className="text-muted" title={release?.error ?? 'not checked yet'}>
                  {pinnedTag ? `v${pinnedTag} · ` : ''}latest unknown
                </span>
              )}
            </p>
          )}
          {drift && (
            <p className="truncate font-mono text-meta text-accent">
              running {app.imageRunning} — restart to pick up the pin
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {notDeployed ? (
            // One chip, not four. "missing / unregistered / no health" is the same
            // fact said three ways, and saying it three ways makes it look like three
            // problems. The title carries the raw strings, so an unexpected one is
            // visible on hover instead of being silently reinterpreted.
            <span title={`container=${app.container} health=${app.health}`}>
              <Chip tone="muted">not deployed</Chip>
            </span>
          ) : (
            <>
              <Chip tone={app.container === 'running' ? 'ok' : 'warn'}>{app.container}</Chip>
              {app.health !== 'none' && app.health !== 'missing' && (
                <Chip tone={app.health === 'healthy' ? 'ok' : 'warn'}>{app.health}</Chip>
              )}
              {app.httpStatus !== null && (
                <Chip tone={app.httpStatus < 400 ? 'ok' : 'danger'}>/health {app.httpStatus}</Chip>
              )}
              <Chip tone={app.registered ? (app.stale ? 'warn' : 'ok') : 'muted'}>
                {app.registered ? (app.stale ? 'registry: stale' : 'registered') : 'unregistered'}
              </Chip>
            </>
          )}
          {prefixDrift && (
            <span
              title={`manifest says ${app.envPrefix}; secrets.yaml says ${app.envPrefixDeclared ?? '—'}; the running .env uses ${app.envPrefixRendered ?? '—'}`}
            >
              <Chip tone="danger">prefix mismatch</Chip>
            </span>
          )}
          {notDeployed && readiness && <ReadinessSummary readiness={readiness} />}
          {/* A deployed app missing a required key is the "no symptom at all" case:
              the container is up, health is green, and the one capability that key
              buys is silently absent. Say it on the row, where the other states are,
              rather than only inside Manage. */}
          {!notDeployed && blocked && (
            <span
              title={`Missing ${readiness?.missing.map((m) => m.label).join(', ')} — open Manage to supply ${readiness && readiness.missing.length === 1 ? 'it' : 'them'}`}
            >
              <Chip tone="warn">needs {readiness?.missing.length} value{readiness?.missing.length === 1 ? '' : 's'}</Chip>
            </span>
          )}
          {stopped && (
            <SmallButton
              primary
              title={`Container is ${app.container} — bring it back up`}
              onClick={() => run('restart', `Restart ${app.name}`, params)}
            >
              Start
            </SmallButton>
          )}
          {notDeployed && (
            // One button for the whole thing: declare, generate, fill from the vault,
            // install — rehearsed against a scratch copy of secrets.yaml first. It
            // used to be Declare, then Install, then Reconcile, in that order.
            <SmallButton
              primary
              disabled={!app.domain || blocked}
              title={
                blocked
                  ? `Still needs ${readiness?.missing.map((m) => m.label).join(', ')}`
                  : app.domain
                    ? `Declare, generate its keys, fill saved ones, then install.sh --app ${app.name}`
                    : 'No domain in secrets.yaml — enter the sudo password and re-read, or set one below'
              }
              onClick={() => run('installApp', `Install ${app.name}`, composedInstall)}
            >
              Install
            </SmallButton>
          )}
          {canUpdate && (
            // update-app.sh, not setImage + reconcile: it reverts to the last image
            // this box actually saw healthy, which is what makes one click safe on a
            // server you are not sitting at.
            <SmallButton
              primary
              title={`Pin ${app.name} to ${release?.latest} and restart it, reverting if it does not come back healthy`}
              onClick={() =>
                run('updateApp', `Update ${app.name} to ${release?.latest}`, {
                  ...params,
                  tag: release?.latest ?? '',
                })
              }
            >
              Update
            </SmallButton>
          )}
          {!notDeployed && !autoUpdates && versus === 'unknown' && onCheckReleases && (
            <SmallButton
              disabled={checkingRelease}
              title={release?.error ?? 'Ask GitHub for the newest published version'}
              onClick={onCheckReleases}
            >
              {checkingRelease ? 'Checking…' : 'Check'}
            </SmallButton>
          )}
          <SmallButton onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Manage'}</SmallButton>
        </div>
      </div>

      {/* The checklist sits outside Manage: it is the thing you need before you press
          the button beside it, not a detail you go looking for. */}
      {notDeployed && readiness && readiness.items.length > 0 && (
        <div className="mt-3 rounded-field border border-line bg-ground p-3">
          <ReadinessList
            readiness={readiness}
            credentials={credentials}
            chosen={chosen}
            onChoose={(key, uid) => setChosen((c) => ({ ...c, [key]: uid }))}
            onSaved={onCredentialSaved}
            configs={configs}
            onConfig={(key, value) => setConfigs((c) => ({ ...c, [key]: value }))}
          />
        </div>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-field border border-line bg-ground p-3">
          {/* Everything from Restart down needs a container. Offering them against
              nothing produces a raw daemon error and an operation log that reads like
              a fault rather than an absence. `gone` is the reason, shown on hover. */}
          <Row label="Deploy">
            {/* Re-pull the tag that is already pinned, with the same revert-on-unhealthy
                as the Update button above. Useful when a tag was force-pushed, or to
                re-run the env reconcile after adding a key. `updateAmber` used to sit
                here as an Amber-only special case; update-app.sh is the same script
                generalised, and update-amber.sh is now a wrapper over it so the voice
                trigger and the systemd path unit keep working. */}
            {!notDeployed && (
              <SmallButton
                title="Pull the currently pinned tag again and restart, reverting if it does not come back"
                onClick={() => run('updateApp', `Re-pull ${app.name}`, params)}
              >
                Re-pull pin
              </SmallButton>
            )}
            <SmallButton
              disabled={!app.domain}
              title={app.domain ? undefined : 'No domain in secrets.yaml for this app'}
              onClick={() =>
                run(
                  'install',
                  notDeployed ? `Install ${app.name}` : `Reconcile ${app.name}`,
                  installParams,
                )
              }
            >
              {notDeployed ? 'Install' : 'Reconcile'}
            </SmallButton>
            <SmallButton
              disabled={notDeployed}
              title={notDeployed ? gone : undefined}
              onClick={() => run('restart', `Restart ${app.name}`, params)}
            >
              Restart
            </SmallButton>
            <SmallButton
              disabled={notDeployed}
              title={notDeployed ? gone : undefined}
              onClick={() => run('stop', `Stop ${app.name}`, params)}
            >
              Stop
            </SmallButton>
            <SmallButton
              disabled={notDeployed}
              title={notDeployed ? gone : undefined}
              onClick={() => run('logs', `Logs — ${app.name}`, params)}
            >
              Logs
            </SmallButton>
            {/* Not gated: this is a shell on the box, which exists either way. */}
            <SmallButton onClick={onOpenTerminal}>Terminal here</SmallButton>
          </Row>

          {/* --- updates ---
              The row above the card only offers "Check" while the answer is *unknown*,
              which leaves the ordinary case with no way out: once a check has said
              "up to date" that verdict is cached for ten minutes, and publishing a
              release inside that window leaves the card confidently wrong with nothing
              to press. Restarting does not help either and reasonably looks like it
              should — `restart` is `compose up -d`, so it re-runs the pinned tag rather
              than looking for a newer one, and the pin is exactly what a stale check
              has failed to update.

              So: one button that always exists, forces a fresh call to GitHub for this
              repo alone, and says when the answer it is showing was taken. */}
          <Row label="Updates">
            {onCheckReleases ? (
              <>
                <SmallButton
                  disabled={checkingRelease}
                  title={`Ask GitHub for the newest published release of ${app.name}, ignoring the ten-minute cache`}
                  onClick={onCheckReleases}
                >
                  {checkingRelease ? 'Checking…' : 'Check for updates'}
                </SmallButton>
                {/* The same action as the Update button on the row above, offered here
                    too because this is where you are standing when the check comes back
                    behind — one `run('updateApp')`, not a second update path. */}
                {canUpdate && (
                  <SmallButton
                    primary
                    title={`Pin ${app.name} to ${release?.latest} and restart it, reverting if it does not come back healthy`}
                    onClick={() =>
                      run('updateApp', `Update ${app.name} to ${release?.latest}`, {
                        ...params,
                        tag: release?.latest ?? '',
                      })
                    }
                  >
                    Update to v{release?.latest}
                  </SmallButton>
                )}
                <span className="text-micro text-muted">
                  {release?.error
                    ? // Never softened into "up to date": a check that failed is not
                      // evidence, and the reason is the only thing that fixes it.
                      `${release.error} · last tried ${since(release.checkedAt)}`
                    : release?.latest
                      ? `latest v${release.latest} · checked ${since(release.checkedAt)}`
                      : 'not checked yet'}
                </span>
              </>
            ) : (
              <span className="text-micro text-muted">
                No release repo in this app&apos;s manifest, so there is nothing to check
                against — pin a tag by hand under Advanced.
              </span>
            )}
          </Row>

          {/* The app's own fields, as opposed to its env. Nothing derives these and
              everything depends on them: `domain` is the exact name Caddy asks Let's
              Encrypt for. It was previously readable here and editable only over SSH,
              which is how a stale value from the example file survives an apex change
              and turns into a certificate request for a host you do not own. */}
          <Row label="Identity">
            <Stanza
              app={app.name}
              field="domain"
              value={app.domain}
              run={run}
              hint="the hostname Caddy serves, and the exact name it asks Let's Encrypt for"
            />
          </Row>
          <Row label="">
            <Stanza
              app={app.name}
              field="upstream"
              value={app.upstream}
              fallback={defaults?.upstream}
              run={run}
              hint="where Caddy proxies to — the loopback port from this app's compose file"
            />
          </Row>
          <Row label="">
            <Stanza
              app={app.name}
              field="server"
              value={app.server}
              fallback={defaults?.server}
              run={run}
              hint="which box this app belongs to (infra.server). Blank means this one."
            />
          </Row>

          {/* Configuration, ungated.
              This was the env editor, behind Advanced mode and listing only what
              secrets.yaml already held — which meant the one question worth asking
              ("what does this app need that it hasn't got?") was both unanswerable and
              in a place most people never open, because a key nothing has written has
              no row in secrets.yaml to appear as. It joins the manifest now, so a
              missing key is a row rather than an absence, and it is always visible:
              principle 2 says a value you can only fix over SSH is a missing feature. */}
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-meta text-muted">Configuration</p>
            <Configuration
              app={app}
              readiness={readiness}
              credentials={credentials}
              run={run}
              onCredentialSaved={onCredentialSaved}
              // install.sh is the reconcile for an app already deployed — the same
              // action the Deploy row above spells "Reconcile", not a second path.
              // Null without a domain, because that is what install.sh refuses on.
              onReconcile={
                notDeployed || !app.domain
                  ? null
                  : () => run('install', `Reconcile ${app.name}`, installParams)
              }
              advanced={advanced}
              disabled={false}
            />
          </div>

          {/* Everything from here down is machinery. Behind Advanced mode, not because
              it is dangerous but because it is rarely the answer: pinning an image by
              hand, rolling back, renaming. Deploy, Configuration and Remove are the
              ordinary path.

              Editing a value used to be listed here too, and that was the mistake this
              change undoes — a setting you cannot see without opting into the machinery
              is a setting you edit over SSH. Advanced still gates the two things that
              are about the *shape* of secrets.yaml rather than a value in it: adding a
              key by hand and deleting one. Both live inside the Configuration section. */}
          {advanced && (
          <>
          <Row label="Pin">
            <Field
              value={image}
              onChange={setImage}
              placeholder={app.imagePinned ?? 'ghcr.io/owner/app:0.1.0'}
            />
            <SmallButton
              disabled={!image.trim()}
              onClick={() =>
                run('setImage', `Pin ${app.name} to ${image.trim()}`, {
                  ...params,
                  image: image.trim(),
                })
              }
            >
              Set tag
            </SmallButton>
            <span className="text-micro text-muted">
              writes secrets.yaml — reconcile or restart afterwards to deploy it
            </span>
          </Row>

          {/* rollback.sh resolves the compose file first and dies without one, so
              there is nothing to roll back to until this is deployed again. */}
          <Row label="Roll back">
            <SmallButton
              disabled={notDeployed}
              title={notDeployed ? gone : undefined}
              onClick={() => run('rollbackList', `Rollback targets — ${app.name}`, params)}
            >
              List tags
            </SmallButton>
            <Field value={tag} onChange={setTag} placeholder="tag" />
            <SmallButton
              disabled={notDeployed || !tag.trim()}
              title={notDeployed ? gone : undefined}
              onClick={() =>
                run('rollback', `Roll ${app.name} back to ${tag.trim()}`, {
                  ...params,
                  tag: tag.trim(),
                })
              }
            >
              Roll back
            </SmallButton>
          </Row>

          {/* Only offered while there is nothing deployed under the old name. Once
              there is, the name lives in the container, /etc/amber-infra, the Caddy
              snippet, the registry and the backup targets — the action refuses, and
              says so, rather than editing config into disagreeing with reality. */}
          <Row label="Rename">
            <Field value={rename} onChange={setRename} placeholder="new name" />
            <SmallButton
              disabled={!/^[a-z][a-z0-9-]*$/.test(rename) || rename === app.name}
              onClick={() =>
                run('renameApp', `Rename ${app.name} to ${rename}`, {
                  ...params,
                  to: rename,
                })
              }
            >
              Rename
            </SmallButton>
            <span className="text-micro text-muted">
              config only, and only before it is deployed
            </span>
          </Row>

          </>
          )}

          {/* One Remove, not two, and not five.
              It stops the container, un-hooks the Caddy site, deregisters it, deletes
              /etc/amber-infra/<app> AND removes its stanza and registry key — the last
              of which used to be a separate `undeclareApp` you had to know to press,
              which is why ghost entries accumulated.

              Data is kept unless you tick the box. That default is deliberate in
              uninstall.sh and a GUI must not quietly invert it. */}
          <Row label="Remove">
            {configOnly ? (
              <>
                <SmallButton
                  danger
                  onClick={() => run('undeclareApp', `Remove the ${app.name} declaration`, params)}
                >
                  Remove declaration
                </SmallButton>
                <span className="text-micro text-muted">
                  edits secrets.yaml only — there is nothing deployed to uninstall.
                </span>
              </>
            ) : (
              <>
                <SmallButton
                  danger
                  onClick={() =>
                    run('removeApp', `Remove ${app.name}`, {
                      ...params,
                      purge: String(purge),
                    })
                  }
                >
                  Remove {app.name}
                </SmallButton>
                <label className="flex items-center gap-1.5 text-micro text-muted">
                  <input
                    type="checkbox"
                    checked={purge}
                    onChange={(e) => setPurge(e.target.checked)}
                    className="accent-danger"
                  />
                  also delete its data volumes
                </label>
                <span className="text-micro text-muted">
                  {purge
                    ? 'Its database goes with it. Backups are still untouched.'
                    : 'Keeps its volumes, so reinstalling picks up where it left off.'}
                </span>
              </>
            )}
          </Row>

        </div>
      )}
    </li>
  )
}

/** One field of an app's stanza in secrets.yaml. Not a secret, so shown in the clear. */
/**
 * One field of an app's stanza in secrets.yaml. Not a secret, so shown in the clear.
 *
 * `fallback` is what the value would be if nobody set it — the loopback port out of
 * the compose file, the box label out of `infra.server`. Before it existed these
 * rendered as empty boxes labelled "upstream" and "server", which is a question with
 * no visible answer: both are derivable, and neither is something to invent.
 */
function Stanza({
  app,
  field,
  value,
  fallback,
  hint,
  run,
}: {
  app: string
  field: 'domain' | 'upstream' | 'server' | 'image'
  value: string | null
  /** The derived default, prefilled when the stanza has not set one. */
  fallback?: string | null
  hint?: string
  run: (actionId: string, title: string, params?: Params) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? fallback ?? '')
  // Compared against the *stored* value, not the fallback: a prefilled default that
  // has never been written is a change worth being able to save.
  const changed = draft !== (value ?? '')
  const save = (): void => {
    if (changed) run('setVar', `Set ${app}.${field}`, { app, field, value: draft })
  }
  return (
    <>
      <Field
        value={draft}
        onChange={setDraft}
        placeholder={field}
        onEnter={save}
      />
      <SmallButton disabled={!changed} onClick={save}>
        Save {field}
      </SmallButton>
      {hint && <span className="text-micro text-muted">{hint}</span>}
    </>
  )
}

/**
 * An epoch timestamp as an age.
 *
 * The point of showing it at all is that a release answer is cached for ten minutes, so
 * "up to date" is a claim about a moment rather than about now — and the reader has to
 * be able to see which moment before deciding whether to press Check again.
 */
function since(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-meta text-muted">{label}</span>
      {children}
    </div>
  )
}
