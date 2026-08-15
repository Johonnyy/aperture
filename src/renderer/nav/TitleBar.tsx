import { ApertureMark, PanelIcon } from './icons'

/**
 * The window's title bar, drawn by the app.
 *
 * Main sets `titleBarStyle: 'hidden'` and hands the OS a themed overlay, so the real
 * minimise / maximise / close buttons still sit at the right — native behaviour,
 * native accessibility, Windows Snap Layouts intact — while the bar they sit in is
 * ours and follows the theme.
 *
 * The geometry comes from `env(titlebar-area-*)`, which Chromium fills in from that
 * overlay. That is what makes this correct on both platforms without a `process.
 * platform` check: on Windows the area starts at the left edge and stops short of the
 * buttons, on macOS it starts *after* the traffic lights. The fallbacks are what a
 * plain browser (or a build with the overlay disabled) would use.
 */
export function TitleBar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
}): React.JSX.Element {
  return (
    <header
      className="drag flex shrink-0 items-center border-b border-line bg-titlebar"
      style={{ height: 'env(titlebar-area-height, 36px)' }}
    >
      <div
        className="flex h-full items-center gap-1.5 pr-3 pl-2"
        style={{
          marginLeft: 'env(titlebar-area-x, 0px)',
          width: 'env(titlebar-area-width, 100%)',
        }}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="no-drag rounded-control p-1.5 text-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent-deep focus-visible:outline-none"
        >
          <PanelIcon className={collapsed ? 'rotate-180' : undefined} />
        </button>

        <ApertureMark className="shrink-0 text-accent" />
        <span className="text-meta font-semibold tracking-[0.14em] text-accent">
          APERTURE
        </span>

        {/* The rest of the row stays bare on purpose: it is the drag handle, and it
            is also where a double-click has to reach the window to maximise. */}
      </div>
    </header>
  )
}
