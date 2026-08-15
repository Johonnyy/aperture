import { useEffect, useState } from 'react'

import type { SettingsPage, SettingsSection } from './tree'

/**
 * The rail.
 *
 * A second navigation column inside a view is a thing to be careful with — the app
 * already has one — so this one is deliberately quieter than the sidebar: no icons, no
 * accent fill, just a tint and the accent on the label of the row you are on. It reads
 * as a table of contents for the pane beside it rather than as a competing nav.
 *
 * Rows are plain buttons in nested lists rather than `role="tree"`. A real tree widget
 * owes you the full keyboard model — roving tabindex, arrows to move and open, Home and
 * End — and claiming the role without implementing it is worse for a screen reader than
 * not claiming it, because it promises keys that do nothing. Tab and Enter work here,
 * which is what a list of links has always offered.
 */
export function SettingsNav({
  sections,
  current,
  trail,
  query,
  onQuery,
  onSelect,
}: {
  /** Already filtered and pruned — the rail draws exactly what it is handed. */
  sections: SettingsSection[]
  current: string | null
  /** Ids from the root to the current page, so its ancestors can be opened. */
  trail: string[]
  query: string
  onQuery: (value: string) => void
  onSelect: (pageId: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(trail))

  // Opening the branch you navigated into, without ever closing one you opened by
  // hand: a union, never an assignment. Landing on a page whose parent is collapsed
  // would otherwise leave the rail with no row marked current at all.
  useEffect(() => {
    setExpanded((prev) => {
      if (trail.every((id) => prev.has(id))) return prev
      const next = new Set(prev)
      for (const id of trail) next.add(id)
      return next
    })
  }, [trail])

  // While filtering, everything is open. A match hidden inside a collapsed parent is
  // a search that silently found nothing, which is the one thing a filter must not do.
  const filtering = query.trim().length > 0

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <nav
      aria-label="Settings"
      className="flex w-[188px] shrink-0 flex-col border-r border-line bg-raised/30"
    >
      <div className="p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter settings"
          aria-label="Filter settings"
          spellCheck={false}
          className="w-full rounded-control border border-line bg-ground px-2.5 py-1.5 text-meta text-ink outline-none placeholder:text-muted focus:border-accent-deep"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sections.length === 0 && (
          <p className="px-1 py-2 text-meta text-muted">
            Nothing matches “{query.trim()}”.
          </p>
        )}

        {sections.map((section) => (
          <div key={section.id} className="mb-3">
            <h2 className="px-2 py-1 text-micro tracking-wider text-muted uppercase">
              {section.label}
            </h2>
            <ul className="flex flex-col gap-px">
              {section.pages.map((page) => (
                <PageRow
                  key={page.id}
                  page={page}
                  depth={0}
                  current={current}
                  expanded={expanded}
                  filtering={filtering}
                  onSelect={onSelect}
                  onToggle={toggle}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Where these live, said once, at the edge — rather than as a subtitle on every
          page. Keywords is the one exception and says so itself. */}
      <p className="shrink-0 border-t border-line px-3 py-2 text-micro text-muted">
        Saved on this machine, in your user data directory.
      </p>
    </nav>
  )
}

function PageRow({
  page,
  depth,
  current,
  expanded,
  filtering,
  onSelect,
  onToggle,
}: {
  page: SettingsPage
  depth: number
  current: string | null
  expanded: Set<string>
  filtering: boolean
  onSelect: (pageId: string) => void
  onToggle: (pageId: string) => void
}): React.JSX.Element {
  const children = page.children ?? []
  const hasChildren = children.length > 0
  const open = filtering || expanded.has(page.id)
  const active = current === page.id

  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-expanded={hasChildren ? open : undefined}
        // One target, two jobs. Selecting a parent opens it, because the alternative
        // is a second hit area three pixels wide inside a row that is already a
        // button — and a parent you can select but not open would hide its children
        // behind a chevron nobody can hit reliably.
        onClick={() => {
          onSelect(page.id)
          if (hasChildren && !open) onToggle(page.id)
        }}
        className={[
          'flex w-full items-center gap-1 rounded-control py-1.5 pr-2 text-left text-body transition-colors',
          'focus-visible:ring-2 focus-visible:ring-accent-deep focus-visible:outline-none',
          active
            ? 'bg-accent/12 text-accent-hi'
            : 'text-muted hover:bg-ink/5 hover:text-ink',
        ].join(' ')}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {hasChildren ? (
          <span
            onClick={(e) => {
              // Collapsing without navigating — the one thing the row itself can't do.
              e.stopPropagation()
              onToggle(page.id)
            }}
            className="-my-1 shrink-0 py-1"
          >
            <Chevron open={open} />
          </span>
        ) : (
          <span aria-hidden className="w-3 shrink-0" />
        )}
        <span className="truncate">{page.label}</span>
      </button>

      {hasChildren && open && (
        <ul className="flex flex-col gap-px">
          {children.map((child) => (
            <PageRow
              key={child.id}
              page={child}
              depth={depth + 1}
              current={current}
              expanded={expanded}
              filtering={filtering}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** 12px, 1.5 stroke, round caps — the icon family's geometry at rail scale. */
function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 transition-transform"
      style={{ transform: open ? 'rotate(90deg)' : 'none' }}
    >
      <path d="m4.5 2.5 4 3.5-4 3.5" />
    </svg>
  )
}
