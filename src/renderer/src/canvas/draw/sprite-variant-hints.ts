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
// snes-framework/docs/spritestateengine.md §10.2 — currently only the spin-
// direction cases that actually change behaviour (palette-only parity variants,
// e.g. the Shy Guy palette, are not surfaced). Extend AUTO_SPIN_SPRITES / add a
// new badge for further behaviour-affecting position variants.

import type { LevelSprite, SpriteCelBounds } from '../../../../preload/api'
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

/** Placement-derived SPAWN variants: a sprite that becomes a continuous GENERATOR
 *  or spawns an extra COMPANION based on its spawn-cell parity. Per sprite: the
 *  axis + the parity that ACTIVATES the spawn (all verified in asm):
 *   - `$0E6` Gusty:        Y, odd  → generator (`init_gusty` `$7182` bit-4 → `INC $76`; spawns Gusties on a timer)
 *   - `$052` Balloon:      X, odd  → generator (`init_balloon` `$70E2` bit-4 → `INC $76` + `BalloonGeneratorActiveFlag`)
 *   - `$0E7` Burt:         X, even → spawns a paired partner (one-shot, Bank05:6183)
 *   - `$11B` Lakitu:       X, odd  → spawns a second Lakitu (one-shot, Bank07:4857)
 *   - `$166` ThunderLakitu:X, odd  → spawns a paired Thunder Lakitu (one-shot, Bank07:13414)
 *  The tile-driven pipe-spawners `$01E`/`$133`/`$19A` are Class F (sprite-neighbors.ts)
 *  and share the generator badge. NOTE: §10.2 mislabeled Gusty as pixel-X — it's Y. */
interface SpawnVariant {
  axis: 'x' | 'y'
  /** Cell parity (0 even / 1 odd) on `axis` that activates the spawn. */
  activeParity: number
  /** `generator` = continuous emitter (cyan up-chevron); `companion` = one-shot
   *  extra spawn (cyan "+"). */
  kind: 'generator' | 'companion'
}
const SPAWN_VARIANTS = new Map<number, SpawnVariant>([
  [0x0e6, { axis: 'y', activeParity: 1, kind: 'generator' }],
  [0x052, { axis: 'x', activeParity: 1, kind: 'generator' }],
  [0x0e7, { axis: 'x', activeParity: 0, kind: 'companion' }],
  [0x11b, { axis: 'x', activeParity: 1, kind: 'companion' }],
  [0x166, { axis: 'x', activeParity: 1, kind: 'companion' }]
])
/** The active spawn variant for a placed sprite, or null when it sits at the
 *  inactive (single-enemy) parity. */
function spawnVariant(sprite: LevelSprite): SpawnVariant | null {
  const v = SPAWN_VARIANTS.get(sprite.num)
  if (!v) return null
  return ((v.axis === 'x' ? sprite.x : sprite.y) & 1) === v.activeParity ? v : null
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
 *  The MANUAL clusters `$055`/`$056` rotate from Yoshi's push — no parity variant. */
const AUTO_SPIN_SPRITES = new Set([0x064, 0x15e, 0x1a0, 0x1a1, 0x101, 0x102, 0x144])

/** Which X-cell parity yields a POSITIVE rotation rate differs by sprite:
 *  cluster / Firebar / SpikyMace give ODD-X → positive; Flipper `$144` is REVERSED
 *  (EVEN-X → positive, `DATA_0D9D2A` $0080/$FF80). Which sign is *visually*
 *  clockwise can't be read from static asm (the orbit renderers are SuperFX), so
 *  it's a global calibration: positive rate maps to `CW_IS_POSITIVE`. Because
 *  direction is derived from each sprite's REAL sign (not raw parity), this one
 *  constant orients every sprite at once. Verified in-editor against the live game:
 *  positive rate spins COUNTER-clockwise, so `CW_IS_POSITIVE = false`. */
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

/** `$064` ALSO picks its orbit RADIUS from spawn-Y bit-4 (the Main branch
 *  `LDA $7182,x ; AND #$0010`): the index `$04` (0 vs 2) reads the radius from
 *  `DATA_04C56C` (dw $0010,$000C) + `DATA_04C666` (dw $0014,$0010), fed to the
 *  cluster contact test. Y-bit-4 == the Y CELL's LSB, so an ODD Y cell → $04=0 →
 *  wide ($0010) and an EVEN Y cell → $04=2 → tight ($000C). `$15E` is fixed at
 *  $04=0 (always wide), so only `$064` carries the radius variant. We encode it
 *  as the spin badge's ring SIZE — one badge shows both placement-derived
 *  variants (direction = spin, ring size = orbit radius). */
const ORBIT_RADIUS_SPRITES = new Set([0x064])
function isWideOrbit(sprite: LevelSprite): boolean {
  return (sprite.y & 1) === 1
}

/** Hidden Winged Cloud `$0B5` picks its PRIZE from spawn X+Y parity: `CODE_03C0CC`
 *  (Bank03:8784) builds index `2*(Y&1) + (X&1)` into `DATA_03C084` =
 *  {1-up, 5-stars, red-switch, 5-stars} and spawns that on pop. So the prize a
 *  cloud gives is encoded purely in its cell parity — invisible in the raw data. */
const PRIZE_CLOUD = 0x0b5
const CLOUD_PRIZE_BY_INDEX = [
  { label: '1', color: 'rgba(53, 200, 85, 1)' }, // 1-up — green
  { label: '5', color: 'rgba(238, 204, 42, 1)' }, // 5 stars — gold
  { label: '!', color: 'rgba(230, 58, 58, 1)' }, // red switch — red
  { label: '5', color: 'rgba(238, 204, 42, 1)' } // 5 stars — gold
] as const
function cloudPrize(sprite: LevelSprite): { label: string; color: string } | null {
  if (sprite.num !== PRIZE_CLOUD) return null
  return CLOUD_PRIZE_BY_INDEX[2 * (sprite.y & 1) + (sprite.x & 1)]
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
    const sv = spawnVariant(s)
    const prize = cloudPrize(s)
    if (!spin && !sv && !prize) continue
    const box = spriteOutlineBox(s, bounds)
    if (spin) {
      // Bottom-right circular arrow: direction = spin (X-cell parity), ring size =
      // orbit-radius variant ($064 wide vs tight; $15E fixed). Constant inset so
      // the badge center stays put as the ring grows/shrinks. No auto-spin sprite
      // is also a spawn-variant sprite, so this never collides with the bottom-
      // right generator/companion badge below (hex-id tag is top-left).
      const r = (ORBIT_RADIUS_SPRITES.has(s.num) ? (isWideOrbit(s) ? 6.5 : 4) : 5) / zoom
      const margin = 8 / zoom
      drawSpinArrow(ctx, box.x0 + box.w - margin, box.y0 + box.h - margin, r, isClockwise(s), zoom)
    }
    if (sv) {
      // Bottom-right cyan badge: generator (up-chevron, continuous) vs spawns-extra
      // ("+", one-shot companion). Generator badge matches the pipe-spawner.
      const bx = box.x0 + box.w - size
      const by = box.y0 + box.h - size
      if (sv.kind === 'generator') drawGeneratorBadge(ctx, bx, by, size, zoom)
      else drawSpawnsExtraBadge(ctx, bx, by, size, zoom)
    }
    if (prize) {
      // Top-right labeled badge: which prize this Winged Cloud gives (by cell parity).
      drawLabelBadge(ctx, box.x0 + box.w - size, box.y0, size, zoom, prize.color, prize.label)
    }
  }
  ctx.restore()
}
