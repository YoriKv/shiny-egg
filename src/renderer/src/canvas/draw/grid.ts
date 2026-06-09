import {
  CELL_PX,
  LEVEL_CELLS_H,
  LEVEL_CELLS_W,
  LEVEL_PX_H,
  LEVEL_PX_W,
  SCREEN_CELLS
} from '../geometry'

/**
 * Draw the level's spatial bounds: faint per-screen grid lines across the full
 * 256×128-cell extent, plus a brighter rectangle marking the hard editable
 * boundary (nothing can be moved/scaled/placed past it — see
 * canvas/limits.ts). Lines stay 1 device pixel thick regardless of zoom so
 * they don't compete visually with object outlines.
 */
export function drawScreenGrid(ctx: CanvasRenderingContext2D, zoom: number): void {
  ctx.save()
  // Interior screen lines.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 1 / zoom
  ctx.beginPath()
  for (let c = 0; c <= LEVEL_CELLS_W; c += SCREEN_CELLS) {
    const x = c * CELL_PX
    ctx.moveTo(x, 0)
    ctx.lineTo(x, LEVEL_PX_H)
  }
  for (let r = 0; r <= LEVEL_CELLS_H; r += SCREEN_CELLS) {
    const y = r * CELL_PX
    ctx.moveTo(0, y)
    ctx.lineTo(LEVEL_PX_W, y)
  }
  ctx.stroke()
  // Outer boundary — the spatial limit, drawn brighter so the playfield edge
  // reads clearly against the surrounding void.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)'
  ctx.lineWidth = 1.5 / zoom
  ctx.strokeRect(0, 0, LEVEL_PX_W, LEVEL_PX_H)
  ctx.restore()
}
