// Sprite rendering is layered like objects: a graphics layer + an outline /
// blueprint overlay, gated by independent toolbar toggles.
//   GRAPHICS (the `sprites` layer) — the sprite's actual visual:
//     1. OAM cel pixels — sprites with a Format-B cel get real pixels from the
//        render:spriteLayer pass, composited as a back layer (drawDecodedBg1),
//        NOT a BizHawk passthrough.
//     2. Landmark glyphs — hand-authored flag markers for the level-completion
//        sprites (Goal / Boss Door / checkpoint), drawn by `drawSpriteGlyphs`.
//   OUTLINE OVERLAY (the `spriteOutlines` layer) — `drawSpriteOutlines` draws a
//     bounding box + hex-id label over EVERY sprite and carries the hover /
//     selection treatment, exactly mirroring `drawObjects` for objects. This is
//     also what gates click-to-select (see hit-test.ts).
// Ordinary sprites with no cel and no landmark glyph (triggers, generators
// $1CA-$1F4, palette/scroll changers $1BA-$1C9, other command sprites) have no
// in-game visual, so their entire representation IS the outline + id — there is
// no generic marker tier any more.
import type { LevelSprite, SpriteCelBounds } from '../../../../preload/api'
import { getSprite } from '../../data/obj-metadata'
import { CELL_PX, spriteCelBox } from '../geometry'
import { drawFlagGlyph, glyphZoomScale } from './glyphs'
import { drawAnchorDot, drawSelectionBox, HOVER_ACCENT } from './selection'
import { beginIdLabels, drawIdLabel } from './text'
import { hex } from '../../lib/hex'

/** Minimum zoom at which a sprite's outline labels (hex id / name) — and the
 *  neighbour-dependency error indicator — render; below it they'd be illegible
 *  and clutter the view. */
export const SPRITE_LABEL_MIN_ZOOM = 1.5

/**
 * Cel bounds to use for a sprite's box treatment (real click area + outline
 * box), or null when the sprite falls back to the 1-cell box. Completion
 * sprites keep their flag-landmark glyph and so report no cel; cel-less sprites
 * (generators / no-visual command sprites $1BA-$1C9) have no graphics to box.
 * Shared with hit-test so the click area always matches the drawn box.
 * `bounds` is keyed by sprite num (see `SpriteLayerResult.bounds`).
 */
export function spriteCelBoundsFor(
  s: LevelSprite,
  bounds: Map<number, SpriteCelBounds> | null | undefined
): SpriteCelBounds | null {
  if (!bounds || isCompletionSprite(s.num)) return null
  return bounds.get(s.num) ?? null
}

/**
 * Sprite IDs that complete (or partially complete) a level — they get a
 * distinct flag glyph so they're findable at a glance among dozens of
 * generic sprite outlines. Color carries the meaning:
 *   amber   = level-completion trigger (goal ring or boss door)
 *   violet  = mid-level checkpoint
 *
 * Specific sprite IDs (from `obj-metadata.json:sprites`):
 *   13  (0x00D)  Goal                       — spinning roulette ring
 *   18  (0x012)  Boss Door                  — exit from fort / castle levels
 *   79  (0x04F)  Middle ring                — checkpoint / mid-level respawn
 *   202 (0x0CA)  Boss Door of Bowser's room — final-boss exit
 */
const GOAL_SPRITE_ID = 13
const BOSS_DOOR_SPRITE_ID = 18
const MIDDLE_RING_SPRITE_ID = 79
const BOWSER_BOSS_DOOR_SPRITE_ID = 202

export function isCompletionSprite(num: number): boolean {
  return (
    num === GOAL_SPRITE_ID ||
    num === BOSS_DOOR_SPRITE_ID ||
    num === MIDDLE_RING_SPRITE_ID ||
    num === BOWSER_BOSS_DOOR_SPRITE_ID
  )
}

/** Hex tag for a sprite — 3 digits (sprite nums span 0x000–0x1F4). Shown in the
 *  outline's top-left corner at zoom, mirroring `objectHex` for objects. */
function spriteHex(s: LevelSprite): string {
  return hex(s.num, 3)
}

/** World-pixel box for a sprite: its size-matched cel box when cel-backed,
 *  else the 1-cell square at its (x, y) anchor. The single source for the
 *  drawn outline AND the hit-tests (`spriteHit` / the marquee box), so the
 *  click area provably can't drift from the drawn box. */
export function spriteOutlineBox(
  s: LevelSprite,
  bounds: Map<number, SpriteCelBounds> | null | undefined
): { x0: number; y0: number; w: number; h: number } {
  const cel = spriteCelBoundsFor(s, bounds)
  if (cel) return spriteCelBox(s.x, s.y, cel)
  return { x0: s.x * CELL_PX, y0: s.y * CELL_PX, w: CELL_PX, h: CELL_PX }
}

/**
 * Sprite GRAPHICS — the tier-2 landmark glyphs (Goal / Boss Door / checkpoint).
 * Gated by the `sprites` layer in Canvas, drawn alongside the tier-1 cel pixels
 * (drawDecodedBg1). Ordinary sprites have no glyph here; they're represented by
 * the outline overlay below. Hover / selection are NOT drawn here — those ride
 * with the outline overlay so they react to the `spriteOutlines` toggle.
 */
