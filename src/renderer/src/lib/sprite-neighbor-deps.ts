// Pure neighbour-dependency resolver. Given a placed sprite + one of its
// `SpriteNeighborDep` records + a level context, decide whether the required
// neighbour is present (`met`) or absent (`missing`). Shared verbatim by the
// editor overlay (renderer) and the validation harness
// (snes-framework/scripts/engine/validate-neighbor-deps.ts) so both judge a
// dependency identically — the harness pins zero false `missing` across every
// shipped level.
//
// DOM- and Node-free: the only metadata coupling is a TYPE import (erased at
// runtime), so node can load this directly. All geometry is in 16px tile cells
// (the units of LevelSprite.x / .y).

import type { SpriteNeighborDep } from '../data/obj-metadata'

export type DepStatus = 'met' | 'missing'

export interface PlacedSprite {
  num: number
  /** Tile-grid cell X (0..255). */
  x: number
  /** Tile-grid cell Y (0..127). */
  y: number
}

export interface NeighborContext {
  /** Every placed sprite in the level (including the one under test). */
  sprites: PlacedSprite[]
  /** Map16 id (16-bit) at a tile cell, or `undefined` when the cell is out of
   *  range / on an unallocated screen. */
  map16At: (cx: number, cy: number) => number | undefined
  /** Does the level set a screen-exit row for this screen (0x00–0x7F)? */
  hasExitForScreen: (screenIndex: number) => boolean
  /** Map16 page (high byte, 0..167) → collision secondary-tag (0..31), or
   *  undefined when the page is out of the cart table. Class-F (pipe-spawner)
   *  only — the resolver matches a cell's page against `dep.collisionTag`.
   *  Optional: a context with no class-F dep can omit it; the `tileLiterals`
   *  fallback still resolves the common $79F1/$79F2 pipe mouth without it. */
  collisionTagOfPage?: (page: number) => number | undefined
}

export interface DepResult {
  dep: SpriteNeighborDep
  status: DepStatus
  /** Cell the target sits at (when `met`) or is expected at (when `missing`) —
   *  only for cell-spatial deps (`same-cell` / `offset-cell` / `path`). The
   *  editor draws the expected-location marker here. */
  targetCell?: { cx: number; cy: number }
  /** The partner sprite that satisfied a sprite-target dep, if any. */
  targetSprite?: PlacedSprite
}

/** Screen index (`(row<<4)|col`, 0x00–0x7F) containing tile cell (cx, cy) —
 *  matches canvas/geometry `screenOf` and the ScreenExit.screenIndex encoding. */
export function screenOfCell(cx: number, cy: number): number {
  return (((cy >> 4) & 0x0f) << 4) | ((cx >> 4) & 0x0f)
}

function tileMatches(id: number | undefined, m: { mask: string; value: string }): boolean {
  if (id === undefined) return false
  return (id & parseInt(m.mask, 16)) === parseInt(m.value, 16)
}

/** True if the Map16 id at a cell satisfies a tile-target dep — via its
 *  `tileMatch` mask/value, OR (class F) any of its `tileLiterals`, OR (class F)
 *  its page's collision secondary-tag equalling `collisionTag`. Mirrors the asm
 *  gate `CODE_0EB8AE` (tile == $79F1/$79F2 || page-tag == $14). */
function cellTargetMatches(
  id: number | undefined,
  dep: SpriteNeighborDep,
  ctx: NeighborContext
): boolean {
  if (id === undefined) return false
  if (dep.tileMatch && tileMatches(id, dep.tileMatch)) return true
  if (dep.tileLiterals?.some((h) => id === parseInt(h, 16))) return true
  if (dep.collisionTag != null && ctx.collisionTagOfPage) {
    const tag = ctx.collisionTagOfPage((id >> 8) & 0xff)
    if (tag !== undefined && tag === parseInt(dep.collisionTag, 16)) return true
  }
  return false
}

