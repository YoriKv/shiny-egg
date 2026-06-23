// Sprite neighbour-dependency visuals (ride the Sprite-Editing / spriteOutlines
// layer). Three pieces:
//   1. ALWAYS-ON error indicator — a small red "!" badge (bottom-left) on every
//      placed sprite that has an unmet ENFORCE dependency (a real, verifiable
//      error).
//   2. ALWAYS-ON spawner indicator — a cyan up-chevron badge (bottom-right) on
//      every sprite whose class-F (pipe-spawner) dep resolved `met`: the sprite
//      sits on a pipe-mouth tile, so it continuously emits copies of itself.
//      This is a behaviour annotation, NOT an error (class F is `enforce:false`).
//   3. SELECTION overlay — for the selected sprite, teal (satisfied) / red
//      (missing) boxes at the target cell + connectors to a partner sprite.
// Enforce deps draw both states; info-only deps draw POSITIVE connections only
// (met, non-own-cell target — grinder↔tree, Slugger↔ChompRock, piranha↔pipe);
// and nothing draws at the sprite's own cell when met (mouser-on-hole, spawners
// — noise; the met state is implied by the absent red badge), with ONE
// exception: a met ice-snap draws a 16x16 box at the spot the frozen enemy snaps
// to — half a tile down-and-right of its cell, centred in the ice cube. Deps
// with no resolvable target (carried Key in another record, the note
// annotations) live only in the Properties "Neighbours" section.
// See lib/sprite-neighbor-deps.ts + the validation harness.

import type { LevelSprite, SpriteCelBounds } from '../../../../preload/api'
import type { DepResult } from '../../lib/sprite-neighbor-deps'
import type { NeighborStatusMap } from '../../hooks/useNeighborDependencies'
import { CELL_PX } from '../geometry'
import { spriteOutlineBox, SPRITE_LABEL_MIN_ZOOM } from './sprites'
import { drawGeneratorBadge } from './sprite-variant-hints'

const ERROR = 'rgba(255, 28, 28, 1)' // bright saturated red — unmet enforce dep
const OK = 'rgba(45, 212, 191, 0.9)' // teal — satisfied

/** Does this sprite have at least one ENFORCE dependency that's missing? Drives
 *  the always-on error badge (and a per-sprite lint count if wanted). */
export function hasNeighborError(results: DepResult[] | undefined): boolean {
  return !!results?.some((r) => r.dep.enforce && r.status === 'missing')
}

/** Is this sprite an ACTIVE pipe-spawner — its class-F SAME-CELL dep resolved
 *  `met` (it sits on a pipe-mouth tile, so it continuously emits copies of
 *  itself)? Drives the always-on cyan spawner badge. Not an error — class F is
 *  `enforce:false`. The same-cell gate matters: class F also carries the
 *  piranha pipe-centring (offset-cell, cosmetic) and the dirt-digger notes
 *  (spatial `note`, always met) — neither is a spawner. */
export function hasActiveSpawner(results: DepResult[] | undefined): boolean {
  return !!results?.some(
    (r) => r.dep.cls === 'tile-behavior' && r.dep.spatial === 'same-cell' && r.status === 'met'
  )
}

function cellCenter(cx: number, cy: number): { x: number; y: number } {
  return { x: (cx + 0.5) * CELL_PX, y: (cy + 0.5) * CELL_PX }
}

function connector(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  color: string,
  zoom: number
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5 / zoom
  ctx.setLineDash([5 / zoom, 4 / zoom])
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.setLineDash([])
}

/** Always-on: a red "!" square in the bottom-left corner of the outline box of
 *  every sprite whose enforce dependencies aren't all satisfied. Sized + styled
 *  to mirror the hex-id tag in the top-left corner (`drawSpriteOutlines`). */
