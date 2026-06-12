// Tests the core editing model: the level reducer's undo/redo + the `commits`
// counter. The counter discipline (bumped only on a real committing edit; left
// untouched by undo/redo/saved; reset on load) is the contract the unified
// undo system (hooks/useUnifiedHistory) depends on to interleave loaded-level
// edits with cross-level edits — so it's worth pinning directly.
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { describe, test, expect } from 'vitest'
import { levelReducer, INITIAL_LEVEL_STATE, isDirty, type LevelState } from './level-reducer'
import type { LevelData, LevelObject, LevelSprite } from '../../../preload/api'

function obj(num: number, x: number, y: number, w = 1, h = 1): LevelObject {
  return { uid: -1, index: 0, num, x, y, w, h, raw: [] } as unknown as LevelObject
}
function spr(num: number, x: number, y: number): LevelSprite {
  return { uid: -1, index: 0, num, x, y } as unknown as LevelSprite
}
function loaded(objects: LevelObject[], sprites: LevelSprite[] = []): LevelState {
  const data = { recordId: 0x10, empty: false, special: false, header: [], objects, sprites, exits: [] }
  return levelReducer(INITIAL_LEVEL_STATE, { type: 'load', data: data as unknown as LevelData })
}

describe('load', () => {
  test('stamps sequential uids (objects then sprites) and sets nextUid', () => {
    const s = loaded([obj(1, 0, 0), obj(2, 1, 1)], [spr(3, 2, 2)])
    expect(s.level!.objects.map((o) => o.uid)).toEqual([0, 1])
    expect(s.level!.sprites.map((sp) => sp.uid)).toEqual([2])
    expect(s.nextUid).toBe(3)
    expect(s.commits).toBe(0)
    expect(s.past).toEqual([])
    expect(s.future).toEqual([])
    expect(isDirty(s)).toBe(false) // base === level at load → clean
  })

  test('load null clears the document', () => {
    const s = levelReducer(loaded([obj(1, 0, 0)]), { type: 'load', data: null })
    expect(s.level).toBeNull()
    expect(s.base).toBeNull()
    expect(s.commits).toBe(0)
  })
})

describe('commits counter (the contract useUnifiedHistory relies on)', () => {
  test('a committing edit bumps commits by exactly 1, pushes undo, clears redo, dirties', () => {
    const s0 = loaded([obj(1, 5, 5)])
    const uid = s0.level!.objects[0]!.uid!
    const s1 = levelReducer(s0, { type: 'moveObject', uid, dx: 2, dy: 0 })
    expect(s1.commits).toBe(1)
    expect(s1.level!.objects[0]!.x).toBe(7)
    expect(s1.past.length).toBe(1)
    expect(s1.future).toEqual([])
    expect(isDirty(s1)).toBe(true)
  })

  test('a no-op action returns the SAME state object (commits NOT bumped)', () => {
    const s0 = loaded([obj(1, 5, 5)])
    const uid = s0.level!.objects[0]!.uid!
    expect(levelReducer(s0, { type: 'moveObject', uid, dx: 0, dy: 0 })).toBe(s0) // clamps to zero delta
    expect(levelReducer(s0, { type: 'moveObject', uid: 9999, dx: 1, dy: 1 })).toBe(s0) // unknown uid
  })

  test('undo / redo / saved leave commits untouched', () => {
    const s0 = loaded([obj(1, 5, 5)])
    const uid = s0.level!.objects[0]!.uid!
    const s1 = levelReducer(s0, { type: 'moveObject', uid, dx: 3, dy: 0 })
    expect(levelReducer(s1, { type: 'undo' }).commits).toBe(1)
    expect(levelReducer(levelReducer(s1, { type: 'undo' }), { type: 'redo' }).commits).toBe(1)
    expect(levelReducer(s1, { type: 'saved' }).commits).toBe(1)
  })
})

