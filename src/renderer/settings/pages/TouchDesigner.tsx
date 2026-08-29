import { useEffect, useState } from 'react'

import type { TdConfig, TdProject } from '../../../shared/touchdesigner'
import { WEB_SERVER_DAT_CALLBACK } from '../../../shared/touchdesigner-callback'
import { Divider, Field, Note, Subhead, field } from '../parts'

/**
 * Where the project is, which port it listens on, and what it currently reports.
 *
 * **Saves itself, like Extensions and Keywords, rather than through the save bar.** Both
 * of those pages opt out and say why; the reason is stronger here. These values change
 * what this machine announces to the whole fleet — the scene list rides out as an `enum`
 * on `switch_scene` — *and* they decide what a launch actually opens. A pending unsaved
 * port would also make Test connection test something other than what is on screen,
 * which is the one thing a diagnostic must never do.
 *
 * The projects list is the first add/remove editor in Settings; `parts.tsx` has no
 * repeater and the comparable list UI (SSH servers) lives outside Settings entirely. It
 * borrows the inline draft panel from `ssh/ServerList.tsx` and commit-on-blur-or-Enter
 * with Escape reverting from `Keywords.tsx`, and imports `field` rather than redeclaring
 * it the way `ServerList` does.
 */
export function TouchDesigner(): React.JSX.Element {
  const [config, setConfig] = useState<TdConfig | null>(null)
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.aperture.touchdesigner.config().then(setConfig)
  }, [])

  if (!config) return <div className="text-meta text-muted">Loading…</div>

  const save = (patch: Partial<TdConfig>): void => {
    void window.aperture.touchdesigner.setConfig(patch).then(setConfig)
  }

  const runProbe = (): void => {
    setProbing(true)
    setProbe(null)
    void window.aperture.touchdesigner
      .probe()
      .then((result) => {
        setProbe({ ok: result.ok, message: result.message })
        return window.aperture.touchdesigner.config()
      })
      .then(setConfig)
      .finally(() => setProbing(false))
  }

  return (
    <div className="flex flex-col gap-5">
      <Note>
        Aperture is only the wire here. It opens projects and forwards commands to a Web
        Server DAT inside your <code>.toe</code> — what a command <em>means</em>, and which
        scenes exist, is decided by your project, not by this app. Changes on this page save
        themselves.
      </Note>

      <MachineSettings config={config} save={save} />

      <Divider />

      <Projects
        config={config}
        setConfig={setConfig}
        error={error}
        setError={setError}
      />

      <Divider />

      <Subhead
        title="Connection"
        blurb="What the project reports right now, and the scene list Amber is told about."
      />
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={runProbe}
            disabled={probing}
            className="rounded-control border border-line px-3 py-1.5 text-meta text-ink transition-colors hover:bg-ink/5 disabled:opacity-40"
          >
            {probing ? 'Asking…' : 'Test connection'}
          </button>
          <span className="text-micro text-muted">
            Sends <code>status</code> and <code>list_scenes</code> to 127.0.0.1:
            {config.bridgePort}.
          </span>
        </div>
        {probe && (
          <p className={probe.ok ? 'text-meta text-muted' : 'text-meta text-danger'}>
            {probe.message}
          </p>
        )}
        <Scenes config={config} />
      </div>

      <Divider />

      <Subhead
        title="The callback"
        blurb="Paste this into the Callbacks DAT of a Web Server DAT in your project, then edit the three commands to mean whatever they should mean for your rig."
      />
      <div className="mt-2 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(WEB_SERVER_DAT_CALLBACK).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
          }}
          className="self-start rounded-control border border-line px-3 py-1.5 text-meta text-ink transition-colors hover:bg-ink/5"
        >
          {copied ? 'Copied' : 'Copy the callback'}
        </button>
        <pre className="max-h-64 overflow-auto rounded-field border border-line bg-ground p-3 text-micro text-muted">
          {WEB_SERVER_DAT_CALLBACK}
        </pre>
      </div>
    </div>
  )
}

/** Commit on blur or Enter, revert on Escape — the `KeywordRow` contract. */
function TextRow({
  label,
  hint,
  value,
  placeholder,
  mono,
  onCommit,
}: {
  label: string
  hint?: React.ReactNode
  value: string
  placeholder?: string
  mono?: boolean
  onCommit: (next: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const dirty = draft.trim() !== value

  return (
    <Field label={label} hint={hint}>
      <input
        className={mono ? `${field} font-mono` : field}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => dirty && onCommit(draft.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit(draft.trim())
          } else if (e.key === 'Escape') {
            setDraft(value)
          }
        }}
      />
    </Field>
  )
}

function MachineSettings({
  config,
  save,
}: {
  config: TdConfig
  save: (patch: Partial<TdConfig>) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Subhead title="This machine" blurb="Where TouchDesigner lives, and how to reach it." />
      <TextRow
        label="Bridge port"
        hint={
          <>
            The port your project&rsquo;s Web Server DAT listens on. Aperture only ever
            talks to 127.0.0.1, so nothing here is reachable from another machine.
          </>
        }
        value={String(config.bridgePort)}
        placeholder="9980"
        onCommit={(next) => save({ bridgePort: Number(next) })}
      />
      <TextRow
        label="TouchDesigner executable"
        hint="Optional. Leave it empty to open the .toe with whatever your OS associates — that works, but it cannot choose which build opens it, and it cannot pass a project to a specific install."
        value={config.executablePath}
        placeholder="C:\Program Files\Derivative\TouchDesigner\bin\TouchDesigner.exe"
        mono
        onCommit={(next) => save({ executablePath: next })}
      />
      <TextRow
        label="Process name"
        hint="Optional. What “close TouchDesigner” targets. Empty uses the platform default (TouchDesigner.exe on Windows)."
        value={config.processName}
        placeholder="TouchDesigner.exe"
        mono
        onCommit={(next) => save({ processName: next })}
      />
    </div>
  )
}

