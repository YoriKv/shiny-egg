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
  /** Is this Map16 page **side-solid** (collision byte-0 `AL` flag, `raw0 & 0x02`)?
   *  Drives `dep.matchSolid` — the grinder monkeys grab any solid wall beside them
   *  (asm `CODE_02ADC1`'s `R7 & $0002`). Optional: contexts with no `matchSolid`
   *  dep can omit it. */
  isSolidPage?: (page: number) => boolean
  /** Sprite nums placed anywhere in the warp-reachable level group (forward
   *  BFS from this record over its screen-exit warps) — the `carried` deps'
   *  fallback: a locked door is satisfied by a Key in a connected sub-room,
   *  not just its own record. Optional: when absent, `carried` resolves
   *  against the own record only (the harness and hook both supply it).
   *  Info-grade regardless — 14/33 shipped doors have NO placed Key anywhere
   *  in their component (keys also spawn from containers, e.g. winged
   *  clouds), so absence is never an error. */
  carriedGroupNums?: Set<number>
}

export interface DepResult {
  dep: SpriteNeighborDep
  status: DepStatus
  /** Cell the target sits at (when `met`) or is expected at (when `missing`) —
   *  only for cell-spatial deps (`same-cell` / `offset-cell` / `path` / `row`,
   *  and `level` when met). The editor draws the expected-location marker here. */
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
 *  `tileMatch` mask/value, OR any of its `tileLiterals`, OR its page's
 *  collision secondary-tag equalling `collisionTag`. Mirrors the asm idioms:
 *  the pipe gate `CODE_0EB8AE` (tile == $79F1/$79F2 || page-tag == $14), the
 *  ice-snap prologue `CODE_02A007` (page-tag == $17), exact-tile probes
 *  (icicle $8E00-02, cork $7D24), and tag-only probes (falling rock $0E). */
function cellTargetMatches(
  id: number | undefined,
  dep: SpriteNeighborDep,
  ctx: NeighborContext
): boolean {
  if (id === undefined) return false
  if (dep.tileMatch && tileMatches(id, dep.tileMatch)) return true
  if (dep.tileLiterals?.some((h) => id === parseInt(h, 16))) return true
  if (id !== 0 && dep.pageLiterals?.some((h) => ((id >> 8) & 0xff) === parseInt(h, 16))) return true
  if (dep.collisionTag != null && ctx.collisionTagOfPage) {
    const tag = ctx.collisionTagOfPage((id >> 8) & 0xff)
    if (tag !== undefined && tag === parseInt(dep.collisionTag, 16)) return true
  }
  // Side-solid page (collision AL flag) — the grinder grabs any solid wall beside it.
  if (dep.matchSolid && id !== 0 && ctx.isSolidPage?.((id >> 8) & 0xff)) return true
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
    case 'row': {
      // Horizontal scan of the OWN row, own cell outward to ±rowSpan (the
      // boo-guys-bomb path-marker: the asm walks the whole row from a side
      // cell; every shipped placement matches within ±2, span 4 adds margin).
      // Nearest match wins so the marker points at the closest target.
      const span = dep.rowSpan ?? 4
      for (let d = 0; d <= span; d++) {
        for (const cx of d === 0 ? [sprite.x] : [sprite.x - d, sprite.x + d]) {
          if (cellTargetMatches(ctx.map16At(cx, sprite.y), dep, ctx)) {
            return { dep, status: 'met', targetCell: { cx, cy: sprite.y } }
          }
        }
      }
      return { dep, status: 'missing', targetCell: { cx: sprite.x, cy: sprite.y } }
    }
    case 'level': {
      // Anywhere-in-level tile scan (wall-lakitu generator: spawns only at
      // cells whose tile matches, probed camera-relative at runtime — the
      // per-record check is "does the level contain any such tile"). Marker =
      // the match nearest the sprite (Manhattan), so the connector is useful.
      let best: { cx: number; cy: number } | undefined
      let bestDist = Infinity
      for (let cy = 0; cy < 128; cy++) {
        for (let cx = 0; cx < 256; cx++) {
          if (!cellTargetMatches(ctx.map16At(cx, cy), dep, ctx)) continue
          const dist = Math.abs(cx - sprite.x) + Math.abs(cy - sprite.y)
          if (dist < bestDist) {
            bestDist = dist
            best = { cx, cy }
          }
        }
      }
      if (best) return { dep, status: 'met', targetCell: best }
      return { dep, status: 'missing' }
    }
    case 'note':
      // Pure annotation (tree-climbing monkeys, dirt diggers, the unresolved
      // frog-pirate exit) — no geometric check; the panel shows the rule text.
      return { dep, status: 'met' }
    case 'proximity':
    case 'global':
    case 'carried': {
      // Pick the NEAREST matching partner (Chebyshev cells), not the first in
      // stream order — the asm by-ID probe (FXCODE_098EBF) homes on the
      // nearest active sprite, and the selection drives the editor's
      // connector, which should point at the obvious partner. The sprite
      // under test is excluded by identity so self-pairings don't trivially
      // satisfy themselves. `radiusCells` (when set) bounds how far a partner
      // may sit — by-ID homing only sees partners co-active in the spawn
      // window, so e.g. the mouser's nest must be within ~a screen.
      const ids = new Set(dep.targetIds.map((s) => parseInt(s, 16)))
      let partner: PlacedSprite | undefined
      let best = Infinity
      for (const s of ctx.sprites) {
        if (!ids.has(s.num)) continue
        if (s.num === sprite.num && s.x === sprite.x && s.y === sprite.y) continue
        const d = Math.max(Math.abs(s.x - sprite.x), Math.abs(s.y - sprite.y))
        if (d < best) {
          best = d
          partner = s
        }
      }
      if (partner && dep.radiusCells !== undefined && best > dep.radiusCells) partner = undefined
      // `carried` fallback: no partner in this record, but one is placed in a
      // warp-connected room the player can carry it in from.
      if (!partner && dep.spatial === 'carried' && ctx.carriedGroupNums) {
        const inGroup = dep.targetIds.some((s) => ctx.carriedGroupNums!.has(parseInt(s, 16)))
        if (inGroup) return { dep, status: 'met' }
      }
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
