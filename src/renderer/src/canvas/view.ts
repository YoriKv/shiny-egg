// Camera state for the canvas (pan + zoom) and helpers for picking an
// initial view. Pure — no React, no DOM.

import type { LevelData } from '../../../preload/api'
import { CELL_PX } from './geometry'

export interface View {
  /** Pan offsets in canvas pixels — applied AFTER the zoom. */
  panX: number
  panY: number
  zoom: number
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 6
export const ZOOM_STEP = 1.12

export const INITIAL_VIEW: View = { panX: 16, panY: 16, zoom: 1 }

/** Inset of the top-left-most object from the canvas top-left when we auto-fit. */
const FIT_INSET_PX = 32

/**
 * Compute a view that lands the level's top-left object at (FIT_INSET_PX,
 * FIT_INSET_PX) of the canvas. YI level Y values don't always start at 0 —
 * some levels sit near the bottom of the addressable Y space, which left
 * the default view looking at empty world above the level.
 */
export function fitViewForLevel(level: LevelData | null): View {
  if (!level || level.empty || level.special || level.objects.length === 0) {
    return INITIAL_VIEW
  }
  let minX = Infinity
  let minY = Infinity
  for (const o of level.objects) {
    minX = Math.min(minX, o.x, o.x + o.w)
    minY = Math.min(minY, o.y, o.y + o.h)
  }
  return {
    zoom: 1,
    panX: FIT_INSET_PX - minX * CELL_PX,
    panY: FIT_INSET_PX - minY * CELL_PX
  }
}

/**
 * Pan so the cell-grid point (x, y) lands in the middle of the canvas
 * viewport. Used after an exit-jump to drop the camera on the room's entry
 * point. `zoom` defaults to 1 (the user's pre-jump zoom was for the source
 * room, so carrying it over doesn't make sense); the object finder passes a
 * tighter zoom so the located object is easy to spot. Clamped to the zoom range.
 */
export function focusViewFor(
  x: number,
  y: number,
  sizePx: { w: number; h: number },
  zoom = 1
): View {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
  const worldX = (x + 0.5) * CELL_PX
  const worldY = (y + 0.5) * CELL_PX
  return {
    zoom: z,
    panX: sizePx.w / 2 - worldX * z,
    panY: sizePx.h / 2 - worldY * z
  }
}

/**
 * Zoom by `factor` about the canvas point (cx, cy) — keeps that point fixed
 * under the cursor (the wheel-zoom rule). Zoom is clamped to the [MIN_ZOOM,
 * MAX_ZOOM] range. Pure.
 */
export function zoomAt(view: View, cx: number, cy: number, factor: number): View {
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor))
  const actual = newZoom / view.zoom
  return {
    zoom: newZoom,
    panX: cx - (cx - view.panX) * actual,
    panY: cy - (cy - view.panY) * actual
  }
}

/**
 * Invert the view transform: a CANVAS-relative point (client coords minus the
 * canvas `getBoundingClientRect()` top-left) → world (pre-zoom) pixel coords.
 * The draw transform is `screen = world * zoom + pan`, so this is
 * `world = (canvas - pan) / zoom`. The single source of that inverse, which the
 * pointer handlers used to inline at ~14 sites. Pure.
 */
export function clientToWorld(view: View, canvasX: number, canvasY: number): { x: number; y: number } {
  return {
    x: (canvasX - view.panX) / view.zoom,
    y: (canvasY - view.panY) / view.zoom
  }
}

/** The cell-grid point at the centre of the viewport. Used by paste to drop a
 *  clipboard group on-screen when its original position is scrolled out of
 *  view. Pure. */
export function viewportCenterCell(view: View, sizePx: { w: number; h: number }): { x: number; y: number } {
  const w = clientToWorld(view, sizePx.w / 2, sizePx.h / 2)
  return { x: w.x / CELL_PX, y: w.y / CELL_PX }
}

/** Is the cell-grid point (x, y) currently within the visible viewport? Maps the
 *  cell to its on-screen pixel (`screen = world * zoom + pan`, world = cell ×
 *  CELL_PX) and tests the canvas rect. Pure. */
export function isCellOnScreen(
  view: View,
  sizePx: { w: number; h: number },
  x: number,
  y: number
): boolean {
  const screenX = x * CELL_PX * view.zoom + view.panX
  const screenY = y * CELL_PX * view.zoom + view.panY
  return screenX >= 0 && screenX <= sizePx.w && screenY >= 0 && screenY <= sizePx.h
}
