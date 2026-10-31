// Always-on stand-in badges for entities with no visible graphic. Two kinds
// share one badge shape:
//   • COMMAND badges (indigo, an abbreviation of the command name) for
//     command-category entities, below;
//   • RAW-ID badges (slate, the entity's hex id) for sprites the static
//     renderer can't draw (bosses, BG3-drawn platforms, …) and objects that
//     stamp no tiles, so a placement never vanishes into an empty cell.
//
// COMMAND-category entities — both sprites
// (Graphic/Palette Changers, auto-scrollers, Ground shake, …) and objects
// (Transparent tile, Scroll stopper, Tile eraser, …). These render no (or a
// clear) in-game graphic, so the editor marks each with a small square badge
// carrying a short abbreviation of its command name (e.g. "Transparent tile" →
// TT). Drawn HALF-TRANSPARENT, echoing the 50%-opacity stand-in the engine
// draws for hidden-until-interaction sprites (HIDDEN_REVEAL), so a command reads
// as "metadata here, not a real object".
//
// One badge style + one label-deriver serve both entity kinds; only the host
// layer differs (sprites ride the Sprites graphics layer next to the
// entrance/teleport glyphs; objects ride the object blueprint layer). Like the
// entrance/teleport glyphs these are FIXED world-space shapes that scale with
// the level like tiles — NO zoom-out enlargement (that growth is reserved for
// the start / goal / checkpoint / spawn landmark glyphs, via glyphZoomScale).

import type { LevelObject, LevelSprite } from '../../../../preload/api'
import { getObjectInfo, getSprite } from '../../data/obj-metadata'
import { generatorSpawn } from '../../data/generator-spawns'
import type { ObjectFootprints } from '../../hooks/useObjectCells'
import { hex } from '../../lib/hex'
import { CELL_PX } from '../geometry'
import type { SpriteBoundsMap } from '../hit-test'
import { hasEntranceGlyph } from './entrance-glyphs'
import { objectHex } from './objects'
import { isCompletionSprite } from './sprites'

const COMMAND_COLOR = '#6366f1' //        indigo-500 — "system/command" marker, distinct from the others
const RAW_ID_COLOR = '#64748b' //         slate-500 — "real entity, graphics unknown"; neutral next to the indigo commands
const COMMAND_BORDER = 'rgba(0, 0, 0, 0.7)'
const TEXT_OUTLINE = 'rgba(0, 0, 0, 0.85)'
const COMMAND_ALPHA = 0.5 // half-transparent, like the hidden-sprite (HIDDEN_REVEAL) stand-ins

// Words to drop when reducing a command name to initials.
const STOP_WORDS = new Set(['of', 'the', 'a', 'an', 'to', 'for', 'from', 'with', 'and', 'into', 'in', 'on', 'off', 'by'])

// Names whose plain initials read poorly (a leading qualifier swamps the key
// concept) get a hand-picked label; everything else falls back to initials.
const LABEL_OVERRIDES: readonly (readonly [RegExp, string])[] = [
  [/auto-scroll/i, 'AS'], //              "Extremely slow auto-scroll" / "Special auto-scroll 3" → AS
  [/lock horizontal scroll/i, 'LS'],
  [/dizzy/i, 'DZ'] //                     "Turn off dizzy effect" → DZ
]

/** Short (≤3-char) abbreviation representing a command name — the badge text.
 *  Overrides first, else the initials of the significant words (a trailing index
 *  token like "00"/"0F"/"8" and stop-words dropped). */
export function commandLabel(name: string): string {
  for (const [re, label] of LABEL_OVERRIDES) if (re.test(name)) return label
  const initials = name
    .replace(/\s+[0-9A-Fa-f]{1,2}$/, '') // drop a trailing standalone index token (Changer "00", scroll "8")
    .split(/[^A-Za-z]+/)
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()))
    .map((w) => w[0]!.toUpperCase())
    .join('')
    .slice(0, 3)
  return initials || name.trim().slice(0, 2).toUpperCase() || '?'
}

