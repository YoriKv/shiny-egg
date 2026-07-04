// Pins the extended-object outline box: ext objects encode no W/H, so instead of
// a meaningless 1×1 box we outline them to the tiles they actually stamp, derived
// from the per-object drawn-tile footprint. Covers the ext-only scoping, the
// anchor-relative offset, the objectVisualBox fallback, and — the correctness
// bit — that applying the box to a drag-shifted anchor translates the whole box.
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { describe, test, expect } from 'vitest'
import { objectOutlineBoxes } from './objects'
import {
  footprintCellBounds,
  objectOutlineBox,
  objectVisualBox,
  CELL_PX,
  LEVEL_CELLS_W
} from '../geometry'
import type { LevelObject } from '../../../../preload/api'

/** Minimal LevelObject — objectOutlineBoxes only reads num/uid/x/y. */
const obj = (o: Partial<LevelObject> & { num: number; x: number; y: number }): LevelObject => ({
  index: 0,
  w: 1,
  h: 1,
  raw: [],
  ...o
})

/** Absolute cell index the footprints use: y*256 + x. */
const cell = (x: number, y: number): number => y * LEVEL_CELLS_W + x

/** All cells in an inclusive x0..x1, y0..y1 rectangle. */
const rect = (x0: number, x1: number, y0: number, y1: number): Set<number> => {
  const out = new Set<number>()
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.add(cell(x, y))
  return out
}

describe('footprintCellBounds', () => {
  test('min corner + inclusive extent from a cell set', () => {
    expect(footprintCellBounds(rect(10, 12, 5, 6))).toEqual({ minX: 10, minY: 5, w: 3, h: 2 })
  })
  test('single cell → 1×1 at that cell', () => {
    expect(footprintCellBounds(new Set([cell(40, 7)]))).toEqual({ minX: 40, minY: 7, w: 1, h: 1 })
  })
  test('empty set → null', () => {
    expect(footprintCellBounds(new Set())).toBeNull()
  })
})

describe('objectOutlineBoxes', () => {
  test('ext object → anchor-relative box for its footprint', () => {
    const objects = [obj({ num: 0, exnum: 0x12, uid: 1, x: 10, y: 5 })]
    const fp = new Map([[1, rect(10, 12, 5, 6)]])
    expect(objectOutlineBoxes(objects, fp).get(1)).toEqual({ offX: 0, offY: 0, w: 3, h: 2 })
  })

  test('footprint offset from the anchor → negative offX/offY', () => {
    // Anchor (10,5) but the object stamps up-and-left of it (x 8..9, y 3..5).
    const objects = [obj({ num: 0, exnum: 0x01, uid: 1, x: 10, y: 5 })]
    const fp = new Map([[1, rect(8, 9, 3, 5)]])
    expect(objectOutlineBoxes(objects, fp).get(1)).toEqual({ offX: -2, offY: -2, w: 2, h: 3 })
  })

  test('standard objects are never included (only ext get a footprint box)', () => {
    const objects = [obj({ num: 0x05, uid: 9, x: 0, y: 0 })]
    const fp = new Map([[9, rect(0, 3, 0, 3)]]) // even with a footprint present
    expect(objectOutlineBoxes(objects, fp).has(9)).toBe(false)
  })

  test('ext object that stamps nothing (no footprint) is omitted', () => {
    const objects = [obj({ num: 0, exnum: 0x99, uid: 2, x: 0, y: 0 })]
    expect(objectOutlineBoxes(objects, new Map()).has(2)).toBe(false)
  })

  test('null footprints (pre-fetch) → empty map', () => {
    const objects = [obj({ num: 0, exnum: 0, uid: 1, x: 0, y: 0 })]
    expect(objectOutlineBoxes(objects, null).size).toBe(0)
  })
})

describe('objectOutlineBox (the drawn box selector)', () => {
  test('ext object with a derived box → world-px box at its anchor', () => {
    const o = obj({ num: 0, exnum: 0x12, uid: 1, x: 10, y: 5 })
    const boxes = objectOutlineBoxes([o], new Map([[1, rect(10, 12, 5, 6)]]))
    expect(objectOutlineBox(o, boxes)).toEqual({
      x0: 10 * CELL_PX,
      y0: 5 * CELL_PX,
      w: 3 * CELL_PX,
      h: 2 * CELL_PX
    })
  })

  test('tracks a move-drag: same box map applied to a shifted anchor translates', () => {
    const committed = obj({ num: 0, exnum: 0x12, uid: 1, x: 10, y: 5 })
    const boxes = objectOutlineBoxes([committed], new Map([[1, rect(10, 12, 5, 6)]]))
    // Drag shifts the anchor +10x/+3y (footprints don't refetch mid-drag).
    const dragged = { ...committed, x: 20, y: 8 }
    expect(objectOutlineBox(dragged, boxes)).toEqual({
      x0: 20 * CELL_PX,
      y0: 8 * CELL_PX,
      w: 3 * CELL_PX,
      h: 2 * CELL_PX
    })
  })

  test('no derived box → falls back to objectVisualBox (unchanged for std objects)', () => {
    const o = obj({ num: 0x05, uid: 9, x: 4, y: 3, w: 6, h: 2 })
    expect(objectOutlineBox(o, new Map())).toEqual(objectVisualBox(o))
  })
})
