// Probe-derived behavior geometry — sprites whose Init measures the placed
// LEVEL DATA (ceiling distance, marker-tile runs, anchor tiles, rails) and
// turns the measurement into a gameplay parameter. Pure functions over a
// Map16 cell reader, mirroring lib/sprite-neighbor-deps.ts so the hook layer
// (useBehaviorProbes) can feed the same decoded layout to both.
//
// These complement the STATIC geometry in data/sprite-behavior-extents.ts:
// static marks are constants from the asm; probe marks re-measure the level
// every edit, so dragging the sprite (or editing the terrain) updates them.
//
// Engine probes are GSU routines (FXCODE_0ACDFA ceiling distance etc.); the
// cell predicates here are *approximations* documented per entry — close
// enough for an editor hint, NOT a byte-exact port. Each mark's hint says so
// where it matters.

import type { BehaviorMark } from '../data/sprite-behavior-extents'

export type Map16At = (cx: number, cy: number) => number | undefined
/** Page (Map16 id high byte) → "fully solid" (collision `flags.al`). */
export type IsSolidPage = (page: number) => boolean

export interface ProbeContext {
  map16At: Map16At
  isSolidPage: IsSolidPage
}

export interface ProbeSprite {
  num: number
  x: number
  y: number
}

/** Cells from `(x, y-1)` up to the first fully-solid cell (exclusive), or
 *  `null` when no solid cell exists within `limit` cells. Approximates the
 *  GSU ceiling probe `FXCODE_0ACDFA`. */
function ceilingDistance(ctx: ProbeContext, x: number, y: number, limit: number): number | null {
  for (let d = 1; d <= limit; d++) {
    const id = ctx.map16At(x, y - d)
    if (id === undefined) return null // ran off the grid
    if (id !== 0 && ctx.isSolidPage((id >> 8) & 0xff)) return d - 1
  }
  return null
}

const CHAIN_HINT =
  'Measured from the level data (ceiling distance) — approximate: the editor treats fully-solid collision as the ceiling, the GSU probe may differ on exotic tiles.'

/** $10C Chained Spike Ball: chain length = (19 − ceilingDistance) × 16 px
 *  (family-spikes §5, probe FXCODE_0ACDFA). The ball lowers by the chain
 *  length below the spawn anchor during its lower/bounce/climb cycle. */
function chainedSpikeBall(ctx: ProbeContext, s: ProbeSprite): BehaviorMark[] {
  const d = ceilingDistance(ctx, s.x, s.y, 19)
  if (d === null) return []
  const chainPx = Math.max(0, (19 - d) * 16)
  return [
    {
      kind: 'extent',
      label: 'Chain drop',
      axis: 'y',
      minus: 0,
      plus: chainPx,
      hint: `Chain length (19 − ${d} ceiling tiles) × 16 = ${chainPx} px. ${CHAIN_HINT}`
    }
  ]
}

/** $126 Spiked Log on Pulley: chain = (20 − d) × 16 px; stomps to ride it
 *  down = max(3, 15 − d) (family-misc §18 — placement height under the
 *  ceiling IS the difficulty parameter). */
function spikedLogOnPulley(ctx: ProbeContext, s: ProbeSprite): BehaviorMark[] {
  const d = ceilingDistance(ctx, s.x, s.y, 20)
  if (d === null) return []
  const chainPx = Math.max(0, (20 - d) * 16)
  const stomps = Math.max(3, 15 - d)
  return [
    {
      kind: 'extent',
      label: 'Pulley drop',
      axis: 'y',
      minus: 0,
      plus: chainPx,
      hint: `Chain length (20 − ${d} ceiling tiles) × 16 = ${chainPx} px; ~${stomps} stomps ride it down. ${CHAIN_HINT}`
    }
  ]
}

/** Marker tiles $00B6-$00BA: the Boo-Guys-carrying-bomb march track. */
const isMarchMarker = (id: number | undefined): boolean => id !== undefined && id >= 0x00b6 && id <= 0x00ba

/** $105/$106 Boo Guys Carrying Bomb: the Init scans the spawn row for marker
 *  tiles $00B6-$00BA; the run sets the chain count + patrol bounds
 *  (family-shyguys §4.19; neighbor-deps Class C — markers sit within ±2 cells
 *  of every shipped placement). */
