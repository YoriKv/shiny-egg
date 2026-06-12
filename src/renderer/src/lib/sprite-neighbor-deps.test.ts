import { describe, it, expect } from 'vitest'
import type { SpriteNeighborDep } from '../data/obj-metadata'
import { resolveDep, probedCell, screenOfCell, type NeighborContext } from './sprite-neighbor-deps'

// Minimal dep builders — only the fields the resolver reads.
function dep(p: Partial<SpriteNeighborDep>): SpriteNeighborDep {
  return {
    cls: 'ice-snap', targetKind: 'map16-tile', spatial: 'same-cell', targetIds: [],
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
    const d = dep({ cls: 'tile-read', spatial: 'offset-cell', offsetPx: { dx: -24, dy: -56 } })
    expect(probedCell({ num: 0x3f, x: 10, y: 10 }, d)).toEqual({ cx: 8, cy: 6 })
  })
})

describe('resolveDep — tile targets', () => {
  // Class B ice-block snap (the 2026-06-10 corrected model): collision-tag $17,
  // carried by pages $89/$8C. e.g. the frozen shyguys of 5-3 on tile $8900.
  const iceTag = (p: number) => (p === 0x89 || p === 0x8c ? 0x17 : 0x00)
  const ice = dep({ cls: 'ice-snap', spatial: 'same-cell', enforce: false, collisionTag: '0x17' })
  it('B ice-snap: met when the own cell page carries collision tag $17', () => {
    const r = resolveDep({ num: 0x1e, x: 5, y: 5 }, ice, ctx({ map16At: () => 0x8900, collisionTagOfPage: iceTag }))
    expect(r.status).toBe('met')
    expect(r.targetCell).toEqual({ cx: 5, cy: 5 })
  })
  it('B ice-snap: missing when the page tag does not match', () => {
    expect(resolveDep({ num: 0x1e, x: 5, y: 5 }, ice, ctx({ map16At: () => 0x0040, collisionTagOfPage: iceTag })).status).toBe('missing')
  })
  it('A rail: matches high byte $87xx (mask 0xFF00)', () => {
    const rail = dep({ cls: 'rail-follower', spatial: 'path', tileMatch: { mask: '0xFF00', value: '0x8700' } })
    expect(resolveDep({ num: 0x185, x: 3, y: 3 }, rail, ctx({ map16At: () => 0x8742 })).status).toBe('met')
    expect(resolveDep({ num: 0x185, x: 3, y: 3 }, rail, ctx({ map16At: () => 0x8042 })).status).toBe('missing')
  })
  it('A rail vertical depth: flatbed reads {own,+1}; spiral ($18F, pathDown=2) reaches +2', () => {
    // rail only two rows below the platform (own=3, +1=4, +2=5 → rail at cy=5).
    const railAtPlus2 = (_cx: number, cy: number) => (cy === 5 ? 0x8700 : 0x0000)
    const base = { cls: 'rail-follower' as const, spatial: 'path' as const, tileMatch: { mask: '0xFF00', value: '0x8700' } }
    expect(resolveDep({ num: 0x185, x: 4, y: 3 }, dep(base), ctx({ map16At: railAtPlus2 })).status).toBe('missing')
    expect(resolveDep({ num: 0x18f, x: 4, y: 3 }, dep({ ...base, pathDown: 2 }), ctx({ map16At: railAtPlus2 })).status).toBe('met')
  })
  it('A rail is column-restricted: a vertical rail in column 66 detaches when moved to 65', () => {
    // Regression for the move-1-left bug: rail only in column 66 — platform at 66
    // attaches, at 65 it must NOT (even though the rail is one cell to the right).
    const rail = dep({ cls: 'rail-follower', spatial: 'path', tileMatch: { mask: '0xFF00', value: '0x8700' } })
    const railInCol66 = (cx: number) => (cx === 66 ? 0x870f : 0x0123)
    expect(resolveDep({ num: 0x18d, x: 66, y: 84 }, rail, ctx({ map16At: railInCol66 })).status).toBe('met')
    expect(resolveDep({ num: 0x18d, x: 65, y: 84 }, rail, ctx({ map16At: railInCol66 })).status).toBe('missing')
  })
  it('C slime: exact tile $0174 at the offset cell', () => {
    const slime = dep({ cls: 'tile-read', spatial: 'offset-cell', offsetPx: { dx: -24, dy: -56 }, tileMatch: { mask: '0xFFFF', value: '0x0174' } })
    const seen = new Map([['8,6', 0x0174]])
    const r = resolveDep({ num: 0x3f, x: 10, y: 10 }, slime, ctx({ map16At: (cx, cy) => seen.get(`${cx},${cy}`) }))
    expect(r.status).toBe('met')
  })
  it('missing when the probed cell is unallocated (undefined)', () => {
    expect(resolveDep({ num: 0x1e, x: 5, y: 5 }, ice, ctx({ map16At: () => undefined })).status).toBe('missing')
  })
  it('C icicle: met on any of the tileLiterals at the own cell', () => {
    const icicle = dep({ cls: 'tile-read', spatial: 'same-cell', tileLiterals: ['0x8E00', '0x8E01', '0x8E02'] })
    expect(resolveDep({ num: 0x190, x: 4, y: 4 }, icicle, ctx({ map16At: () => 0x8e01 })).status).toBe('met')
    expect(resolveDep({ num: 0x190, x: 4, y: 4 }, icicle, ctx({ map16At: () => 0x8e03 })).status).toBe('missing')
  })
  it('row: scans the own row outward to ±rowSpan, nearest match wins', () => {
    const marker = dep({ cls: 'tile-read', spatial: 'row', rowSpan: 4, tileLiterals: ['0x00B8'] })
    const at = (cx: number, cy: number) => (cy === 7 && cx === 12 ? 0x00b8 : 0x0000)
    const met = resolveDep({ num: 0x105, x: 10, y: 7 }, marker, ctx({ map16At: at }))
    expect(met.status).toBe('met')
    expect(met.targetCell).toEqual({ cx: 12, cy: 7 })
    // outside the span (5 cells away) and off-row are both missing
    expect(resolveDep({ num: 0x105, x: 17, y: 7 }, marker, ctx({ map16At: at })).status).toBe('missing')
    expect(resolveDep({ num: 0x105, x: 12, y: 8 }, marker, ctx({ map16At: at })).status).toBe('missing')
  })
  it('level: met when the tile exists anywhere; marker is the nearest match', () => {
    const hole = dep({ cls: 'tile-read', spatial: 'level', tileLiterals: ['0x0010'] })
    const at = (cx: number, cy: number) =>
      (cx === 3 && cy === 3) || (cx === 200 && cy === 100) ? 0x0010 : 0x0000
    const r = resolveDep({ num: 0x1e0, x: 5, y: 5 }, hole, ctx({ map16At: at }))
    expect(r.status).toBe('met')
    expect(r.targetCell).toEqual({ cx: 3, cy: 3 })
    expect(resolveDep({ num: 0x1e0, x: 5, y: 5 }, hole, ctx({ map16At: () => 0x0000 })).status).toBe('missing')
  })
  it('pageLiterals: matches the Map16 page family (grinder tree trunks $99/$9A)', () => {
    const tree = dep({
      cls: 'tile-read', spatial: 'row', rowSpan: 1, enforce: false,
      pageLiterals: ['0x99', '0x9A']
    })
    const treeRight = (cx: number, cy: number) => (cy === 7 && cx === 11 ? 0x9913 : 0x0000)
    const r = resolveDep({ num: 0x1a9, x: 10, y: 7 }, tree, ctx({ map16At: treeRight }))
    expect(r.status).toBe('met')
    expect(r.targetCell).toEqual({ cx: 11, cy: 7 })
    // page $9B and the empty tile (page 0) do not match
    expect(resolveDep({ num: 0x1a9, x: 10, y: 7 }, tree, ctx({ map16At: () => 0x9b13 })).status).toBe('missing')
    expect(resolveDep({ num: 0x1a9, x: 10, y: 7 }, tree, ctx({ map16At: () => 0x0000 })).status).toBe('missing')
  })
  it('note: always met (pure annotation, no geometric check)', () => {
    const note = dep({ cls: 'tile-behavior', spatial: 'note', enforce: false })
    expect(resolveDep({ num: 0xfd, x: 0, y: 0 }, note, ctx({ map16At: () => undefined })).status).toBe('met')
  })
})

