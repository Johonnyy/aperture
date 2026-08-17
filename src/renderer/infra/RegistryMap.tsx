import type { RegistryDiagnosis, RegistryLink, RegistryNode } from '../../shared/registry'
import type { Layout, NodeBox } from './registry-layout'

/**
 * The picture: what is joined to the registry and what is not.
 *
 * Dumb by construction — a diagnosis and a layout in, SVG out, no state and no data
 * access. Everything it decides is which of five stroke treatments an edge gets.
 *
 * IT CARRIES NO ACCESSIBILITY CONTRACT. The `<svg>` is `aria-hidden`, and the real
 * semantics live in the list `RegistryCard` renders underneath: a screen reader gets
 * "bloom — the registry has never been told this app's key" as a plain button, tab
 * order is native, and the focus ring is the app's own. That split is what lets the
 * diagram be expressive without owing anyone a description of itself.
 *
 * Three rules that keep it themeable, all of them things `npm run verify:theme` or a
 * theme switch will catch if broken:
 *
 *   * `fill="currentColor"` on every `<text>`. SVG text paints with `fill`, which
 *     defaults to black; `text-ink` only sets `color`. Without it the labels are
 *     invisible on five of the six themes.
 *   * `[stroke-width:var(--stroke)]` rather than a number, so the diagram inherits
 *     Terminal green's 2px rule and everything else's 1px.
 *   * No `<defs>`, no gradients, no masks. Partly because flat fills read better across
 *     six palettes, and partly because a `url(#...)` reference whose id happens to be
 *     spelled out of hex digits is a colour literal as far as verify:theme is
 *     concerned, and fails the build. (This comment fell into that trap once.)
 */

/** Edge stroke per link state. Dash rhythm carries the same meaning as the hue. */
const EDGE: Record<RegistryLink, string> = {
  live: 'stroke-ok',
  stale: 'stroke-warn [stroke-dasharray:5_3]',
  refused: 'stroke-danger [stroke-dasharray:2_3]',
  absent: 'stroke-line [stroke-dasharray:1_4]',
  unknown: 'stroke-line [stroke-dasharray:1_6]',
}

const BOX: Record<RegistryLink, string> = {
  live: 'stroke-ok/50',
  stale: 'stroke-warn/60',
  refused: 'stroke-danger/60',
  absent: 'stroke-line',
  unknown: 'stroke-line',
}

const LABEL: Record<RegistryLink, string> = {
  live: 'text-ink',
  stale: 'text-warn',
  refused: 'text-danger',
  absent: 'text-muted',
  unknown: 'text-muted',
}

/**
 * How far the elbow stops short of the trunk when the app is not joined.
 *
 * This is the whole idiom. A line that does not arrive is an app that has not
 * registered — readable at a glance, before any word is, and it survives a colourblind
 * reader, a monochrome print and Contact sheet.
 */
const BREAK = 22

function edgePath(box: NodeBox, joined: boolean): string {
  if (joined) return box.d
  // Re-cut the same path from a start point pushed away from the trunk. Keeping the
  // curve identical means the gap reads as a break in one line rather than as two
  // different shapes.
  const s = box.side === 'left' ? -1 : 1
  const edgeX = box.side === 'left' ? box.x + box.w : box.x
  const startX = box.x + box.w / 2 + s * (box.w / 2 + BREAK)
  return `M ${startX} ${box.cy} L ${edgeX} ${box.cy}`
}

/** The status glyph at the right of each box — the third, non-colour channel. */
function Glyph({ link, x, cy }: { link: RegistryLink; x: number; cy: number }): React.JSX.Element {
  if (link === 'live') {
    return <circle cx={x} cy={cy} r={3.5} className="fill-ok animate-pulse-dot" />
  }
  if (link === 'refused') {
    return (
      <g className="stroke-danger [stroke-width:var(--stroke)]" strokeLinecap="round">
        <line x1={x - 3.5} y1={cy - 3.5} x2={x + 3.5} y2={cy + 3.5} />
        <line x1={x - 3.5} y1={cy + 3.5} x2={x + 3.5} y2={cy - 3.5} />
      </g>
    )
  }
  if (link === 'stale') {
    return (
      <circle
        cx={x}
        cy={cy}
        r={3.5}
        fill="none"
        className="stroke-warn [stroke-width:var(--stroke)]"
      />
    )
  }
  if (link === 'unknown') {
    return (
      <line
        x1={x}
        y1={cy - 3.5}
        x2={x}
        y2={cy + 3.5}
        strokeLinecap="round"
        className="stroke-line [stroke-width:var(--stroke)]"
      />
    )
  }
  return (
    <circle cx={x} cy={cy} r={3.5} fill="none" className="stroke-line [stroke-width:var(--stroke)]" />
  )
}

