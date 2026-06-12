// Pins the badge predicates' class/spatial gating — loose-direction guards the
// shipped-level harness cannot see (it never evaluates draw code). The spawner
// badge must fire ONLY for class-F SAME-CELL deps: class F also carries the
// piranha pipe-centring (offset-cell, met whenever one sits on a pipe) and the
// dirt-digger annotations (spatial `note`, ALWAYS met) — an ungated predicate
// would badge every Zeus Guy / Shark Chomp / Cannonball as a pipe spawner.

import { describe, it, expect } from 'vitest'
import type { SpriteNeighborDep } from '../../data/obj-metadata'
import type { DepResult } from '../../lib/sprite-neighbor-deps'
import { hasActiveSpawner, hasNeighborError, drawNeighborSelectionOverlay } from './sprite-neighbors'

/** Minimal canvas-ctx stub: records method-call names, swallows everything. */
function stubCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const ctx = new Proxy(
    {},
    {
      get: (_t, prop) =>
        typeof prop === 'string' ? (..._args: unknown[]) => void calls.push(prop) : undefined,
      set: () => true
    }
  ) as CanvasRenderingContext2D
  return { ctx, calls }
}

function result(p: Partial<SpriteNeighborDep>, status: 'met' | 'missing'): DepResult {
  const dep: SpriteNeighborDep = {
    cls: 'tile-behavior', targetKind: 'map16-tile', spatial: 'same-cell', targetIds: [],
    enforce: false, targetName: '', failureMode: '', designerRule: '', ...p
  }
  return { dep, status }
}

describe('hasActiveSpawner', () => {
  it('fires for a met class-F same-cell dep (shy guy on a pipe mouth)', () => {
    expect(hasActiveSpawner([result({ cls: 'tile-behavior', spatial: 'same-cell' }, 'met')])).toBe(true)
  })
  it('does NOT fire for the piranha pipe-centring (offset-cell)', () => {
    expect(hasActiveSpawner([result({ cls: 'tile-behavior', spatial: 'offset-cell' }, 'met')])).toBe(false)
  })
  it('does NOT fire for dirt-digger annotations (note, always met)', () => {
    expect(hasActiveSpawner([result({ cls: 'tile-behavior', spatial: 'note' }, 'met')])).toBe(false)
  })
  it('does NOT fire for a met ice-snap (same-cell but not tile-behavior)', () => {
    expect(hasActiveSpawner([result({ cls: 'ice-snap', spatial: 'same-cell' }, 'met')])).toBe(false)
  })
  it('does NOT fire when the spawner dep is missing (off-pipe shy guy)', () => {
    expect(hasActiveSpawner([result({ cls: 'tile-behavior', spatial: 'same-cell' }, 'missing')])).toBe(false)
  })
})

describe('drawNeighborSelectionOverlay — info-only deps draw POSITIVE connections only', () => {
  const sprite = { index: 0, num: 0x1a9, x: 5, y: 5 }
  const treeDep = { cls: 'tile-read' as const, spatial: 'row' as const, enforce: false }
  it('met info dep at a neighbouring cell draws the connection (grinder ↔ tree)', () => {
    const r = result(treeDep, 'met')
    r.targetCell = { cx: 6, cy: 5 }
    const { ctx, calls } = stubCtx()
    drawNeighborSelectionOverlay(ctx, sprite, [r], 2)
    expect(calls).toContain('strokeRect')
  })
  it('missing info dep draws nothing (absence is never an error)', () => {
    const r = result(treeDep, 'missing')
    r.targetCell = { cx: 5, cy: 5 }
    const { ctx, calls } = stubCtx()
    drawNeighborSelectionOverlay(ctx, sprite, [r], 2)
    expect(calls.filter((c) => c === 'stroke' || c === 'strokeRect')).toEqual([])
  })
  it('met info dep at the OWN cell draws nothing (ice-snap / spawner noise)', () => {
    const r = result({ cls: 'ice-snap', spatial: 'same-cell', enforce: false }, 'met')
    r.targetCell = { cx: 5, cy: 5 }
    const { ctx, calls } = stubCtx()
    drawNeighborSelectionOverlay(ctx, sprite, [r], 2)
    expect(calls.filter((c) => c === 'stroke' || c === 'strokeRect')).toEqual([])
  })
  it('met info SPRITE pairing draws the connector + ring (Slugger ↔ Chomp Rock)', () => {
    const r = result({ cls: 'sprite-pair', targetKind: 'sprite', spatial: 'global', enforce: false }, 'met')
    r.targetSprite = { num: 0x9e, x: 20, y: 5 }
    const { ctx, calls } = stubCtx()
    drawNeighborSelectionOverlay(ctx, sprite, [r], 2)
    expect(calls).toContain('stroke')
  })
  it('met ENFORCED dep at the OWN cell also draws nothing (icicle on its anchor)', () => {
    const r = result({ cls: 'tile-read', spatial: 'same-cell', enforce: true }, 'met')
    r.targetCell = { cx: 5, cy: 5 }
    const { ctx, calls } = stubCtx()
    drawNeighborSelectionOverlay(ctx, sprite, [r], 2)
    expect(calls.filter((c) => c === 'stroke' || c === 'strokeRect')).toEqual([])
  })
  it('missing ENFORCED dep at the OWN cell still draws the red box', () => {
    const r = result({ cls: 'tile-read', spatial: 'same-cell', enforce: true }, 'missing')
    r.targetCell = { cx: 5, cy: 5 }
    const { ctx, calls } = stubCtx()
    drawNeighborSelectionOverlay(ctx, sprite, [r], 2)
    expect(calls).toContain('strokeRect')
  })
})

describe('drawNeighborSelectionOverlay — same-cell pairings draw nothing', () => {
  const sprite = { index: 0, num: 0x33, x: 5, y: 5 }
  it('radiusCells 0 (mouser ON its hole): no connector/ring for the met partner', () => {
    const r = result({ cls: 'sprite-pair', targetKind: 'sprite', spatial: 'proximity', enforce: true, radiusCells: 0 }, 'met')
    r.targetSprite = { num: 0x2f, x: 5, y: 5 }
    const { ctx, calls } = stubCtx()
    drawNeighborSelectionOverlay(ctx, sprite, [r], 2)
    expect(calls.filter((c) => c === 'stroke' || c === 'strokeRect')).toEqual([])
  })
  it('unbounded sprite deps still draw the connector + ring', () => {
    const r = result({ cls: 'sprite-pair', targetKind: 'sprite', spatial: 'global', enforce: true }, 'met')
    r.targetSprite = { num: 0x9e, x: 20, y: 5 }
    const { ctx, calls } = stubCtx()
    drawNeighborSelectionOverlay(ctx, sprite, [r], 2)
    expect(calls).toContain('stroke')
  })
})

describe('hasNeighborError', () => {
  it('fires only for a MISSING ENFORCED dep', () => {
    expect(hasNeighborError([result({ cls: 'rail-follower', spatial: 'path', enforce: true }, 'missing')])).toBe(true)
    expect(hasNeighborError([result({ cls: 'rail-follower', spatial: 'path', enforce: true }, 'met')])).toBe(false)
    expect(hasNeighborError([result({ cls: 'ice-snap', spatial: 'same-cell', enforce: false }, 'missing')])).toBe(false)
    expect(hasNeighborError(undefined)).toBe(false)
  })
})
