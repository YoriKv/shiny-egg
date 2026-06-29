// Behavior-extent overlay (rides the Sprite-Editing / spriteOutlines layer).
// Two pieces:
//   1. SELECTION overlay — for the selected sprite, its behavior geometry from
//      data/sprite-behavior-extents.ts: trigger zones (dashed box), patrol
//      extents (segment with end ticks), orbits (dashed circle), reach domes
//      (dashed upper half-circle + base line), and the runtime-snap ghost
//      (crosshair at the position the init moves the sprite to, with a dotted
//      connector from the placed cell).
//   2. ALWAYS-ON cap warning — an amber "n/max" badge (bottom-left) on every
//      sprite whose engine instance cap (data/sprite-level-caps.ts) is
//      exceeded by the level's placed count. Warning-grade, not an error:
//      drawn before the neighbour error badge so a genuine red "!" wins the
//      corner.
// SINGLE SOURCE: geometry + caps live in the data modules; this module only
// presents them (color, dash, tick styling) — mirrors sprite-variant-hints.

import type { LevelSprite, SpriteCelBounds } from '../../../../preload/api'
import { behaviorMarks, type BehaviorMark } from '../../data/sprite-behavior-extents'
import { capStatus } from '../../data/sprite-level-caps'
import type { ProbeResult } from '../../hooks/useBehaviorProbes'
import { CELL_PX } from '../geometry'
import { spriteOutlineBox, SPRITE_LABEL_MIN_ZOOM } from './sprites'

/** Violet — behavior geometry; distinct from neighbour teal/red, badge amber,
 *  generator cyan, and the selection accent. */
const BEHAVIOR = 'rgba(167, 139, 250, 0.95)'
const WARN = 'rgba(245, 200, 60, 1)' // amber (matches the variant-hint family)

function dashed(ctx: CanvasRenderingContext2D, zoom: number): void {
  ctx.strokeStyle = BEHAVIOR
  ctx.lineWidth = 1.5 / zoom
  ctx.setLineDash([6 / zoom, 4 / zoom])
}

function drawZone(ctx: CanvasRenderingContext2D, ax: number, ay: number, m: Extract<BehaviorMark, { kind: 'zone' }>, zoom: number): void {
  dashed(ctx, zoom)
  ctx.strokeRect(ax + m.x0, ay + m.y0, m.x1 - m.x0, m.y1 - m.y0)
  ctx.setLineDash([])
}

