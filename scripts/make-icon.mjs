/**
 * Generate `build/icon.png` — the app icon electron-builder converts to `.ico`
 * and `.icns`.
 *
 * A script rather than a checked-in binary because the icon is *derived*: it is
 * Darkroom's ground and accent (`src/shared/theme.ts`) drawn as an aperture iris.
 * Retuning the palette should not mean opening a raster editor, and a generated
 * file can be diffed by reading forty lines instead of squinting at a PNG.
 *
 * No dependencies — a signed-distance field rasterized by hand and encoded with
 * `node:zlib`. Adding a design toolchain to produce one 1024px square would cost
 * more than this file.
 *
 *   node scripts/make-icon.mjs      # or: npm run icon
 *
 * This is a placeholder in the sense that it was drawn by arithmetic, not by a
 * designer. It is not a placeholder in the sense of being temporary scaffolding:
 * replace `build/icon.png` with a real 1024x1024 PNG whenever one exists and
 * nothing else in the build has to change.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'build/icon.png')

const SIZE = 1024

// Darkroom, from src/shared/theme.ts. Kept as literals: this script runs under bare
// node with no TypeScript, and importing the theme would mean bundling it first.
const GROUND = [0x14, 0x11, 0x0d]
const RAISED = [0x1d, 0x18, 0x12]
const ACCENT_HI = [0xff, 0xc6, 0x6b]
const ACCENT_DEEP = [0xc8, 0x82, 0x1f]

// Geometry, in pixels at 1024. The iris is deliberately smaller than the plate:
// macOS shrinks an icon inside its grid and a full-bleed disc reads as a blob.
const CORNER = 224 // rounded-square radius of the plate
const R_OUTER = 336 // outer edge of the blades
const R_HEX = 128 // circumradius of the opening
const SEAM = 30 // width of the gap between two blades

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** Coverage from a signed distance: negative is inside, and the edge spans one pixel. */
const cover = (d) => clamp01(0.5 - d)

/** Signed distance to a rounded rectangle centred on the canvas. */
function roundedRect(x, y, half, r) {
  const qx = Math.abs(x) - (half - r)
  const qy = Math.abs(y) - (half - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

// The six blade tips, one pointing up. Vertex k and vertex k+1 bound blade k, and
// the seam for that blade is that edge extended outward past vertex k+1 — which is
// what makes the opening read as blades that could close rather than as a hexagon
// someone drew spokes on.
const VERTS = Array.from({ length: 6 }, (_, k) => {
  const a = (-90 + 60 * k) * (Math.PI / 180)
  return [Math.cos(a) * R_HEX, Math.sin(a) * R_HEX]
})

/** Signed distance to the hexagonal opening — negative inside the hole. */
function hexagon(x, y) {
  let d = -Infinity
  for (let k = 0; k < 6; k++) {
    const [ax, ay] = VERTS[k]
    const [bx, by] = VERTS[(k + 1) % 6]
    const ex = bx - ax
    const ey = by - ay
    const len = Math.hypot(ex, ey)
    // Outward normal of the edge, given vertices wound clockwise in screen space.
    const nx = ey / len
    const ny = -ex / len
    d = Math.max(d, (x - ax) * nx + (y - ay) * ny)
  }
  return d
}

/** Distance to the seam ray leaving vertex k+1 along edge k. */
function seamDistance(x, y, k) {
  const [ax, ay] = VERTS[k]
  const [bx, by] = VERTS[(k + 1) % 6]
  const len = Math.hypot(bx - ax, by - ay)
  const dx = (bx - ax) / len
  const dy = (by - ay) / len
  const t = (x - bx) * dx + (y - by) * dy
  if (t <= 0) return Math.hypot(x - bx, y - by)
  return Math.hypot(x - (bx + dx * t), y - (by + dy * t))
}

const rgba = Buffer.alloc(SIZE * SIZE * 4)

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    // Centre-of-pixel coordinates, origin at the middle of the canvas.
    const x = px + 0.5 - SIZE / 2
    const y = py + 0.5 - SIZE / 2

    const plate = cover(roundedRect(x, y, SIZE / 2, CORNER))

    // Intersection of: inside the outer circle, outside the opening, and clear of
    // all six seams. Each term is negative where it is satisfied, so the tightest
    // constraint wins.
    let d = Math.hypot(x, y) - R_OUTER
    d = Math.max(d, -hexagon(x, y))
    for (let k = 0; k < 6; k++) d = Math.max(d, SEAM / 2 - seamDistance(x, y, k))
    const iris = cover(d)

    // Light falls from the upper left, so the blades brighten toward it.
    const t = clamp01((x / R_OUTER + y / R_OUTER + 2) / 4)
    const blade = mix(ACCENT_HI, ACCENT_DEEP, t)
    const back = mix(RAISED, GROUND, clamp01((y + SIZE / 2) / SIZE))

    const rgb = mix(back, blade, iris)
    const i = (py * SIZE + px) * 4
    rgba[i] = Math.round(rgb[0])
    rgba[i + 1] = Math.round(rgb[1])
    rgba[i + 2] = Math.round(rgb[2])
    rgba[i + 3] = Math.round(plate * 255)
  }
}

// --- Minimal PNG encoder: 8-bit RGBA, one chunk of IDAT, no interlacing. ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type: truecolour with alpha
// bytes 10-12 stay zero: deflate, adaptive filtering, no interlace.

// Filter byte 0 (None) per scanline. The image is smooth gradients, so Paeth would
// compress better — but this file is 40KB either way and None keeps the encoder honest.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let py = 0; py < SIZE; py++) {
  const src = py * SIZE * 4
  const dst = py * (SIZE * 4 + 1)
  raw[dst] = 0
  rgba.copy(raw, dst + 1, src, src + SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`wrote ${OUT} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KB)`)
