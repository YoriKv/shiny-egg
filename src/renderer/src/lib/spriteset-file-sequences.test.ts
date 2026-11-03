import { describe, expect, it } from 'vitest'
import { placeOrderedSpritesetFiles } from 'snes-framework/sprite-file-sequences'

describe('ordered spriteset file placement', () => {
  it('joins overlapping sequences into one adjacent chain', () => {
    const files = [0x2a, 0x33, 0x2b, 0x47, 0x55, 0x56]
    const result = placeOrderedSpritesetFiles(
      files,
      [[0x2a, 0x2b], [0x2b, 0x47]],
      new Set(),
      new Set([0x2a, 0x2b, 0x33, 0x47])
    )

    expect(result.conflicts).toEqual([])
    expect(files.some((_, start) =>
      files[start] === 0x2a && files[start + 1] === 0x2b && files[start + 2] === 0x47
    )).toBe(true)
  })

  it('places a three-file sprite requirement as one ordered adjacent group', () => {
    const files = [0x32, 0x55, 0x33, 0x56, 0x34, 0x57]
    const result = placeOrderedSpritesetFiles(
      files,
      [[0x32, 0x33, 0x34]],
      new Set(),
      new Set([0x32, 0x33, 0x34, 0x55, 0x56, 0x57])
    )

    expect(result.conflicts).toEqual([])
    expect(files.some((_, start) =>
      files[start] === 0x32 && files[start + 1] === 0x33 && files[start + 2] === 0x34
    )).toBe(true)
  })

  it('places Poochy files next to each other even when separated in the draft', () => {
    const files = [0x3a, 0x22, 0x3b, 0x23, 0x24, 0x25]
    const result = placeOrderedSpritesetFiles(
      files,
      [[0x3a, 0x3b]],
      new Set(),
      new Set([0x3a, 0x3b, 0x22])
    )

    expect(result.conflicts).toEqual([])
    expect(files.some((_, start) => files[start] === 0x3a && files[start + 1] === 0x3b)).toBe(true)
  })

  it('uses duplicate filler slots to fit Caged Ghost without reporting a false conflict', () => {
    const files = [0x4f, 0x43, 0x25, 0x29, 0x1a, 0x1a]
    const result = placeOrderedSpritesetFiles(
      files,
      [[0x42, 0x43]],
      new Set(),
      new Set([0x4f, 0x43, 0x25, 0x29, 0x42])
    )

    expect(result.conflicts).toEqual([])
    expect(files.some((_, start) => files[start] === 0x42 && files[start + 1] === 0x43)).toBe(true)
  })

  it('reports a sequence when every possible placement would displace a locked slot', () => {
    const files = [0x10, 0x11, 0x12, 0x13, 0x14, 0x15]
    const result = placeOrderedSpritesetFiles(
      files,
      [[0x2a, 0x2b]],
      new Set([0, 1, 2, 3, 4, 5]),
      new Set([0x2a, 0x2b])
    )

    expect(result.conflicts).toEqual([0x2a, 0x2b])
    expect(files).toEqual([0x10, 0x11, 0x12, 0x13, 0x14, 0x15])
  })
})
