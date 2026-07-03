// All click/hover hit-tests for the canvas. Pure functions taking the level
// data + visibility + view + cursor coords and returning what's under the
// point. No React, no DOM events.

import type { LevelData, LevelObject, LevelSprite, SpriteCelBounds } from '../../../preload/api'
import type { IncomingExit, LayerVisibility, Selection } from '../types'
import { isLayerVisible } from './draw/objects'
import { spriteCelBoundsFor, spriteOutlineBox } from './draw/sprites'
import {
  CELL_PX,
  EXIT_MARKER_HALF_PX,
  INCOMING_HIT_HALF_PX,
  LEVEL_CELLS_H,
  LEVEL_CELLS_W,
  SPAWN_HIT_HALF_PX,
  exitCenterX,
  exitCenterY,
  objectVisualBox
} from './geometry'
import type { View } from './view'

/** Per-object drawn-tile footprints (uid → set of absolute cell indices,
 *  `y * LEVEL_CELLS_W + x`), from useObjectCells. When an object has an entry its
 *  clickable region IS those cells — a click targets the tile you see and cycles
 *  through objects whose tiles are buried at that cell. Objects absent from the
 *  map (command objects / unported handlers, or a just-added object whose refetch
 *  hasn't landed) fall back to their bounding box. */
export type ObjectFootprints = Map<number, Set<number>> | null | undefined

/** Absolute cell index (`y * LEVEL_CELLS_W + x`) for a world point, or -1 when
 *  off the level grid (so a footprint object — cell-based — can't hit there). */
function cellIndexAt(wx: number, wy: number): number {
  const cx = Math.floor(wx / CELL_PX)
  const cy = Math.floor(wy / CELL_PX)
  if (cx < 0 || cx >= LEVEL_CELLS_W || cy < 0 || cy >= LEVEL_CELLS_H) return -1
  return cy * LEVEL_CELLS_W + cx
}

/** True when a world point hits object `o` — its DRAWN TILES when a footprint is
 *  known, else its bounding box (fallback for command / no-gfx objects and the
 *  brief post-edit window before the footprint refetch resolves). `cell` is the
 *  precomputed `cellIndexAt(wx, wy)` (shared across the object loop). */
function objectHit(
  o: LevelObject,
  footprints: ObjectFootprints,
  wx: number,
  wy: number,
  cell: number
): boolean {
  const fp = o.uid != null ? footprints?.get(o.uid) : undefined
  if (fp) return cell >= 0 && fp.has(cell)
  const b = objectVisualBox(o)
  return wx >= b.x0 && wx < b.x0 + b.w && wy >= b.y0 && wy < b.y0 + b.h
}

/** Whether world point (wx, wy) falls on object `o`'s clickable region — the same
 *  drawn-tiles-else-box predicate select/hover use, exposed so the drag-to-move
 *  grab shares it (grab area == select area). Computes the cell internally. */
export function objectHitAtPoint(
  o: LevelObject,
  footprints: ObjectFootprints,
  wx: number,
  wy: number
): boolean {
  return objectHit(o, footprints, wx, wy, cellIndexAt(wx, wy))
}

/** True when any of a footprint's cells overlaps a world-pixel rectangle (marquee
 *  box-select against drawn tiles). O(footprint) — fine for a one-shot release. */
function footprintInRect(
  fp: Set<number>,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number
): boolean {
  for (const cell of fp) {
    const cx = (cell % LEVEL_CELLS_W) * CELL_PX
    const cy = Math.floor(cell / LEVEL_CELLS_W) * CELL_PX
    if (rectsOverlap(rx0, ry0, rx1, ry1, cx, cy, cx + CELL_PX, cy + CELL_PX)) return true
  }
  return false
}

/** Sprite click/hover bounds, keyed by sprite num — `SpriteLayerResult.bounds`
 *  collapsed into a lookup. Null/empty before the sprite layer resolves. */
export type SpriteBoundsMap = Map<number, SpriteCelBounds> | null | undefined

/**
 * True when (wx, wy) — world pixels — falls on sprite `s`. The hit region IS
 * the drawn outline box (`spriteOutlineBox` — the size-matched cel box when
 * cel-backed, the 1-cell square otherwise), so the click area provably can't
 * drift from the drawn box. The cel-less square keeps inclusive far edges (a
 * click exactly on the box's right/bottom edge still counts), matching the
 * old forgiving marker-square behavior. Shared by every sprite hit path.
 */