describe('undo / redo', () => {
  test('undo back to the load snapshot restores reference-equality (clean)', () => {
    const s0 = loaded([obj(1, 5, 5)])
    const uid = s0.level!.objects[0]!.uid!
    const s1 = levelReducer(s0, { type: 'moveObject', uid, dx: 3, dy: 0 })
    const s2 = levelReducer(s1, { type: 'undo' })
    expect(s2.level).toBe(s0.level) // same reference the reducer loaded
    expect(isDirty(s2)).toBe(false)
    expect(s2.future.length).toBe(1)
  })

  test('redo re-applies the undone edit', () => {
    const s0 = loaded([obj(1, 5, 5)])
    const uid = s0.level!.objects[0]!.uid!
    const s1 = levelReducer(s0, { type: 'moveObject', uid, dx: 3, dy: 0 })
    const s3 = levelReducer(levelReducer(s1, { type: 'undo' }), { type: 'redo' })
    expect(s3.level!.objects[0]!.x).toBe(8)
  })

  test('a fresh edit after undo discards the redo future', () => {
    const s0 = loaded([obj(1, 5, 5)])
    const uid = s0.level!.objects[0]!.uid!
    const s1 = levelReducer(s0, { type: 'moveObject', uid, dx: 3, dy: 0 })
    const s2 = levelReducer(s1, { type: 'undo' })
    expect(levelReducer(s2, { type: 'moveObject', uid, dx: 1, dy: 0 }).future).toEqual([])
  })
})

describe('saved', () => {
  test('pulls base to the current level so isDirty flips false', () => {
    const s0 = loaded([obj(1, 5, 5)])
    const uid = s0.level!.objects[0]!.uid!
    const s1 = levelReducer(s0, { type: 'moveObject', uid, dx: 1, dy: 0 })
    expect(isDirty(s1)).toBe(true)
    expect(isDirty(levelReducer(s1, { type: 'saved' }))).toBe(false)
  })
})

describe('add / delete', () => {
  test('addObject appends, bumps nextUid + commits, and clamps the cell in-bounds', () => {
    const s0 = loaded([])
    const s1 = levelReducer(s0, { type: 'addObject', template: { num: 4, x: 9999, y: -5, w: 1, h: 1 } })
    expect(s1.level!.objects.length).toBe(1)
    expect(s1.nextUid).toBe(s0.nextUid + 1)
    expect(s1.commits).toBe(1)
    const o = s1.level!.objects[0]!
    expect(o.x).toBeGreaterThanOrEqual(0)
    expect(o.x).toBeLessThan(256)
    expect(o.y).toBe(0) // -5 clamps up to 0
  })

  test('deleteObject removes by uid and reindexes the survivors', () => {
    const s0 = loaded([obj(1, 0, 0), obj(2, 1, 1), obj(3, 2, 2)])
    const mid = s0.level!.objects[1]!.uid!
    const s1 = levelReducer(s0, { type: 'deleteObject', uid: mid })
    expect(s1.level!.objects.map((o) => o.num)).toEqual([1, 3])
    expect(s1.level!.objects.map((o) => o.index)).toEqual([0, 1]) // reindexed to positions
    expect(s1.commits).toBe(1)
  })
})

describe('deleteEntities (Erase tool batch delete)', () => {
  test('removes objects + sprites in one commit, reindexing both survivor lists', () => {
    const s0 = loaded([obj(1, 0, 0), obj(2, 1, 1), obj(3, 2, 2)], [spr(4, 0, 0), spr(5, 1, 1)])
    const o0 = s0.level!.objects[0]!.uid!
    const o2 = s0.level!.objects[2]!.uid!
    const sp1 = s0.level!.sprites[1]!.uid!
    const s1 = levelReducer(s0, { type: 'deleteEntities', objectUids: [o0, o2], spriteUids: [sp1] })
    expect(s1.level!.objects.map((o) => o.num)).toEqual([2])
    expect(s1.level!.sprites.map((sp) => sp.num)).toEqual([4])
    expect(s1.level!.objects.map((o) => o.index)).toEqual([0]) // reindexed
    expect(s1.commits).toBe(1) // ONE commit for the whole sweep (one undo step)
    expect(s1.past.length).toBe(1)
  })

  test('keeps the untouched slice ref (structural-sharing invariant)', () => {
    const s0 = loaded([obj(1, 0, 0), obj(2, 1, 1)], [spr(3, 0, 0)])
    const o0 = s0.level!.objects[0]!.uid!
    // Only objects targeted → sprites slice ref must be preserved so the sprite
    // render layer isn't needlessly re-fetched.
    const s1 = levelReducer(s0, { type: 'deleteEntities', objectUids: [o0], spriteUids: [] })
    expect(s1.level!.sprites).toBe(s0.level!.sprites)
    expect(s1.level!.objects).not.toBe(s0.level!.objects)
  })

  test('an all-unmatched / empty sweep is a no-op (same state, commits untouched)', () => {
    const s0 = loaded([obj(1, 0, 0)], [spr(2, 0, 0)])
    expect(levelReducer(s0, { type: 'deleteEntities', objectUids: [], spriteUids: [] })).toBe(s0)
    expect(levelReducer(s0, { type: 'deleteEntities', objectUids: [9999], spriteUids: [8888] })).toBe(s0)
  })
})

