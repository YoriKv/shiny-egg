// Object-drag cell-highlight: paint the dragged object's per-cell provenance
// classes as translucent cell fills. A transient VECTOR overlay drawn on the
// main canvas ctx — it does NOT participate in the Tier-2 backing-canvas / patch
// system. Drawn above the BG1 backing canvas and below the object outline +
// resize handles, so those stay crisp on top. The classes are decode-driven, so
// they're independent of any mid-level tileset/palette band switching (which
// only affects BG1 pixels).
//
// Ported from GoldenEgg's selection tint (GE/Forms/LevelTab.cs:1109-1219, the
// `RenderFlag` enum at :4228): GoldenEgg tints each cell by the selected
// object's decoder provenance (PutTile vs PutrTile `state 0x10`, plus a buried
// check). It inverts the footprint; we use green instead, and show it only
// during a drag.

import type { DecodedObjectInfluence, InfluenceClass } from '../../../../preload/api'
import { CELL_PX } from '../geometry'

/** Translucent fill per provenance class. Green = the object's own visible
 *  footprint; blue = a tile it stamps into a neighbour cell; red = a footprint
 *  cell a later object overdraws (its "shadow"); magenta = both. */
const CLASS_FILL: Record<InfluenceClass, string> = {
  footprint: 'rgba(120, 220, 120, 0.30)',
  neighbor: 'rgba(90, 150, 255, 0.34)',
  buried: 'rgba(235, 90, 80, 0.36)',
  buriedNeighbor: 'rgba(210, 95, 210, 0.36)'
}

export function drawObjectInfluence(
  ctx: CanvasRenderingContext2D,
  influence: DecodedObjectInfluence
): void {
  ctx.save()
  let last: InfluenceClass | null = null
  for (const c of influence.cells) {
    if (c.cls !== last) {
      ctx.fillStyle = CLASS_FILL[c.cls]
      last = c.cls
    }
    ctx.fillRect(c.x * CELL_PX, c.y * CELL_PX, CELL_PX, CELL_PX)
  }
  ctx.restore()
}
