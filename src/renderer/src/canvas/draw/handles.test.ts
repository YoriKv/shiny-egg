// Pins the resize grab hit-tests: `hitResizeEdge` (render mode's edge bands)
// and the `hitObjectResize` outline-mode dispatch. World px at zoom 1 equal
// screen px; CELL_PX is 16.

import { describe, test, expect } from 'vitest'
import { hitObjectResize, hitResizeEdge } from './handles'
import type { LevelObject } from '../../../../preload/api'

// Anchor (2,3), 4×2 cells → box x 32..96, y 48..80; free edges x=96, y=80.
const obj = (o: Partial<LevelObject> = {}): LevelObject =>
  ({ uid: 1, num: 0, x: 2, y: 3, w: 4, h: 2, ...o }) as LevelObject

describe('hitResizeEdge', () => {
  test('free corner, free edges, and misses', () => {
    const o = obj()
    expect(hitResizeEdge(o, 'wh', 96, 80, 1)).toBe('corner')
    expect(hitResizeEdge(o, 'wh', 101, 85, 1)).toBe('corner') // within the handle-square slop
    expect(hitResizeEdge(o, 'wh', 95, 50, 1)).toBe('edgeW') // anywhere along the edge, not just the midpoint
    expect(hitResizeEdge(o, 'wh', 40, 81, 1)).toBe('edgeH')
    expect(hitResizeEdge(o, 'wh', 60, 60, 1)).toBeNull() // interior → move
    expect(hitResizeEdge(o, 'wh', 32, 60, 1)).toBeNull() // anchor edge isn't draggable
    expect(hitResizeEdge(o, 'wh', 101, 60, 1)).toBeNull() // past the band
    expect(hitResizeEdge(o, 'wh', 96, 40, 1)).toBeNull() // beyond the edge's span
  })

  test('size mode limits which grabs exist', () => {
    const o = obj()
    expect(hitResizeEdge(o, 'w', 96, 80, 1)).toBe('edgeW')
    expect(hitResizeEdge(o, 'w', 60, 80, 1)).toBeNull()
    expect(hitResizeEdge(o, 'h', 96, 80, 1)).toBe('edgeH')
    expect(hitResizeEdge(o, 'h', 96, 60, 1)).toBeNull()
    expect(hitResizeEdge(o, 'none', 96, 80, 1)).toBeNull()
  })

  test('a negative extent moves the free edge to the other side', () => {
    // Anchor (6,3), w = -4 → box x 32..96 with the free edge at x=32.
    const o = obj({ x: 6, w: -4 })
    expect(hitResizeEdge(o, 'wh', 32, 60, 1)).toBe('edgeW')
    expect(hitResizeEdge(o, 'wh', 96, 60, 1)).toBeNull()
  })

  test('the band is screen-fixed', () => {
    const o = obj()
    expect(hitResizeEdge(o, 'wh', 98, 60, 1)).toBe('edgeW')
    expect(hitResizeEdge(o, 'wh', 98, 60, 4)).toBeNull() // 4 px at zoom 4 = 1 world px
  })
})

describe('hitObjectResize', () => {
  test('dispatches on the outline mode', () => {
    const o = obj()
    // Upper part of the right edge: off the detailed handle square (centred at
    // y=64), on the render-mode band.
    expect(hitObjectResize(o, 'wh', 96, 50, 1, 'detailed')).toBeNull()
    expect(hitObjectResize(o, 'wh', 96, 50, 1, 'render')).toBe('edgeW')
    expect(hitObjectResize(o, 'wh', 96, 64, 1, 'detailed')).toBe('edgeW')
    expect(hitObjectResize(o, 'wh', 96, 80, 1, 'off')).toBeNull()
  })
})
