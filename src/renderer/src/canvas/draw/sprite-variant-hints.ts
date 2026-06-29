// Placement-derived sprite VARIANT hints (ride the Sprite-Editing / spriteOutlines
// layer). Some sprites pick a behaviour variant from their spawn POSITION rather
// than a field — most famously the auto-rotating "pinwheel" platform clusters:
// $064/$15E set spin direction from their X-cell parity, and $064 additionally
// sets its orbit RADIUS from its Y-cell parity. These relationships are invisible
// in the raw data (moving the sprite one cell over flips the behaviour), so the
// editor surfaces them as a small on-outline badge — a circular arrow whose
// direction = spin and ring size = orbit radius.
//
// This is the "Pattern A: position-derived" family from
// snes-framework/docs/spritestateengine.md §10.2 — the behaviour-affecting
// cases only (palette-only parity variants, e.g. the Shy Guy palette, are not
// surfaced). SINGLE SOURCE: every per-sprite parity mapping lives in
// data/sprite-parity-variants.ts (which also feeds the Properties panel rows);
// this module only derives badges from it — direction arrow, generator/
// companion chevron-plus, orbit ring size — plus the one truly draw-side family,
// AUTO_SPIN_SPRITES (its rate-sign→clockwise calibration is about rendering, not
// data). Add new parity variants to the data table, not here. (Prizes are NOT a
// badge here — `drawSpritePrize` draws a half-tile circular, selection-only icon
// above the sprite from data/sprite-prizes.ts.)

import type { LevelSprite, SpriteCelBounds } from '../../../../preload/api'
import {
  parityDirection,
  parityOrbitWide,
  paritySpawnBadge,
  type ParityDirection
} from '../../data/sprite-parity-variants'
import { spriteOutlineBox, SPRITE_LABEL_MIN_ZOOM } from './sprites'
import { CELL_PX } from '../geometry'
import { spritePrizeAt, SPRITE_PRIZE_STYLE } from '../../data/sprite-prizes'

const SPIN = 'rgba(245, 200, 60, 1)' // amber — distinct from error red + generator cyan
const GENERATOR_CYAN = 'rgba(34, 211, 238, 1)' // bright cyan — sprite is a generator (emits enemies)

/** Shared badge background: a `size`×`size` filled square with a thin black
 *  border (constant screen-width, top-left at (x,y)). Every variant badge draws
 *  this first, then its own white mark on top — so the family reads identically. */
function drawBadgeBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  zoom: number,
  fill: string
): void {
  ctx.fillStyle = fill
  ctx.fillRect(x, y, size, size)
  ctx.lineWidth = 1 / zoom
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.strokeRect(x + 0.5 / zoom, y + 0.5 / zoom, size - 1 / zoom, size - 1 / zoom)
}

/** Round cousin of drawBadgeBox: a filled circle of `diameter` centred at (cx,cy)
 *  with the same thin constant-screen-width black border. Used by the selection-only
 *  prize icon so it reads as a distinct, lighter-weight marker than the square hint
 *  badges. */
function drawBadgeCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  diameter: number,
  zoom: number,
  fill: string
): void {
  const r = diameter / 2
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 1 / zoom
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.beginPath()
  ctx.arc(cx, cy, r - 0.5 / zoom, 0, Math.PI * 2)
  ctx.stroke()
}

/** Selection-only: a HALF-TILE CIRCULAR prize icon centred on the cell ABOVE each selected
 *  prize-bearing sprite, showing what it releases when popped/triggered (sprite-prizes.ts). This
 *  is the ONLY prize indicator — it replaced the old always-on corner badge: placement-positioned,
 *  selection-gated, and it covers EVERY prize sprite (Winged Clouds incl. single-prize ones, plus
 *  the $161 defeat-all reward). Parity entries ($067/$0B5/$161) index by the placed cell. */
