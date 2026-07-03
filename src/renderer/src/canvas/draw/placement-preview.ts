// Placement preview: a ghost of the armed picker entity (PlacementItem) drawn at
// the cursor cell while the Place tool is armed — the "as if being dragged"
// affordance shown BEFORE a click actually commits it (nothing is added to the
// level / saved until the click). Deliberately styled distinct from selection
// (chartreuse) and hover: a DASHED cyan box + translucent cyan fill so it reads
// unmistakably as a not-yet-placed preview. Objects show their footprint (so it
// tracks the Shift+arrow resize live) + anchor dot; sprites their cel / 1-cell
// box; exits highlight the whole target SCREEN (exits are per-screen singletons).
// No IPC — the box follows the cursor at pointer rate, mirroring the live drag
// overlays in scene.ts.

import type { LevelSprite } from '../../../../preload/api'
import type { PlacementItem } from '../../types'
import type { SpriteBoundsMap } from '../hit-test'
import { CELL_PX, SCREEN_CELLS, objectVisualBox } from '../geometry'
import { spriteOutlineBox } from './sprites'
import { drawAnchorDot } from './selection'
import { beginIdLabels, drawIdLabel } from './text'
import { hex } from '../../lib/hex'

const PREVIEW_ACCENT = 'rgba(120, 220, 255, 0.95)'
const PREVIEW_FILL = 'rgba(120, 220, 255, 0.14)'

/** Id tag for the ghost — matches the placed-entity outline tags (objectHex /
 *  3-digit sprite hex) so the preview reads with the same vocabulary. */
function previewTag(item: PlacementItem): string {
  if (item.kind === 'object') {
    return item.num === 0 && item.exnum !== undefined ? `e${hex(item.exnum, 2)}` : hex(item.num, 2)
  }
  if (item.kind === 'sprite') return hex(item.num, 3)
  return 'exit'
}

/**
 * Draw the armed placement preview at cell `(cx, cy)` (the cursor cell). Pure
 * ctx drawing — self-contained save/restore so it never leaks the dash / fill
 * state into the rest of the scene.
 */
export function drawPlacementPreview(
  ctx: CanvasRenderingContext2D,
  item: PlacementItem,
  cx: number,
  cy: number,
  zoom: number,
  spriteBounds: SpriteBoundsMap
): void {
  ctx.save()

  // Exits are per-screen singletons — a click adds the exit to the clicked
  // cell's whole screen, so preview the target screen rather than a cell box.
  if (item.kind === 'exit') {
    const col = cx >> 4
    const row = cy >> 4
    const x0 = col * SCREEN_CELLS * CELL_PX
    const y0 = row * SCREEN_CELLS * CELL_PX
    const s = SCREEN_CELLS * CELL_PX
    ctx.fillStyle = PREVIEW_FILL
    ctx.fillRect(x0, y0, s, s)
    ctx.lineWidth = 1.5 / zoom
    ctx.setLineDash([4 / zoom, 3 / zoom])
    ctx.strokeStyle = PREVIEW_ACCENT
    ctx.strokeRect(x0, y0, s, s)
    ctx.restore()
    return
  }

  // Object footprint (tracks live Shift+arrow resize via item.w/h) or sprite
  // cel / 1-cell box, both anchored at the cursor cell.
  const box =
    item.kind === 'object'
      ? objectVisualBox({ x: cx, y: cy, w: item.w, h: item.h })
      : spriteOutlineBox({ num: item.num, x: cx, y: cy } as LevelSprite, spriteBounds)

  const inset = 0.75 / zoom
  ctx.fillStyle = PREVIEW_FILL
  ctx.fillRect(box.x0, box.y0, box.w, box.h)
  ctx.lineWidth = 1.5 / zoom
  ctx.setLineDash([4 / zoom, 3 / zoom])
  ctx.strokeStyle = PREVIEW_ACCENT
  ctx.strokeRect(box.x0 + inset, box.y0 + inset, box.w - inset * 2, box.h - inset * 2)

  // Anchor dot (the (x, y) the size/cel grows from) — cyan, matching the ghost.
  ctx.setLineDash([])
  drawAnchorDot(ctx, cx, cy, zoom, false, PREVIEW_ACCENT)

  // Id tag in the box's top-left, mirroring the placed-entity outline labels —
  // only once zoomed in enough to be legible (matches the object/sprite labels).
  if (zoom >= 1) {
    const adv = beginIdLabels(ctx, zoom)
    drawIdLabel(ctx, box.x0, box.y0, previewTag(item), zoom, adv)
  }

  ctx.restore()
}
