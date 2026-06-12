// Probe-derived behavior geometry — pins the level-measured marks (chain
// lengths, march tracks, icicle heights, rail components) against synthetic
// grids, plus the static-table resolution + instance-cap counting they ship
// alongside.
import { describe, expect, it } from 'vitest'
import { behaviorMarks, behaviorRows } from '../data/sprite-behavior-extents'
import { capStatus } from '../data/sprite-level-caps'
import { probeMarks, railComponentCells, type ProbeContext } from './sprite-probe-marks'

/** Grid-backed context: cells map `"x,y" -> map16 id`; pages in `solid` are
 *  fully solid (collision al). Unlisted cells read 0 (in-range empty). */
function ctxOf(cells: Record<string, number>, solid: number[] = [0x01]): ProbeContext {
  return {
    map16At: (cx, cy) => {
      if (cx < 0 || cy < 0 || cx > 255 || cy > 127) return undefined
      return cells[`${cx},${cy}`] ?? 0
    },
    isSolidPage: (page) => solid.includes(page)
  }
}

describe('chained spike ball $10C (ceiling-distance chain)', () => {
  it('chain = (19 - d) * 16 for a ceiling d cells up', () => {
    // Solid at y=6, sprite at y=10 → first probe hit at d=4 steps → distance 3.
    const ctx = ctxOf({ '8,6': 0x0100 })
    const marks = probeMarks(ctx, { num: 0x10c, x: 8, y: 10 })
    expect(marks).toHaveLength(1)
    const m = marks[0]!
    expect(m.kind).toBe('extent')
    if (m.kind === 'extent') {
      expect(m.axis).toBe('y')
      expect(m.plus).toBe((19 - 3) * 16)
    }
  })
  it('no ceiling in range -> no mark', () => {
    expect(probeMarks(ctxOf({}), { num: 0x10c, x: 8, y: 10 })).toHaveLength(0)
  })
  it('non-solid pages are not a ceiling', () => {
    const ctx = ctxOf({ '8,9': 0x8701 }) // rail tile directly above — pass-through
    expect(probeMarks(ctx, { num: 0x10c, x: 8, y: 10 })).toHaveLength(0)
  })
})

describe('boo guys carrying bomb $105/$106 (marker run)', () => {
  it('expands the contiguous $B6-$BA run around the spawn row', () => {
    const cells: Record<string, number> = {}
    for (let x = 10; x <= 16; x++) cells[`${x},5`] = 0x00b6 + (x % 5)
    const marks = probeMarks(ctxOf(cells), { num: 0x105, x: 12, y: 5 })
    expect(marks).toHaveLength(1)
    const m = marks[0]!
    if (m.kind === 'extent') {
      expect(m.minus).toBe((12 - 10) * 16)
      expect(m.plus).toBe((17 - 12) * 16)
    }
  })
  it('seeds from a marker up to 2 cells away; none -> no mark', () => {
    const cells = { '14,5': 0x00b7 }
    expect(probeMarks(ctxOf(cells), { num: 0x106, x: 12, y: 5 })).toHaveLength(1)
    expect(probeMarks(ctxOf(cells), { num: 0x106, x: 9, y: 5 })).toHaveLength(0)
  })
})

describe('falling icicle $190 (anchor height)', () => {
  it('counts 1-3 anchor tiles above', () => {
    const ctx = ctxOf({ '4,7': 0x8e01, '4,6': 0x8e02 })
    const marks = probeMarks(ctx, { num: 0x190, x: 4, y: 8 })
    expect(marks).toHaveLength(1)
    const m = marks[0]!
    if (m.kind === 'zone') expect(m.y0).toBe(-32)
  })
  it('no anchor -> no mark', () => {
    expect(probeMarks(ctxOf({}), { num: 0x190, x: 4, y: 8 })).toHaveLength(0)
  })
})

describe('rail component trace ($185-$18F)', () => {
  it('walks the 8-connected $87xx component from own/below cell', () => {
    // L-shaped rail: (5,9)..(8,9) then diagonal up to (9,8).
    const cells: Record<string, number> = {
      '5,9': 0x8701, '6,9': 0x8701, '7,9': 0x8701, '8,9': 0x8701, '9,8': 0x8702
    }
    // Platform placed ON the rail start.
    const own = railComponentCells(ctxOf(cells), { num: 0x185, x: 5, y: 9 })
    expect(own).toHaveLength(5)
    // Platform placed one cell ABOVE the rail (the below-cell seed).
    const below = railComponentCells(ctxOf(cells), { num: 0x185, x: 7, y: 8 })
    expect(below).toHaveLength(5)
    // Far from any rail: nothing.
    expect(railComponentCells(ctxOf(cells), { num: 0x185, x: 20, y: 20 })).toHaveLength(0)
  })
  it('caps runaway components', () => {
    const cells: Record<string, number> = {}
    for (let x = 0; x < 200; x++) cells[`${x},9`] = 0x8701
    expect(railComponentCells(ctxOf(cells), { num: 0x186, x: 0, y: 9 }, 50)).toHaveLength(50)
  })
})

describe('static behavior marks (data table)', () => {
  it('arrow sign snap ghost resolves the 32px-block centre', () => {
    // Odd/odd placement (17,11): block base (16,10) → ghost at px (256+8, 160+8)... wait:
    // px = ((17*16) & ~0x1F) + 8 = (272 & ~31) + 8 = 256 + 8 = 264.
    const marks = behaviorMarks(0x197, 17, 11)
    expect(marks).toHaveLength(1)
    const m = marks[0]!
    if (m.kind === 'snap') {
      expect(m.px).toBe(264)
      expect(m.py).toBe(168)
    }
    // Even/even placement: the snap (+8 within the block) never equals the
    // anchor, so a ghost still appears 8px in.
    expect(behaviorMarks(0x197, 16, 10)).toHaveLength(1)
  })
  it('behaviorRows humanizes snap marks as cells', () => {
    const rows = behaviorRows(0x198, 17, 11)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.value).toContain('cell (16, 10)')
  })
})

describe('instance caps', () => {
  it('counts the cap GROUP across the level; alive guards never warn', () => {
    const sprites = [{ num: 0x036 }, { num: 0x050 }, { num: 0x123 }]
    const st = capStatus(0x036, sprites)
    expect(st).not.toBeNull()
    expect(st!.count).toBe(2)
    // The BG3 group is an alive-at-once guard (cleared on despawn) — extra
    // placements are the shipped left/right spawn-pair pattern, not an error.
    // Full semantics pinned in data/sprite-level-caps.test.ts.
    expect(st!.exceeded).toBe(false)
  })
  it('within the cap is not exceeded; uncapped nums return null', () => {
    expect(capStatus(0x097, [{ num: 0x097 }, { num: 0x097 }])!.exceeded).toBe(false)
    expect(capStatus(0x01e, [{ num: 0x01e }])).toBeNull()
  })
})