export function drawSpritePrize(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[],
  selSprUids: Set<number>,
  zoom: number
): void {
  if (zoom < SPRITE_LABEL_MIN_ZOOM) return
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const diameter = CELL_PX / 2 // half-tile circular badge
  for (const s of sprites) {
    if (s.uid === undefined || !selSprUids.has(s.uid)) continue
    const prize = spritePrizeAt(s.num, s.x, s.y)
    if (!prize) continue
    const style = SPRITE_PRIZE_STYLE[prize]
    // Centred in the tile directly above the cloud (same centre the full-tile square used).
    const cx = s.x * CELL_PX + CELL_PX / 2
    const cy = (s.y - 1) * CELL_PX + CELL_PX / 2
    drawBadgeCircle(ctx, cx, cy, diameter, zoom, style.color)
    // Single-glyph prizes (★ / ¢ / ! / ?) read large; 3-char labels shrink to fit the circle
    // (its inscribed square is ~0.71× the diameter, so 3-char text rides smaller than in a box).
    ctx.font = `bold ${diameter * (style.label.length <= 1 ? 0.66 : 0.34)}px 'JetBrains Mono', monospace`
    const ty = cy + 0.5 / zoom
    // Dark outline under the white glyph so the label stays legible over any badge color
    // (constant screen-width stroke, rounded joins so it hugs the glyph cleanly).
    ctx.lineWidth = 2 / zoom
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
    ctx.strokeText(style.label, cx, ty)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(style.label, cx, ty)
  }
  ctx.restore()
}

/** A small cyan "generator" badge (filled square + white up-chevron) with its
 *  top-left at (x,y), `size`×`size`. Means "this sprite continuously emits
 *  enemies." Shared by the pipe-spawner indicator (sprite-neighbors.ts, class F)
 *  and the Gusty generator hint below, so both generator kinds read identically. */
export function drawGeneratorBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  zoom: number
): void {
  drawBadgeBox(ctx, x, y, size, zoom, GENERATOR_CYAN)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5 / zoom
  const pad = size * 0.28
  ctx.beginPath()
  ctx.moveTo(x + pad, y + size - pad)
  ctx.lineTo(x + size / 2, y + pad)
  ctx.lineTo(x + size - pad, y + size - pad)
  ctx.stroke()
}

/** A small cyan "spawns one extra" badge (filled square + white "+") — the
 *  one-shot companion-spawn cousin of the continuous generator badge (up-chevron). */
export function drawSpawnsExtraBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  zoom: number
): void {
  drawBadgeBox(ctx, x, y, size, zoom, GENERATOR_CYAN)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5 / zoom
  const m = size * 0.3
  ctx.beginPath()
  ctx.moveTo(x + m, y + size / 2)
  ctx.lineTo(x + size - m, y + size / 2)
  ctx.moveTo(x + size / 2, y + m)
  ctx.lineTo(x + size / 2, y + size - m)
  ctx.stroke()
}

/** Sprites whose ROTATION DIRECTION is chosen by spawn-X-cell parity — the init
 *  reads `$70E2` bit-4 (== the X CELL's LSB, since spawn expands tile→pixel ×16)
 *  and indexes a signed rotation-rate. Verified families:
 *   - `$064`/`$15E` rotating-platform cluster (`DATA_04C242` $80/$7F → `$19` sign)
 *   - `$1A0`/`$1A1` Firebar      (`DATA_0CA00B` $FF00/$0100 → `$78`, Bank0C:4316)
 *   - `$101`/`$102` SpikyMace    (±2 → `GenericTable701900`, Bank0D:82)
 *   - `$135`/`$136` CirclingRaven (`init_small_raven` Bank0D:3162 — bit 4 of
 *     (X−8) → `$7400` facing 0/2; facing left walks its block anticlockwise.
 *     The metadata names pin the orientation: "anticlockwise / clockwise" in
 *     even/odd order.)
 *  The MANUAL clusters `$055`/`$056` rotate from Yoshi's push — no parity variant. */