describe('moveEntities (multi-select drag / arrow move)', () => {
  test('translates every member by one shared delta in a single commit', () => {
    const s0 = loaded([obj(1, 5, 5), obj(2, 8, 8)], [spr(3, 10, 10)])
    const [o1, o2] = [s0.level!.objects[0]!.uid!, s0.level!.objects[1]!.uid!]
    const sp = s0.level!.sprites[0]!.uid!
    const s1 = levelReducer(s0, {
      type: 'moveEntities',
      objectUids: [o1, o2],
      spriteUids: [sp],
      dx: 3,
      dy: -2
    })
    expect(s1.level!.objects.map((o) => [o.x, o.y])).toEqual([[8, 3], [11, 6]])
    expect(s1.level!.sprites.map((s) => [s.x, s.y])).toEqual([[13, 8]])
    expect(s1.commits).toBe(1)
  })

  test('clamps the group rigidly — the whole group stops when one member hits an edge', () => {
    // obj at x=2 and obj at x=10; a dx of -5 would push the first to x=-3, so the
    // group is clamped to dx=-2 (both shift by the same -2, no shearing).
    const s0 = loaded([obj(1, 2, 5), obj(2, 10, 5)])
    const s1 = levelReducer(s0, {
      type: 'moveEntities',
      objectUids: s0.level!.objects.map((o) => o.uid!),
      spriteUids: [],
      dx: -5,
      dy: 0
    })
    expect(s1.level!.objects.map((o) => o.x)).toEqual([0, 8])
  })

  test('keeps the untouched slice ref when only one kind moves; no-op stays same state', () => {
    const s0 = loaded([obj(1, 5, 5)], [spr(2, 5, 5)])
    const s1 = levelReducer(s0, {
      type: 'moveEntities',
      objectUids: [s0.level!.objects[0]!.uid!],
      spriteUids: [],
      dx: 1,
      dy: 1
    })
    expect(s1.level!.sprites).toBe(s0.level!.sprites)
    expect(s1.level!.objects).not.toBe(s0.level!.objects)
    // A zero net move (already at the edge, pushed further out) is a no-op.
    const atEdge = loaded([obj(1, 0, 0)])
    expect(
      levelReducer(atEdge, {
        type: 'moveEntities',
        objectUids: [atEdge.level!.objects[0]!.uid!],
        spriteUids: [],
        dx: -3,
        dy: -3
      })
    ).toBe(atEdge)
  })
})

describe('addEntities (multi Duplicate / Paste batch add)', () => {
  test('appends objects then sprites, assigning uids objects-first in array order', () => {
    const s0 = loaded([obj(1, 0, 0)], [spr(2, 0, 0)]) // nextUid = 2
    const base = s0.nextUid
    const s1 = levelReducer(s0, {
      type: 'addEntities',
      objects: [obj(0xa, 5, 5), obj(0xb, 6, 6)],
      sprites: [spr(0xc, 7, 7)]
    })
    // Two objects then one sprite → uids base, base+1 (objects), base+2 (sprite).
    expect(s1.level!.objects.map((o) => o.uid)).toEqual([0, base, base + 1])
    expect(s1.level!.sprites.map((sp) => sp.uid)).toEqual([1, base + 2])
    expect(s1.nextUid).toBe(base + 3)
    expect(s1.commits).toBe(1) // single commit for the whole batch
    expect(s1.level!.objects.map((o) => o.index)).toEqual([0, 1, 2]) // reindexed
  })

  test('keeps the untouched slice ref when only one kind is added', () => {
    const s0 = loaded([obj(1, 0, 0)], [spr(2, 0, 0)])
    const s1 = levelReducer(s0, { type: 'addEntities', objects: [obj(9, 1, 1)], sprites: [] })
    expect(s1.level!.sprites).toBe(s0.level!.sprites) // sprites slice ref preserved
    expect(s1.level!.objects).not.toBe(s0.level!.objects)
  })

  test('clamps coords into bounds and is a no-op when both lists are empty', () => {
    const s0 = loaded([])
    expect(levelReducer(s0, { type: 'addEntities', objects: [], sprites: [] })).toBe(s0)
    const s1 = levelReducer(s0, { type: 'addEntities', objects: [obj(4, 9999, -5)], sprites: [] })
    const o = s1.level!.objects[0]!
    expect(o.x).toBeLessThan(256)
    expect(o.x).toBeGreaterThanOrEqual(0)
    expect(o.y).toBe(0)
  })
})