/** Default own-column downward read depth for a class-A rail follower. The GSU
 *  walker (CODE_0B8C44) reads a SINGLE cell — the platform's own column at its
 *  foot (own cell or just below), so the check is COLUMN-restricted, not a
 *  radius: moving a platform off its rail's column detaches it even when other
 *  rail tiles sit one cell away (e.g. a vertical rail). `{own, +1}` covers all
 *  ten flatbed platforms with zero false errors; the spiral lift overrides this
 *  to 2 via `dep.pathDown` (its pivot is a cell lower). Widening the default
 *  would falsely pass a platform parked above its rail. Pinned by
 *  validate-neighbor-deps. */
export const PATH_DOWN = 1

/** Cell the dep probes. `offset-cell` (class C) floor-divides the signed pixel
 *  probe back to a cell (matching the asm's LDB cell fetch); every other
 *  cell-spatial dep reads the sprite's own cell. */
export function probedCell(sprite: PlacedSprite, dep: SpriteNeighborDep): { cx: number; cy: number } {
  if (dep.spatial === 'offset-cell' && dep.offsetPx) {
    const px = sprite.x * 16 + dep.offsetPx.dx
    const py = sprite.y * 16 + dep.offsetPx.dy
    return { cx: Math.floor(px / 16), cy: Math.floor(py / 16) }
  }
  return { cx: sprite.x, cy: sprite.y }
}

/** Resolve one dependency to met/missing against the level context. */
export function resolveDep(sprite: PlacedSprite, dep: SpriteNeighborDep, ctx: NeighborContext): DepResult {
  switch (dep.spatial) {
    case 'same-cell':
    case 'offset-cell': {
      const cell = probedCell(sprite, dep)
      const met = cellTargetMatches(ctx.map16At(cell.cx, cell.cy), dep, ctx)
      return { dep, status: met ? 'met' : 'missing', targetCell: cell }
    }
    case 'path': {
      // Rail follower: read the OWN column at the platform's foot (own cell down
      // through PATH_DOWN). Column-restricted so an off-the-rail horizontal move
      // detaches even past a nearby vertical rail; first rail cell wins, else the
      // expected location is the own cell.
      if (dep.tileMatch) {
        const down = dep.pathDown ?? PATH_DOWN
        for (let dy = 0; dy <= down; dy++) {
          const cy = sprite.y + dy
          if (tileMatches(ctx.map16At(sprite.x, cy), dep.tileMatch)) {
            return { dep, status: 'met', targetCell: { cx: sprite.x, cy } }
          }
        }
      }
      return { dep, status: 'missing', targetCell: { cx: sprite.x, cy: sprite.y } }
    }
    case 'proximity':
    case 'global':
    case 'carried': {
      const ids = new Set(dep.targetIds.map((s) => parseInt(s, 16)))
      const partner = ctx.sprites.find((s) => ids.has(s.num))
      return { dep, status: partner ? 'met' : 'missing', targetSprite: partner }
    }
    case 'screen': {
      // A warp sprite reads the screen-exit row for the screen Yoshi exits on —
      // usually its own (142/144 shipped placements), but a sprite at a screen
      // boundary transitions into an adjacent screen, so accept an exit on its
      // own OR a 4-adjacent screen (covers the 0xD7 bonus-room pipe + teleport,
      // whose single exit sits on the screen directly below). Erring toward
      // 'met' keeps the always-on indicator from crying wolf on boundary pipes.
      const sc = screenOfCell(sprite.x, sprite.y)
      const col = sc & 0x0f
      const row = (sc >> 4) & 0x0f
      const screens = [sc]
      if (col > 0x0) screens.push(sc - 0x01)
      if (col < 0xf) screens.push(sc + 0x01)
      if (row > 0x0) screens.push(sc - 0x10)
      if (row < 0x7) screens.push(sc + 0x10)
      const met = screens.some((s) => ctx.hasExitForScreen(s))
      return { dep, status: met ? 'met' : 'missing' }
    }
  }
}
