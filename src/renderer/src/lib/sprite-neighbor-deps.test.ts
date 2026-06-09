import { describe, it, expect } from 'vitest'
import type { SpriteNeighborDep } from '../data/obj-metadata'
import { resolveDep, probedCell, screenOfCell, type NeighborContext } from './sprite-neighbor-deps'

// Minimal dep builders — only the fields the resolver reads.
function dep(p: Partial<SpriteNeighborDep>): SpriteNeighborDep {
  return {
    cls: 'B1', targetKind: 'map16-tile', spatial: 'same-cell', targetIds: [],
    enforce: true, targetName: '', failureMode: '', designerRule: '', ...p
  }
}
function ctx(p: Partial<NeighborContext>): NeighborContext {
  return { sprites: [], map16At: () => undefined, hasExitForScreen: () => false, ...p }
}

describe('screenOfCell', () => {
  it('packs (row<<4)|col from tile cells', () => {
    expect(screenOfCell(0, 0)).toBe(0x00)
    expect(screenOfCell(15, 15)).toBe(0x00) // still screen (0,0)
    expect(screenOfCell(16, 0)).toBe(0x01) // next screen right
    expect(screenOfCell(0, 16)).toBe(0x10) // next screen down
    expect(screenOfCell(0xff, 0x7f)).toBe(0x7f)
  })
})

describe('probedCell (offset-cell, class C)', () => {
  it('floor-divides the signed pixel probe back to a cell', () => {
    // (X-0x18, Y-0x38) = (-24, -56)px from a cell origin → (-2, -4) cells.
    const d = dep({ cls: 'C', spatial: 'offset-cell', offsetPx: { dx: -24, dy: -56 } })
    expect(probedCell({ num: 0x3f, x: 10, y: 10 }, d)).toEqual({ cx: 8, cy: 6 })
  })
})

describe('resolveDep — tile targets', () => {
  const keyhole = dep({ cls: 'B1', spatial: 'same-cell', tileMatch: { mask: '0xF800', value: '0xB800' } })
  it('B1 keyhole: met when own cell is in the $B800-$BFFF page', () => {
    const r = resolveDep({ num: 0x27, x: 5, y: 5 }, keyhole, ctx({ map16At: () => 0xb812 }))
    expect(r.status).toBe('met')
    expect(r.targetCell).toEqual({ cx: 5, cy: 5 })
  })
  it('B1 keyhole: missing when the page does not match', () => {
    expect(resolveDep({ num: 0x27, x: 5, y: 5 }, keyhole, ctx({ map16At: () => 0x0040 })).status).toBe('missing')
  })
  it('A rail: matches high byte $87xx (mask 0xFF00)', () => {
    const rail = dep({ cls: 'A', spatial: 'path', tileMatch: { mask: '0xFF00', value: '0x8700' } })
    expect(resolveDep({ num: 0x185, x: 3, y: 3 }, rail, ctx({ map16At: () => 0x8742 })).status).toBe('met')
    expect(resolveDep({ num: 0x185, x: 3, y: 3 }, rail, ctx({ map16At: () => 0x8042 })).status).toBe('missing')
  })
  it('A rail vertical depth: flatbed reads {own,+1}; spiral ($18F, pathDown=2) reaches +2', () => {
    // rail only two rows below the platform (own=3, +1=4, +2=5 → rail at cy=5).
    const railAtPlus2 = (_cx: number, cy: number) => (cy === 5 ? 0x8700 : 0x0000)
    const base = { cls: 'A' as const, spatial: 'path' as const, tileMatch: { mask: '0xFF00', value: '0x8700' } }
    expect(resolveDep({ num: 0x185, x: 4, y: 3 }, dep(base), ctx({ map16At: railAtPlus2 })).status).toBe('missing')
    expect(resolveDep({ num: 0x18f, x: 4, y: 3 }, dep({ ...base, pathDown: 2 }), ctx({ map16At: railAtPlus2 })).status).toBe('met')
  })
  it('A rail is column-restricted: a vertical rail in column 66 detaches when moved to 65', () => {
    // Regression for the move-1-left bug: rail only in column 66 — platform at 66
    // attaches, at 65 it must NOT (even though the rail is one cell to the right).
    const rail = dep({ cls: 'A', spatial: 'path', tileMatch: { mask: '0xFF00', value: '0x8700' } })
    const railInCol66 = (cx: number) => (cx === 66 ? 0x870f : 0x0123)
    expect(resolveDep({ num: 0x18d, x: 66, y: 84 }, rail, ctx({ map16At: railInCol66 })).status).toBe('met')
    expect(resolveDep({ num: 0x18d, x: 65, y: 84 }, rail, ctx({ map16At: railInCol66 })).status).toBe('missing')
  })
  it('C slime: exact tile $0174 at the offset cell', () => {
    const slime = dep({ cls: 'C', spatial: 'offset-cell', offsetPx: { dx: -24, dy: -56 }, tileMatch: { mask: '0xFFFF', value: '0x0174' } })
    const seen = new Map([['8,6', 0x0174]])
    const r = resolveDep({ num: 0x3f, x: 10, y: 10 }, slime, ctx({ map16At: (cx, cy) => seen.get(`${cx},${cy}`) }))
    expect(r.status).toBe('met')
  })
  it('missing when the probed cell is unallocated (undefined)', () => {
    expect(resolveDep({ num: 0x27, x: 5, y: 5 }, keyhole, ctx({ map16At: () => undefined })).status).toBe('missing')
  })
})

