/**
 * The settings tree, as data — and the pure functions that read it.
 *
 * Settings used to be one 900-line column you scrolled, which worked until it didn't:
 * the voice block alone is four controls and three explanatory paragraphs, and every
 * new knob made every old knob harder to find. The fix is the shape every settings
 * screen this size converges on — a rail of pages on the left, one page at a time on
 * the right — and the thing that keeps it cheap is that a page is a *declaration*
 * rather than a wiring job.
 *
 * Adding one is a single object in `registry.tsx` and a component that calls
 * `useSettings()`. There is no route to register, no save button to add, no
 * `SettingsView` edit. See `docs/settings.md`.
 *
 * Nothing here imports React at runtime (the component type is erased), so this file
 * bundles for `npm run verify:settings` and the tree logic is tested without a DOM.
 */

import type { ComponentType } from 'react'

/**
 * What a `visible` predicate is allowed to look at.
 *
 * Deliberately a plain snapshot passed in from the shell rather than something a page
 * reads with a hook: visibility is evaluated while *walking* the tree, and a hook per
 * node would tie hook order to a filtered, collapsed, user-driven traversal. Grow it
 * as pages need it — one selector in `SettingsView` is the whole cost.
 */
export interface SettingsCtx {
  /** Any state but `unlinked`. Presence, not health — same rule as the sidebar row. */
  bloomLinked: boolean
  /** `settings.advancedMode`, so a page can hide until it is asked for. */
  advanced: boolean
}

/** One page in the rail. May carry children, which is what makes this a tree. */
export interface SettingsPage {
  /** Stable and unique across the whole tree — it is persisted as "where you were". */
  id: string
  label: string
  /** One line under the title, drawn by the shell so a page body is only controls. */
  blurb?: string
  /**
   * Extra words the filter should match. The point is to find a setting by the word
   * you actually have — "wss", "bearer", "speed", "openrouter" — none of which appear
   * in any page's label.
   */
  keywords?: string[]
  Content: ComponentType
  children?: SettingsPage[]
  /** Hidden entirely when this returns false, children and all. */
  visible?: (ctx: SettingsCtx) => boolean
}

/** A heading in the rail. Never selectable — it names a group, it isn't a page. */
export interface SettingsSection {
  id: string
  label: string
  pages: SettingsPage[]
}

export function isVisible(page: SettingsPage, ctx: SettingsCtx): boolean {
  return page.visible ? page.visible(ctx) : true
}

/** The tree with hidden pages — and any section left empty by them — removed. */
export function visibleSections(
  sections: SettingsSection[],
  ctx: SettingsCtx,
): SettingsSection[] {
  const prune = (pages: SettingsPage[]): SettingsPage[] =>
    pages
      .filter((page) => isVisible(page, ctx))
      .map((page) =>
        page.children ? { ...page, children: prune(page.children) } : page,
      )

  return sections
    .map((section) => ({ ...section, pages: prune(section.pages) }))
    .filter((section) => section.pages.length > 0)
}

/** Every visible page, depth-first, in the order the rail draws them. */
export function flatten(sections: SettingsSection[], ctx: SettingsCtx): SettingsPage[] {
  const out: SettingsPage[] = []
  const walk = (pages: SettingsPage[]): void => {
    for (const page of pages) {
      if (!isVisible(page, ctx)) continue
      out.push(page)
      if (page.children) walk(page.children)
    }
  }
  for (const section of sections) walk(section.pages)
  return out
}

/**
 * The path to a page: its ancestors, then itself. Empty when nothing has that id.
 *
 * Used for two things — the breadcrumb above a nested page, and knowing which
 * branches to expand so the selected row is never hidden inside a collapsed parent.
 */
