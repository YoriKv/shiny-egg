// Pure pixel/world constants and screen geometry. No React, no state.
// Imported by view, hit-test, and every draw module.

import type { SpriteCelBounds } from '../../../preload/api'

/** YI screen size, in cells. The level (256×128 cells) decomposes into 16×8 screens. */
export const SCREEN_CELLS = 16

/**
 * Logical pixel size of one YI tile cell. The level streams encode positions
 * and sizes in cells, not pixels; the canvas multiplies by this to plot.
 */
export const CELL_PX = 16

export const SCREEN_PX = SCREEN_CELLS * CELL_PX

/**
 * A YI level is a fixed 16×8 grid of screens (the engine pages screens into
 * the 32-KB Map16 buffer at `$7F:8000`; the Lua `draw_tile_map` indexes
 * screens as `y*16 + x`, range 0..127 — i.e. 16 wide, 8 tall). That fixes the
 * editable spatial bounds for every level regardless of how many screens it
 * actually allocates. See `snes-framework/docs/levelloader.md` and
 * `research/level-render-source-and-scripts.md` §11.2.
 */
export const LEVEL_SCREENS_W = 16
export const LEVEL_SCREENS_H = 8

/** Level extent in cells: 256 × 128 (16×8 screens × 16 cells/screen). */
export const LEVEL_CELLS_W = LEVEL_SCREENS_W * SCREEN_CELLS
export const LEVEL_CELLS_H = LEVEL_SCREENS_H * SCREEN_CELLS

/** Level extent in world (pre-zoom) pixels: 4096 × 2048. */
export const LEVEL_PX_W = LEVEL_CELLS_W * CELL_PX
export const LEVEL_PX_H = LEVEL_CELLS_H * CELL_PX

/** Half-extent of an exit marker's door icon, in world (pre-zoom) pixels. Sized
 *  so the whole chip spans one tile (2 × 8 = 16 = CELL_PX); the incoming marker
 *  is normalized to the same size. */
export const EXIT_MARKER_HALF_PX = 8

/** Half-extent (world px) of the spawn flag's clickable square. The pole
 *  extends ~9 px up from the cell center, so we offset / size accordingly. */
export const SPAWN_HIT_HALF_PX = 10

/** Half-extent (world px) of an incoming-exit marker's clickable square.
 *  Matches the door icon (normalized to one tile — EXIT_MARKER_HALF_PX). */
export const INCOMING_HIT_HALF_PX = 8

/**
 * Visual / interaction extent of one object dimension, in cells. A size of 0 is
 * a real authored value (encodes as byte 0xFF, distinct from 1/-1) — rendered
 * and hit-tested as **1/4 tile** so it's visible and unmistakable from size 1.
 * Otherwise the magnitude (negative folds back from the anchor; the caller
 * applies the anchor offset via `min(x, x+d)`).
 *
 * This is the *visual* footprint. For *cell* footprint — bounds clamping
 * (`objectCellBox`) and collision-cell iteration — use `Math.max(1, abs(d))`
 * instead: a size-0 object still occupies its single anchor cell there.
 */
export function objectBoxExtent(d: number): number {
  return Math.abs(d) || 0.25
}

export function screenCol(screenIndex: number): number {
  return screenIndex & 0x0f
}

export function screenRow(screenIndex: number): number {
  return (screenIndex >> 4) & 0x0f
}

/** Compose a screen index (`(row<<4)|col`, 0x00–0x7F) from screen column/row —
 *  the inverse of `screenCol`/`screenRow`. */
export function makeScreenIndex(col: number, row: number): number {
  return ((row & 0x0f) << 4) | (col & 0x0f)
}

/**
 * Screen index containing tile cell `(cx, cy)`. The level is a 16×8 grid of
 * 16-cell screens, so this floor-divides each axis into screen coords and packs
 * them as `(row<<4)|col` — matching `ScreenExit.screenIndex`. Single source for
 * the cell→screen mapping shared by entity-links and the sprite neighbour-dep
 * resolver. */
export function screenOf(cx: number, cy: number): number {
  return makeScreenIndex(Math.floor(cx / SCREEN_CELLS), Math.floor(cy / SCREEN_CELLS))
}

/** Inset (world px) of the exit marker's CENTER from its screen's top-left
 *  corner: half a tile, so the one-tile door icon lands exactly in the screen's
 *  top-left cell (chip corner flush with the screen corner). */
export const EXIT_MARKER_INSET_PX = CELL_PX / 2

/** Exit marker centre X — anchored at the TOP-LEFT corner of the exit's screen
 *  (inset so the chip clears the screen boundary), not the screen centre. The
 *  single source for the exit marker position: draw (exits.ts), hit-test, and
 *  the link anchor (entity-links.ts) all call it so they can't drift. */
export function exitMarkerX(screenIndex: number): number {
  return screenCol(screenIndex) * SCREEN_PX + EXIT_MARKER_INSET_PX
}

