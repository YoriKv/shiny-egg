import type { LinkLine } from '../entity-links'

/**
 * Dashed amber connector lines for entity associations (exit ↔ pipe/door, and
 * future special-case relations). Drawn under the marker glyphs so each line's
 * endpoints tuck into the entity it connects.
 */
export function drawLinks(
  ctx: CanvasRenderingContext2D,
  lines: LinkLine[],
  zoom: number
): void {
  if (lines.length === 0) return
  ctx.save()
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)'
  ctx.lineWidth = 1.5 / zoom
  ctx.setLineDash([5 / zoom, 4 / zoom])
  for (const l of lines) {
    ctx.beginPath()
    ctx.moveTo(l.ax, l.ay)
    ctx.lineTo(l.bx, l.by)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.restore()
}
