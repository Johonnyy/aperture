/**
 * Where the registry map's boxes go.
 *
 * A bus, not a starburst. The store sits at the top, a trunk descends from it, and each
 * app hangs off the trunk on a short elbow, alternating left and right. A radial map is
 * charming at three apps and unreadable at fifteen, and radial label collision is a
 * maths problem nobody should have to own; this shape is collision-free by construction
 * and costs `ceil(n / columns)` rows however many apps arrive.
 *
 * The split it encodes is also the right one semantically: the **trunk is
 * infrastructure** and is always drawn in `line`, while each **elbow is a relationship**
 * and carries that app's state. A line that does not reach the trunk is an app that has
 * not registered — which is the whole thing the picture has to say.
 *
 * Pure, and free of React and DOM types, so `scripts/verify-registry.mjs` can assert the
 * invariants that actually matter — nothing overlaps, nothing escapes the box — across
 * app counts and widths no one will sit down and try by hand.
 *
 * Takes a *count*, never the diagnosis. Presentation logic stays out of the geometry.
 */

/** Logical px. Not themed: this is geometry, and the theme owns colour and radius. */
const NODE_W = 176
const NODE_H = 34
const ROW = 46
const GUTTER = 26
const ELBOW = 10
const STORE_W = 152
const STORE_H = 52
const HEAD_GAP = 26
const PAD = 8

/** Below this the two columns would not fit side by side, so it becomes one. */
export const TWO_COLUMN_MIN = 520

export interface NodeBox {
  index: number
  x: number
  y: number
  w: number
  h: number
  side: 'left' | 'right'
  /** Vertical centre — where the elbow meets the node. */
  cy: number
  /** The elbow path, trunk to node edge. */
  d: string
}

export interface Layout {
  width: number
  height: number
  columns: 1 | 2
  store: { x: number; y: number; w: number; h: number; cx: number }
  /** Null when there are no apps: a trunk to nowhere is worse than no trunk. */
  trunk: { x: number; y1: number; y2: number } | null
  nodes: NodeBox[]
}

export function layoutOf(count: number, width: number): Layout {
  // A width of zero happens for exactly one frame, before the ResizeObserver reports.
  // Clamping rather than returning an empty layout keeps the first paint from being a
  // collapsed box that then jumps.
  const w = Math.max(280, Math.round(width) || 640)
  const columns: 1 | 2 = w >= TWO_COLUMN_MIN ? 2 : 1
  const rows = Math.ceil(count / columns)
  const trunkX = Math.round(w / 2)
  const storeY = PAD
  const firstRowY = PAD + STORE_H + HEAD_GAP

  const nodes: NodeBox[] = []
  for (let i = 0; i < count; i++) {
    // In one column everything hangs to the right of the trunk, so the trunk stays
    // where it is and the map does not reflow into a different shape on resize.
    const side: 'left' | 'right' = columns === 2 ? (i % 2 === 0 ? 'left' : 'right') : 'right'
    const row = columns === 2 ? Math.floor(i / 2) : i
    const y = firstRowY + row * ROW
    const cy = y + NODE_H / 2
    // In one column the node has the full width to the right of the trunk, minus the
    // gutter — at 320px a 176px box would otherwise overflow.
    const nodeW = columns === 2 ? NODE_W : Math.min(NODE_W, w - trunkX - GUTTER - PAD)
    const x = side === 'left' ? trunkX - GUTTER - nodeW : trunkX + GUTTER
    const s = side === 'left' ? -1 : 1
    const edgeX = side === 'left' ? x + nodeW : x
    nodes.push({
      index: i,
      x,
      y,
      w: nodeW,
      h: NODE_H,
      side,
      cy,
      // A quadratic corner off the trunk rather than a right angle: the same curve the
      // rest of the app's borders imply, and it reads as a branch rather than a table.
      d: `M ${trunkX} ${cy - ELBOW} Q ${trunkX} ${cy} ${trunkX + s * ELBOW} ${cy} L ${edgeX} ${cy}`,
    })
  }

  const lastCy = nodes.length > 0 ? nodes[nodes.length - 1].cy : firstRowY
  return {
    width: w,
    height: PAD + STORE_H + (count > 0 ? HEAD_GAP + rows * ROW : 0) + PAD,
    columns,
    store: {
      x: trunkX - STORE_W / 2,
      y: storeY,
      w: STORE_W,
      h: STORE_H,
      cx: trunkX,
    },
    trunk: count > 0 ? { x: trunkX, y1: storeY + STORE_H, y2: lastCy } : null,
    nodes,
  }
}
