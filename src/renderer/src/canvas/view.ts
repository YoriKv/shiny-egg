// Camera state for the canvas (pan + zoom) and helpers for picking an
// initial view. Pure — no React, no DOM.

import type { LevelData } from '../../../preload/api'
import { CELL_PX, LEVEL_PX_H, LEVEL_PX_W } from './geometry'

export interface View {
  /** Pan offsets in canvas pixels — applied AFTER the zoom. */
  panX: number
  panY: number
  zoom: number
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 6
export const ZOOM_STEP = 1.12

/** The toolbar zoom-dropdown presets (also the Shift+wheel snap stops). Plain
 *  wheel zoom is continuous (ZOOM_STEP), so the live zoom is usually between
 *  presets; MAX_ZOOM intentionally exceeds the largest preset. Ascending. */
export const ZOOM_PRESETS: readonly number[] = [0.25, 0.5, 1, 2, 3, 4]

/** Tolerance for "is the zoom AT a preset" in stepZoomPreset. Presets are
 *  assigned exactly (never accumulated), so this only needs to absorb the
 *  round-off of zoomTo's factor arithmetic — keep it far below the gap
 *  between any two presets. */
const PRESET_EPS = 1e-9

/**
 * The next preset zoom in `dir` (+1 in, -1 out) from `zoom` — the Shift+wheel
 * snap. A zoom sitting exactly on a preset steps to its neighbour; a zoom
 * between presets snaps to the nearest one in that direction. Returns `zoom`
 * unchanged when no preset lies further that way (past either end). Pure.
 */
export function stepZoomPreset(zoom: number, dir: 1 | -1): number {
  if (dir > 0) {
    for (const p of ZOOM_PRESETS) if (p > zoom + PRESET_EPS) return p
  } else {
    for (let i = ZOOM_PRESETS.length - 1; i >= 0; i--) {
      if (ZOOM_PRESETS[i]! < zoom - PRESET_EPS) return ZOOM_PRESETS[i]!
    }
  }
  return zoom
}

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
 * Zoom to the absolute level `zoom` about the canvas point (cx, cy) — keeps
 * that point fixed (the wheel-zoom rule). Assigns `zoom` exactly (clamped to
 * [MIN_ZOOM, MAX_ZOOM]) so a preset pick lands on the preset value, not a
 * factor-multiplication approximation of it. Pure.
 */
export function zoomTo(view: View, cx: number, cy: number, zoom: number): View {
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
  const actual = newZoom / view.zoom
  return {
    zoom: newZoom,
    panX: cx - (cx - view.panX) * actual,
    panY: cy - (cy - view.panY) * actual
  }
}

/**
 * Zoom by `factor` about the canvas point (cx, cy) — keeps that point fixed
 * under the cursor (the wheel-zoom rule). Zoom is clamped to the [MIN_ZOOM,
 * MAX_ZOOM] range. Pure.
 */
export function zoomAt(view: View, cx: number, cy: number, factor: number): View {
  return zoomTo(view, cx, cy, view.zoom * factor)
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

/**
 * The CANVAS-relative point that shows, under view `to`, the same world point
 * (canvasX, canvasY) showed under view `from`. Re-anchors a drag's start point
 * when the view changes mid-drag (wheel zoom, edge auto-scroll) so the drag's
 * client-space delta keeps meaning the same world delta. Pure.
 */
export function reanchorCanvasPoint(
  from: View,
  to: View,
  canvasX: number,
  canvasY: number
): { x: number; y: number } {
  const w = clientToWorld(from, canvasX, canvasY)
  return { x: w.x * to.zoom + to.panX, y: w.y * to.zoom + to.panY }
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

/** Width of the band along each canvas edge where a drag auto-scrolls. Also the
 *  margin the level edge stops at, so scrolling never runs off into the void. */
export const EDGE_SCROLL_ZONE_PX = 40
/** Auto-scroll speed (canvas px/s) at the very edge or beyond it. */
const EDGE_SCROLL_MAX_SPEED = 1200

/** Signed speed (px/s) for one axis: +ve near the far edge (scroll toward
 *  higher world coords), -ve near the near edge, 0 in the interior. Ramps
 *  linearly across the zone and saturates once the cursor leaves the canvas. */
function edgeSpeed(pos: number, extent: number): number {
  const near = EDGE_SCROLL_ZONE_PX - pos
  const far = pos - (extent - EDGE_SCROLL_ZONE_PX)
  if (near > 0) return -EDGE_SCROLL_MAX_SPEED * Math.min(1, near / EDGE_SCROLL_ZONE_PX)
  if (far > 0) return EDGE_SCROLL_MAX_SPEED * Math.min(1, far / EDGE_SCROLL_ZONE_PX)
  return 0
}

/** Move `pan` by `-speed * dt` but never past the level-edge limit, and never
 *  snap toward it from beyond (a view the user already panned past stays put). */
function edgeStep(pan: number, speed: number, dtSec: number, levelPx: number, extent: number): number {
  if (speed > 0) {
    const min = extent - EDGE_SCROLL_ZONE_PX - levelPx
    return Math.min(pan, Math.max(min, pan - speed * dtSec))
  }
  if (speed < 0) {
    return Math.max(pan, Math.min(EDGE_SCROLL_ZONE_PX, pan - speed * dtSec))
  }
  return pan
}

/**
 * Drag edge auto-scroll: the pan after `dtMs` with the cursor at the
 * CANVAS-relative point (canvasX, canvasY), which may lie outside the canvas
 * (window-level drag listeners keep reporting it). Inside the edge band the view
 * scrolls toward that edge, faster the closer the cursor is, and stops once the
 * level's edge is EDGE_SCROLL_ZONE_PX inside the viewport. Returns `view`'s pan
 * unchanged when nothing should move. Pure.
 */
export function edgeScrollPan(
  view: View,
  sizePx: { w: number; h: number },
  canvasX: number,
  canvasY: number,
  dtMs: number
): { panX: number; panY: number } {
  const dt = dtMs / 1000
  return {
    panX: edgeStep(view.panX, edgeSpeed(canvasX, sizePx.w), dt, LEVEL_PX_W * view.zoom, sizePx.w),
    panY: edgeStep(view.panY, edgeSpeed(canvasY, sizePx.h), dt, LEVEL_PX_H * view.zoom, sizePx.h)
  }
}
