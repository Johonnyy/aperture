import { MONO } from '../../../shared/theme'
import type { PopupState, Suggestion } from './index'

export type { PopupState }

const KIND: Record<Suggestion['kind'], { badge: string; className: string }> = {
  history: { badge: 'hist', className: 'text-accent' },
  command: { badge: 'cmd', className: 'text-ok' },
  path: { badge: 'path', className: 'text-ink/70' },
  flag: { badge: 'flag', className: 'text-muted' },
}

/**
 * The ghost completion and the suggestion dropdown, drawn *over* the terminal rather
 * than into it.
 *
 * Position is viewport-fixed and derived from the cursor cell, so no layout maths has
 * to agree with xterm's. `pointer-events-none` throughout: this is a hint, and a
 * click that stole focus from the terminal would be a bug, not a feature.
 */
export function SuggestionPopup({ state }: { state: PopupState }): React.JSX.Element | null {
  if (!state.ghost && !state.open) return null

  return (
    <>
      {state.ghost && (
        <span
          aria-hidden
          style={{
            left: state.x,
            top: state.y,
            lineHeight: `${state.cellHeight}px`,
            // The same constant xterm is built with. These two must never drift —
            // the ghost is positioned against xterm's cell grid.
            fontFamily: MONO,
            fontSize: 13,
          }}
          className="pointer-events-none fixed z-40 whitespace-pre text-ink/35"
        >
          {state.ghost}
        </span>
      )}

      {state.open && (
        <ul
          style={{ left: state.x, top: state.y + state.cellHeight }}
          className="pointer-events-none fixed z-50 max-h-64 w-[min(28rem,60vw)] overflow-hidden rounded-field border border-line bg-raised py-1 elev-pop"
        >
          {state.items.map((item, i) => {
            const kind = KIND[item.kind]
            return (
              <li
                key={`${item.kind}:${item.label}`}
                aria-selected={i === state.index}
                className={[
                  'flex items-center gap-2 px-2.5 py-1 font-mono text-meta',
                  i === state.index ? 'bg-accent/15 text-accent-hi' : 'text-ink/80',
                ].join(' ')}
              >
                <span className={`w-8 shrink-0 text-nano ${kind.className}`}>{kind.badge}</span>
                <span className="truncate">{item.label}</span>
              </li>
            )
          })}
          <li className="px-2.5 pt-1 text-micro text-muted">↑↓ or Tab · Enter accepts · Esc</li>
        </ul>
      )}
    </>
  )
}
