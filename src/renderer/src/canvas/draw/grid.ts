import {
  CELL_PX,
  LEVEL_CELLS_H,
  LEVEL_CELLS_W,
  LEVEL_PX_H,
  LEVEL_PX_W,
  SCREEN_CELLS
} from '../geometry'
import type { GridMode } from '../../types'

// Grid stroke colour — black, reading as a neutral overlay over the colourful
// level art and the bright COLDATA backdrop gradients. Three alpha tiers keep
// the depth hierarchy readable: per-cell (faintest) < per-screen < outer
// boundary (most opaque).
const GRID_RGB = '0, 0, 0'

/**
 * Draw the level's spatial bounds. `mode` selects how much grid:
 *   'screen' — faint per-SCREEN lines (every 16 cells) across the full
 *              256×128-cell extent.
 *   'tile'   — additionally draws the finer per-CELL lines underneath, with the
 *              per-screen lines still emphasized on top (so the tile grid
 *              "also shows the screen grid").
 * Both modes draw the brighter rectangle marking the hard editable boundary
 * (nothing can be moved/scaled/placed past it — see canvas/limits.ts). Lines
 * stay 1 device pixel thick regardless of zoom so they don't compete visually
 * with object outlines. (`mode` is never 'off' here — the caller gates on that.)
 */
export function drawScreenGrid(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  mode: GridMode
): void {
  ctx.save()
  // Per-CELL (tile) lines first — only in 'tile' mode. Cells that coincide with
  // a screen line are skipped here so they read as the brighter per-screen line
  // drawn over them below.
  if (mode === 'tile') {
    ctx.strokeStyle = `rgba(${GRID_RGB}, 0.45)`
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
  ctx.strokeStyle = `rgba(${GRID_RGB}, 0.5)`
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
  ctx.strokeStyle = `rgba(${GRID_RGB}, 0.85)`
  ctx.lineWidth = 1 / zoom
  ctx.strokeRect(0, 0, LEVEL_PX_W, LEVEL_PX_H)
  ctx.restore()
}