export function trailOf(
  sections: SettingsSection[],
  id: string,
  ctx: SettingsCtx,
): SettingsPage[] {
  const walk = (pages: SettingsPage[], trail: SettingsPage[]): SettingsPage[] | null => {
    for (const page of pages) {
      if (!isVisible(page, ctx)) continue
      const next = [...trail, page]
      if (page.id === id) return next
      const found = page.children ? walk(page.children, next) : null
      if (found) return found
    }
    return null
  }

  for (const section of sections) {
    const found = walk(section.pages, [])
    if (found) return found
  }
  return []
}

/**
 * Resolve the page to show.
 *
 * Never returns something that isn't there: a remembered page can vanish between
 * launches (Bloom gets unlinked, a page is renamed in a release), and landing on a
 * blank pane because of a stale localStorage key is the worst possible first
 * impression of a settings screen. Falls back to the first visible page.
 */
export function resolvePageId(
  sections: SettingsSection[],
  wanted: string | null,
  ctx: SettingsCtx,
): string | null {
  const pages = flatten(sections, ctx)
  if (wanted && pages.some((page) => page.id === wanted)) return wanted
  return pages[0]?.id ?? null
}

function normalise(value: string): string {
  return value.toLowerCase().trim()
}

/** Does this page itself answer the query? Children are considered separately. */
export function matches(page: SettingsPage, query: string): boolean {
  const q = normalise(query)
  if (!q) return true
  return [page.label, page.blurb ?? '', ...(page.keywords ?? [])].some((text) =>
    normalise(text).includes(q),
  )
}

/**
 * The tree pruned to what the filter matches.
 *
 * Two rules, both about not lying by omission. A page that matches keeps its whole
 * subtree, because "Brain" matching while its own Keywords child disappears would
 * suggest the child doesn't exist. A page that doesn't match is still kept when a
 * descendant does, because otherwise a match would be unreachable — you would see
 * nothing, having typed the exact word for a setting that is right there.
 *
 * A section whose *label* matches keeps everything under it, which is what makes
 * "amber" a way to see Amber's pages rather than a way to find nothing.
 */
export function search(
  sections: SettingsSection[],
  query: string,
  ctx: SettingsCtx,
): SettingsSection[] {
  const q = normalise(query)
  if (!q) return visibleSections(sections, ctx)

  const keep = (pages: SettingsPage[]): SettingsPage[] => {
    const out: SettingsPage[] = []
    for (const page of pages) {
      if (!isVisible(page, ctx)) continue
      if (matches(page, q)) {
        // `visiblePages`, not `keep` — a match keeps its children whether or not they
        // match too. Filtering them here is what would make "Brain" look childless.
        out.push(
          page.children
            ? { ...page, children: visiblePages(page.children, ctx) }
            : page,
        )
        continue
      }
      const children = page.children ? keep(page.children) : []
      if (children.length > 0) out.push({ ...page, children })
    }
    return out
  }

  return sections
    .map((section) =>
      normalise(section.label).includes(q)
        ? { ...section, pages: visiblePages(section.pages, ctx) }
        : { ...section, pages: keep(section.pages) },
    )
    .filter((section) => section.pages.length > 0)
}

function visiblePages(pages: SettingsPage[], ctx: SettingsCtx): SettingsPage[] {
  return pages
    .filter((page) => isVisible(page, ctx))
    .map((page) =>
      page.children ? { ...page, children: visiblePages(page.children, ctx) } : page,
    )
}

/**
 * Ids used more than once, so the shell can shout in development.
 *
 * A duplicate id is not a type error and not a visible bug — the rail draws fine and
 * two rows just select each other. Catching it at mount is far cheaper than catching
 * it by hand later.
 */
export function duplicateIds(sections: SettingsSection[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  const walk = (pages: SettingsPage[]): void => {
    for (const page of pages) {
      if (seen.has(page.id)) dupes.add(page.id)
      seen.add(page.id)
      if (page.children) walk(page.children)
    }
  }
  for (const section of sections) {
    if (seen.has(section.id)) dupes.add(section.id)
    seen.add(section.id)
    walk(section.pages)
  }
  return [...dupes]
}