export function drawSpriteGlyphs(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[],
  zoom: number
): void {
  // At >= 100% scale = 1 so the glyph fits inside the sprite's 1-cell outline
  // box; below 100% it enlarges (glyphZoomScale) so the landmark stays visible
  // as the cell shrinks on screen.
  const scale = glyphZoomScale(zoom)
  ctx.save()
  for (const s of sprites) {
    if (!isCompletionSprite(s.num)) continue
    const cx = (s.x + 0.5) * CELL_PX
    const cy = (s.y + 0.5) * CELL_PX
    drawCompletionGlyph(ctx, cx, cy, s.num, scale)
  }
  ctx.restore()
}

/**
 * Sprite OUTLINE overlay — a bounding box + hex-id label over every sprite,
 * plus the hover / selection treatment. The sprite analog of `drawObjects`:
 * constant screen-width strokes (1/zoom), chartreuse on hover/selection, a
 * black-backed id tag in the top-left corner promoted to the friendly name at
 * higher zoom. Gated by the `spriteOutlines` layer in Canvas.
 */
export function drawSpriteOutlines(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[],
  hovered: LevelSprite | null,
  selectedUids: Set<number>,
  zoom: number,
  bounds: Map<number, SpriteCelBounds> | null | undefined
): void {
  const isSelected = (s: LevelSprite): boolean => s.uid != null && selectedUids.has(s.uid)
  const hoveredUid = hovered?.uid ?? -1
  ctx.save()
  ctx.lineWidth = 1 / zoom
  const inset = 0.5 / zoom // pull stroke into the integer pixel grid
  for (const s of sprites) {
    if (isSelected(s)) continue // selection drawn on top
    const box = spriteOutlineBox(s, bounds)
    // Amber by default so sprite outlines read as distinct from objects'
    // white; chartreuse on hover to match the object / exit hover style.
    ctx.strokeStyle =
      s.uid === hoveredUid ? HOVER_ACCENT : 'rgba(255, 205, 92, 0.6)'
    ctx.strokeRect(box.x0 + inset, box.y0 + inset, box.w - inset * 2, box.h - inset * 2)
  }
  ctx.restore()

  // Selection on top so its highlight is unambiguous. Shares drawObjects'
  // selection treatment via the common helper.
  for (const s of sprites) {
    if (isSelected(s)) drawSelectionBox(ctx, spriteOutlineBox(s, bounds), zoom)
  }

  // Anchor/origin dot on every sprite — the (x, y) point its cel is placed from
  // (render-sprite-layer lands the cel's (0,0) origin here). For cel-backed
  // sprites this sits inside/offset from the outline box, so it reveals the true
  // placement point; mirrors objects' drawAnchor. Emphasised on hover/selection.
  for (const s of sprites) {
    drawSpriteAnchor(ctx, s, zoom, isSelected(s) || s.uid === hoveredUid)
  }

  // Labels — hex id, promoted to the friendly name at higher zoom — only when
  // zoomed in enough to be legible. Top-left of the box, mirroring drawObjects.
  if (zoom >= SPRITE_LABEL_MIN_ZOOM) {
    const showName = zoom >= 2.5
    ctx.save()
    const adv = beginIdLabels(ctx, zoom)
    for (const s of sprites) {
      const box = spriteOutlineBox(s, bounds)
      const label = showName ? getSprite(s.num).name || spriteHex(s) : spriteHex(s)
      drawIdLabel(ctx, box.x0, box.y0, label, zoom, adv)
    }
    ctx.restore()
  }
}

/**
 * Dot at a sprite's `(x, y)` anchor — the origin point its cel is placed
 * from (`render-sprite-layer` lands the cel's `(0, 0)` here). For cel-backed
 * sprites the outline box is offset from this by the cel origin, so the dot
 * reveals where the sprite is actually anchored. Amber idle tint distinguishes
 * sprites from objects' orange (shared shape via `drawAnchorDot`).
 */
function drawSpriteAnchor(
  ctx: CanvasRenderingContext2D,
  s: LevelSprite,
  zoom: number,
  emphasis: boolean
): void {
  drawAnchorDot(ctx, s.x, s.y, zoom, emphasis, 'rgba(255, 205, 92, 0.9)')
}

/**
 * Distinctive markers for level-completion sprites — pop out of the crowd of
 * generic sprite outlines. All use the same pennant-flag shape so they read as
 * a family; the color carries the meaning:
 *   - Goal / boss doors: amber flag — primary level-completion trigger.
 *   - Middle ring (sprite 79): violet flag — mid-level checkpoint.
 */
function drawCompletionGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spriteNum: number,
  scale: number
): void {
  if (
    spriteNum === GOAL_SPRITE_ID ||
    spriteNum === BOSS_DOOR_SPRITE_ID ||
    spriteNum === BOWSER_BOSS_DOOR_SPRITE_ID
  ) {
    drawFlagGlyph(ctx, cx, cy, '#fbbf24', 'rgba(251, 191, 36, 0.32)', scale) // amber-400
  } else if (spriteNum === MIDDLE_RING_SPRITE_ID) {
    drawFlagGlyph(ctx, cx, cy, '#a78bfa', 'rgba(167, 139, 250, 0.30)', scale) // violet-400
  }
}