export function spriteHit(
  s: LevelSprite,
  wx: number,
  wy: number,
  bounds: SpriteBoundsMap
): boolean {
  const b = spriteOutlineBox(s, bounds)
  if (spriteCelBoundsFor(s, bounds)) {
    return wx >= b.x0 && wx < b.x0 + b.w && wy >= b.y0 && wy < b.y0 + b.h
  }
  return wx >= b.x0 && wx <= b.x0 + b.w && wy >= b.y0 && wy <= b.y0 + b.h
}

/** Axis-aligned box overlap (half-open — touching edges don't count). */
function rectsOverlap(
  ax0: number, ay0: number, ax1: number, ay1: number,
  bx0: number, by0: number, bx1: number, by1: number
): boolean {
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0
}

export function selectionKey(sel: Selection): string {
  switch (sel.kind) {
    case 'object': return `o:${sel.uid}`
    case 'sprite': return `s:${sel.uid}`
    case 'exit': return `e:${sel.uid}`
    case 'incoming': return `i:${sel.incoming.sourceLevelRecordId}:${sel.incoming.sourceScreenIndex}`
    case 'spawn': return 'sp' // singleton per level
  }
}

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  return selectionKey(a) === selectionKey(b)
}

/** Merge `add` into `base`, de-duplicated by selection identity (key). Used to
 *  union marquee / shift-click results into the current multi-selection. */
export function unionSelections(base: Selection[], add: Selection[]): Selection[] {
  const seen = new Set(base.map(selectionKey))
  const out = base.slice()
  for (const s of add) {
    const k = selectionKey(s)
    if (!seen.has(k)) {
      seen.add(k)
      out.push(s)
    }
  }
  return out
}

/**
 * Shift-click selection policy against the hit stack (top-drawn first):
 *   - add the first hit not already selected (so on overlap a repeated
 *     shift-click walks DOWN the stack, always *adding* — never deselecting);
 *   - if every hit is already selected and there's exactly one hit, toggle it
 *     off (the "deselect one at a time" case for a non-overlapping entity);
 *   - otherwise (overlap, all already selected) leave the selection unchanged.
 * `base` should already be filtered to the multi-selectable kinds (object/sprite).
 */
export function applyShiftClick(base: Selection[], hits: Selection[]): Selection[] {
  if (hits.length === 0) return base
  const keys = new Set(base.map(selectionKey))
  const next = hits.find((h) => !keys.has(selectionKey(h)))
  if (next) return [...base, next]
  if (hits.length === 1) {
    const k = selectionKey(hits[0]!)
    return base.filter((s) => selectionKey(s) !== k)
  }
  return base
}

/** Convert client (viewport) coords to world (level) pixel coords. */
function clientToWorld(
  rect: DOMRect,
  view: View,
  clientX: number,
  clientY: number
): { wx: number; wy: number } {
  return {
    wx: (clientX - rect.left - view.panX) / view.zoom,
    wy: (clientY - rect.top - view.panY) / view.zoom
  }
}

/**
 * Return the set of selectables under the cursor, top-drawn first. Cycling
 * through this set on repeated clicks lets the user reach things that are
 * buried under others. Layer-visibility is respected — toggled-off layers
 * are unclickable, matching what the user sees.
 */