export function exitMarkerY(screenIndex: number): number {
  return screenRow(screenIndex) * SCREEN_PX + EXIT_MARKER_INSET_PX
}

/** World-pixel box of a sprite's composited cel, given its tile (x, y) anchor
 *  and the per-num bounds from `render:spriteLayer`. The drawn pixels and the
 *  click area share this box, so the selection box always matches the graphic. */
export function spriteCelBox(
  spriteX: number,
  spriteY: number,
  b: SpriteCelBounds
): { x0: number; y0: number; w: number; h: number } {
  return {
    x0: spriteX * CELL_PX - b.originX,
    y0: spriteY * CELL_PX - b.originY,
    w: b.width,
    h: b.height
  }
}

/**
 * Snap a pixel drag delta to an integer cell delta at the current zoom. One cell
 * spans `CELL_PX * zoom` screen pixels, so the pixel delta divides by that and
 * rounds. Single source for every drag-move kind's cell snap (object / sprite /
 * incoming / spawn / group), so the preview and the commit snap identically.
 */
export function snapCellDelta(
  dxPx: number,
  dyPx: number,
  zoom: number
): { cellDx: number; cellDy: number } {
  return {
    cellDx: Math.round(dxPx / (CELL_PX * zoom)),
    cellDy: Math.round(dyPx / (CELL_PX * zoom))
  }
}

/**
 * An object's VISUAL / hit-test box in world (pre-zoom) pixels. The anchor
 * `(x, y)` and signed size `(w, h)` fold to a top-left + positive extent: a
 * negative dimension grows the box back from the anchor (`min(x, x+w)`), and a
 * size-0 axis renders as 1/4 tile (`objectBoxExtent`). This is the single source
 * for the object box — `drawObjects`, the resize handles, the hit-tests, and the
 * association-link anchor all derive from it, so the drawn box and the click box
 * provably can't drift. For the integer-cell footprint (bounds clamping) use
 * `limits.objectCellBox` instead — a size-0 axis covers one cell there.
 */
export function objectVisualBox(o: {
  x: number
  y: number
  w: number
  h: number
}): { x0: number; y0: number; w: number; h: number } {
  return {
    x0: Math.min(o.x, o.x + o.w) * CELL_PX,
    y0: Math.min(o.y, o.y + o.h) * CELL_PX,
    w: objectBoxExtent(o.w) * CELL_PX,
    h: objectBoxExtent(o.h) * CELL_PX
  }
}

/**
 * An extended object's outline box, expressed ANCHOR-RELATIVE in cells: `offX`/
 * `offY` are the footprint's min corner minus the object's anchor `(x, y)`, and
 * `w`/`h` are its cell extent. Applied to the object's LIVE anchor by
 * `objectOutlineBox`, so the box tracks a move-drag automatically — exactly how
 * `spriteCelBox` applies per-num bounds to a sprite's live position. Extended
 * objects encode no W/H (their nominal box is a meaningless 1×1), so we size
 * their outline to the tiles they actually stamp instead. Built by
 * `objectOutlineBoxes` (draw/objects.ts) from the per-object footprints.
 */
export interface ObjectOutlineBox {
  offX: number
  offY: number
  w: number
  h: number
}

/**
 * Cell-space bounding box of a set of absolute cell indices (`y * LEVEL_CELLS_W
 * + x`), as returned by `render:objectCells` / `useObjectCells`. Returns the min
 * corner and the inclusive cell extent, or null for an empty set.
 */
export function footprintCellBounds(
  cells: ReadonlySet<number>
): { minX: number; minY: number; w: number; h: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of cells) {
    const x = c % LEVEL_CELLS_W
    const y = Math.floor(c / LEVEL_CELLS_W)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < 0) return null
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * The world-px outline box to DRAW for an object. An extended object with a
 * derived footprint box (uid present in `outlineBoxes`) is outlined to its
 * stamped tiles, tracking its live anchor; every other object (standard, or an
 * ext object that stamps nothing / whose footprint hasn't fetched yet) falls
 * back to `objectVisualBox`. This is the single source for the drawn outline —
 * `drawObjects` and its validity badge both go through it, so the badge stays
 * pinned to the box's corner. Hit-testing is deliberately unchanged (it targets
 * the exact footprint cells for ext objects); this only sizes the visible box.
 */
export function objectOutlineBox(
  o: { x: number; y: number; w: number; h: number; uid?: number },
  outlineBoxes: ReadonlyMap<number, ObjectOutlineBox>
): { x0: number; y0: number; w: number; h: number } {
  const b = o.uid != null ? outlineBoxes.get(o.uid) : undefined
  if (b) {
    return {
      x0: (o.x + b.offX) * CELL_PX,
      y0: (o.y + b.offY) * CELL_PX,
      w: b.w * CELL_PX,
      h: b.h * CELL_PX
    }
  }
  return objectVisualBox(o)
}
