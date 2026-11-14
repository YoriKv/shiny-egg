import { describe, expect, test } from 'vitest'
import type { LevelObject } from '../../../preload/api'
import extendedBoxes from '../data/object-placement.json'
import { clampGroupMove, clampObjectMove, clampObjectPlacement, clampObjectResize, isObjectPlacementSafe, objectCellBox } from './limits'

function object(num: number, x: number, y: number, w = 1, h = 1, exnum?: number): LevelObject {
  return { index: 0, num, x, y, w, h, exnum, raw: [] }
}

function expectInside(o: LevelObject): void {
  const b = objectCellBox(o)
  expect(b.x0).toBeGreaterThanOrEqual(0)
  expect(b.y0).toBeGreaterThanOrEqual(0)
  expect(b.x0 + b.w).toBeLessThanOrEqual(256)
  expect(b.y0 + b.h).toBeLessThanOrEqual(128)
}

describe('loader placement bounds', () => {
  test.each([
    [0x12, 8, 1, 127],
    [0x79, 8, 1, 127],
    [0x79, -8, 1, 127],
    [0x27, 8, -4, 127],
    [0x28, 8, -4, 127],
    [0x2a, 8, 1, 0],
    [0x2a, 8, -4, 0],
    [0x8c, 8, 1, 127],
    [0xcf, 8, 1, 127],
    [0xd8, 8, 1, 127]
  ])('object %i with size %i,%i cannot be placed at row %i', (num, w, h, y) => {
    const bad = object(num, 64, y, w, h)
    expect(isObjectPlacementSafe(bad)).toBe(false)
    const placed = clampObjectPlacement(bad)
    expect(isObjectPlacementSafe(placed)).toBe(true)
    if (h < 0) expect(placed.h).toBeLessThan(0)

    const original = object(num, 64, 64, w, h)
    expect(isObjectPlacementSafe(original)).toBe(true)
    const move = clampObjectMove(original, 0, y - original.y)
    expect(isObjectPlacementSafe({ ...original, x: original.x + move.dx, y: original.y + move.dy })).toBe(true)
    expect(move.dy).not.toBe(y - original.y)
  })

  test('width-dependent height also limits resizing and rigid group moves', () => {
    const wire = object(0x12, 64, 116, 4, 1)
    expect(isObjectPlacementSafe(wire)).toBe(true)
    const size = clampObjectResize(wire, 32, 1)
    expect(size.w).toBeLessThan(32)
    expect(isObjectPlacementSafe({ ...wire, ...size })).toBe(true)
    const room = object(0x8c, 80, 120, 8, 1)
    const move = clampGroupMove([wire, room], [], 0, 20)
    for (const o of [wire, room]) expect(isObjectPlacementSafe({ ...o, x: o.x + move.dx, y: o.y + move.dy })).toBe(true)
  })

  test('safe slanted twisted tree placements at the top edge stay available', () => {
    const tree = object(0x78, 64, 0, 8, 1)
    expect(isObjectPlacementSafe(tree)).toBe(true)
    expect(clampObjectPlacement(tree)).toEqual(tree)
    expect(clampObjectMove({ ...tree, y: 1 }, 0, -1)).toEqual({ dx: 0, dy: -1 })
  })

  test('valid negative-height placements retain their sign at either edge', () => {
    for (const o of [object(0x27, 64, 0, 8, -4), object(0x2a, 64, 127, 8, -4)]) {
      const placed = clampObjectPlacement(o)
      expect(placed.h).toBe(-4)
      expect(isObjectPlacementSafe(placed)).toBe(true)
    }
  })

  test('blank tiles and fences include the invisible border in all directions', () => {
    for (const num of [0xa7, 0xa8]) {
      expect(objectCellBox(object(num, 10, 20, 4, 5))).toEqual({ x0: 9, y0: 19, w: 6, h: 7 })
      expect(clampObjectMove(object(num, 1, 1), -1, -1)).toEqual({ dx: 0, dy: 0 })
      expect(clampObjectMove(object(num, 254, 126), 1, 1)).toEqual({ dx: 0, dy: 0 })
      expect(clampObjectResize(object(num, 250, 120), 20, 20)).toEqual({ w: 5, h: 7 })
      expect(clampObjectResize(object(num, 10, 10), -2, -3)).toEqual({ w: 1, h: 1 })
    }
  })

  test('extended objects use fixed loader geometry regardless of stored size', () => {
    const sign = object(0, 254, 126, 100, 100, 0x50)
    expect(objectCellBox(sign)).toEqual({ x0: 254, y0: 126, w: 2, h: 2 })
    expect(clampObjectMove(sign, 1, 1)).toEqual({ dx: 0, dy: 0 })
    expect(clampGroupMove([sign, object(1, 10, 10)], [], 10, 10)).toEqual({ dx: 0, dy: 0 })
  })

  test('every generated extended footprint and blank tile fits after placing at any corner', () => {
    const objects = Object.keys(extendedBoxes).map(id => object(0, 0, 0, 1, 1, parseInt(id, 16)))
    objects.push(object(0xa8, 0, 0, 128, 128))
    for (const o of objects) for (const x of [0, 255]) for (const y of [0, 127]) {
      const placed = clampObjectPlacement({ ...o, x, y })
      expectInside(placed)
      expect(clampObjectPlacement(placed)).toEqual(placed)
    }
  })
})
