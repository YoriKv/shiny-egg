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
// Only `enforce` deps draw the selection boxes/connectors (the ones the editor
// can verify); other info-only deps (keyholes, locked-door→Key) are described in
// the Properties "Neighbours" section instead, since their target isn't visible
// to a per-record check. See lib/sprite-neighbor-deps.ts + the validation harness.

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

/** Is this sprite an ACTIVE pipe-spawner — a class-F dep resolved `met` (it sits
 *  on a pipe-mouth tile, so it continuously emits copies of itself)? Drives the
 *  always-on cyan spawner badge. Not an error — class F is `enforce:false`. */
export function hasActiveSpawner(results: DepResult[] | undefined): boolean {
  return !!results?.some((r) => r.dep.cls === 'F' && r.status === 'met')
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
 *  connector, or a connector + ring to a partner sprite. */
export function drawNeighborSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  sprite: LevelSprite,
  results: DepResult[],
  zoom: number
): void {
  const from = cellCenter(sprite.x, sprite.y)
  ctx.save()
  for (const r of results) {
    if (!r.dep.enforce) continue // info-only deps are panel-only
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
