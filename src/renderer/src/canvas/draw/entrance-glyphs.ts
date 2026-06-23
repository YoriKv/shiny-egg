// Always-on graphic glyphs for the invisible "entrance" / "teleport" sprites.
// These sprites have no in-game cel (empty spriteset — they're invisible
// exit-triggers), so the editor stands in a drawn icon as their sole graphic.
// Four DIRECTIONAL entrances get a red arrow (black outline) centred on the
// entrance tile, pointing the way Yoshi travels through it (right/left/down/down);
// the Teleport sprite ($084) gets a red portal disc with a white swirl.
//
// Rides the Sprites GRAPHICS layer (drawn next to the completion-flag glyphs in
// scene.ts), so it toggles with Show/Hide Sprites and is independent of the
// outline + hex-id (the Sprite Editing layer). These are FIXED world-space
// shapes that scale with the level like tiles — deliberately NOT zoom-out
// enlarged: that growth (glyphZoomScale) is reserved for the start / goal /
// checkpoint / spawn landmark glyphs, which must stay findable at any zoom.
//
// $042 (Vertical pipe entrance) and $0D1 (Hidden entrance, revealed by an !
// switch) share the "down" arrow; $0D1 is hidden in-game, so it draws at 50%
// opacity — the same hidden-sprite idiom as engine sprite-parity.ts
// HIDDEN_REVEAL (which $0D1 once used to borrow the $14D "Arrow cloud, down" cel
// before this cleaner shared icon replaced it).

import type { LevelSprite } from '../../../../preload/api'
import { CELL_PX } from '../geometry'

type EntranceDir = 'right' | 'left' | 'down'

/** Entrance sprites whose only editor visual is a directional arrow (the way you
 *  travel through the entrance). All three are invisible exit-triggers in-game. */
const ENTRANCE_ARROWS: Readonly<Record<number, EntranceDir>> = {
  0x0d0: 'right', // Horizontal entrance, towards right
  0x147: 'left', //  Horizontal entrance, towards left
  0x042: 'down', //  Vertical pipe entrance — drop down
  0x0d1: 'down' //   Hidden entrance (! switch) — drops down (drawn at 50% opacity)
}

/** Entrance sprites that are HIDDEN in-game (revealed by an event) — drawn at
 *  half opacity, matching the "hidden sprite renders at 50%" idiom used
 *  elsewhere (engine sprite-parity.ts HIDDEN_REVEAL). */
const HIDDEN_ENTRANCES: ReadonlySet<number> = new Set([0x0d1])

const TELEPORT_SPRITE = 0x084 // "Teleport sprite" — invisible warp trigger

const ARROW_FILL = '#ef4444' //    red-500 — vivid entrance/teleport marker
const ARROW_OUTLINE = '#000000' // black outline so it reads over any tile
const DISC_BORDER = ARROW_OUTLINE // solid black outline, same weight as the arrows

/** Filled colour disc + solid black outline centred on (cx,cy) — the shared backing
 *  every entrance/teleport glyph draws first, so the white mark on top reads over
 *  any tile. Mirrors the prize badge family (filled fill + dark edge + white mark). */
function drawDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string
): void {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = 1.2 // matches the entrance arrows' black outline weight
  ctx.strokeStyle = DISC_BORDER
  ctx.stroke()
}

/** Red arrow (black outline) centred on the entrance tile, pointing the way Yoshi
 *  travels through it (`dir`). Drawn on the tile itself, so it sits inside the
 *  sprite's 1-cell selection box. The arrow polygon is authored pointing +x and
 *  rotated for direction (right → 0, down → +90°, left → 180°). */
function drawEntranceArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: EntranceDir
): void {
  const cx = (x + 0.5) * CELL_PX
  const cy = (y + 0.5) * CELL_PX
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(dir === 'right' ? 0 : dir === 'down' ? Math.PI / 2 : Math.PI)
  // Arrow pointing +x, roughly centred on the origin (so it stays put when rotated).
  ctx.beginPath()
  ctx.moveTo(-6.5, -2.2)
  ctx.lineTo(1.5, -2.2)
  ctx.lineTo(1.5, -5)
  ctx.lineTo(6.5, 0)
  ctx.lineTo(1.5, 5)
  ctx.lineTo(1.5, 2.2)
  ctx.lineTo(-6.5, 2.2)
  ctx.closePath()
  ctx.fillStyle = ARROW_FILL
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 1.2
  ctx.strokeStyle = ARROW_OUTLINE
  ctx.stroke()
  ctx.restore()
}

/** Red disc + white portal swirl (an Archimedean spiral) — reads as "teleport".
 *  Shares the entrance arrows' red so the warp markers read as one family. */
function drawTeleportGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number
): void {
  drawDisc(ctx, cx, cy, 8.5, ARROW_FILL)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // ~2.25-turn spiral growing to radius 6 — a compact swirl that reads as a portal.
  const maxAngle = 2.25 * Math.PI * 2
  const gain = 6 / maxAngle
  ctx.beginPath()
  for (let a = 0; a <= maxAngle; a += 0.18) {
    const r = gain * a
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (a === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * Draw the entrance-arrow / teleport glyphs for every placed entrance/teleport
 * sprite. Always on (these are the sprite's only graphic) — no zoom gate, like
 * the completion-flag glyphs. Gated by the `sprites` layer in scene.ts.
 */
export function drawEntranceGlyphs(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[]
): void {
  ctx.save()
  for (const s of sprites) {
    const dir = ENTRANCE_ARROWS[s.num]
    if (dir) {
      // Hidden entrances draw their arrow at half opacity (the shared hidden-
      // sprite idiom); visible ones at full opacity.
      ctx.globalAlpha = HIDDEN_ENTRANCES.has(s.num) ? 0.5 : 1
      drawEntranceArrow(ctx, s.x, s.y, dir)
    } else if (s.num === TELEPORT_SPRITE) {
      ctx.globalAlpha = 1
      drawTeleportGlyph(ctx, (s.x + 0.5) * CELL_PX, (s.y + 0.5) * CELL_PX)
    }
  }
  ctx.restore()
}