describe('setObjectIndex / setSpriteIndex (reorder slider)', () => {
  test('moves an object to an absolute position and reindexes', () => {
    const s0 = loaded([obj(1, 0, 0), obj(2, 1, 1), obj(3, 2, 2)]) // uids 0,1,2
    const s1 = levelReducer(s0, { type: 'setObjectIndex', uid: 0, index: 2 })
    expect(s1.level!.objects.map((o) => o.uid)).toEqual([1, 2, 0])
    expect(s1.level!.objects.map((o) => o.index)).toEqual([0, 1, 2]) // reindexed to array pos
    expect(s1.commits).toBe(1)
    expect(s1.past.length).toBe(1)
  })

  test('clamps an out-of-range index to the last position', () => {
    const s0 = loaded([obj(1, 0, 0), obj(2, 1, 1)])
    const s1 = levelReducer(s0, { type: 'setObjectIndex', uid: 0, index: 99 })
    expect(s1.level!.objects.map((o) => o.uid)).toEqual([1, 0])
    expect(s1.commits).toBe(1)
  })

  // The slider fires idempotent throttled dispatches; landing on the current
  // index must NOT commit (else a continuous drag would pile up undo entries).
  test('no-op when already at that index → SAME state, no commit/undo entry', () => {
    const s0 = loaded([obj(1, 0, 0), obj(2, 1, 1)])
    const s1 = levelReducer(s0, { type: 'setObjectIndex', uid: 0, index: 0 })
    expect(s1).toBe(s0)
    expect(s1.commits).toBe(0)
  })

  test('setSpriteIndex moves a sprite and reindexes', () => {
    const s0 = loaded([], [spr(1, 0, 0), spr(2, 1, 1), spr(3, 2, 2)]) // uids 0,1,2
    const s1 = levelReducer(s0, { type: 'setSpriteIndex', uid: 2, index: 0 })
    expect(s1.level!.sprites.map((sp) => sp.uid)).toEqual([2, 0, 1])
    expect(s1.level!.sprites.map((sp) => sp.index)).toEqual([0, 1, 2])
    expect(s1.commits).toBe(1)
  })
})

describe('reorderObject / reorderSprite (±1 bring-forward / send-back)', () => {
  test('reorderSprite swaps with the neighbour and reindexes', () => {
    const s0 = loaded([], [spr(1, 0, 0), spr(2, 1, 1), spr(3, 2, 2)]) // uids 0,1,2
    const fwd = levelReducer(s0, { type: 'reorderSprite', uid: 0, delta: 1 }) // bring forward
    expect(fwd.level!.sprites.map((sp) => sp.uid)).toEqual([1, 0, 2])
    expect(fwd.level!.sprites.map((sp) => sp.index)).toEqual([0, 1, 2])
    expect(fwd.commits).toBe(1)
  })

  test('reorderSprite at the stream edge is a no-op (SAME state)', () => {
    const s0 = loaded([], [spr(1, 0, 0), spr(2, 1, 1)])
    expect(levelReducer(s0, { type: 'reorderSprite', uid: 0, delta: -1 })).toBe(s0) // already at back
    expect(levelReducer(s0, { type: 'reorderSprite', uid: 1, delta: 1 })).toBe(s0) // already at front
  })
})

