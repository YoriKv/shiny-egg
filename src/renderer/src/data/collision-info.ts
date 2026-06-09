// Renderer-side helpers for summarising the cart's `bg_type_table`
// metadata for a selected object. The Properties panel shows what
// collision behaviour an object stamps into the level grid — when the
// user clicks a `$67` jungle canopy they should see "Solid (AL)"; when
// they click a `$68` coin they should see "None — Tag: coin".
//
// The 28 named secondary tags are duplicated here (mirrors
// `snes-framework/scripts/engine/collision.ts:SECONDARY_TAG_NAMES`)
// because the renderer's tsconfig doesn't reach into the snes-framework
// tree — only the preload `.d.ts` re-exports types from it. The names
// are pure constants so duplication is cheap; a CI check could verify
// drift if it ever becomes a worry.

import type {
  CollisionEntry,
  DecodedLevelLayout,
  LevelObject
} from '../../../preload/api'

const SECONDARY_TAG_NAMES = [
  'none',
  'snow-grass-floor',
  'soap',
  'dented-floor',
  'mud',
  'lava',
  'coin',
  'question-block',
  'edible-bg',
  'rail',
  'damage',
  'stake',
  'stairs-left',
  'stairs-right',
  'falling-floor',
  'switch-block',
  'mario-block',
  'tube-block',
  'countdown-block',
  'waterfall-floor',
  'enemy-pipe', // 0x14 DK — enemy-spawn pipe mouth (not player-enterable; see engine/collision.ts)
  'cedar-tree',
  'switch-coin',
  'ice-block',
  'wobbly-rock',
  'damage-slope-stake',
  'damage-icicle',
  'knockdown',
  '<unused>', '<unused>', '<unused>', '<unused>'
] as const

const PAGE_STRIDE = 1 << 9 // 512 bytes per allocated LRU page
const ROW_STRIDE = 1 << 5  // 32 bytes per row within a page
const SCREEN_PAGE_UNALLOCATED = 0x80

/** Compact human-readable summary of one CollisionEntry. */
function describeEntry(entry: CollisionEntry): string {
  const shapeParts: string[] = []
  if (entry.flags.al) shapeParts.push('AL')
  if (entry.flags.md) shapeParts.push('MD')
  if (entry.flags.sk) shapeParts.push(`SK $${entry.slopeIdx.toString(16).padStart(2, '0')}`)
  if (entry.flags.wt) shapeParts.push('WT')
  if (entry.flags.mg) shapeParts.push('MG')
  if (entry.flags.tn) shapeParts.push('TN')
  const shape = shapeParts.length > 0 ? shapeParts.join('+') : 'NO'

  const extras: string[] = []
  if (entry.tag > 0) {
    const name = SECONDARY_TAG_NAMES[entry.tag] ?? `tag$${entry.tag.toString(16)}`
    extras.push(`tag=${name}`)
  }
  if (entry.doors.dr) extras.push('DR')
  if (entry.doors.bd) extras.push('BD')

  return extras.length > 0 ? `${shape} (${extras.join(', ')})` : shape
}

/** Read the 16-bit Map16 ID at a cell coord from the decoded layout.
 *  Returns 0 (= unstamped) if the screen wasn't allocated or the cell
 *  is out of range. */
function readCellMap16(
  layout: DecodedLevelLayout,
  cellX: number,
  cellY: number
): number {
  if (cellX < 0 || cellX > 255 || cellY < 0 || cellY > 127) return 0
  const screen = ((cellY >> 4) << 4) | (cellX >> 4)
  const slot = layout.screenPageMap[screen]
  if (slot === SCREEN_PAGE_UNALLOCATED) return 0
  const lruPage = slot & 0x3f
  if (lruPage === 0) return 0
  const off =
    lruPage * PAGE_STRIDE +
    ((cellY & 0x0f) * ROW_STRIDE) +
    ((cellX & 0x0f) << 1)
  return layout.levelDataBuffer[off] | (layout.levelDataBuffer[off + 1] << 8)
}

/** Per-object collision summary. The blueprint bbox can include
 *  negative widths (right-anchored objects) and the actual stamp area
 *  may not fully match — we iterate the symbolic rectangle's cells,
 *  collect non-zero Map16 IDs, look up each one's PAGE in the collision
 *  table, then dedupe + describe. */
export interface ObjectCollisionSummary {
  /** Human-readable line for the Properties panel. */
  display: string
  /** Per-page breakdown for cells stamped within this object's bbox.
   *  Surfaced so a future expand-state can drill into individual cells. */
  perPage: { page: number; count: number; description: string }[]
  /** Total cells inspected in the bbox. */
  cellsInspected: number
  /** Cells with a non-zero Map16 ID (i.e. successfully stamped). */
  cellsStamped: number
}

export function summarizeObjectCollision(
  obj: LevelObject,
  layout: DecodedLevelLayout | null,
  table: CollisionEntry[] | null
): ObjectCollisionSummary | null {
  if (!layout || !table) return null

  // Iterate the bbox cells. Handle negative w/h (object grows left/up)
  // via min/abs the same way the draw + hit-test code does.
  const x0 = Math.min(obj.x, obj.x + obj.w)
  const y0 = Math.min(obj.y, obj.y + obj.h)
  const w = Math.max(1, Math.abs(obj.w))
  const h = Math.max(1, Math.abs(obj.h))

  const pageCounts = new Map<number, number>()
  let cellsInspected = 0
  let cellsStamped = 0

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      cellsInspected++
      const id = readCellMap16(layout, x0 + dx, y0 + dy)
      if (id === 0) continue
      cellsStamped++
      const page = (id >>> 8) & 0xff
      pageCounts.set(page, (pageCounts.get(page) ?? 0) + 1)
    }
  }

  if (cellsStamped === 0) {
    return {
      display: 'Unstamped — no Bank13 handler ported yet for this object.',
      perPage: [],
      cellsInspected,
      cellsStamped: 0
    }
  }

  const perPage = [...pageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([page, count]) => {
      const entry = table[page]
      return {
        page,
        count,
        description: entry ? describeEntry(entry) : `<page $${page.toString(16)} out of range>`
      }
    })

  // Single-page case: just show the description. Multi-page: compact
  // "AL ×24, NO ×8" form for at-a-glance read.
  const display = perPage.length === 1
    ? `${perPage[0]!.description} (${perPage[0]!.count} cells)`
    : perPage.map(p => `${p.description} ×${p.count}`).join(', ')

  return { display, perPage, cellsInspected, cellsStamped }
}
