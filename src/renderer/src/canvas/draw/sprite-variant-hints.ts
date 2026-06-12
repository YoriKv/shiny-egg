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
// companion chevron-plus, prize glyph, orbit ring size — plus the one truly
// draw-side family, AUTO_SPIN_SPRITES (its rate-sign→clockwise calibration is
// about rendering, not data). Add new parity variants to the data table, not
// here.

import type { LevelSprite, SpriteCelBounds } from '../../../../preload/api'
import {
  parityDirection,
  parityOrbitWide,
  parityPrize,
  paritySpawnBadge,
  type ParityDirection,
  type ParityPrizeKind
} from '../../data/sprite-parity-variants'
import { spriteOutlineBox, SPRITE_LABEL_MIN_ZOOM } from './sprites'

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
 *   - `$144` Flipper            (`DATA_0D9D2A` $0080/$FF80 → `$7A36`, Bank0D:3820)
 *   - `$135`/`$136` CirclingRaven (`init_small_raven` Bank0D:3162 — bit 4 of
 *     (X−8) → `$7400` facing 0/2; facing left walks its block anticlockwise.
 *     The metadata names pin the orientation: "anticlockwise / clockwise" in
 *     even/odd order.)
 *  The MANUAL clusters `$055`/`$056` rotate from Yoshi's push — no parity variant. */
const AUTO_SPIN_SPRITES = new Set([0x064, 0x15e, 0x1a0, 0x1a1, 0x101, 0x102, 0x144, 0x135, 0x136])

/** Which X-cell parity yields a POSITIVE rotation rate differs by sprite:
 *  cluster / Firebar / SpikyMace give ODD-X → positive; Flipper `$144` is REVERSED
 *  (EVEN-X → positive, `DATA_0D9D2A` $0080/$FF80). Which sign is *visually*
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

/** Prize-kind presentation (glyph + colour) for the prize badge — the KIND is
 *  data (parityPrize, from the parity-variant table); how it looks lives here. */
const PRIZE_STYLE: Record<ParityPrizeKind, { label: string; color: string }> = {
  '1up': { label: '1', color: 'rgba(53, 200, 85, 1)' }, // green
  stars: { label: '5', color: 'rgba(238, 204, 42, 1)' }, // gold
  switch: { label: '!', color: 'rgba(230, 58, 58, 1)' }, // red
  sunflower: { label: 'S', color: 'rgba(245, 158, 11, 1)' }, // orange ($067's 6-leaf sunflower)
  flower: { label: 'F', color: 'rgba(236, 72, 153, 1)' }, // pink
  coin: { label: 'C', color: 'rgba(238, 204, 42, 1)' }, // gold (label disambiguates vs stars)
  key: { label: 'K', color: 'rgba(148, 163, 184, 1)' }, // slate
  door: { label: 'D', color: 'rgba(168, 121, 80, 1)' } // wood brown
}

/** A small filled badge with a 1-char white label (the prize indicator). */
function drawLabelBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  zoom: number,
  color: string,
  label: string
): void {
  drawBadgeBox(ctx, x, y, size, zoom, color)
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${size * 0.78}px 'JetBrains Mono', monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + size / 2, y + size / 2 + 0.5 / zoom)
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
    const prizeKind = parityPrize(s.num, s.x, s.y)
    const dir = parityDirection(s.num, s.x, s.y)
    if (!spin && !badge && !prizeKind && !dir) continue
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
    if (prizeKind) {
      // Top-right labeled badge: which prize this Winged Cloud gives (by cell parity).
      const style = PRIZE_STYLE[prizeKind]
      drawLabelBadge(ctx, box.x0 + box.w - size, box.y0, size, zoom, style.color, style.label)
    }
  }
  ctx.restore()
}