export function RegistryMap({
  map,
  layout,
  activeId,
  flows,
  onHover,
  onSelect,
}: {
  map: RegistryDiagnosis
  layout: Layout
  activeId: string | null
  /**
   * Peers Amber is calling *right now*, by name.
   *
   * The map has always shown what the registry believes; this is the only channel
   * that shows it doing something. Everything needed was already in the store —
   * `Activity.origin` is `peer:<name>` and `<name>` is the same string as the node's
   * label — so a live edge costs one prop and no new frame.
   */
  flows?: ReadonlySet<string>
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}): React.JSX.Element {
  const { store, trunk, nodes } = layout

  return (
    <svg
      width={layout.width}
      height={layout.height}
      aria-hidden="true"
      focusable="false"
      className="block max-w-full select-none"
    >
      {/* The trunk is infrastructure, so it is never stateful — except when the store
          itself is the problem, which is the one case where the whole bus is dead. */}
      {trunk && (
        <path
          d={`M ${trunk.x} ${trunk.y1} L ${trunk.x} ${trunk.y2}`}
          fill="none"
          strokeLinecap="round"
          className={`[stroke-width:var(--stroke)] transition-colors ${
            map.store.link === 'live' ? 'stroke-line' : 'stroke-danger/60'
          }`}
        />
      )}

      {/* the store */}
      <g
        className="cursor-pointer transition"
        onMouseEnter={() => onHover(map.store.id)}
        onMouseLeave={() => onHover(null)}
        onClick={() => onSelect(map.store.id)}
      >
        <rect
          x={store.x}
          y={store.y}
          width={store.w}
          height={store.h}
          className={`fill-raised [rx:var(--radius-field)] [stroke-width:var(--stroke)] transition-colors ${
            BOX[map.store.link]
          } ${activeId === map.store.id ? 'fill-ground' : ''}`}
        />
        <text
          x={store.cx}
          y={store.y + 21}
          textAnchor="middle"
          fill="currentColor"
          className={`font-mono text-meta ${LABEL[map.store.link]}`}
        >
          registry
        </text>
        <text
          x={store.cx}
          y={store.y + 37}
          textAnchor="middle"
          fill="currentColor"
          className="text-nano text-muted"
        >
          {map.apps.filter((a) => a.link === 'live').length}/{map.apps.length} linked
        </text>
      </g>

      {/* one group per app */}
      {nodes.map((box) => {
        const node: RegistryNode | undefined = map.apps[box.index]
        if (!node) return null
        const joined = node.link === 'live' || node.link === 'stale'
        const active = activeId === node.id
        // In flight right now. Matched on the node's label rather than its id,
        // because the label is the peer name Amber uses in `peer:<name>` — the same
        // string on both sides, which is what makes this need no new plumbing.
        const busy = flows?.has(node.label) ?? false
        // A busy peer stays lit even while something else is hovered: the point of
        // the live channel is that it draws the eye without being pointed at.
        const dim = activeId !== null && !active && !busy
        return (
          <g
            key={node.id}
            className={`cursor-pointer transition ${dim ? 'opacity-60' : ''}`}
            onMouseEnter={() => onHover(node.id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect(node.id)}
          >
            <path
              d={edgePath(box, joined)}
              fill="none"
              strokeLinecap="round"
              className={`${EDGE[node.link]} transition-colors ${
                active
                  ? '[stroke-width:calc(var(--stroke)*2)]'
                  : '[stroke-width:var(--stroke)]'
              } ${busy || (active && node.link === 'live') ? 'animate-registry-flow [stroke-dasharray:4_4]' : ''}`}
            />
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              className={`[rx:var(--radius-control)] [stroke-width:var(--stroke)] transition-colors ${
                BOX[node.link]
              } ${active ? 'fill-ground' : 'fill-raised'}`}
            />
            <text
              x={box.x + 11}
              y={box.cy + 4}
              fill="currentColor"
              className={`font-mono text-meta ${LABEL[node.link]}`}
            >
              {node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}
            </text>
            <Glyph link={node.link} x={box.x + box.w - 13} cy={box.cy} />
          </g>
        )
      })}
    </svg>
  )
}
