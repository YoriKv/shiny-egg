// Always-on badges for GENERATOR sprites: a purple square (matching the
// "generator" category label color — App.css `.se-props__cat--generator`,
// #a855f7) with a thumbnail of the enemy the generator spawns inside it.
// Generator STOPPERS get the same badge plus a red X across the front.
//
// The generator→enemy map + stopper flag live in data/generator-spawns.ts; the
// enemy thumbnails are the CACHED render.pickerThumbnails bitmaps (passed in from
// useGeneratorThumbnails), converted to a <canvas> once via renderImageToCanvas
// (WeakMap-cached) so nothing re-rasterises per frame. Fixed world-space size —
// no zoom-out enlargement (that growth is reserved for the start/goal/checkpoint/
// spawn landmark glyphs). Rides the Sprites graphics layer (scene.ts).

import type { LevelSprite, RenderImage } from '../../../../preload/api'
import { CELL_PX } from '../geometry'
import { generatorSpawn } from '../../data/generator-spawns'
import { renderImageToCanvas } from '../../lib/render-image-canvas'

const GENERATOR_COLOR = '#a855f7' // purple-500 — matches .se-props__cat--generator
const BADGE_BORDER = 'rgba(0, 0, 0, 0.6)'
const STOPPER_X = '#ef4444' //       red-500 — "stopped"

const HALF = 7.5 //  15px badge — nearly fills the 16px cell, leaving a thin margin
const PADDING = 1 // inner gap so the enemy thumbnail doesn't touch the border

/** Purple square + enemy thumbnail (fit, aspect-preserved) + optional red stopper X. */
function drawGeneratorBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  thumb: RenderImage | undefined,
  stopper: boolean
): void {
  const x0 = cx - HALF
  const y0 = cy - HALF
  const size = HALF * 2
  ctx.fillStyle = GENERATOR_COLOR
  ctx.fillRect(x0, y0, size, size)
  // Enemy thumbnail, scaled to fit inside with a small margin (cached-canvas blit).
  if (thumb && thumb.width > 0 && thumb.height > 0) {
    const box = size - PADDING * 2
    const s = Math.min(box / thumb.width, box / thumb.height)
    const dw = thumb.width * s
    const dh = thumb.height * s
    ctx.drawImage(renderImageToCanvas(thumb), cx - dw / 2, cy - dh / 2, dw, dh)
  }
  ctx.lineWidth = 1
  ctx.strokeStyle = BADGE_BORDER
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1)
  if (stopper) {
    ctx.strokeStyle = STOPPER_X
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    const m = 2.5
    ctx.beginPath()
    ctx.moveTo(x0 + m, y0 + m)
    ctx.lineTo(x0 + size - m, y0 + size - m)
    ctx.moveTo(x0 + size - m, y0 + m)
    ctx.lineTo(x0 + m, y0 + size - m)
    ctx.stroke()
  }
}

/** Draw generator / stopper badges for every placed generator sprite. The table
 *  membership (generator-spawns.ts) is the gate; `thumbs` is keyed by enemy num.
 *  Gated by the `sprites` layer in scene.ts. */
export function drawGeneratorBadges(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[],
  thumbs: Map<number, RenderImage> | null
): void {
  ctx.save()
  // Smoothing on just for these badges — the enemy cel is downscaled into the
  // cell, which reads better filtered than nearest-neighbour. The outer save/
  // restore puts the canvas-wide pixel-art setting (off) back afterwards.
  ctx.imageSmoothingEnabled = true
  for (const s of sprites) {
    const gen = generatorSpawn(s.num)
    if (!gen) continue
    drawGeneratorBadge(ctx, (s.x + 0.5) * CELL_PX, (s.y + 0.5) * CELL_PX, thumbs?.get(gen.enemy), gen.stopper)
  }
  ctx.restore()
}
