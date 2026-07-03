// Pins the multi-select set policy: unionSelections (dedup) and the shift-click
// rule (add-next-in-stack, never-deselect-on-overlap). Most geometry hit-tests
// (hitTestRect etc.) need a DOMRect/view and are exercised in-app; the spawn
// hit-test's `spawnPos` override (world-map draft) is pinned here since it's the
// correctness bit that keeps a moved marker grabbable.
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { describe, test, expect } from 'vitest'
import { applyShiftClick, unionSelections, hitTestAll, hitTestSpawn } from './hit-test'
import type { IncomingExit, LayerVisibility, Selection } from '../types'
import type { LevelData } from '../../../preload/api'
import type { View } from './view'

const o = (uid: number): Selection => ({ kind: 'object', uid })
const s = (uid: number): Selection => ({ kind: 'sprite', uid })
const keys = (sel: Selection[]): string[] =>
  sel.map((x) => `${x.kind[0]}${(x as { uid: number }).uid}`)

describe('unionSelections', () => {
  test('appends only entities not already present (by identity)', () => {
    expect(keys(unionSelections([o(1), s(2)], [o(1), o(3), s(2), s(4)]))).toEqual([
      'o1', 's2', 'o3', 's4'
    ])
  })
  test('an object and a sprite with the same uid are distinct', () => {
    expect(keys(unionSelections([o(5)], [s(5)]))).toEqual(['o5', 's5'])
  })
})

describe('applyShiftClick', () => {
  test('no hits → unchanged', () => {
    expect(applyShiftClick([o(1)], [])).toEqual([o(1)])
  })

  test('single unselected hit → added', () => {
    expect(keys(applyShiftClick([o(1)], [o(2)]))).toEqual(['o1', 'o2'])
  })

  test('single already-selected hit → toggled off (deselect one at a time)', () => {
    expect(applyShiftClick([o(1), o(2)], [o(2)])).toEqual([o(1)])
  })

  test('overlap, none selected → adds the top of the stack', () => {
    // hits are top-drawn first; sprites stack above objects.
    expect(keys(applyShiftClick([], [s(7), o(3)]))).toEqual(['s7'])
  })

  test('overlap, top already selected → adds the next one down (walks the stack)', () => {
    expect(keys(applyShiftClick([s(7)], [s(7), o(3)]))).toEqual(['s7', 'o3'])
  })

  test('overlap, all already selected → unchanged (never deselect on overlap)', () => {
    expect(applyShiftClick([s(7), o(3)], [s(7), o(3)])).toEqual([s(7), o(3)])
  })
})

// Spawn hit-test `spawnPos` override (world-map entrance-table draft). With
// pan=0/zoom=1 and rect at the origin, world px == client px, so a cell (cx,cy)'s
// marker centre sits at ((cx+0.5)*16, (cy+0.5)*16); SPAWN_HIT_HALF_PX is 10.
describe('spawn hit-test override', () => {
  const view: View = { panX: 0, panY: 0, zoom: 1 }
  const rect = { left: 0, top: 0 } as DOMRect
  const layers = { spriteOutlines: true, exits: false } as LayerVisibility
  const noIncoming: IncomingExit[] = []
  const bounds = null // SpriteBoundsMap accepts null
  const footprints = null // ObjectFootprints; null ⇒ objects box-fallback (no objects here)
  // Base spawn at cell (5,5) → centre (88,88).
  const level = {
    empty: false,
    special: false,
    spawn: { x: 5, y: 5 },
    objects: [],
    sprites: [],
    exits: []
  } as unknown as LevelData
  const spawnHit = (hits: Selection[]): Selection | undefined => hits.find((h) => h.kind === 'spawn')

  test('param omitted → falls back to level.spawn (base position)', () => {
    expect(spawnHit(hitTestAll(level, view, layers, noIncoming, rect, 88, 88, bounds, footprints))).toEqual({
      kind: 'spawn',
      spawn: { x: 5, y: 5 }
    })
  })

  test('override relocates the hit point — moved marker is grabbable, base no longer hits', () => {
    // Override spawn to cell (10,10) → centre (168,168).
    expect(
      spawnHit(hitTestAll(level, view, layers, noIncoming, rect, 168, 168, bounds, footprints, { x: 10, y: 10 }))
    ).toEqual({ kind: 'spawn', spawn: { x: 10, y: 10 } })
    expect(
      spawnHit(hitTestAll(level, view, layers, noIncoming, rect, 88, 88, bounds, footprints, { x: 10, y: 10 }))
    ).toBeUndefined()
  })

  test('explicit null override → spawn not selectable (level has no entrance)', () => {
    expect(spawnHit(hitTestAll(level, view, layers, noIncoming, rect, 88, 88, bounds, footprints, null))).toBeUndefined()
  })

  test('hitTestSpawn (hover) honours the override', () => {
    expect(hitTestSpawn(level, view, layers, rect, 168, 168, { x: 10, y: 10 })).toBe(true)
    expect(hitTestSpawn(level, view, layers, rect, 88, 88, { x: 10, y: 10 })).toBe(false)
    expect(hitTestSpawn(level, view, layers, rect, 88, 88, null)).toBe(false)
  })
})

