/**
 * One icon family, one set of rules: 20x20 box, 1.5 stroke, round caps and joins,
 * `currentColor` throughout. Mixing icon styles is the fastest way to make a tool
 * feel assembled rather than designed, so anything added here follows the same
 * geometry.
 *
 * Hand-drawn rather than pulled from a library: the set is small, and the app's
 * CSP forbids remote assets anyway.
 */
type IconProps = { className?: string }

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** Amber: a voice, carrying. A source with sound leaving it. */
export function AmberIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <circle cx="7" cy="10" r="2.25" fill="currentColor" stroke="none" />
      <path d="M11.4 6.6a4.8 4.8 0 0 1 0 6.8" />
      <path d="M14.1 4.2a8.2 8.2 0 0 1 0 11.6" />
    </svg>
  )
}

/** Servers: a rack. Two units, each with its status lamp. */
export function ServerIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="3.5" width="14" height="5.5" rx="1.5" />
      <rect x="3" y="11" width="14" height="5.5" rx="1.5" />
      <path d="M6 6.25h.01M6 13.75h.01" />
    </svg>
  )
}

/**
 * Keys: a key. Not a padlock — a lock says "this is secured", and what this page
 * actually holds is the things that open other people's locks.
 */
export function KeyIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <circle cx="7" cy="7" r="3.25" />
      <path d="M9.3 9.3 16 16" />
      <path d="M13.6 13.6 12 15.2" />
    </svg>
  )
}

/** Settings: sliders. A gear implies machinery; sliders imply preferences. */
export function SlidersIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M3 6h9M15 6h2M3 14h2M8 14h9" />
      <circle cx="13.5" cy="6" r="1.75" />
      <circle cx="6.5" cy="14" r="1.75" />
    </svg>
  )
}

/**
 * Collapse toggle: a panel with its rail. Reads as "the sidebar itself" rather
 * than a bare chevron, so the target of the action is unambiguous.
 */
export function PanelIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path d="M8 3.5v13" />
    </svg>
  )
}

/** The app mark: an aperture blade opening. */
export function ApertureMark({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className} strokeWidth={1.4}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3v7l6.06 3.5M10 10 3.94 13.5M10 10l6.06-3.5" />
    </svg>
  )
}

/**
 * Bloom: a stem opening into three petals — agents defined here, then sent out.
 *
 * Deliberately organic against the geometric rack and sliders: Bloom is the one tab
 * whose contents you *author* rather than administer, and the odd one out in the
 * column is doing its job.
 */
export function BloomIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M10 17.5v-5" />
      <circle cx="10" cy="10" r="2" />
      <path d="M10 8a3.2 3.2 0 0 1 0-5.2A3.2 3.2 0 0 1 10 8Z" />
      <path d="M11.8 11a3.2 3.2 0 0 1 4.6 2.4A3.2 3.2 0 0 1 11.8 11Z" />
      <path d="M8.2 11a3.2 3.2 0 0 0-4.6 2.4A3.2 3.2 0 0 0 8.2 11Z" />
    </svg>
  )
}
