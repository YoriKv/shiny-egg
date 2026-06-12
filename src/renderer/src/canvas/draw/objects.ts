import type { LevelObject } from '../../../../preload/api'
import { getObjectInfo } from '../../data/obj-metadata'
import type { LayerVisibility } from '../../types'
import { objectVisualBox } from '../geometry'
import { drawAnchorDot, drawSelectionBox, HOVER_ACCENT } from './selection'
import { beginIdLabels, drawIdLabel } from './text'
import { hex } from '../../lib/hex'

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
 * Object outlines (the blueprint view) are independent of the BG1
 * graphics layer — `bg1Outlines` controls visibility + hit-testing of
 * outlines, `bg1` controls visibility of the rendered tiles. Originally
 * both were bundled under `bg1`; split so the user can show outlines
 * without tiles, or tiles without outlines.
 */
export function isLayerVisible(_o: LevelObject, layers: LayerVisibility): boolean {
  return layers.bg1Outlines
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
  layers: LayerVisibility
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
    const { x0, y0, w, h } = objectVisualBox(o)
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
    drawSelectionBox(ctx, objectVisualBox(selected), zoom)
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
      const { x0, y0 } = objectVisualBox(o)
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
