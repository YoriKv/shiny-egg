// Engine-derived editor limits + the shared clamp helpers every tool uses to
// keep edits inside the cart's hard boundaries. Centralised here (rather than
// duplicated per tool) so the select/place/erase/measure tools, the canvas
// drag overlay, and the level reducer all enforce the SAME rules.
//
// Two kinds of limit:
//   1. Spatial — a level is a fixed 256×128-cell grid (see geometry.ts).
//      Nothing may be moved/scaled/placed outside it.
//   2. Count   — how many of an entity the engine can track for one level.
//      These come from the runtime tables, NOT the on-disk stream size.
//
// Sources (all under snes-framework/):
//   - Sprite cap: the stage-sprite spawn-flag table at CARTRAM $70:28CA is a
//     256-byte table indexed by an 8-bit stage ID (yi/Memory/SRAM_Buffers.asm
//     "Stage-sprites spawning flags"; the despawn path writes `STA $7028CA,x`
//     with X = stage ID at yi/Banks/Bank03.asm). Level-data sprites stream in
//     by camera position and each occupies one stage ID; $FF is the
//     "no-respawn" sentinel (the StageID slot field, yi/Memory/SRAM_SpriteSlots.asm),
//     leaving $00..$FE = 255 respawn-tracked sprites. This is the only sprite
//     limit a static editor can enforce — the 16 ambient / 24 normal *active*
//     slots (SRAM_SpriteSlots.asm) are a per-frame concurrency limit that
//     depends on camera position, not a placement cap.
//   - Exit cap: the live screen-exit table $7F:7E00 holds one 4-byte record
//     per screen across the 16×8 grid = 128 screens (docs/levelloader.md §1
//     stage 6).

import type { LevelObject, LevelSprite } from '../../../preload/api'
import {
  LEVEL_CELLS_H,
  LEVEL_CELLS_W,
  LEVEL_SCREENS_H,
  LEVEL_SCREENS_W
} from './geometry'

/**
 * Max level-data sprites the engine can track. Stage IDs $00..$FE are
 * respawn-tracked in the 256-entry `$70:28CA` flag table; $FF is reserved as
 * the "no-respawn" sentinel — so 255 is the safe authoring ceiling.
 */
export const MAX_LEVEL_SPRITES = 255

/** Max screen-exit records — one per screen in the 16×8 grid (= 128). */
export const MAX_LEVEL_EXITS = LEVEL_SCREENS_W * LEVEL_SCREENS_H

/**
 * Active sprite-slot counts (informational — a per-frame concurrency limit,
 * not a placement cap). Surfaced so tooling can warn, but never used to block
 * a static edit. From yi/Memory/SRAM_SpriteSlots.asm.
 */
export const ACTIVE_SPRITE_SLOTS = {
  ambient: 16,
  normal: 24,
  /** Normal slots the camera-spawn scan actually fills (6..23); slots 0..5
   *  are reserved for persistent/boss sprites. See yi/Banks/Bank03.asm. */
  normalDynamic: 18
} as const

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v))

/**
 * Bit widths of the 15 level-header fields, MSB-first — a renderer-side mirror
 * of the engine's `HEADER_BIT_WIDTHS`
 * (snes-framework/scripts/engine/object-decode/header.ts). The table is fixed
 * cart metadata (statically known, invariant across ROM versions); the
 * authoritative widths flow main-side at save (the serializer is passed the
 * level-map's widths). This mirror exists only to clamp editor input so a header
 * value can never overflow its packed field.
 */
export const HEADER_BIT_WIDTHS: readonly number[] = [
  5, 4, 5, 5, 6, 6, 6, 7, 4, 5, 6, 5, 5, 4, 2
]

/** Clamp a header field value to [0, 2^width − 1] for its field index. An
 *  unknown index clamps to 0 (defensive — the panel only ever sends 0..14). */
export function clampHeaderField(index: number, v: number): number {
  const w = HEADER_BIT_WIDTHS[index] ?? 0
  return clamp(Math.round(v), 0, (1 << w) - 1)
}

/**
 * An object's occupied CELL box (integer cells) — used for bounds clamping. A
 * size-0 or negative dimension still covers at least its one anchor cell here;
 * a negative width/height extends the box back from the anchor. The VISUAL /
 * hit-test footprint is separate — `geometry.objectBoxExtent` renders a size-0
 * axis as 1/4 tile — so don't conflate the two.
 */
export function objectCellBox(o: LevelObject): {
  x0: number
  y0: number
  w: number
  h: number
} {
  return {
    x0: Math.min(o.x, o.x + o.w),
    y0: Math.min(o.y, o.y + o.h),
    w: Math.max(1, Math.abs(o.w)),
    h: Math.max(1, Math.abs(o.h))
  }
}