export function hitTestAll(
  level: LevelData | null,
  view: View,
  layers: LayerVisibility,
  incoming: IncomingExit[],
  rect: DOMRect,
  clientX: number,
  clientY: number,
  spriteBounds: SpriteBoundsMap,
  /** Per-object drawn-tile footprints — objects hit on their tiles, not their box
   *  (see ObjectFootprints). */
  footprints: ObjectFootprints,
  /** Effective spawn cell — the world-map entrance-table DRAFT position when
   *  editing, so the moved marker stays clickable before save+reload. Defaults to
   *  `level.spawn` (the base, extract-time position) when omitted. */
  spawnPos?: { x: number; y: number } | null
): Selection[] {
  if (!level || level.empty || level.special) return []
  const { wx, wy } = clientToWorld(rect, view, clientX, clientY)
  const hits: Selection[] = []

  // Exits sit on top, so cycle them first.
  if (layers.exits) {
    for (const e of level.exits) {
      const ex = exitCenterX(e.screenIndex)
      const ey = exitCenterY(e.screenIndex)
      if (
        Math.abs(wx - ex) <= EXIT_MARKER_HALF_PX &&
        Math.abs(wy - ey) <= EXIT_MARKER_HALF_PX
      ) {
        hits.push({ kind: 'exit', uid: e.uid! })
      }
    }

    // Incoming-exit markers (where a sibling room warps the player in).
    for (const inc of incoming) {
      const ix = (inc.destX + 0.5) * CELL_PX
      const iy = (inc.destY + 0.5) * CELL_PX
      if (
        Math.abs(wx - ix) <= INCOMING_HIT_HALF_PX &&
        Math.abs(wy - iy) <= INCOMING_HIT_HALF_PX
      ) {
        hits.push({ kind: 'incoming', incoming: inc })
      }
    }

  }

  // Spawn flag + sprites both gate on `spriteOutlines` (the editing/outline
  // layer), mirroring how objects gate on `bg1Outlines` — no outline drawn →
  // not selectable. The spawn is sprite-like: its flag glyph rides the Sprites
  // layer, its selectable outline rides Sprite Editing. It's cycled before the
  // sprite list to keep the exits → incoming → spawn → sprites → objects order.
  if (layers.spriteOutlines) {
    const spawn = spawnPos !== undefined ? spawnPos : level.spawn
    if (spawn) {
      const sx = (spawn.x + 0.5) * CELL_PX
      const sy = (spawn.y + 0.5) * CELL_PX
      if (
        Math.abs(wx - sx) <= SPAWN_HIT_HALF_PX &&
        Math.abs(wy - sy) <= SPAWN_HIT_HALF_PX
      ) {
        hits.push({ kind: 'spawn', spawn })
      }
    }
    // The hit region is the drawn outline box (see spriteHit) — the
    // size-matched cel box when cel-backed, the 1-cell square otherwise.
    for (const s of level.sprites) {
      if (spriteHit(s, wx, wy, spriteBounds)) {
        hits.push({ kind: 'sprite', uid: s.uid! })
      }
    }
  }

  // Objects drawn-last first, so the topmost in z-order takes precedence. The hit
  // region is each object's DRAWN TILES (footprints) — including cells later
  // overwritten by a higher object, so the stack at a cell includes the buried
  // objects and repeated clicks cycle down to them. Objects that stamp nothing
  // (command / no-gfx) fall back to their bounding box (objectHit).
  const cell = cellIndexAt(wx, wy)
  for (let i = level.objects.length - 1; i >= 0; i--) {
    const o = level.objects[i]
    if (!isLayerVisible(o, layers)) continue
    if (objectHit(o, footprints, wx, wy, cell)) {
      hits.push({ kind: 'object', uid: o.uid! })
    }
  }
  return hits
}

/**
 * Object + sprite uids whose hit-box contains the cursor — the Erase tool's
 * per-sample target set. Reuses hitTestAll so the layer-visibility gating
 * matches selection (objects need `bg1Outlines`, sprites need `spriteOutlines`),
 * then keeps only the erasable kinds — exits / incoming / spawn are never erased.
 */
export function collectEraseHits(
  level: LevelData | null,
  view: View,
  layers: LayerVisibility,
  incoming: IncomingExit[],
  spriteBounds: SpriteBoundsMap,
  footprints: ObjectFootprints,
  rect: DOMRect,
  clientX: number,
  clientY: number
): { objUids: number[]; sprUids: number[] } {
  const hits = hitTestAll(level, view, layers, incoming, rect, clientX, clientY, spriteBounds, footprints)
  const objUids: number[] = []
  const sprUids: number[] = []
  for (const h of hits) {
    if (h.kind === 'object') objUids.push(h.uid)
    else if (h.kind === 'sprite') sprUids.push(h.uid)
  }
  return { objUids, sprUids }
}

/**
 * Object + sprite selections whose box intersects a marquee (the shift-drag
 * box). Two client corners → a normalized world rect; objects gate on
 * `bg1Outlines`, sprites on `spriteOutlines` (only outlined entities are
 * selectable, matching click selection). Exits / incoming / spawn are never
 * box-selected — multi-select is objects + sprites only.
 */
export function hitTestRect(
  level: LevelData | null,
  view: View,
  layers: LayerVisibility,
  rect: DOMRect,
  clientX0: number,
  clientY0: number,
  clientX1: number,
  clientY1: number,
  spriteBounds: SpriteBoundsMap,
  footprints: ObjectFootprints
): Selection[] {
  if (!level || level.empty || level.special) return []
  const a = clientToWorld(rect, view, clientX0, clientY0)
  const b = clientToWorld(rect, view, clientX1, clientY1)
  const rx0 = Math.min(a.wx, b.wx)
  const ry0 = Math.min(a.wy, b.wy)
  const rx1 = Math.max(a.wx, b.wx)
  const ry1 = Math.max(a.wy, b.wy)
  const hits: Selection[] = []
  if (layers.spriteOutlines) {
    for (const s of level.sprites) {
      const box = spriteOutlineBox(s, spriteBounds)
      if (rectsOverlap(rx0, ry0, rx1, ry1, box.x0, box.y0, box.x0 + box.w, box.y0 + box.h)) {
        hits.push({ kind: 'sprite', uid: s.uid! })
      }
    }
  }
  // Objects box-select on their DRAWN TILES (any footprint cell inside the box),
  // falling back to the bounding box for objects that stamp nothing.
  for (const o of level.objects) {
    if (!isLayerVisible(o, layers)) continue
    const fp = o.uid != null ? footprints?.get(o.uid) : undefined
    const box = objectVisualBox(o)
    const hit = fp
      ? footprintInRect(fp, rx0, ry0, rx1, ry1)
      : rectsOverlap(rx0, ry0, rx1, ry1, box.x0, box.y0, box.x0 + box.w, box.y0 + box.h)
    if (hit) hits.push({ kind: 'object', uid: o.uid! })
  }
  return hits
}