describe('reorderEntities (multi-select group ±1)', () => {
  test('forward shifts every selected object past its unselected neighbour', () => {
    // uids 0,1,2,3; select the non-contiguous {0, 2}.
    const s0 = loaded([obj(1, 0, 0), obj(2, 1, 1), obj(3, 2, 2), obj(4, 3, 3)])
    const s1 = levelReducer(s0, { type: 'reorderEntities', objectUids: [0, 2], spriteUids: [], delta: 1 })
    expect(s1.level!.objects.map((o) => o.uid)).toEqual([1, 0, 3, 2]) // 0→1, 2→3
    expect(s1.level!.objects.map((o) => o.index)).toEqual([0, 1, 2, 3])
    expect(s1.commits).toBe(1)
  })

  test('a contiguous block at the stream edge is a no-op (SAME state)', () => {
    const s0 = loaded([obj(1, 0, 0), obj(2, 1, 1), obj(3, 2, 2)])
    // {1,2} are the top two → can't move forward.
    expect(levelReducer(s0, { type: 'reorderEntities', objectUids: [1, 2], spriteUids: [], delta: 1 })).toBe(s0)
  })

  test('shifts objects + sprites together; untouched slice keeps its ref', () => {
    // obj uid 0; sprites uids 1,2,3.
    const s0 = loaded([obj(1, 0, 0)], [spr(2, 0, 0), spr(3, 1, 1), spr(4, 2, 2)])
    const s1 = levelReducer(s0, { type: 'reorderEntities', objectUids: [0], spriteUids: [3], delta: -1 })
    // the lone object is already at the back edge → objects slice unchanged (ref kept).
    expect(s1.level!.objects).toBe(s0.level!.objects)
    // sprite uid 3 moves back one.
    expect(s1.level!.sprites.map((sp) => sp.uid)).toEqual([1, 3, 2])
    expect(s1.commits).toBe(1)
  })
})

describe('setHeaderField (level header editor)', () => {
  // header.ts bit widths: [5,4,5,5,6,6,6,7,4,5,6,5,5,4,2]. The reducer never
  // imports the engine; it clamps via canvas/limits' renderer mirror.
  const header = (): number[] => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1]
  function withHeader(h: number[]): LevelState {
    const data = { recordId: 0x10, empty: false, special: false, header: h, objects: [obj(1, 0, 0)], sprites: [spr(2, 0, 0)], exits: [] }
    return levelReducer(INITIAL_LEVEL_STATE, { type: 'load', data: data as unknown as LevelData })
  }

  test('sets a field, bumps commits, dirties, and returns a NEW header ref', () => {
    const s0 = withHeader(header())
    const s1 = levelReducer(s0, { type: 'setHeaderField', index: 1, value: 0xc })
    expect(s1.level!.header[1]).toBe(0xc)
    expect(s1.level!.header).not.toBe(s0.level!.header) // new array (render layers key on it)
    expect(s1.commits).toBe(1)
    expect(isDirty(s1)).toBe(true)
  })

  test('keeps the objects/sprites slice refs (structural-sharing invariant)', () => {
    const s0 = withHeader(header())
    const s1 = levelReducer(s0, { type: 'setHeaderField', index: 0, value: 0x1f })
    expect(s1.level!.objects).toBe(s0.level!.objects)
    expect(s1.level!.sprites).toBe(s0.level!.sprites)
  })

  test('clamps to the field bit-width (field 1 = 4 bits → 15; field 14 = 2 bits → 3)', () => {
    const s0 = withHeader(header())
    expect(levelReducer(s0, { type: 'setHeaderField', index: 1, value: 99 }).level!.header[1]).toBe(15)
    expect(levelReducer(s0, { type: 'setHeaderField', index: 14, value: 99 }).level!.header[14]).toBe(3)
    expect(levelReducer(s0, { type: 'setHeaderField', index: 0, value: -5 }).level!.header[0]).toBe(0)
  })

  test('no-op when the clamped value equals the current value → SAME state', () => {
    const s0 = withHeader(header())
    expect(levelReducer(s0, { type: 'setHeaderField', index: 1, value: 1 })).toBe(s0) // already 1
    expect(levelReducer(s0, { type: 'setHeaderField', index: 14, value: 1 })).toBe(s0) // already 1
    // 14 is a 2-bit field (max 3); 7 clamps to 3, which differs from 1 → NOT a no-op
    expect(levelReducer(s0, { type: 'setHeaderField', index: 14, value: 7 })).not.toBe(s0)
  })

  test('an index outside the header is a no-op (SAME state)', () => {
    const s0 = withHeader(header())
    expect(levelReducer(s0, { type: 'setHeaderField', index: 99, value: 1 })).toBe(s0)
  })

  test('is undoable — undo restores the prior header value', () => {
    const s0 = withHeader(header())
    const s1 = levelReducer(s0, { type: 'setHeaderField', index: 2, value: 0x1f })
    const s2 = levelReducer(s1, { type: 'undo' })
    expect(s2.level!.header[2]).toBe(2)
    expect(isDirty(s2)).toBe(false)
  })
})