function Scenes({ config }: { config: TdConfig }): React.JSX.Element {
  if (!config.cachedScenes.length) {
    return (
      <p className="text-micro text-muted">
        No scenes known yet. They are read whenever Amber lists them, after a project
        opens, and when you test the connection above — until then{' '}
        <code>switch_scene</code> accepts any name and the project decides.
      </p>
    )
  }
  const when = config.scenesUpdatedAt
    ? new Date(config.scenesUpdatedAt).toLocaleString()
    : 'unknown'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {config.cachedScenes.map((scene) => (
          <span
            key={scene}
            className="rounded-control border border-line px-2 py-0.5 text-micro text-muted"
          >
            {scene}
          </span>
        ))}
      </div>
      <span className="text-micro text-muted">
        Read {when}. This is the list Amber is told about and the panel draws buttons from.
      </span>
    </div>
  )
}

const EMPTY_DRAFT = { name: '', path: '' }

/**
 * The projects list.
 *
 * Names are how Amber picks what to open ("open the bedroom rig"), which is why the main
 * process refuses a duplicate rather than resolving it to whichever came first — the way
 * `getServer` does for SSH. That refusal surfaces here rather than being swallowed.
 */
function Projects({
  config,
  setConfig,
  error,
  setError,
}: {
  config: TdConfig
  setConfig: (config: TdConfig) => void
  error: string
  setError: (message: string) => void
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)

  const reload = (): void => {
    void window.aperture.touchdesigner.config().then(setConfig)
  }

  const add = (): void => {
    if (!draft.name.trim()) return
    void window.aperture.touchdesigner.addProject(draft).then((result) => {
      if ('error' in result) {
        setError(result.error)
        return
      }
      setError('')
      setAdding(false)
      setDraft(EMPTY_DRAFT)
      reload()
    })
  }

  const edit = (id: string, patch: { name?: string; path?: string }): void => {
    void window.aperture.touchdesigner.updateProject(id, patch).then((result) => {
      if ('error' in result) {
        setError(result.error)
        return
      }
      setError('')
      reload()
    })
  }

  const remove = (project: TdProject): void => {
    if (!window.confirm(`Remove "${project.name}"? Nothing on disk is deleted.`)) return
    void window.aperture.touchdesigner.removeProject(project.id).then(() => {
      setError('')
      reload()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Subhead
        title="Projects"
        blurb="The .toe files this machine can open. Amber refers to them by name, so names have to be unique."
      />

      {config.projects.length === 0 && !adding && (
        <p className="text-micro text-muted">
          None yet. Until one is added, <code>process.launch</code> has nothing to open.
        </p>
      )}

      {config.projects.map((project) => (
        <div key={project.id} className="flex flex-col gap-2 rounded-field border border-line p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-meta text-ink">{project.name}</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-micro text-muted">
                <input
                  type="radio"
                  name="td-default-project"
                  checked={config.defaultProjectId === project.id}
                  onChange={() =>
                    void window.aperture.touchdesigner
                      .setConfig({ defaultProjectId: project.id })
                      .then(setConfig)
                  }
                  className="accent-accent"
                />
                default
              </label>
              <button
                type="button"
                onClick={() => remove(project)}
                className="rounded-control border border-line px-2 py-0.5 text-micro text-muted transition-colors hover:border-danger/50 hover:bg-danger/10 hover:text-danger"
              >
                Remove
              </button>
            </div>
          </div>
          <TextRow
            label="Name"
            value={project.name}
            onCommit={(next) => edit(project.id, { name: next })}
          />
          <TextRow
            label=".toe file"
            value={project.path}
            placeholder="C:\rigs\bedroom.toe"
            mono
            onCommit={(next) => edit(project.id, { path: next })}
          />
        </div>
      ))}

      {adding ? (
        <div className="flex flex-col gap-2 rounded-field border border-line p-3">
          <Field label="Name">
            <input
              className={field}
              value={draft.name}
              placeholder="Bedroom Rig"
              autoFocus
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label=".toe file">
            <input
              className={`${field} font-mono`}
              value={draft.path}
              placeholder="C:\rigs\bedroom.toe"
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            />
          </Field>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={add}
              className="rounded-control border border-line px-3 py-1 text-meta text-ink transition-colors hover:bg-ink/5"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setDraft(EMPTY_DRAFT)
                setError('')
              }}
              className="rounded-control px-3 py-1 text-meta text-muted transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start rounded-control border border-line px-3 py-1.5 text-meta text-ink transition-colors hover:bg-ink/5"
        >
          Add a project
        </button>
      )}

      {error && <p className="text-meta text-danger">{error}</p>}
    </div>
  )
}