/** Half-transparent colored square + short white label, centred on (cx,cy). */
function drawStandInBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  label: string,
  color: string
): void {
  const half = 7 // ~14px square — nearly fills the 16px cell, leaving a thin margin
  ctx.save()
  ctx.globalAlpha = COMMAND_ALPHA
  ctx.fillStyle = color
  ctx.fillRect(cx - half, cy - half, half * 2, half * 2)
  ctx.lineWidth = 1
  ctx.strokeStyle = COMMAND_BORDER
  ctx.strokeRect(cx - half, cy - half, half * 2, half * 2)
  // Label — dark outline under white so it stays legible through the 50% fill.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold ${label.length >= 3 ? 5.2 : 7}px 'JetBrains Mono', monospace`
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2
  ctx.strokeStyle = TEXT_OUTLINE
  ctx.strokeText(label, cx, cy)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, cx, cy)
  ctx.restore()
}

/** Command-SPRITE badges — one per placed command-category sprite. Always on
 *  (these sprites have no cel); gated by the `sprites` layer in scene.ts. */
export function drawCommandSpriteBadges(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[]
): void {
  for (const s of sprites) {
    const info = getSprite(s.num)
    if (info.category !== 'command') continue
    drawStandInBadge(ctx, (s.x + 0.5) * CELL_PX, (s.y + 0.5) * CELL_PX, commandLabel(info.name), COMMAND_COLOR)
  }
}

/** Command-OBJECT badges — one per placed command-category object, centred on its
 *  footprint. Gated by the `bg1Outlines` (object blueprint) layer in scene.ts. */
export function drawCommandObjectBadges(
  ctx: CanvasRenderingContext2D,
  objects: LevelObject[]
): void {
  for (const o of objects) {
    const info = getObjectInfo(o.num, o.exnum)
    if (info.category !== 'command') continue
    const cx = (o.x + Math.max(1, o.w) / 2) * CELL_PX
    const cy = (o.y + Math.max(1, o.h) / 2) * CELL_PX
    drawStandInBadge(ctx, cx, cy, commandLabel(info.name), COMMAND_COLOR)
  }
}

/** Whether a placed sprite renders nothing and has no other stand-in: no cel
 *  bounds from the sprite render (the static renderer couldn't draw it), and
 *  it isn't a completion flag, entrance/teleport glyph, command or generator,
 *  which all draw their own marker. */
export function spriteNeedsRawIdBadge(s: LevelSprite, bounds: NonNullable<SpriteBoundsMap>): boolean {
  if (bounds.has(s.num)) return false
  if (isCompletionSprite(s.num) || hasEntranceGlyph(s.num) || generatorSpawn(s.num)) return false
  return getSprite(s.num).category !== 'command'
}

/** Raw-ID badges for sprites the static renderer can't draw. Skipped until the
 *  sprite render has produced its bounds (`null`), so a level that's still
 *  rendering doesn't flash a badge on every sprite. Gated by the `sprites`
 *  annotation layer in scene.ts. */
export function drawRawIdSpriteBadges(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[],
  bounds: SpriteBoundsMap
): void {
  if (!bounds) return
  for (const s of sprites) {
    if (!spriteNeedsRawIdBadge(s, bounds)) continue
    drawStandInBadge(ctx, (s.x + 0.5) * CELL_PX, (s.y + 0.5) * CELL_PX, hex(s.num, 3), RAW_ID_COLOR)
  }
}

/** Raw-ID badges for objects that stamp no tiles (an empty decode footprint) and
 *  aren't commands, centred on their box like the command badges. Skipped until
 *  the footprints have loaded. Gated by the `bg1Outlines` layer in scene.ts. */
export function drawRawIdObjectBadges(
  ctx: CanvasRenderingContext2D,
  objects: LevelObject[],
  footprints: ObjectFootprints
): void {
  if (!footprints) return
  for (const o of objects) {
    if (o.uid === undefined || (footprints.get(o.uid)?.size ?? 0) > 0) continue
    if (getObjectInfo(o.num, o.exnum).category === 'command') continue
    const cx = (o.x + Math.max(1, o.w) / 2) * CELL_PX
    const cy = (o.y + Math.max(1, o.h) / 2) * CELL_PX
    drawStandInBadge(ctx, cx, cy, objectHex(o), RAW_ID_COLOR)
  }
}
