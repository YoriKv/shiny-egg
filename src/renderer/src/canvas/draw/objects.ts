import type { LevelObject } from '../../../../preload/api'
import { getObjectInfo } from '../../data/obj-metadata'
import type { LayerVisibility } from '../../types'
import type { ObjectFootprints } from '../../hooks/useObjectCells'
import {
  CELL_PX,
  LEVEL_CELLS_W,
  footprintCellBounds,
  objectOutlineBox,
  objectVisualBox,
  type ObjectOutlineBox
} from '../geometry'
import { drawAnchorDot, drawSelectionBox, HOVER_ACCENT, strokeBasicOutline } from './selection'
import { beginIdLabels, drawIdLabel } from './text'
import { hex } from '../../lib/hex'

/**
 * Anchor-relative outline boxes (in cells) for the EXTENDED objects in `objects`,
 * derived from their drawn-tile footprints. Extended objects encode no W/H — their
 * nominal box is a meaningless 1×1 — so we outline them to the tiles they actually
 * stamp. Only ext objects (`num === 0`) that stamp ≥1 tile get an entry; standard
 * objects and no-visual ext objects are absent and fall back to `objectVisualBox`.
 *
 * Offsets are taken against each object's COMMITTED anchor (the `objects` passed
 * here are `level.objects`, the same positions the footprints were decoded at), so
 * applying them to a live (drag-shifted) anchor in `objectOutlineBox` translates
 * the whole box with the drag. Cheap map build; memoise on `[level, footprints]`.
 */
export function objectOutlineBoxes(
  objects: LevelObject[],
  footprints: ObjectFootprints
): Map<number, ObjectOutlineBox> {
  const out = new Map<number, ObjectOutlineBox>()
  if (!footprints) return out
  for (const o of objects) {
    if (o.num !== 0 || o.uid == null) continue // extended objects only
    const cells = footprints.get(o.uid)
    if (!cells) continue
    const b = footprintCellBounds(cells)
    if (!b) continue
    out.set(o.uid, { offX: b.minX - o.x, offY: b.minY - o.y, w: b.w, h: b.h })
  }
  return out
}

/** Hex tag for an object — shown in the corner of the bounding box at high zoom. */
export function objectHex(o: LevelObject): string {
  if (o.num === 0 && o.exnum !== undefined) {
    return `e${hex(o.exnum, 2)}`
  }
  return hex(o.num, 2)
}

/** Match objects by session uid — stream index shifts under add/delete and
 *  object references diverge across re-fetches, but uid is stable. */
function isSameObj(a: LevelObject | null, b: LevelObject | null): boolean {
  return !!a && !!b && a.uid != null && a.uid === b.uid
}

/**
 * Whether object editing (outline draw + hit-testing) is enabled — true in both
 * 'detailed' and 'render' OutlineMode, false only in 'off'. Independent of the
 * BG1 graphics layer (`bg1` controls the rendered tiles). Objects were once
 * bundled under `bg1`; split so the user can show outlines without tiles or vice
 * versa. In 'render' mode `drawObjects` isn't called (scene draws only the
 * selected object), but hit-testing still uses this gate.
 */
export function isLayerVisible(_o: LevelObject, layers: LayerVisibility): boolean {
  return layers.bg1Outlines !== 'off'
}

/** Background-layer ordering by category. Lower draws first (behind). */
export function zOrder(o: LevelObject): number {
  const info = getObjectInfo(o.num, o.exnum)
  switch (info.category) {
    case 'command': return 0
    case 'decoration': return 1
    case 'water': return 2
    case 'platform': return 3
    case 'slope': return 4
    case 'terrain': return 5
    case 'pipe': return 6
    case 'hazard': return 7
    case 'interactive': return 8
    case 'collectible': return 9
    default: return 5
  }
}

export function drawObjects(
  ctx: CanvasRenderingContext2D,
  objects: LevelObject[],
  hovered: LevelObject | null,
  selectedUids: Set<number>,
  zoom: number,
  layers: LayerVisibility,
  /** Per-uid footprint outline boxes for extended objects (objectOutlineBoxes);
   *  empty for a level with none, or before the first footprint fetch resolves. */
  outlineBoxes: ReadonlyMap<number, ObjectOutlineBox> = new Map()
): void {
  // Outline-only blueprint. The actual game pixels are rendered as a back
  // layer (Phase 4 — BizHawk VRAM → canvas). This layer's job is just to
  // mark editable bounds and let the user click-target objects without
  // obscuring the underlying graphics.
  const isSelected = (o: LevelObject): boolean => o.uid != null && selectedUids.has(o.uid)
  const visible = objects.filter((o) => isLayerVisible(o, layers))
  ctx.save()
  ctx.lineWidth = 1 / zoom
  const inset = 0.5 / zoom // pull stroke into integer pixel grid
  for (const o of visible) {
    const { x0, y0, w, h } = objectOutlineBox(o, outlineBoxes)
    if (isSelected(o)) {
      continue // selection rendered with its own marker below
    } else if (isSameObj(o, hovered)) {
      ctx.strokeStyle = HOVER_ACCENT
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
    }
    ctx.strokeRect(x0 + inset, y0 + inset, w - inset * 2, h - inset * 2)
    // Anchor dot on objects that grow back from their root (negative w/h), so
    // the non-standard anchor is visible without selecting them; also on hover.
    if (o.w < 0 || o.h < 0 || isSameObj(o, hovered)) {
      drawAnchor(ctx, o, zoom, false)
    }
  }
  ctx.restore()

  // Draw selection(s) on top so the highlight is unambiguous, regardless of
  // category z-order. Multi-select highlights every selected object.
  for (const selected of visible) {
    if (!isSelected(selected)) continue
    drawSelectionBox(ctx, objectOutlineBox(selected, outlineBoxes), zoom)
    // Anchor (root) of the selected object — the fixed pivot the resize handles
    // pull against; chartreuse to read as part of the selection.
    drawAnchor(ctx, selected, zoom, true)
  }

  // Labels only when zoomed in enough that they'd be legible. At higher zoom
  // we promote from hex tag to friendly name. Match layer filtering so we
  // don't label hidden objects.
  if (zoom >= 1.5) {
    const showName = zoom >= 2.5
    const adv = beginIdLabels(ctx, zoom)
    for (const o of visible) {
      const { x0, y0 } = objectOutlineBox(o, outlineBoxes)
      const label = showName ? getObjectInfo(o.num, o.exnum).name || objectHex(o) : objectHex(o)
      drawIdLabel(ctx, x0, y0, label, zoom, adv)
    }
  }
}

