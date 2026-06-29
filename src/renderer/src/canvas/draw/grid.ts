import {
  CELL_PX,
  LEVEL_CELLS_H,
  LEVEL_CELLS_W,
  LEVEL_PX_H,
  LEVEL_PX_W,
  SCREEN_CELLS
} from '../geometry'
import type { GridMode } from '../../types'
import { parseRgba, withAlphaScale } from '../../lib/rgba'

// The grid is one user-picked color (`color` arg — an rgba() string from the
// toolbar swatch beside the canvas background, default DEFAULT_GRID_COLOR in
// App.tsx). The picked color AND alpha apply directly to BOTH the per-screen
// and per-cell (tile) lines. The outer editable-boundary rect reuses the same
// color but a touch more opaque (×BOUNDARY_ALPHA_SCALE, clamped) so the
// playfield edge still reads as the hardest line.
const BOUNDARY_ALPHA_SCALE = 1.3

/**
 * Draw the level's spatial bounds in `color` (an rgba() string). `mode` selects
 * how much grid:
 *   'screen' — per-SCREEN lines (every 16 cells) across the full 256×128-cell
 *              extent.
 *   'tile'   — additionally draws the finer per-CELL lines underneath.
 * Both modes draw the rectangle marking the hard editable boundary (nothing can
 * be moved/scaled/placed past it — see canvas/limits.ts). Lines stay 1 device
 * pixel thick regardless of zoom so they don't compete visually with object
 * outlines. (`mode` is never 'off' here — the caller gates on that.)
 */
export function drawScreenGrid(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  mode: GridMode,
  color: string
): void {
  const rgba = parseRgba(color)
  const lineStyle = withAlphaScale(rgba, 1) // screen + tile lines: the picked color+alpha
  ctx.save()
  // Per-CELL (tile) lines first — only in 'tile' mode. Cells that coincide with
  // a screen line are skipped here so they read as the per-screen line drawn
  // over them below (same color, but no double-stroke darkening at overlaps).
  if (mode === 'tile') {
    ctx.strokeStyle = lineStyle
    ctx.lineWidth = 1 / zoom
    ctx.beginPath()
    for (let c = 0; c <= LEVEL_CELLS_W; c++) {
      if (c % SCREEN_CELLS === 0) continue
      const x = c * CELL_PX
      ctx.moveTo(x, 0)
      ctx.lineTo(x, LEVEL_PX_H)
    }
    for (let r = 0; r <= LEVEL_CELLS_H; r++) {
      if (r % SCREEN_CELLS === 0) continue
      const y = r * CELL_PX
      ctx.moveTo(0, y)
      ctx.lineTo(LEVEL_PX_W, y)
    }
    ctx.stroke()
  }
  // Per-screen lines (both modes).
  ctx.strokeStyle = lineStyle
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
  // Outer boundary — the spatial limit, most opaque so the playfield edge reads
  // clearly, but kept thin (1px, like the interior lines).
  ctx.strokeStyle = withAlphaScale(rgba, BOUNDARY_ALPHA_SCALE)
  ctx.lineWidth = 1 / zoom
  ctx.strokeRect(0, 0, LEVEL_PX_W, LEVEL_PX_H)
  ctx.restore()
}
