// Render-validity canvas markers: a magenta/black "missing texture" checker
// badge in the TOP-RIGHT corner of an entity's outline box, on every placed
// object whose probe verdict is `invalid` (its stamped tiles have no graphics
// under the current header — e.g. after a HeaderPanel tileset change) and
// every placed sprite whose required spriteset file(s) are absent. Rides the
// same layers as the outlines it annotates (bg1Outlines / spriteOutlines) and
// is deliberately distinct from the neighbour-deps red "!" (bottom-left):
// "needs neighbour" ≠ "gfx missing". Drawn AFTER the variant hints so it
// covers the (rare) top-right Winged-Cloud prize badge — error beats hint.
// Only definite failures mark; `degraded`/`unknown` stay quiet here (the bg1
// layer itself shows partial breakage, and the picker carries amber badges).

import type { LevelObject, LevelSprite, SpriteCelBounds } from '../../../../preload/api'
import type { EntityValidityView } from '../../hooks/useEntityRenderValidity'
import { objectVisualBox } from '../geometry'
import { spriteOutlineBox, SPRITE_LABEL_MIN_ZOOM } from './sprites'

const MAGENTA = '#d136d1'
const DARK = '#16181b'

/** The classic missing-texture motif: a 2×2 magenta/black checker tile, sized
 *  + outlined to mirror the other corner badges (hex-id tag, red "!"). */
function drawGfxMissingBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  zoom: number
): void {
  const half = size / 2
  ctx.fillStyle = MAGENTA
  ctx.fillRect(x, y, size, size)
  ctx.fillStyle = DARK
  ctx.fillRect(x + half, y, half, half)
  ctx.fillRect(x, y + half, half, half)
  ctx.lineWidth = 1 / zoom
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.strokeRect(x + 0.5 / zoom, y + 0.5 / zoom, size - 1 / zoom, size - 1 / zoom)
}

/** Badge every object whose verdict under the current header is `invalid`. */
export function drawObjectValidityIndicators(
  ctx: CanvasRenderingContext2D,
  objects: LevelObject[],
  validity: EntityValidityView,
  zoom: number
): void {
  if (zoom < SPRITE_LABEL_MIN_ZOOM) return // hide with the id labels/badges
  const size = 12 / zoom
  ctx.save()
  for (const o of objects) {
    if (validity.objectVerdict(o.num, o.exnum) !== 'invalid') continue
    const box = objectVisualBox(o)
    drawGfxMissingBadge(ctx, box.x0 + box.w - size, box.y0, size, zoom)
  }
  ctx.restore()
}

/** Badge every sprite whose required spriteset file(s) are absent. */
export function drawSpriteValidityIndicators(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[],
  validity: EntityValidityView,
  bounds: Map<number, SpriteCelBounds> | null | undefined,
  zoom: number
): void {
  if (zoom < SPRITE_LABEL_MIN_ZOOM) return
  const size = 12 / zoom
  ctx.save()
  for (const s of sprites) {
    if (validity.spriteValidity(s.num).verdict !== 'missing-gfx') continue
    const box = spriteOutlineBox(s, bounds)
    drawGfxMissingBadge(ctx, box.x0 + box.w - size, box.y0, size, zoom)
  }
  ctx.restore()
}