function booGuysCarryingBomb(ctx: ProbeContext, s: ProbeSprite): BehaviorMark[] {
  // Find the nearest marker within ±2 cells on the spawn row, then expand.
  let seed: number | null = null
  for (const dx of [0, -1, 1, -2, 2]) {
    if (isMarchMarker(ctx.map16At(s.x + dx, s.y))) {
      seed = s.x + dx
      break
    }
  }
  if (seed === null) return []
  let lo = seed
  let hi = seed
  while (lo > 0 && isMarchMarker(ctx.map16At(lo - 1, s.y))) lo--
  while (hi < 255 && isMarchMarker(ctx.map16At(hi + 1, s.y))) hi++
  const count = hi - lo + 1
  return [
    {
      kind: 'extent',
      label: 'March track',
      axis: 'x',
      minus: (s.x - lo) * 16,
      plus: (hi + 1 - s.x) * 16,
      hint: `${count} marker tiles ($B6-$BA) — the run sets the bomb-chain length and the patrol bounds.`
    }
  ]
}

/** $190 Falling Icicle: anchor tiles $8E00-$8E02 directly above set the
 *  icicle's height (1-3 tiles); no anchor = the sprite despawns
 *  (neighbor-deps Class C validates presence; this measures the height). */
function fallingIcicle(ctx: ProbeContext, s: ProbeSprite): BehaviorMark[] {
  let h = 0
  while (h < 3) {
    const id = ctx.map16At(s.x, s.y - 1 - h)
    if (id === undefined || id < 0x8e00 || id > 0x8e02) break
    h++
  }
  if (h === 0) return []
  return [
    {
      kind: 'zone',
      label: 'Icicle body',
      x0: 0,
      y0: -h * 16,
      x1: 16,
      y1: 0,
      hint: `${h} anchor tile${h > 1 ? 's' : ''} ($8E00-$8E02) above — the icicle renders this tall and drops as one piece.`
    }
  ]
}

const PROBES: Record<number, (ctx: ProbeContext, s: ProbeSprite) => BehaviorMark[]> = {
  0x10c: chainedSpikeBall,
  0x126: spikedLogOnPulley,
  0x105: booGuysCarryingBomb,
  0x106: booGuysCarryingBomb,
  0x190: fallingIcicle
}

/** Probe-derived marks for a placed sprite (empty when the sprite has no probe
 *  or the level data doesn't support one — e.g. no ceiling in range). */
export function probeMarks(ctx: ProbeContext, s: ProbeSprite): BehaviorMark[] {
  return PROBES[s.num]?.(ctx, s) ?? []
}

/** Sprite nums with a probe (lets the hook skip levels without any). */
export function hasProbe(num: number): boolean {
  return num in PROBES || isRailFollower(num)
}

// ── Rail trace ─────────────────────────────────────────────────────────────

/** Line-guided platforms $185-$18F (neighbor-deps Class A). */
export function isRailFollower(num: number): boolean {
  return num >= 0x185 && num <= 0x18f
}

const isRailCell = (id: number | undefined): boolean => id !== undefined && (id >> 8) === 0x87

/** The connected rail component ($87xx cells, 8-connected) a rail follower
 *  rides, seeded from its own cell or the cell below (the same two candidates
 *  the neighbor-dep rail check probes). Returns packed cell indices
 *  `cy*256 + cx`, capped to keep a corrupt grid from exploding. */
export function railComponentCells(ctx: ProbeContext, s: ProbeSprite, cap = 2048): number[] {
  let seed: { cx: number; cy: number } | null = null
  for (const cand of [{ cx: s.x, cy: s.y }, { cx: s.x, cy: s.y + 1 }]) {
    if (isRailCell(ctx.map16At(cand.cx, cand.cy))) {
      seed = cand
      break
    }
  }
  if (!seed) return []
  const visited = new Set<number>()
  const queue: number[] = [seed.cy * 256 + seed.cx]
  visited.add(queue[0]!)
  const out: number[] = []
  while (queue.length > 0 && out.length < cap) {
    const cell = queue.pop()!
    out.push(cell)
    const cx = cell % 256
    const cy = (cell / 256) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx > 255 || ny > 127) continue
        const key = ny * 256 + nx
        if (visited.has(key)) continue
        visited.add(key)
        if (isRailCell(ctx.map16At(nx, ny))) queue.push(key)
      }
    }
  }
  return out
}
