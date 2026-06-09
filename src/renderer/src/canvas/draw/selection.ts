// Shared selection-box rendering — the chartreuse box + marching-ant corners
// drawn around a selected object or sprite. Extracted so drawObjects and
// drawSpriteOutlines render an identical selection treatment (the editor's
// goal of objects and sprites "functioning similarly").

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
  ctx.strokeStyle = '#d4e157'
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
