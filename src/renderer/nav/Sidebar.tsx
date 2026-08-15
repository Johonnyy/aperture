import { useEffect, useState } from 'react'

import { useStore } from '../store'
import { AmberIcon, ServerIcon, SlidersIcon } from './icons'

export type View = 'chat' | 'ssh' | 'settings'

interface NavItem {
  id: View
  label: string
  icon: (props: { className?: string }) => React.JSX.Element
}

/**
 * Apps land here as they're built (finance, school, …), nested under Amber
 * because she's how you reach them — each one is a backend she can query, not a
 * peer of hers. Empty for now; the group renders Amber alone until it isn't.
 */
const AMBER_APPS: NavItem[] = []

const AMBER: NavItem = { id: 'chat', label: 'Amber', icon: AmberIcon }
const SERVERS: NavItem = { id: 'ssh', label: 'Servers', icon: ServerIcon }
const SETTINGS: NavItem = { id: 'settings', label: 'Settings', icon: SlidersIcon }

const STORAGE_KEY = 'aperture.sidebar.collapsed'

/**
 * Lives here, next to the thing it collapses, but is called by `App` — the toggle
 * that drives it now sits in the title bar, so the state has to be above both.
 *
 * Pure presentation, so it belongs in the renderer rather than the config file main
 * owns. Read synchronously to avoid a first-paint flash of the wrong width.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true',
  )
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed))
  }, [collapsed])
  return [collapsed, () => setCollapsed((c) => !c)]
}

export function Sidebar({
  view,
  onNavigate,
  collapsed,
}: {
  view: View
  onNavigate: (view: View) => void
  collapsed: boolean
}): React.JSX.Element {
  const connState = useStore((s) => s.connection.state)
  const connected = connState === 'open'

  return (
    <nav
      aria-label="Main"
      data-collapsed={collapsed}
      className={[
        'flex shrink-0 flex-col border-r border-line bg-raised/50',
        // Width is the one layout property worth transitioning here: the subtree is
        // a handful of rows, and snapping reads as a glitch rather than a state change.
        'transition-[width] duration-150 ease-out',
        collapsed ? 'w-[60px]' : 'w-[212px]',
      ].join(' ')}
    >
      {/* --- navigation ---
          The brand and the collapse toggle used to head this column; both moved to
          the title bar, which spans the window and is where a desktop app puts its
          identity and its panel controls. The sidebar is navigation now, nothing else.
          Deliberately not a scroll container: `overflow-y-auto` would clip the
          collapsed-mode tooltips, which escape the sidebar horizontally and are the
          only labels available at 60px wide. Two rows today, and a nav long enough
          to need scrolling would want a portalled tooltip anyway. */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 p-2">
        <NavButton
          item={AMBER}
          active={view === AMBER.id}
          collapsed={collapsed}
          onClick={() => onNavigate(AMBER.id)}
        />

        {AMBER_APPS.map((app) => (
          <NavButton
            key={app.id}
            item={app}
            active={view === app.id}
            collapsed={collapsed}
            nested
            onClick={() => onNavigate(app.id)}
          />
        ))}

        <hr className="my-2 border-0 border-t border-line" />

        <NavButton
          item={SERVERS}
          active={view === SERVERS.id}
          collapsed={collapsed}
          onClick={() => onNavigate(SERVERS.id)}
        />
      </div>

      {/* --- footer --- */}
      <div className="flex shrink-0 flex-col gap-0.5 border-t border-line p-2">
        <ConnectionButton collapsed={collapsed} connected={connected} state={connState} />
        <NavButton
          item={SETTINGS}
          active={view === SETTINGS.id}
          collapsed={collapsed}
          onClick={() => onNavigate(SETTINGS.id)}
        />
      </div>
    </nav>
  )
}

function NavButton({
  item,
  active,
  collapsed,
  nested,
  onClick,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  nested?: boolean
  onClick: () => void
}): React.JSX.Element {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={[
        'group relative flex items-center rounded-control text-body transition-colors',
        'focus-visible:ring-2 focus-visible:ring-accent-deep focus-visible:outline-none',
        collapsed ? 'h-9 justify-center px-0' : 'h-9 gap-2.5 px-2.5',
        // Selection is carried by a tint plus the accent on the label, not a bar
        // down the edge. Inactive rows stay neutral so the active one is the only
        // colored thing in the column.
        active
          ? 'bg-accent/15 text-accent-hi'
          : 'text-muted hover:bg-ink/5 hover:text-ink active:bg-ink/10',
        nested && !collapsed ? 'ml-3' : '',
      ].join(' ')}
    >
      <Icon className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {collapsed && <Tooltip>{item.label}</Tooltip>}
    </button>
  )
}

function ConnectionButton({
  collapsed,
  connected,
  state,
}: {
  collapsed: boolean
  connected: boolean
  state: string
}): React.JSX.Element {
  const label = connected ? 'Connected' : state === 'idle' ? 'Connect' : state
  const pending = state === 'connecting' || state === 'reconnecting'

  return (
    <button
      type="button"
      onClick={() =>
        void (connected
          ? window.aperture.amber.disconnect()
          : window.aperture.amber.connect())
      }
      title={connected ? 'Disconnect from Amber' : 'Connect to Amber'}
      className={[
        'group relative flex items-center rounded-control text-body text-muted transition-colors',
        'hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent-deep focus-visible:outline-none',
        collapsed ? 'h-9 justify-center px-0' : 'h-9 gap-2.5 px-2.5',
      ].join(' ')}
    >
      <span
        className={[
          'h-2 w-2 shrink-0 rounded-full transition-colors',
          connected ? 'bg-ok' : state === 'error' ? 'bg-danger' : 'bg-muted',
          pending ? 'animate-pulse-dot bg-accent' : '',
          // Line the dot up with the icon column above it, so the footer reads as
          // part of the same list rather than a separate widget.
          collapsed ? '' : 'mx-1.5',
        ].join(' ')}
      />
      {!collapsed && <span className="truncate capitalize">{label}</span>}
      {collapsed && <Tooltip>{connected ? 'Connected' : label}</Tooltip>}
    </button>
  )
}

/**
 * Labels have to survive collapsing, and native `title` is too slow to serve as
 * the only affordance when the icon is all you have.
 */
function Tooltip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full z-50 ml-2 rounded-control border border-line bg-raised px-2 py-1 text-xs whitespace-nowrap text-ink opacity-0 elev-panel transition-opacity group-hover:opacity-100"
    >
      {children}
    </span>
  )
}
