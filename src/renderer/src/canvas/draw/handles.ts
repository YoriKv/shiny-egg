// Object resize handles — the direct-manipulation layer over `setObjectFields`.
//
// Model: the object's anchor `(o.x, o.y)` is a FIXED pivot; `w`/`h` are signed
// cell extents (YI folds a negative dimension to grow the box back from the
// anchor — see limits.ts). So we only ever drag the box edges OPPOSITE the
// anchor ("free" edges). Dragging a free edge past the anchor flips the extent's
// sign — the supported way to author a negative size. Dragging onto the anchor
// authors size 0 (a 1/4-cell box). Bounds + min-magnitude-1-for-nonzero come
// from `clampObjectResize` (which preserves 0); this module just turns a cursor
// position into extents and places/hit-tests the handle squares.

import type { LevelObject } from '../../../../preload/api'
import type { SizeMode } from '../../data/object-record'
import { CELL_PX, objectVisualBox } from '../geometry'

/** Which handle was grabbed: the free corner (both axes), the free vertical edge
 *  (width only), or the free horizontal edge (height only). */
export type ResizeHandle = 'corner' | 'edgeW' | 'edgeH'

export interface HandlePoint {
  id: ResizeHandle
  /** Center, in world (pre-zoom) px. */
  x: number
  y: number
}

/** On-screen handle square size, px (kept constant regardless of zoom). */
const HANDLE_PX = 9

/** Box edges + free-edge / midpoint positions for an object, in world px. The
 *  anchor corner is `(o.x, o.y)`; the free edges are the opposite sides. */
function boxEdges(o: LevelObject): {
  freeX: number
  freeY: number
  midX: number
  midY: number
} {
  const { x0: bx0, y0: by0, w, h } = objectVisualBox(o)
  const bx1 = bx0 + w
  const by1 = by0 + h
  return {
    freeX: o.w >= 0 ? bx1 : bx0,
    freeY: o.h >= 0 ? by1 : by0,
    midX: (bx0 + bx1) / 2,
    midY: (by0 + by1) / 2
  }
}

/**
 * The resize handles for an object, ordered so the corner is hit-tested first
 * (it overlaps the edge handles on small boxes). `'none'` (extended objects,
 * which encode no W/H) → no handles.
 */
export function objectResizeHandles(o: LevelObject, sizeMode: SizeMode): HandlePoint[] {
  if (sizeMode === 'none') return []
  const e = boxEdges(o)
  const out: HandlePoint[] = []
  if (sizeMode === 'wh') out.push({ id: 'corner', x: e.freeX, y: e.freeY })
  if (sizeMode === 'wh' || sizeMode === 'w') out.push({ id: 'edgeW', x: e.freeX, y: e.midY })
  if (sizeMode === 'wh' || sizeMode === 'h') out.push({ id: 'edgeH', x: e.midX, y: e.freeY })
  return out
}

/**
 * New signed extents from dragging handle `id` to world px `(wx, wy)`. The free
 * edge snaps to the nearest cell grid line, so the dragged extent is
 * `(line − anchor)`: dragging onto the anchor line authors size 0 — a real
 * authored value (encodes as byte 0xFF, rendered as a 1/4 cell by
 * `objectBoxExtent`), and crossing the anchor yields a negative extent. The
 * UNdragged axis is returned verbatim. Caller clamps via `clampObjectResize`,
 * which preserves 0.
 */
export function extentFromHandle(
  o: LevelObject,
  id: ResizeHandle,
  wx: number,
  wy: number
): { w: number; h: number } {
  let w = o.w
  let h = o.h
  if (id === 'corner' || id === 'edgeW') w = Math.round(wx / CELL_PX) - o.x
  if (id === 'corner' || id === 'edgeH') h = Math.round(wy / CELL_PX) - o.y
  return { w, h }
}

/** CSS cursor for a handle. Edge handles are axis cursors; the corner's diagonal
 *  depends on which box corner is free — same-sign w/h → top-left/bottom-right
 *  (`nwse`), mixed signs → top-right/bottom-left (`nesw`). */
export function cursorForHandle(id: ResizeHandle, o: LevelObject): string {
  if (id === 'edgeW') return 'ew-resize'
  if (id === 'edgeH') return 'ns-resize'
  return o.w >= 0 === (o.h >= 0) ? 'nwse-resize' : 'nesw-resize'
}

/** Hit-test the resize handles; returns the grabbed handle or null. Tolerance is
 *  screen-fixed (the drawn square + a px of slop), converted to world units. */
export function hitResizeHandle(
  o: LevelObject,
  sizeMode: SizeMode,
  wx: number,
  wy: number,
  zoom: number
): ResizeHandle | null {
  const tol = (HANDLE_PX / 2 + 1) / zoom
  for (const h of objectResizeHandles(o, sizeMode)) {
    if (Math.abs(wx - h.x) <= tol && Math.abs(wy - h.y) <= tol) return h.id
  }
  return null
}

/** Draw the resize handles as small chartreuse squares on the selected box. */
export function drawResizeHandles(
  ctx: CanvasRenderingContext2D,
  handles: HandlePoint[],
  zoom: number
): void {
  if (handles.length === 0) return
  const s = HANDLE_PX / zoom
  ctx.save()
  ctx.fillStyle = '#d4e157'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.lineWidth = 1 / zoom
  for (const h of handles) {
    ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s)
    ctx.strokeRect(h.x - s / 2, h.y - s / 2, s, s)
  }
  ctx.restore()
}