/**
 * Clamp a proposed object translation so the object's whole box stays inside
 * the level. Returns the (possibly reduced) delta; `{dx:0,dy:0}` means the
 * move is fully blocked. The delta applies directly to `o.x`/`o.y` because the
 * anchor and the box top-left shift together.
 */
export function clampObjectMove(
  o: LevelObject,
  dx: number,
  dy: number
): { dx: number; dy: number } {
  const { x0, y0, w, h } = objectCellBox(o)
  const nx0 = clamp(x0 + dx, 0, LEVEL_CELLS_W - w)
  const ny0 = clamp(y0 + dy, 0, LEVEL_CELLS_H - h)
  return { dx: nx0 - x0, dy: ny0 - y0 }
}

/**
 * Clamp a proposed object resize so the resized box stays inside the level.
 * The ANCHOR (`o.x`,`o.y`) is the fixed pivot; `w`/`h` are signed extents (YI
 * folds a negative dimension to grow the box *back* from the anchor). Each axis
 * is clamped independently so its far box edge stays in-bounds, preserving sign
 * and a magnitude ≥ 1. Crucially this is anchor-relative, not box-top-left
 * relative — a negative extent grows toward 0, so its limit is the anchor
 * itself, not the level edge.
 */
export function clampObjectResize(
  o: LevelObject,
  w: number,
  h: number
): { w: number; h: number } {
  return {
    w: clampExtent(o.x, w, LEVEL_CELLS_W),
    h: clampExtent(o.y, h, LEVEL_CELLS_H)
  }
}

/**
 * Clamp one signed extent `v` around a fixed `anchor` cell so the covered box —
 * `[anchor, anchor+v)` when `v > 0`, or `[anchor+v, anchor)` when `v < 0` —
 * stays within `[0, limit)`.
 *
 * `v === 0` is a REAL authored value (encodes as byte 0xFF, distinct from
 * 1/-1; 163+ such objects ship in the cart) — it covers the single anchor cell,
 * always in-bounds, so it's preserved verbatim and never normalised to ±1. For
 * `v < 0` the magnitude is capped at the anchor; with the anchor hard against
 * the low edge there's no room to grow back, so it snaps to `+1`.
 */
function clampExtent(anchor: number, v: number, limit: number): number {
  if (v === 0) return 0
  if (v > 0) return clamp(v, 1, limit - anchor)
  if (anchor < 1) return 1
  return -clamp(Math.abs(v), 1, anchor)
}

/** Clamp a single cell coordinate (sprite / spawn / exit point) into bounds. */
export function clampCell(x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, 0, LEVEL_CELLS_W - 1),
    y: clamp(y, 0, LEVEL_CELLS_H - 1)
  }
}

/** Clamp a proposed point-entity (sprite) translation into bounds. */
export function clampSpriteMove(
  s: LevelSprite,
  dx: number,
  dy: number
): { dx: number; dy: number } {
  const c = clampCell(s.x + dx, s.y + dy)
  return { dx: c.x - s.x, dy: c.y - s.y }
}

/**
 * Clamp a proposed RIGID translation of a whole group (objects + sprites) by a
 * single shared delta. Unlike clamping each entity independently (which would
 * shear the group apart at an edge), this intersects every member's allowed
 * delta range so the group moves together and stops when the FIRST member hits a
 * boundary. Each member's in-bounds range contains 0, so the intersection is
 * always non-empty. An empty group → `{dx:0,dy:0}`. Shared by the canvas drag
 * overlay and the `moveEntities` reducer action so preview == commit.
 */
export function clampGroupMove(
  objects: LevelObject[],
  sprites: LevelSprite[],
  dx: number,
  dy: number
): { dx: number; dy: number } {
  let loDx = -Infinity
  let hiDx = Infinity
  let loDy = -Infinity
  let hiDy = Infinity
  for (const o of objects) {
    const { x0, y0, w, h } = objectCellBox(o)
    loDx = Math.max(loDx, -x0)
    hiDx = Math.min(hiDx, LEVEL_CELLS_W - w - x0)
    loDy = Math.max(loDy, -y0)
    hiDy = Math.min(hiDy, LEVEL_CELLS_H - h - y0)
  }
  for (const s of sprites) {
    loDx = Math.max(loDx, -s.x)
    hiDx = Math.min(hiDx, LEVEL_CELLS_W - 1 - s.x)
    loDy = Math.max(loDy, -s.y)
    hiDy = Math.min(hiDy, LEVEL_CELLS_H - 1 - s.y)
  }
  if (!Number.isFinite(loDx)) return { dx: 0, dy: 0 } // empty group
  return { dx: clamp(dx, loDx, hiDx), dy: clamp(dy, loDy, hiDy) }
}