function drawExtent(ctx: CanvasRenderingContext2D, ax: number, ay: number, m: Extract<BehaviorMark, { kind: 'extent' }>, zoom: number): void {
  // Segment through the sprite's centre, with perpendicular end ticks.
  const cx = ax + CELL_PX / 2
  const cy = ay + CELL_PX / 2
  const tick = 5 / zoom
  dashed(ctx, zoom)
  ctx.beginPath()
  if (m.axis === 'x') {
    ctx.moveTo(cx - m.minus, cy)
    ctx.lineTo(cx + m.plus, cy)
  } else {
    ctx.moveTo(cx, cy - m.minus)
    ctx.lineTo(cx, cy + m.plus)
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  if (m.axis === 'x') {
    ctx.moveTo(cx - m.minus, cy - tick)
    ctx.lineTo(cx - m.minus, cy + tick)
    ctx.moveTo(cx + m.plus, cy - tick)
    ctx.lineTo(cx + m.plus, cy + tick)
  } else {
    ctx.moveTo(cx - tick, cy - m.minus)
    ctx.lineTo(cx + tick, cy - m.minus)
    ctx.moveTo(cx - tick, cy + m.plus)
    ctx.lineTo(cx + tick, cy + m.plus)
  }
  ctx.stroke()
}

function drawOrbit(ctx: CanvasRenderingContext2D, ax: number, ay: number, m: Extract<BehaviorMark, { kind: 'orbit' }>, zoom: number): void {
  dashed(ctx, zoom)
  ctx.beginPath()
  ctx.ellipse(ax + CELL_PX / 2 + m.cx, ay + CELL_PX / 2 + m.cy, m.rx, m.ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawReach(ctx: CanvasRenderingContext2D, ax: number, ay: number, m: Extract<BehaviorMark, { kind: 'reach' }>, zoom: number): void {
  // Danger DOME: the UPPER half-circle (canvas y grows down, so the top half
  // is π…2π) plus its flat base line through the centre — a ground attacker
  // reaches up/out to here but not into the floor below.
  const cx = ax + CELL_PX / 2 + m.cx
  const cy = ay + CELL_PX / 2 + m.cy
  dashed(ctx, zoom)
  ctx.beginPath()
  ctx.ellipse(cx, cy, m.r, m.r, 0, Math.PI, Math.PI * 2)
  ctx.moveTo(cx - m.r, cy)
  ctx.lineTo(cx + m.r, cy)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawSnapGhost(ctx: CanvasRenderingContext2D, ax: number, ay: number, m: Extract<BehaviorMark, { kind: 'snap' }>, zoom: number): void {
  // Dotted connector from the placed anchor to the runtime anchor, then a
  // crosshair + small box marking where the sprite actually shows up in-game.
  ctx.strokeStyle = BEHAVIOR
  ctx.lineWidth = 1.2 / zoom
  ctx.setLineDash([2 / zoom, 3 / zoom])
  ctx.beginPath()
  ctx.moveTo(ax + CELL_PX / 2, ay + CELL_PX / 2)
  ctx.lineTo(m.px + CELL_PX / 2, m.py + CELL_PX / 2)
  ctx.stroke()
  ctx.setLineDash([])
  const r = 5 / zoom
  const cx = m.px + CELL_PX / 2
  const cy = m.py + CELL_PX / 2
  ctx.beginPath()
  ctx.moveTo(cx - r, cy)
  ctx.lineTo(cx + r, cy)
  ctx.moveTo(cx, cy - r)
  ctx.lineTo(cx, cy + r)
  ctx.stroke()
  ctx.strokeRect(m.px, m.py, CELL_PX, CELL_PX)
}

/** Selection overlay: the selected sprite's behavior geometry — the static
 *  marks from the data table plus the level-measured probe marks/rail trace
 *  (hooks/useBehaviorProbes), when supplied. Anchor = the placed cell's
 *  top-left px (the same anchor the data module's marks are relative to). */
export function drawBehaviorSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  sprite: LevelSprite,
  zoom: number,
  probe?: ProbeResult
): void {
  const marks = [...behaviorMarks(sprite.num, sprite.x, sprite.y), ...(probe?.marks ?? [])]
  if (marks.length === 0 && !probe?.railCells) return
  const ax = sprite.x * CELL_PX
  const ay = sprite.y * CELL_PX
  ctx.save()
  // Rail trace under the marks: a translucent highlight on every connected
  // $87xx rail cell the platform rides.
  if (probe?.railCells) {
    ctx.fillStyle = 'rgba(167, 139, 250, 0.18)'
    ctx.strokeStyle = BEHAVIOR
    ctx.lineWidth = 1 / zoom
    for (const cell of probe.railCells) {
      const cx = (cell % 256) * CELL_PX
      const cy = ((cell / 256) | 0) * CELL_PX
      ctx.fillRect(cx, cy, CELL_PX, CELL_PX)
    }
  }
  for (const m of marks) {
    switch (m.kind) {
      case 'zone': drawZone(ctx, ax, ay, m, zoom); break
      case 'extent': drawExtent(ctx, ax, ay, m, zoom); break
      case 'orbit': drawOrbit(ctx, ax, ay, m, zoom); break
      case 'reach': drawReach(ctx, ax, ay, m, zoom); break
      case 'snap': drawSnapGhost(ctx, ax, ay, m, zoom); break
    }
  }
  ctx.restore()
}

/** Always-on: an amber "n/max" badge (bottom-left corner of the outline box) on
 *  every sprite whose engine instance cap is exceeded by the level's placed
 *  count. Drawn BEFORE the neighbour error badge so a red "!" overdraws it. */
export function drawCapWarnings(
  ctx: CanvasRenderingContext2D,
  sprites: LevelSprite[],
  zoom: number,
  bounds: Map<number, SpriteCelBounds> | null | undefined
): void {
  if (zoom < SPRITE_LABEL_MIN_ZOOM) return // hide with the hex-id label
  const size = 12 / zoom
  ctx.save()
  for (const s of sprites) {
    const st = capStatus(s.num, sprites)
    if (!st?.exceeded) continue
    const box = spriteOutlineBox(s, bounds)
    const bx = box.x0
    const by = box.y0 + box.h - size
    ctx.fillStyle = WARN
    ctx.fillRect(bx, by, size * 1.7, size)
    ctx.lineWidth = 1 / zoom
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.strokeRect(bx + 0.5 / zoom, by + 0.5 / zoom, size * 1.7 - 1 / zoom, size - 1 / zoom)
    ctx.fillStyle = '#000000'
    ctx.font = `bold ${size * 0.72}px 'JetBrains Mono', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${st.count}/${st.cap.max}`, bx + size * 0.85, by + size / 2 + 0.5 / zoom)
  }
  ctx.restore()
}
