import { describe, it, expect } from 'vitest'
import { fillGradient, lerpBgr15, GRADIENT_BLACK, gradientOffset } from './gradient'

// BGR-15 component helpers for assertions.
const bgr = (r: number, g: number, b: number): number => (b << 10) | (g << 5) | r
const chan = (c: number): [number, number, number] => [c & 0x1f, (c >>> 5) & 0x1f, (c >>> 10) & 0x1f]

describe('lerpBgr15', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    const a = bgr(2, 4, 6)
    const b = bgr(20, 16, 30)
    expect(lerpBgr15(a, b, 0)).toBe(a)
    expect(lerpBgr15(a, b, 1)).toBe(b)
  })
  it('interpolates each 5-bit channel at the midpoint', () => {
    expect(chan(lerpBgr15(bgr(0, 0, 0), bgr(20, 10, 30), 0.5))).toEqual([10, 5, 15])
  })
})

describe('fillGradient', () => {
  it('interpolates black stops between sequential non-black anchors', () => {
    const colors = new Array(24).fill(GRADIENT_BLACK)
    colors[0] = bgr(0, 0, 0) // black anchor still counts as black → not an anchor
    colors[2] = bgr(20, 0, 0) // anchor
    colors[6] = bgr(0, 0, 20) // anchor
    const out = fillGradient(colors)
    // Stops 3,4,5 interpolate from red(20,0,0)→blue(0,0,20); 4 is the midpoint.
    expect(chan(out[4]!)).toEqual([10, 0, 10])
    // Anchors themselves are untouched.
    expect(out[2]).toBe(bgr(20, 0, 0))
    expect(out[6]).toBe(bgr(0, 0, 20))
    // Stops before the first anchor / after the last stay black (unchanged).
    expect(out[1]).toBe(GRADIENT_BLACK)
    expect(out[7]).toBe(GRADIENT_BLACK)
  })

  it('leaves the input unchanged with fewer than two anchors', () => {
    const one = new Array(24).fill(GRADIENT_BLACK)
    one[5] = bgr(10, 10, 10)
    expect(fillGradient(one)).toEqual(one)
    expect(fillGradient(new Array(24).fill(GRADIENT_BLACK))).toEqual(new Array(24).fill(GRADIENT_BLACK))
  })

  it('does not mutate the input array', () => {
    const colors = new Array(24).fill(GRADIENT_BLACK)
    colors[0] = bgr(31, 0, 0)
    colors[3] = bgr(0, 31, 0)
    const copy = colors.slice()
    fillGradient(colors)
    expect(colors).toEqual(copy)
  })

  it('chains through every anchor (multi-stop), each segment continuous', () => {
    const colors = new Array(24).fill(GRADIENT_BLACK)
    colors[0] = bgr(0, 0, 0) // black, ignored
    colors[1] = bgr(31, 0, 0)
    colors[5] = bgr(0, 0, 0) // black between → filled, not an anchor
    colors[9] = bgr(0, 0, 31)
    const out = fillGradient(colors)
    // Segment 1→9 midpoint (stop 5): halfway red→blue.
    expect(chan(out[5]!)).toEqual([16, 0, 16])
  })
})

describe('gradientOffset', () => {
  it('maps (table, stop) to the flat byte offset (48-byte stride, 2-byte words)', () => {
    expect(gradientOffset(0, 0)).toBe(0)
    expect(gradientOffset(0, 23)).toBe(46)
    expect(gradientOffset(1, 0)).toBe(48)
    expect(gradientOffset(15, 23)).toBe(15 * 48 + 46)
  })
})
