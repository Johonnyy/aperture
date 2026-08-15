import type { SearchAddon } from '@xterm/addon-search'
import { useEffect, useRef, useState, type RefObject } from 'react'

import type { ISearchOptions } from '@xterm/addon-search'

/** The overview-ruler colours are required by the addon's type, not optional. */
const OPTIONS: ISearchOptions = {
  decorations: {
    activeMatchBackground: '#ffb347',
    matchBackground: '#5a4318',
    activeMatchColorOverviewRuler: '#ffb347',
    matchOverviewRuler: '#5a4318',
  },
}

/**
 * Find-in-scrollback. Takes the addon by ref rather than by value because the
 * terminal it belongs to is created inside an effect, after this can first render.
 */
export function SearchBar({
  addon,
  onClose,
}: {
  addon: RefObject<SearchAddon | null>
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Clearing the highlight on close matters: leaving it painted makes stale matches
  // look like live ones the next time the bar is opened.
  useEffect(() => () => addon.current?.clearDecorations(), [addon])

  const find = (next: boolean): void => {
    if (!query) return
    const search = addon.current
    if (!search) return
    if (next) search.findNext(query, OPTIONS)
    else search.findPrevious(query, OPTIONS)
  }

  return (
    <div className="flex items-center gap-2 border-b border-line bg-raised/50 px-4 py-1.5">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          if (e.target.value) addon.current?.findNext(e.target.value, OPTIONS)
          else addon.current?.clearDecorations()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(!e.shiftKey)
          if (e.key === 'Escape') onClose()
        }}
        placeholder="Find in scrollback"
        className="flex-1 rounded-[8px] border border-line bg-ground px-2.5 py-1 font-mono text-[11px] text-ink outline-none focus:border-amber-deep"
      />
      <button
        type="button"
        onClick={() => find(false)}
        className="rounded-[8px] border border-line px-2 py-1 text-[11px] text-muted transition hover:border-amber-deep hover:text-ink"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => find(true)}
        className="rounded-[8px] border border-line px-2 py-1 text-[11px] text-muted transition hover:border-amber-deep hover:text-ink"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded-[8px] border border-line px-2 py-1 text-[11px] text-muted transition hover:border-amber-deep hover:text-ink"
      >
        ✕
      </button>
    </div>
  )
}
