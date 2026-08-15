import { useEffect, useMemo, useState } from 'react'

import type { Settings } from '../../shared/types'
import { useStore } from '../store'
import { SettingsProvider } from './context'
import { SETTINGS } from './registry'
import { SettingsNav } from './SettingsNav'
import { duplicateIds, resolvePageId, search, trailOf, type SettingsCtx } from './tree'

/** Where you were last time. Settings unmounts when you glance at the chat, and
 *  losing your place every time you did was the cost of that. Presentation only, so
 *  localStorage rather than the config file main owns — same call as the sidebar's
 *  collapsed state. */
const STORAGE_KEY = 'aperture.settings.page'

/**
 * The settings shell: a rail of pages, one page at a time, one draft across all of
 * them.
 *
 * The shell owns everything a page would otherwise have to repeat — the title, the
 * blurb, the breadcrumb, the scroll container and the save bar — so a page component
 * is only its controls. See `registry.tsx` for how to add one and `docs/settings.md`
 * for the rules.
 */
export function SettingsView(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const bloomLinked = useStore((s) => s.bloomLink.state) !== 'unlinked'

  const [draft, setDraft] = useState<Settings>(settings)
  const [saved, setSaved] = useState(false)
  const [query, setQuery] = useState('')
  const [wanted, setWanted] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  )

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  // Visibility is answered from what is *saved*, never from the draft: a page must not
  // appear and disappear under the cursor while a toggle is staged but uncommitted.
  const ctx: SettingsCtx = useMemo(
    () => ({ bloomLinked, advanced: settings.advancedMode }),
    [bloomLinked, settings.advancedMode],
  )

  const current = useMemo(
    () => resolvePageId(SETTINGS, wanted, ctx),
    [wanted, ctx],
  )
  const trail = useMemo(
    () => (current ? trailOf(SETTINGS, current, ctx) : []),
    [current, ctx],
  )
  // Memoised as its own value, not derived inline in the JSX: the rail opens branches
  // in an effect keyed on it, and a fresh array every render would run that effect on
  // every keystroke in the filter box.
  const trailIds = useMemo(() => trail.map((p) => p.id), [trail])
  const filtered = useMemo(() => search(SETTINGS, query, ctx), [query, ctx])

  useEffect(() => {
    if (current) localStorage.setItem(STORAGE_KEY, current)
  }, [current])

  // A duplicate id draws a perfectly normal rail in which two rows select each other —
  // not a type error, and not obviously a bug when you meet it. One walk of a dozen
  // nodes at mount is cheap enough not to bother gating on a dev flag.
  useEffect(() => {
    const dupes = duplicateIds(SETTINGS)
    if (dupes.length > 0) console.error('Duplicate settings ids:', dupes.join(', '))
  }, [])

  const save = async (): Promise<void> => {
    setSettings(await window.aperture.settings.set(draft))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  /** Write through immediately, moving the draft with it so `dirty` stays honest.
   *  The theme picker's escape hatch — see `pages/Appearance.tsx`. */
  const commit = (patch: Partial<Settings>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    void window.aperture.settings.set(patch).then(setSettings)
  }

  const reconnect = async (): Promise<void> => {
    await save()
    // URL and token only take effect on a fresh dial, so bounce the socket.
    await window.aperture.amber.disconnect()
    await window.aperture.amber.connect()
  }

  // Cmd/Ctrl+S. Only bound while Settings is mounted, and only meaningful while there
  // is a draft to commit — a desktop app with an explicit Save owes you this.
  // No dependency array on purpose: the handler closes over `draft`, and a stale one
  // would save whatever the page looked like when you arrived.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 's' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      if (dirty) void save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const page = trail[trail.length - 1] ?? null
  const Content = page?.Content
  const needsReconnect =
    draft.amberUrl !== settings.amberUrl || draft.authToken !== settings.authToken

  return (
    <section className="flex min-h-0 min-w-0 flex-1">
      <SettingsNav
        sections={filtered}
        current={current}
        trail={trailIds}
        query={query}
        onQuery={setQuery}
        onSelect={setWanted}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
            {page && (
              <header>
                {trail.length > 1 && (
                  <nav aria-label="Breadcrumb" className="mb-1 text-meta text-muted">
                    {trail.slice(0, -1).map((ancestor) => (
                      <span key={ancestor.id}>
                        <button
                          type="button"
                          onClick={() => setWanted(ancestor.id)}
                          className="hover:text-ink"
                        >
                          {ancestor.label}
                        </button>
                        <span aria-hidden> › </span>
                      </span>
                    ))}
                  </nav>
                )}
                <h1 className="text-lg font-medium">{page.label}</h1>
                {page.blurb && <p className="mt-1 text-sm text-muted">{page.blurb}</p>}
              </header>
            )}

            {Content ? (
              <SettingsProvider
                value={{
                  draft,
                  saved: settings,
                  set: (patch) => setDraft((d) => ({ ...d, ...patch })),
                  update: (fn) => setDraft(fn),
                  commit,
                  current,
                  go: setWanted,
                }}
              >
                <Content />
              </SettingsProvider>
            ) : (
              <p className="text-sm text-muted">This settings page has gone away.</p>
            )}
          </div>
        </div>

        {/* The save bar spans the pane rather than sitting at the end of a page,
            because the draft spans the pane too: change the voice, wander to Terminal,
            change a threshold, save both. A per-page Save would have thrown the first
            change away at the moment you made the second. */}
        {(dirty || saved) && (
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-raised/60 px-6 py-3">
            {dirty ? (
              <>
                <span className="text-xs text-muted">
                  Unsaved changes
                  {needsReconnect && ' — the connection moves on reconnect'}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setDraft(settings)}
                  className="rounded-field border border-line px-3 py-1.5 text-sm text-muted transition hover:border-accent-deep hover:text-ink"
                >
                  Discard
                </button>
                {needsReconnect && (
                  <button
                    type="button"
                    onClick={() => void reconnect()}
                    className="rounded-field border border-line px-3 py-1.5 text-sm text-ink transition hover:border-accent-deep"
                  >
                    Save &amp; reconnect
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void save()}
                  className="rounded-field border border-accent-deep bg-accent/15 px-4 py-1.5 text-sm text-accent-hi transition hover:bg-accent/25"
                >
                  Save
                </button>
              </>
            ) : (
              <span className="text-xs text-ok">Saved</span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