describe('resolveDep — sprite targets', () => {
  const door = dep({ cls: 'sprite-pair', targetKind: 'sprite', spatial: 'carried', targetIds: ['0x027'] })
  it('met when a partner sprite id is present anywhere', () => {
    const r = resolveDep({ num: 0x4e, x: 1, y: 1 }, door, ctx({ sprites: [{ num: 0x27, x: 9, y: 9 }] }))
    expect(r.status).toBe('met')
    expect(r.targetSprite?.num).toBe(0x27)
  })
  it('missing when no partner is placed', () => {
    expect(resolveDep({ num: 0x4e, x: 1, y: 1 }, door, ctx({ sprites: [{ num: 0x100, x: 0, y: 0 }] })).status).toBe('missing')
  })
  it('picks the NEAREST partner, not the first in stream order', () => {
    // Regression for the mouser→nest pointer: two nests, the far one first in
    // the sprite list — the connector must target the co-placed one.
    const nest = dep({ cls: 'sprite-pair', targetKind: 'sprite', spatial: 'proximity', targetIds: ['0x02F'] })
    const r = resolveDep({ num: 0x33, x: 50, y: 20 }, nest, ctx({
      sprites: [{ num: 0x2f, x: 200, y: 90 }, { num: 0x2f, x: 50, y: 20 }]
    }))
    expect(r.status).toBe('met')
    expect(r.targetSprite).toEqual({ num: 0x2f, x: 50, y: 20 })
  })
  it('radiusCells bounds the partner search', () => {
    const nest = dep({
      cls: 'sprite-pair', targetKind: 'sprite', spatial: 'proximity',
      targetIds: ['0x02F'], radiusCells: 16
    })
    const farOnly = ctx({ sprites: [{ num: 0x2f, x: 200, y: 90 }] })
    expect(resolveDep({ num: 0x33, x: 50, y: 20 }, nest, farOnly).status).toBe('missing')
    const near = ctx({ sprites: [{ num: 0x2f, x: 60, y: 24 }] })
    expect(resolveDep({ num: 0x33, x: 50, y: 20 }, nest, near).status).toBe('met')
  })
  it('radiusCells 0 = same-cell pairing (mouser sits ON its hole)', () => {
    const nest = dep({
      cls: 'sprite-pair', targetKind: 'sprite', spatial: 'proximity',
      targetIds: ['0x02F'], radiusCells: 0
    })
    const onHole = ctx({ sprites: [{ num: 0x2f, x: 50, y: 20 }] })
    expect(resolveDep({ num: 0x33, x: 50, y: 20 }, nest, onHole).status).toBe('met')
    const oneOff = ctx({ sprites: [{ num: 0x2f, x: 51, y: 20 }] })
    expect(resolveDep({ num: 0x33, x: 50, y: 20 }, nest, oneOff).status).toBe('missing')
  })
  it('carried falls back to the warp-group set when no partner is in the record', () => {
    const door = dep({ cls: 'sprite-pair', targetKind: 'sprite', spatial: 'carried', targetIds: ['0x027'] })
    // Key placed in a connected sub-room (group set), none in this record.
    const viaGroup = resolveDep({ num: 0x4e, x: 1, y: 1 }, door, ctx({
      sprites: [], carriedGroupNums: new Set([0x027])
    }))
    expect(viaGroup.status).toBe('met')
    expect(viaGroup.targetSprite).toBeUndefined() // cross-record — nothing to point at
    // No key anywhere in the group either.
    expect(resolveDep({ num: 0x4e, x: 1, y: 1 }, door, ctx({
      sprites: [], carriedGroupNums: new Set([0x100])
    })).status).toBe('missing')
    // A partner IN the record is preferred (gives the connector target).
    const inRecord = resolveDep({ num: 0x4e, x: 1, y: 1 }, door, ctx({
      sprites: [{ num: 0x27, x: 9, y: 9 }], carriedGroupNums: new Set([0x027])
    }))
    expect(inRecord.targetSprite?.num).toBe(0x27)
    // The group fallback is carried-only: a 'global' dep ignores it.
    const pair = dep({ cls: 'sprite-pair', targetKind: 'sprite', spatial: 'global', targetIds: ['0x09E'] })
    expect(resolveDep({ num: 0xf5, x: 1, y: 1 }, pair, ctx({
      sprites: [], carriedGroupNums: new Set([0x09e])
    })).status).toBe('missing')
  })
  it('a sprite cannot satisfy its own dep (identity excluded)', () => {
    const selfPair = dep({ cls: 'sprite-pair', targetKind: 'sprite', spatial: 'global', targetIds: ['0x033'] })
    expect(resolveDep({ num: 0x33, x: 5, y: 5 }, selfPair, ctx({
      sprites: [{ num: 0x33, x: 5, y: 5 }]
    })).status).toBe('missing')
    expect(resolveDep({ num: 0x33, x: 5, y: 5 }, selfPair, ctx({
      sprites: [{ num: 0x33, x: 5, y: 5 }, { num: 0x33, x: 9, y: 5 }]
    })).status).toBe('met')
  })
})