// NB: $144 is NOT here — it's a right/left FLIPPER (X-parity → $7A36 ±$80 → a 90° orientation,
// not a spin), so it carries a left/right Direction parity variant instead (sprite-parity-variants).
const AUTO_SPIN_SPRITES = new Set([0x064, 0x15e, 0x1a0, 0x1a1, 0x101, 0x102, 0x135, 0x136])

/** Which X-cell parity yields a POSITIVE rotation rate differs by sprite:
 *  cluster / Firebar / SpikyMace give ODD-X → positive. (The $144 flipper was once here as
 *  "reversed", but it's a right/left orientation, not a spin — moved to a Direction parity
 *  variant.) Which sign is *visually*
 *  clockwise can't be read from static asm (the orbit renderers are SuperFX), so
 *  it's a global calibration: positive rate maps to `CW_IS_POSITIVE`. Because
 *  direction is derived from each sprite's REAL sign (not raw parity), this one
 *  constant orients every sprite at once. Verified in-editor against the live game:
 *  positive rate spins COUNTER-clockwise, so `CW_IS_POSITIVE = false`.
 *  The ravens `$135`/`$136` have no signed rate (their "direction" is a facing);
 *  odd-X = clockwise, which under `CW_IS_POSITIVE = false` means they belong
 *  OUTSIDE this set (odd → rate-negative → clockwise). */
const ODD_X_POSITIVE_RATE = new Set([0x064, 0x15e, 0x1a0, 0x1a1, 0x101, 0x102])
const CW_IS_POSITIVE = false
function isClockwise(sprite: LevelSprite): boolean {
  const positiveRate = ((sprite.x & 1) === 1) === ODD_X_POSITIVE_RATE.has(sprite.num)
  return positiveRate === CW_IS_POSITIVE
}

/** Placement-derived spin direction for a sprite, or null when it isn't one of
 *  the auto-spin families. The Properties panel surfaces this as a read-only row
 *  next to the on-outline badge; both read the same X-cell parity, so they always
 *  agree. `'cw'` = clockwise (the same best-effort guess the badge draws). */
export function spriteSpinDirection(sprite: LevelSprite): 'cw' | 'ccw' | null {
  if (!AUTO_SPIN_SPRITES.has(sprite.num)) return null
  return isClockwise(sprite) ? 'cw' : 'ccw'
}

/** A straight arrow at (cx,cy) pointing `dir` — the linear-direction cousin of
 *  the spin arrow (same amber, same bottom-right anchor): which way a
 *  parity-directed sprite initially travels/faces (left/right) or bobs/sweeps
 *  (up/down). Directions come from `parityDirection` (data-driven, asm-verified
 *  [even, odd] mappings), so the badge always agrees with the Properties
 *  panel's Direction row. */
function drawDirectionArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: ParityDirection,
  zoom: number
): void {
  ctx.strokeStyle = SPIN
  ctx.fillStyle = SPIN
  ctx.lineWidth = 1.6 / zoom
  const half = 5.5 / zoom
  const horiz = dir === 'left' || dir === 'right'
  const sign = dir === 'right' || dir === 'down' ? 1 : -1
  const tipX = cx + (horiz ? sign * half : 0)
  const tipY = cy + (horiz ? 0 : sign * half)
  ctx.beginPath()
  ctx.moveTo(cx - (horiz ? sign * half : 0), cy - (horiz ? 0 : sign * half))
  ctx.lineTo(tipX, tipY)
  ctx.stroke()
  // Arrowhead: two barbs swept back from the tip.
  const ang = horiz ? (sign > 0 ? 0 : Math.PI) : sign > 0 ? Math.PI / 2 : -Math.PI / 2
  const ah = 3.4 / zoom
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(tipX + Math.cos(ang + 2.6) * ah, tipY + Math.sin(ang + 2.6) * ah)
  ctx.lineTo(tipX + Math.cos(ang - 2.6) * ah, tipY + Math.sin(ang - 2.6) * ah)
  ctx.closePath()
  ctx.fill()
}

