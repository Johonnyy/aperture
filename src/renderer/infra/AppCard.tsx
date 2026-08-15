import { useState } from 'react'

import type { InfraApp } from '../../shared/types'
import { EnvEditor } from './EnvEditor'
import { Chip, Field, SmallButton } from './parts'
import type { Params } from './useRunner'

/**
 * One deployed app.
 *
 * The line worth staring at is `imagePinned` vs `imageRunning`. They diverge when the
 * pin was bumped and nothing restarted, or when a container was started by hand — the
 * state where every dashboard says "healthy" and the code running is not the code you
 * think. Everything else on the card is context for that.
 */
/**
 * Docker's own container states. Anything else — "missing", an empty string, or the
 * "<no value>" a Go template yields when asked for `.State` on something that is not
 * a container — means there is nothing running under this name.
 *
 * Matching the set rather than the sentinel is the point. This used to test
 * `container === 'missing'`, so one unexpected string from the far end silently
 * flipped the card into "deployed": four status chips and no Install button, on a box
 * with no container at all.
 */
const CONTAINER_STATES = [
  'running',
  'restarting',
  'paused',
  'exited',
  'created',
  'dead',
  'removing',
]

function containerExists(state: string): boolean {
  return CONTAINER_STATES.includes(state.trim())
}

export function AppCard({
  app,
  run,
  onOpenTerminal,
}: {
  app: InfraApp
  run: (actionId: string, title: string, params?: Params) => void
  onOpenTerminal: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [image, setImage] = useState('')
  const [tag, setTag] = useState('')
  const [rename, setRename] = useState('')

  /** Why an action is unavailable. Shown on hover, so it is never a dead button. */
  const gone = 'Nothing is deployed under this name — install it first.'

  const drift = Boolean(
    app.imagePinned && app.imageRunning && app.imagePinned !== app.imageRunning,
  )
  // secrets.yaml is the source; the container reads a rendered .env. A key present in
  // one and not the other means an edit that has not been reconciled yet — the same
  // class of "looks green, isn't what you think" as the image-tag drift above.
  const drifted = app.env.filter((v) => !app.envKeys.includes(v.name))
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
            <SmallButton
              primary
              disabled={!app.domain}
              title={
                app.domain
                  ? `Run install.sh --app ${app.name} --domain ${app.domain}`
                  : 'No domain in secrets.yaml — enter the sudo password and re-read, or set one below'
              }
              onClick={() => run('install', `Install ${app.name}`, installParams)}
            >
              Install
            </SmallButton>
          )}
          <SmallButton onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Manage'}</SmallButton>
        </div>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-field border border-line bg-ground p-3">
          {/* Everything from Restart down needs a container. Offering them against
              nothing produces a raw daemon error and an operation log that reads like
              a fault rather than an absence. `gone` is the reason, shown on hover. */}
          <Row label="Deploy">
            {app.name === 'amber' && !notDeployed && (
              <SmallButton onClick={() => run('updateAmber', 'Update Amber')}>
                Update Amber
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

          {/* The app's own fields, as opposed to its env. Nothing derives these and
              everything depends on them: `domain` is the exact name Caddy asks Let's
              Encrypt for. It was previously readable here and editable only over SSH,
              which is how a stale value from the example file survives an apex change
              and turns into a certificate request for a host you do not own. */}
          <Row label="Identity">
            <Stanza app={app.name} field="domain" value={app.domain} run={run} />
          </Row>
          <Row label="">
            <Stanza app={app.name} field="upstream" value={app.upstream} run={run} />
            <Stanza app={app.name} field="server" value={app.server} run={run} />
          </Row>

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

          <Row label="Danger">
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
                  Keeping it is what lets you install again later.
                </span>
              </>
            ) : (
              <SmallButton danger onClick={() => run('uninstall', `Remove ${app.name}`, params)}>
                Remove app
              </SmallButton>
            )}
          </Row>

          <div className="border-t border-line pt-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="w-16 shrink-0 text-meta text-muted">Env</span>
              {drifted.length > 0 && (
                <Chip tone="warn">
                  {drifted.length} not yet in the running .env
                </Chip>
              )}
            </div>
            {app.env.length > 0 ? (
              <EnvEditor app={app.name} vars={app.env} run={run} disabled={false} />
            ) : (
              <p className="text-meta text-muted">
                Nothing under <code>apps.{app.name}.env</code>, or secrets.yaml could not
                be read — enter the sudo password and re-read.
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/** One field of an app's stanza in secrets.yaml. Not a secret, so shown in the clear. */
function Stanza({
  app,
  field,
  value,
  run,
}: {
  app: string
  field: 'domain' | 'upstream' | 'server' | 'image'
  value: string | null
  run: (actionId: string, title: string, params?: Params) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? '')
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
    </>
  )
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
