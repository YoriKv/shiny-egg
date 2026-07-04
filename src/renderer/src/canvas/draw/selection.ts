// Shared selection/hover treatment — the chartreuse accent color, the
// selected-entity box, and the entity anchor dot. Extracted so drawObjects,
// drawSpriteOutlines, exits, handles, and the marquee all render an identical
// selection language (the editor's goal of objects and sprites "functioning
// similarly").

import { CELL_PX } from '../geometry'

/** The selection/hover accent (chartreuse) — the canvas counterpart of
 *  App.css's `--accent`. Use `selectionAccent(alpha)` for translucent forms. */
export const SELECTION_ACCENT = '#d4e157'

/** The accent at an arbitrary alpha (212, 225, 87 = #d4e157). */
export function selectionAccent(alpha: number): string {
  return `rgba(212, 225, 87, ${alpha})`
}

/** Accent at 0.85 — the shared hover-outline stroke (objects / sprites / spawn). */
export const HOVER_ACCENT = selectionAccent(0.85)

/**
 * Stroke the CURRENT path as an alternating black/white dashed line — the
 * "basic" (render-mode) entity outline. Two phase-shifted passes over the same
 * (already-built) path: black dashes, then white in their gaps, so the outline
 * reads over any tile without depending on a theme color. Constant screen size
 * via `zoom`. Self-contained (save/restore) — build the path (beginPath + rect /
 * segments), then call this; it leaves no dash/style state behind.
 */
export function strokeBasicOutline(ctx: CanvasRenderingContext2D, zoom: number): void {
  const dash = 3 / zoom
  ctx.save()
  ctx.lineWidth = 1 / zoom
  ctx.lineCap = 'butt'
  ctx.setLineDash([dash, dash])
  ctx.lineDashOffset = 0
  ctx.strokeStyle = '#000000'
  ctx.stroke()
  ctx.lineDashOffset = dash // fill the black gaps with white → alternating
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.restore()
}

/** Draw the selected-entity box: a thick chartreuse rectangle with small
 *  marching-ant corner ticks, at constant screen width (strokes scale by
 *  1/zoom). `box` is in world pixels; self-contained (save/restore) so it
 *  leaves no ctx state behind. */
export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  box: { x0: number; y0: number; w: number; h: number },
  zoom: number
): void {
  const { x0, y0, w, h } = box
  ctx.save()
  ctx.strokeStyle = SELECTION_ACCENT
  ctx.lineWidth = 2 / zoom
  const inset = 1 / zoom
  ctx.strokeRect(x0 - inset, y0 - inset, w + inset * 2, h + inset * 2)
  // Marching-ant corners — small chartreuse ticks at each corner.
  const tick = 4 / zoom
  ctx.beginPath()
  ctx.moveTo(x0 - inset, y0 - inset + tick); ctx.lineTo(x0 - inset, y0 - inset); ctx.lineTo(x0 - inset + tick, y0 - inset)
  ctx.moveTo(x0 + w + inset - tick, y0 - inset); ctx.lineTo(x0 + w + inset, y0 - inset); ctx.lineTo(x0 + w + inset, y0 - inset + tick)
  ctx.moveTo(x0 - inset, y0 + h + inset - tick); ctx.lineTo(x0 - inset, y0 + h + inset); ctx.lineTo(x0 - inset + tick, y0 + h + inset)
  ctx.moveTo(x0 + w + inset - tick, y0 + h + inset); ctx.lineTo(x0 + w + inset, y0 + h + inset); ctx.lineTo(x0 + w + inset, y0 + h + inset - tick)
  ctx.stroke()
  ctx.restore()
}

/**
 * Subtle dot at an entity's `(cellX, cellY)` anchor — the point its size/cel
 * grows from. Shared by objects and sprites so the anchor treatment stays
 * identical; `idleFill` carries the per-entity tint (objects orange, sprites
 * amber). Emphasis (hover/selection) promotes it to the accent and enlarges
 * it. Self-contained (save/restore) so it can't leak fill/stroke state into
 * the caller's loop.
 */
export function drawAnchorDot(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  zoom: number,
  emphasis: boolean,
  idleFill: string
): void {
  const ax = cellX * CELL_PX
  const ay = cellY * CELL_PX
  const r = (emphasis ? 3 : 2.25) / zoom
  ctx.save()
  ctx.beginPath()
  ctx.arc(ax, ay, r, 0, Math.PI * 2)
  ctx.fillStyle = emphasis ? SELECTION_ACCENT : idleFill
  ctx.fill()
  ctx.lineWidth = 1 / zoom
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.stroke()
  ctx.restore()
}