describe('resolveDep — screen-metadata (class E)', () => {
  const pipe = dep({ cls: 'screen-exit', targetKind: 'screen-metadata', spatial: 'screen' })
  it('met when the sprite screen has an exit row', () => {
    const r = resolveDep({ num: 0x42, x: 0x14, y: 0x05 }, pipe, ctx({ hasExitForScreen: (s) => s === screenOfCell(0x14, 0x05) }))
    expect(r.status).toBe('met')
  })
  it('missing when the screen has no exit', () => {
    expect(resolveDep({ num: 0x42, x: 0x14, y: 0x05 }, pipe, ctx({ hasExitForScreen: () => false })).status).toBe('missing')
  })
  it('accepts a 4-adjacent screen but NOT diagonal or two-away (tolerance bound)', () => {
    // Loose-direction pin: the boundary-pipe tolerance is exactly the 4
    // neighbours. Widening it (8-neighbourhood / radius 2) would pass the
    // shipped-level harness while blinding the error indicator.
    const sprite = { num: 0x42, x: 0x24, y: 0x25 } // screen 0x22 (col 2, row 2)
    const at = (sc: number) => ctx({ hasExitForScreen: (s) => s === sc })
    for (const ok of [0x22, 0x21, 0x23, 0x12, 0x32]) {
      expect(resolveDep(sprite, pipe, at(ok)).status).toBe('met')
    }
    for (const bad of [0x11, 0x13, 0x31, 0x33, 0x20, 0x24, 0x02, 0x42]) {
      expect(resolveDep(sprite, pipe, at(bad)).status).toBe('missing')
    }
  })
})

describe('resolveDep — class F pipe-spawner (tile-literal OR collision-tag)', () => {
  const spawner = dep({
    cls: 'tile-behavior', spatial: 'same-cell', enforce: false,
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
