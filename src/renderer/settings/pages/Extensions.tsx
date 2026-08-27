import { useEffect, useState } from 'react'

import type { ExtensionSummary } from '../../../shared/extensions'
import { useStore } from '../../store'
import { Divider, Note, Subhead, Toggle } from '../parts'

/**
 * What is installed on this machine, and what each thing is allowed to do.
 *
 * This is a **consent screen**, so two properties matter more than looking tidy.
 *
 * It says what a permission means in words, not as a slug: "may shut down, restart or
 * sleep this machine" rather than `power`. Someone agreeing to a thing they cannot read
 * has not agreed to anything.
 *
 * And it is honest about the limit. An ungranted action is never announced to Amber and
 * is refused if asked for anyway — two real gates, in two processes. What it is *not* is
 * a sandbox: every extension is compiled into the same bundle with the same privileges,
 * so this list is a statement of intent that the build enforces at its edges, not a
 * boundary the OS holds. Saying so is better than implying a guarantee that isn't there.
 *
 * Saves itself on toggle rather than through the save bar, like the Keywords page: a
 * grant changes what this machine advertises to the whole fleet, so a pending unsaved
 * permission would be a lie on screen in both directions.
 */
export function Extensions(): React.JSX.Element {
  const fromEvent = useStore((s) => s.extensions)
  const [local, setLocal] = useState<ExtensionSummary[]>([])
  const summaries = fromEvent.length ? fromEvent : local

  useEffect(() => {
    void window.aperture.extensions.list().then(setLocal)
  }, [])

  const toggle = (key: string, granted: boolean): void => {
    void window.aperture.extensions.setGrant(key, granted).then(setLocal)
  }

  return (
    <div className="flex flex-col gap-5">
      <Note>
        Extensions are what Amber can drive on this machine. Nothing here is on by
        default — an ungranted permission means the capability is never offered to her
        and is refused if she asks anyway. These are compiled into the app rather than
        installed, so this list changes only when Aperture updates.
      </Note>

      {summaries.map((extension, index) => (
        <div key={extension.id}>
          {index > 0 && <Divider />}
          <Subhead
            title={`${extension.name} · v${extension.version}`}
            blurb={extension.description}
          />

          <div className="mt-3 flex flex-col gap-2">
            {extension.permissions.map((permission) => (
              <Toggle
                key={permission.permission}
                label={`Allow it to ${permission.label}`}
                hint={
                  permission.granted
                    ? 'Announced to Amber and available in the Devices panel.'
                    : 'Not announced, and refused if she asks for it anyway.'
                }
                checked={permission.granted}
                onChange={(next) => toggle(`${extension.id}:${permission.permission}`, next)}
              />
            ))}
          </div>

          <ul className="mt-3 flex flex-col gap-1">
            {extension.actions.map((action) => (
              <li key={action.key} className="flex items-baseline gap-2 text-meta">
                <span
                  className={action.available ? 'font-mono text-ink' : 'font-mono text-muted'}
                >
                  {action.key}
                </span>
                {action.destructive && (
                  // The badge is the point of this list. A capability key alone doesn't
                  // tell you which of these Amber will stop and ask about.
                  <span className="rounded-control border border-danger/50 px-1 text-danger">
                    asks first
                  </span>
                )}
                {!action.available && <span className="text-muted">— off</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {summaries.length === 0 && <Note>No extensions in this build.</Note>}
    </div>
  )
}