/** A circular arrow (≈270° arc + tangent arrowhead) at (cx,cy), spinning `cw`. */
function drawSpinArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cw: boolean, zoom: number): void {
  ctx.strokeStyle = SPIN
  ctx.fillStyle = SPIN
  ctx.lineWidth = 1.6 / zoom
  const a0 = -Math.PI / 2 // start at top
  const sweep = Math.PI * 1.5 // 270°
  const a1 = cw ? a0 + sweep : a0 - sweep
  ctx.beginPath()
  ctx.arc(cx, cy, r, a0, a1, !cw) // canvas y-down: increasing angle = visually clockwise
  ctx.stroke()
  // Arrowhead at the arc end, pointing along the direction of travel (tangent).
  const ex = cx + Math.cos(a1) * r
  const ey = cy + Math.sin(a1) * r
  const tang = cw ? a1 + Math.PI / 2 : a1 - Math.PI / 2
  const ah = 3.4 / zoom
  ctx.beginPath()
  ctx.moveTo(ex + Math.cos(tang) * ah, ey + Math.sin(tang) * ah)
  ctx.lineTo(ex + Math.cos(tang + 2.4) * ah, ey + Math.sin(tang + 2.4) * ah)
  ctx.lineTo(ex + Math.cos(tang - 2.4) * ah, ey + Math.sin(tang - 2.4) * ah)
  ctx.closePath()
  ctx.fill()
}

/** Draw position-derived variant badges for every placed sprite that has one.
 *  Hidden below the label zoom (with the hex-id tag), matching the other
 *  on-outline indicators. */
export function drawSpriteVariantHints(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[],
  zoom: number,
  bounds: Map<number, SpriteCelBounds> | null | undefined
): void {
  if (zoom < SPRITE_LABEL_MIN_ZOOM) return
  const size = 12 / zoom // generator badge size (matches the hex-id + pipe-spawner badge)
  ctx.save()
  for (const s of sprites) {
    const spin = AUTO_SPIN_SPRITES.has(s.num)
    const badge = paritySpawnBadge(s.num, s.x, s.y)
    const dir = parityDirection(s.num, s.x, s.y)
    if (!spin && !badge && !dir) continue
    const box = spriteOutlineBox(s, bounds)
    if (dir) {
      // Bottom-right straight arrow: initial travel/facing (left/right) or
      // bob/sweep phase (up/down) from the parity-direction table. The
      // direction families are disjoint from the auto-spin / spawn-variant /
      // prize sets, so the anchor never collides.
      const margin = 8 / zoom
      drawDirectionArrow(ctx, box.x0 + box.w - margin, box.y0 + box.h - margin, dir, zoom)
    }
    if (spin) {
      // Bottom-right circular arrow: direction = spin (X-cell parity), ring size =
      // orbit-radius variant ($064 wide vs tight; $15E fixed). Constant inset so
      // the badge center stays put as the ring grows/shrinks. No auto-spin sprite
      // is also a spawn-variant sprite, so this never collides with the bottom-
      // right generator/companion badge below (hex-id tag is top-left).
      const wide = parityOrbitWide(s.num, s.x, s.y)
      const r = (wide === null ? 5 : wide ? 6.5 : 4) / zoom
      const margin = 8 / zoom
      drawSpinArrow(ctx, box.x0 + box.w - margin, box.y0 + box.h - margin, r, isClockwise(s), zoom)
    }
    if (badge) {
      // Bottom-right cyan badge: generator (up-chevron, continuous) vs spawns-extra
      // ("+", one-shot companion). Generator badge matches the pipe-spawner.
      const bx = box.x0 + box.w - size
      const by = box.y0 + box.h - size
      if (badge === 'generator') drawGeneratorBadge(ctx, bx, by, size, zoom)
      else drawSpawnsExtraBadge(ctx, bx, by, size, zoom)
    }
    // (Prize is no longer a corner badge — see drawSpritePrize: a full-tile icon above the
    //  sprite, shown only on selection, covering every prize-bearing sprite.)
  }
  ctx.restore()
}
