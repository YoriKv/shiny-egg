// Shared glyph primitives. drawFlagGlyph is used both by sprite-completion
// markers (amber/violet) and by the world-map spawn flag (green).

import { CELL_PX } from '../geometry'
import { drawSelectionBox, HOVER_ACCENT } from './selection'
import { beginIdLabels, drawIdLabel } from './text'

/** How aggressively flag / landmark glyphs enlarge as the level is zoomed out
 *  past 100%, plus the cap on that enlargement. */
const GLYPH_ZOOM_RATE = 2
const GLYPH_MAX_ZOOM_SCALE = 6

/**
 * Zoom-out enlargement factor for flag / landmark glyphs. `1` at >= 100% so a
 * glyph fits inside its 1-cell outline box; below 100% it grows
 * `GLYPH_ZOOM_RATE`× the constant-on-screen rate (`1/zoom`) so the marker stays
 * visible as the cell shrinks on screen, capped at `GLYPH_MAX_ZOOM_SCALE`.
 */
export function glyphZoomScale(zoom: number): number {
  if (zoom >= 1) return 1
  return Math.min(GLYPH_MAX_ZOOM_SCALE, 1 + GLYPH_ZOOM_RATE * (1 / zoom - 1))
}

/**
 * Pennant-flag glyph — universally readable as "this is a notable point".
 * Centered on (cx, cy) and sized to fit within one cell (CELL_PX) at
 * `scale = 1`. `scale > 1` enlarges it past the cell — used to keep landmark
 * sprites legible when the level is zoomed out (the cell shrinks on screen but
 * the glyph holds a readable size).
 */
export function drawFlagGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  haloColor: string,
  scale = 1
): void {
  const haloR = 7 * scale
  const poleTop = cy - 7 * scale
  const poleBottom = cy + 6 * scale
  const flagSpan = 5.5 * scale
  const flagHeight = 5 * scale

  // Soft halo so the thin pole isn't lost at low zoom. Centered in the cell.
  ctx.strokeStyle = haloColor
  ctx.lineWidth = 2 * scale
  ctx.beginPath()
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2)
  ctx.stroke()

  // Pole.
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5 * scale
  ctx.beginPath()
  ctx.moveTo(cx, poleTop)
  ctx.lineTo(cx, poleBottom)
  ctx.stroke()

  // Pennant.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(cx, poleTop)
  ctx.lineTo(cx + flagSpan, poleTop + flagHeight / 2)
  ctx.lineTo(cx, poleTop + flagHeight)
  ctx.closePath()
  ctx.fill()

  // Pole base.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, poleBottom, 1.5 * scale, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * World-map spawn marker — green flag glyph at the cell where Yoshi
 * materializes when entering this level from the world map. Same pennant
 * shape as goal/checkpoint so the trio reads as a family:
 *   green   = spawn  (where you START)
 *   amber   = goal / boss door (primary completion)
 *   violet  = middle ring (mid-level checkpoint)
 */
export function drawSpawnGlyph(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  zoom: number
): void {
  // Flag only — hover / selection live on the spawn's sprite-style outline
  // (drawSpawnOutline), matching how sprite glyphs carry no selection treatment.
  ctx.save()
  const cx = (cellX + 0.5) * CELL_PX
  const cy = (cellY + 0.5) * CELL_PX
  drawFlagGlyph(ctx, cx, cy, '#86efac', 'rgba(134, 239, 172, 0.32)', glyphZoomScale(zoom)) // green-300
  ctx.restore()
}

/**
 * Sprite-style selectable outline for the world-map spawn — a 1-cell box (the
 * spawn is a point entity) with a "spawn" label, mirroring `drawSpriteOutlines`
 * so the spawn reads and selects like a sprite. Gated on the Sprite Editing
 * (`spriteOutlines`) layer; the flag glyph above is gated on Show/Hide Sprites,
 * so the spawn's two halves toggle independently like a real sprite.
 */