// Drawn-tiles object hit-testing: an object's clickable region is its stamped
// cells (footprints), not its bounding box. With pan=0/zoom=1 at the origin,
// cell (cx,cy)'s centre is ((cx+0.5)*16, (cy+0.5)*16) and cellIndexAt = cy*256+cx.
describe('drawn-tiles object hit-testing', () => {
  const view: View = { panX: 0, panY: 0, zoom: 1 }
  const rect = { left: 0, top: 0 } as DOMRect
  // Object-only: sprite/spawn/exit layers off so only the object loop runs.
  const layers = { bg1Outlines: true, spriteOutlines: false, exits: false } as unknown as LayerVisibility
  const noIncoming: IncomingExit[] = []
  const bounds = null
  const level = {
    empty: false,
    special: false,
    objects: [
      { uid: 1, num: 0x10, x: 2, y: 3, w: 1, h: 1 }, // stamps cell (2,3)
      { uid: 2, num: 0x11, x: 2, y: 3, w: 1, h: 1 }, // ALSO stamps (2,3) — drawn later ⇒ on top
      { uid: 3, num: 0x12, x: 5, y: 5, w: 1, h: 1 } // command obj: no footprint ⇒ box fallback
    ],
    sprites: [],
    exits: []
  } as unknown as LevelData
  const CELL_2_3 = 3 * 256 + 2
  // uid 1 + 2 both stamp (2,3); uid 3 stamps nothing (absent from the map).
  const footprints = new Map<number, Set<number>>([
    [1, new Set([CELL_2_3])],
    [2, new Set([CELL_2_3])]
  ])
  const objUids = (hits: Selection[]): number[] =>
    hits.filter((h) => h.kind === 'object').map((h) => (h as { uid: number }).uid)

  test('click on a drawn cell → stack top-first, INCLUDING the buried object', () => {
    // Centre of cell (2,3) = (40, 56). Both objects stamp it; uid 2 is on top.
    expect(objUids(hitTestAll(level, view, layers, noIncoming, rect, 40, 56, bounds, footprints))).toEqual([2, 1])
  })

  test('click off every footprint cell selects nothing (tiles are the region, not the box)', () => {
    // Cell (2,4) = centre (40, 72): not a stamped cell, and outside uid 3's box.
    expect(objUids(hitTestAll(level, view, layers, noIncoming, rect, 40, 72, bounds, footprints))).toEqual([])
  })

  test('an object that stamps nothing falls back to its bounding box', () => {
    // uid 3 box = cell (5,5) = centre (88, 88).
    expect(objUids(hitTestAll(level, view, layers, noIncoming, rect, 88, 88, bounds, footprints))).toEqual([3])
  })

  test('null footprints → every object box-fallback (pre-refetch / legacy behaviour)', () => {
    // With no footprint data, uid 1 + 2 boxes both cover cell (2,3) ⇒ both hit.
    expect(objUids(hitTestAll(level, view, layers, noIncoming, rect, 40, 56, bounds, null))).toEqual([2, 1])
  })
})