export function drawNeighborIndicators(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[],
  statusByUid: NeighborStatusMap,
  bounds: Map<number, SpriteCelBounds> | null | undefined,
  zoom: number
): void {
  if (zoom < SPRITE_LABEL_MIN_ZOOM) return // hide with the hex-id label
  const size = 12 / zoom // matches the hex-id label height (constant on-screen)
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold ${10 / zoom}px 'JetBrains Mono', monospace`
  for (const s of sprites) {
    if (s.uid === undefined) continue
    const results = statusByUid.get(s.uid)
    const error = hasNeighborError(results)
    const spawner = hasActiveSpawner(results)
    if (!error && !spawner) continue
    const box = spriteOutlineBox(s, bounds)
    if (error) {
      // bottom-left red "!" — mirrors the top-left hex-id tag.
      const x = box.x0
      const y = box.y0 + box.h - size
      ctx.fillStyle = ERROR
      ctx.fillRect(x, y, size, size)
      ctx.lineWidth = 1 / zoom
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'
      ctx.strokeRect(x + 0.5 / zoom, y + 0.5 / zoom, size - 1 / zoom, size - 1 / zoom)
      ctx.fillStyle = '#ffffff'
      ctx.fillText('!', x + size / 2, y + size / 2 + 0.5 / zoom)
    }
    if (spawner) {
      // bottom-right cyan generator badge — the sprite emits enemies out of the
      // pipe. Shared with the Gusty generator hint (see sprite-variant-hints).
      drawGeneratorBadge(ctx, box.x0 + box.w - size, box.y0 + box.h - size, size, zoom)
    }
  }
  ctx.restore()
}

/** Selection-only: for the selected sprite, draw its enforce deps — teal when
 *  satisfied, red when missing — as a box at the target/expected cell plus a
 *  connector, or a connector + ring to a partner sprite.
 *
 *  Two cross-cutting rules (one positive, one negative):
 *  - Info-only deps draw a POSITIVE connection only: met + a target that isn't
 *    at the sprite's own cell (grinder ↔ tree trunk, Slugger ↔ Chomp Rock,
 *    piranha ↔ pipe mouth, pinwheel ↔ rail below, door ↔ same-record Key).
 *    Absence is never an error, so missing info deps draw nothing.
 *  - A target at the sprite's own cell draws nothing — a box/ring under the
 *    sprite is pure noise (mouser ON its hole, pipe spawners; the met state is
 *    implied by the absent red badge). The ice-snap is the exception: it draws a
 *    16x16 box half a tile down-and-right of the cell — where the enemy snaps
 *    to, centred in the ice cube. */
export function drawNeighborSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  sprite: LevelSprite,
  results: DepResult[],
  zoom: number
): void {
  const from = cellCenter(sprite.x, sprite.y)
  ctx.save()
  for (const r of results) {
    const target = r.targetCell ?? (r.targetSprite && { cx: r.targetSprite.x, cy: r.targetSprite.y })
    const ownCell = target !== undefined && target.cx === sprite.x && target.cy === sprite.y
    if (!r.dep.enforce && (r.status !== 'met' || !target)) continue
    // ice-snap: the asm prologue CODE_02A007 offsets the sprite +8px in BOTH X
    // and Y (`& $FFF0 | $0008` on each) before writing the position back, so a
    // cell-aligned placement lands half a tile DOWN and to the RIGHT of its cell
    // — centred in the 2x2 ice cube. Draw a 16x16 dashed-teal box at that snapped
    // spot (cell origin + half a tile) to show where the frozen enemy ends up.
    // No connector — the box already sits on the selected sprite.
    if (r.dep.cls === 'ice-snap' && r.status === 'met' && r.targetCell) {
      const { cx, cy } = r.targetCell
      const inset = 1 / zoom
      const half = CELL_PX / 2 // asm snap shifts the sprite +8px (half a 16px tile) in X and Y
      ctx.strokeStyle = OK
      ctx.lineWidth = 2 / zoom
      ctx.setLineDash([4 / zoom, 3 / zoom])
      ctx.strokeRect(cx * CELL_PX + half + inset, cy * CELL_PX + half + inset, CELL_PX - 2 * inset, CELL_PX - 2 * inset)
      ctx.setLineDash([])
      continue
    }
    if (ownCell && r.status === 'met') continue
    const color = r.status === 'met' ? OK : ERROR
    const met = r.status === 'met'
    if (r.targetCell) {
      const { cx, cy } = r.targetCell
      const inset = 1 / zoom
      ctx.strokeStyle = color
      ctx.lineWidth = 2 / zoom
      ctx.setLineDash(met ? [] : [4 / zoom, 3 / zoom])
      ctx.strokeRect(cx * CELL_PX + inset, cy * CELL_PX + inset, CELL_PX - 2 * inset, CELL_PX - 2 * inset)
      ctx.setLineDash([])
      connector(ctx, from, cellCenter(cx, cy), color, zoom)
    } else if (r.targetSprite) {
      const to = cellCenter(r.targetSprite.x, r.targetSprite.y)
      connector(ctx, from, to, color, zoom)
      ctx.beginPath()
      ctx.arc(to.x, to.y, 6, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.lineWidth = 2 / zoom
      ctx.stroke()
    }
    // Missing sprite/screen deps with no target to point at are covered by the
    // always-on badge.
  }
  ctx.restore()
}