describe('addExit (the Place tool "Exit / Special" entry)', () => {
  test('adds a self-warp on the clicked cell\'s screen and takes nextUid', () => {
    const s0 = loaded([obj(1, 0, 0)])
    const s1 = levelReducer(s0, {
      type: 'addExit',
      screenIndex: ((0x25 >> 4) << 4) | (0x37 >> 4), // cell (0x37, 0x25) → screen 0x23
      dest: { levelRecordId: 0x10, x: 0x37, y: 0x25 }
    })
    expect(s1.commits).toBe(1)
    expect(s1.level!.exits).toHaveLength(1)
    const e = s1.level!.exits[0]!
    expect(e.variant).toBe('warp')
    expect(e.screenIndex).toBe(0x23)
    expect(e.uid).toBe(s0.nextUid)
    expect(s1.nextUid).toBe(s0.nextUid + 1)
    if (e.variant === 'warp') {
      expect(e.destLevelRecordId).toBe(0x10)
      expect(e.destX).toBe(0x37)
      expect(e.destY).toBe(0x25)
      expect(e.entranceType).toBe(0)
    }
  })

  test('an occupied screen is a no-op (SAME state — one exit per screen)', () => {
    const s0 = loaded([obj(1, 0, 0)])
    const s1 = levelReducer(s0, {
      type: 'addExit',
      screenIndex: 0x05,
      dest: { levelRecordId: 0x10, x: 80, y: 8 }
    })
    expect(
      levelReducer(s1, { type: 'addExit', screenIndex: 0x05, dest: { levelRecordId: 0x10, x: 81, y: 9 } })
    ).toBe(s1)
  })

  test('is undoable', () => {
    const s0 = loaded([obj(1, 0, 0)])
    const s1 = levelReducer(s0, {
      type: 'addExit',
      screenIndex: 0x05,
      dest: { levelRecordId: 0x10, x: 80, y: 8 }
    })
    const s2 = levelReducer(s1, { type: 'undo' })
    expect(s2.level!.exits).toHaveLength(0)
    expect(isDirty(s2)).toBe(false)
  })
})

describe('setExitVariant (warp ↔ minibattle conversion)', () => {
  function withExit(): LevelState {
    const s0 = loaded([obj(1, 0, 0)])
    return levelReducer(s0, {
      type: 'addExit',
      screenIndex: 0x12,
      dest: { levelRecordId: 0x2a, x: 40, y: 33 }
    })
  }

  test('warp → minibattle maps dest → return and seeds minibattleId 0xDE', () => {
    const s1 = withExit()
    const uid = s1.level!.exits[0]!.uid!
    const s2 = levelReducer(s1, { type: 'setExitVariant', uid, variant: 'minibattle' })
    const e = s2.level!.exits[0]!
    expect(e.variant).toBe('minibattle')
    expect(e.screenIndex).toBe(0x12)
    expect(e.uid).toBe(uid)
    if (e.variant === 'minibattle') {
      expect(e.minibattleId).toBe(0xde)
      expect(e.returnX).toBe(40)
      expect(e.returnY).toBe(33)
      expect(e.returnLevelRecordId).toBe(0x2a)
      // no stale warp keys on the converted record (clean payload swap)
      expect('destLevelRecordId' in e).toBe(false)
    }
  })

  test('round-trips back to warp (return → dest, entranceType reset)', () => {
    const s1 = withExit()
    const uid = s1.level!.exits[0]!.uid!
    const s2 = levelReducer(s1, { type: 'setExitVariant', uid, variant: 'minibattle' })
    const s3 = levelReducer(s2, { type: 'setExitVariant', uid, variant: 'warp' })
    const e = s3.level!.exits[0]!
    expect(e.variant).toBe('warp')
    if (e.variant === 'warp') {
      expect(e.destLevelRecordId).toBe(0x2a)
      expect(e.destX).toBe(40)
      expect(e.destY).toBe(33)
      expect(e.entranceType).toBe(0)
    }
  })

  test('same variant / unknown uid are no-ops (SAME state)', () => {
    const s1 = withExit()
    const uid = s1.level!.exits[0]!.uid!
    expect(levelReducer(s1, { type: 'setExitVariant', uid, variant: 'warp' })).toBe(s1)
    expect(levelReducer(s1, { type: 'setExitVariant', uid: 9999, variant: 'minibattle' })).toBe(s1)
  })
})