export function drawSpawnOutline(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  hovered: boolean,
  selected: boolean,
  zoom: number
): void {
  const x0 = cellX * CELL_PX
  const y0 = cellY * CELL_PX
  if (selected) {
    drawSelectionBox(ctx, { x0, y0, w: CELL_PX, h: CELL_PX }, zoom)
  } else {
    ctx.save()
    ctx.lineWidth = 1 / zoom
    const inset = 0.5 / zoom
    // Amber default / chartreuse hover — same treatment as drawSpriteOutlines.
    ctx.strokeStyle = hovered ? HOVER_ACCENT : 'rgba(255, 205, 92, 0.6)'
    ctx.strokeRect(x0 + inset, y0 + inset, CELL_PX - inset * 2, CELL_PX - inset * 2)
    ctx.restore()
  }
  // Label, zoom-gated, top-left of the box — mirrors the sprite id label so the
  // spawn is identifiable when the flag glyph (Sprites layer) is hidden.
  if (zoom >= 1.5) {
    ctx.save()
    const adv = beginIdLabels(ctx, zoom)
    drawIdLabel(ctx, x0, y0, 'spawn', zoom, adv)
    ctx.restore()
  }
}

/**
 * Test-spawn marker — the per-session "Set Spawn" override that Test Level
 * drops Yoshi at on the next boot. Drawn as an abstract Yoshi egg (pale
 * teal-white shell, two green patches, black outline), deliberately distinct
 * from the green world-map spawn flag (`drawSpawnGlyph`) so the two never read
 * as the same thing. Session-only, never written to the ROM.
 */
export function drawTestSpawnGlyph(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  zoom: number
): void {
  ctx.save()
  const cx = (cellX + 0.5) * CELL_PX
  const cy = (cellY + 0.5) * CELL_PX
  // Enlarge when zoomed out (same factor as the flag glyphs) so the override
  // marker stays visible; every dimension below is multiplied by `scale`.
  const scale = glyphZoomScale(zoom)

  // Egg outline — the same 4-cubic shape as the toolbar icon, scaled by S and
  // centered on the cell. Coords are relative to the center: the widest point
  // sits BELOW center (cy + 1·S) and the top is narrower than the base, so it
  // reads as an egg rather than an ellipse. A function so the body fill, the
  // spot clip, and the shell stroke all trace the exact same path.
  const S = 1.25 * scale
  const eggPath = (): void => {
    ctx.beginPath()
    ctx.moveTo(cx, cy - 6 * S)
    ctx.bezierCurveTo(cx + 3.0 * S, cy - 6.0 * S, cx + 4.6 * S, cy - 2.5 * S, cx + 4.6 * S, cy + 1.0 * S)
    ctx.bezierCurveTo(cx + 4.6 * S, cy + 4.4 * S, cx + 2.5 * S, cy + 6.0 * S, cx, cy + 6.0 * S)
    ctx.bezierCurveTo(cx - 2.5 * S, cy + 6.0 * S, cx - 4.6 * S, cy + 4.4 * S, cx - 4.6 * S, cy + 1.0 * S)
    ctx.bezierCurveTo(cx - 4.6 * S, cy - 2.5 * S, cx - 3.0 * S, cy - 6.0 * S, cx, cy - 6.0 * S)
    ctx.closePath()
  }

  // Soft halo so the egg stays legible at low zoom / over busy tiles.
  ctx.fillStyle = 'rgba(186, 230, 253, 0.30)' // sky-200
  ctx.beginPath()
  ctx.arc(cx, cy, 10 * scale, 0, Math.PI * 2)
  ctx.fill()

  // Shell body.
  eggPath()
  ctx.fillStyle = '#edf6f3'
  ctx.fill()

  // Two green patches, clipped to the shell so neither spills past the outline.
  // Same layout as the toolbar icon: a smaller patch upper-left, a larger one
  // lower-right.
  ctx.save()
  eggPath()
  ctx.clip()
  const spot = (dx: number, dy: number, r: number, color: string): void => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  spot(-2.1 * scale, -1.8 * scale, 1.8 * scale, '#7cbf55') // lighter green, upper-left
  spot(2.0 * scale, 2.5 * scale, 2.2 * scale, '#57a544') // green, lower-right
  ctx.restore()

  // Shell outline last so it crisply bounds the patches.
  eggPath()
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 1.25 * scale
  ctx.stroke()
  ctx.restore()
}