/**
 * Dot at an object's anchor (root) corner — the `(x, y)` its size grows from.
 * For a negative w/h the anchor is NOT the box's top-left, so this reveals
 * negative sizes at a glance; on the selected object it also marks the fixed
 * pivot the resize handles pull against. Orange idle tint distinguishes
 * objects from sprites' amber (shared shape via `drawAnchorDot`).
 */
function drawAnchor(
  ctx: CanvasRenderingContext2D,
  o: LevelObject,
  zoom: number,
  emphasis: boolean
): void {
  drawAnchorDot(ctx, o.x, o.y, zoom, emphasis, 'rgba(255, 193, 110, 0.9)')
}

/**
 * Add the perimeter of a footprint cell set to the current path (moveTo/lineTo
 * only — the caller does beginPath + the stroke). A cell edge is added only where
 * it borders a NON-member cell, so concavities and holes trace exactly.
 * `dxCells`/`dyCells` offset every cell — used to follow a live move-drag
 * (footprints are decoded at the committed position). Cell index =
 * `y * LEVEL_CELLS_W + x`.
 */
function addFootprintEdges(
  ctx: CanvasRenderingContext2D,
  cells: ReadonlySet<number>,
  dxCells: number,
  dyCells: number
): void {
  for (const c of cells) {
    const x = c % LEVEL_CELLS_W
    const y = Math.floor(c / LEVEL_CELLS_W)
    const px = (x + dxCells) * CELL_PX
    const py = (y + dyCells) * CELL_PX
    // Top / bottom: `c ∓ LEVEL_CELLS_W` never wraps a row, so out-of-range → not
    // a member → edge drawn (correct at the grid's top/bottom).
    if (!cells.has(c - LEVEL_CELLS_W)) {
      ctx.moveTo(px, py)
      ctx.lineTo(px + CELL_PX, py)
    }
    if (!cells.has(c + LEVEL_CELLS_W)) {
      ctx.moveTo(px, py + CELL_PX)
      ctx.lineTo(px + CELL_PX, py + CELL_PX)
    }
    // Left / right: guard the column edges so `c ∓ 1` can't wrap to the adjacent
    // row and falsely suppress a boundary edge.
    if (x === 0 || !cells.has(c - 1)) {
      ctx.moveTo(px, py)
      ctx.lineTo(px, py + CELL_PX)
    }
    if (x === LEVEL_CELLS_W - 1 || !cells.has(c + 1)) {
      ctx.moveTo(px + CELL_PX, py)
      ctx.lineTo(px + CELL_PX, py + CELL_PX)
    }
  }
}

/**
 * Render-mode object outline: for each SELECTED object, an alternating
 * black/white dashed outline (strokeBasicOutline) tracing the exact tiles it
 * stamps — the clean render-preview counterpart to the full `drawObjects`
 * blueprint. `objects` is the (possibly drag-shifted) display list; `committed`
 * is the reducer-committed list the footprints were decoded against, so a
 * mid-drag object's outline translates by its drag delta. Objects that stamp
 * nothing (command objects, or a footprint not yet fetched) fall back to their
 * nominal box so the selection still reads.
 */
export function drawObjectRenderOutlines(
  ctx: CanvasRenderingContext2D,
  objects: LevelObject[],
  selectedUids: Set<number>,
  footprints: ObjectFootprints,
  committed: LevelObject[],
  zoom: number
): void {
  if (selectedUids.size === 0) return
  const committedPos = new Map<number, LevelObject>()
  for (const c of committed) if (c.uid != null) committedPos.set(c.uid, c)
  for (const o of objects) {
    if (o.uid == null || !selectedUids.has(o.uid)) continue
    const cells = footprints?.get(o.uid) ?? null
    ctx.beginPath()
    if (cells && cells.size > 0) {
      const base = committedPos.get(o.uid)
      addFootprintEdges(ctx, cells, base ? o.x - base.x : 0, base ? o.y - base.y : 0)
    } else {
      const b = objectVisualBox(o)
      ctx.rect(b.x0, b.y0, b.w, b.h)
    }
    strokeBasicOutline(ctx, zoom)
  }
}