export function hitTestObject(
  level: LevelData | null,
  view: View,
  layers: LayerVisibility,
  rect: DOMRect,
  clientX: number,
  clientY: number,
  footprints: ObjectFootprints
): LevelObject | null {
  if (!level || level.empty || level.special) return null
  const { wx, wy } = clientToWorld(rect, view, clientX, clientY)
  // Hover on the DRAWN TILES (footprints), falling back to the box — see hitTestAll.
  const cell = cellIndexAt(wx, wy)
  for (let i = level.objects.length - 1; i >= 0; i--) {
    const o = level.objects[i]
    if (!isLayerVisible(o, layers)) continue
    if (objectHit(o, footprints, wx, wy, cell)) return o
  }
  return null
}

export function hitTestSprite(
  level: LevelData | null,
  view: View,
  layers: LayerVisibility,
  rect: DOMRect,
  clientX: number,
  clientY: number,
  spriteBounds: SpriteBoundsMap
): LevelSprite | null {
  if (!level || level.empty || level.special || !layers.spriteOutlines) return null
  const { wx, wy } = clientToWorld(rect, view, clientX, clientY)
  // Walk in reverse so later-drawn sprites win when stacked.
  for (let i = level.sprites.length - 1; i >= 0; i--) {
    const s = level.sprites[i]
    if (spriteHit(s, wx, wy, spriteBounds)) return s
  }
  return null
}

export function hitTestExit(
  level: LevelData | null,
  view: View,
  layers: LayerVisibility,
  rect: DOMRect,
  clientX: number,
  clientY: number
): boolean {
  if (!level || level.empty || level.special || !layers.exits) return false
  const { wx, wy } = clientToWorld(rect, view, clientX, clientY)
  for (const e of level.exits) {
    const ex = exitCenterX(e.screenIndex)
    const ey = exitCenterY(e.screenIndex)
    if (
      Math.abs(wx - ex) <= EXIT_MARKER_HALF_PX &&
      Math.abs(wy - ey) <= EXIT_MARKER_HALF_PX
    ) {
      return true
    }
  }
  return false
}

export function hitTestIncoming(
  level: LevelData | null,
  view: View,
  layers: LayerVisibility,
  incoming: IncomingExit[],
  rect: DOMRect,
  clientX: number,
  clientY: number
): boolean {
  if (!level || level.empty || level.special || !layers.exits) return false
  const { wx, wy } = clientToWorld(rect, view, clientX, clientY)
  for (const inc of incoming) {
    const ix = (inc.destX + 0.5) * CELL_PX
    const iy = (inc.destY + 0.5) * CELL_PX
    if (
      Math.abs(wx - ix) <= INCOMING_HIT_HALF_PX &&
      Math.abs(wy - iy) <= INCOMING_HIT_HALF_PX
    ) {
      return true
    }
  }
  return false
}

export function hitTestSpawn(
  level: LevelData | null,
  view: View,
  layers: LayerVisibility,
  rect: DOMRect,
  clientX: number,
  clientY: number,
  /** Effective spawn cell (entrance-table draft); defaults to `level.spawn`. */
  spawnPos?: { x: number; y: number } | null
): boolean {
  if (!level || level.empty || level.special || !layers.spriteOutlines) return false
  const spawn = spawnPos !== undefined ? spawnPos : level.spawn
  if (!spawn) return false
  const { wx, wy } = clientToWorld(rect, view, clientX, clientY)
  const sx = (spawn.x + 0.5) * CELL_PX
  const sy = (spawn.y + 0.5) * CELL_PX
  return (
    Math.abs(wx - sx) <= SPAWN_HIT_HALF_PX &&
    Math.abs(wy - sy) <= SPAWN_HIT_HALF_PX
  )
}