describe('resolveDep — sprite targets', () => {
  const door = dep({ cls: 'D', targetKind: 'sprite', spatial: 'carried', targetIds: ['0x027'] })
  it('met when a partner sprite id is present anywhere', () => {
    const r = resolveDep({ num: 0x4e, x: 1, y: 1 }, door, ctx({ sprites: [{ num: 0x27, x: 9, y: 9 }] }))
    expect(r.status).toBe('met')
    expect(r.targetSprite?.num).toBe(0x27)
  })
  it('missing when no partner is placed', () => {
    expect(resolveDep({ num: 0x4e, x: 1, y: 1 }, door, ctx({ sprites: [{ num: 0x100, x: 0, y: 0 }] })).status).toBe('missing')
  })
})

describe('resolveDep — screen-metadata (class E)', () => {
  const pipe = dep({ cls: 'E', targetKind: 'screen-metadata', spatial: 'screen' })
  it('met when the sprite screen has an exit row', () => {
    const r = resolveDep({ num: 0x42, x: 0x14, y: 0x05 }, pipe, ctx({ hasExitForScreen: (s) => s === screenOfCell(0x14, 0x05) }))
    expect(r.status).toBe('met')
  })
  it('missing when the screen has no exit', () => {
    expect(resolveDep({ num: 0x42, x: 0x14, y: 0x05 }, pipe, ctx({ hasExitForScreen: () => false })).status).toBe('missing')
  })
})

describe('resolveDep — class F pipe-spawner (tile-literal OR collision-tag)', () => {
  const spawner = dep({
    cls: 'F', spatial: 'same-cell', enforce: false,
    collisionTag: '0x14', tileLiterals: ['0x79F1', '0x79F2']
  })
  it('met on the literal pipe-mouth tiles $79F1/$79F2 (no collision table needed)', () => {
    expect(resolveDep({ num: 0x1e, x: 5, y: 5 }, spawner, ctx({ map16At: () => 0x79f1 })).status).toBe('met')
    expect(resolveDep({ num: 0x1e, x: 5, y: 5 }, spawner, ctx({ map16At: () => 0x79f2 })).status).toBe('met')
  })
  it('met when the cell page carries collision tag $14 (pipe) via collisionTagOfPage', () => {
    const r = resolveDep({ num: 0x1e, x: 5, y: 5 }, spawner, ctx({
      map16At: () => 0x7d08, collisionTagOfPage: (p) => (p === 0x7d ? 0x14 : 0x00)
    }))
    expect(r.status).toBe('met')
  })
  it('missing on a non-pipe tile whose page is not tagged pipe', () => {
    expect(resolveDep({ num: 0x1e, x: 5, y: 5 }, spawner, ctx({
      map16At: () => 0x0123, collisionTagOfPage: () => 0x00
    })).status).toBe('missing')
  })
  it('page-tag path needs collisionTagOfPage: a $7Dxx tile is missing without it (literal fallback only)', () => {
    expect(resolveDep({ num: 0x1e, x: 5, y: 5 }, spawner, ctx({ map16At: () => 0x7d08 })).status).toBe('missing')
  })
})
