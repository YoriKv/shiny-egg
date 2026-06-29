import { describe, it, expect } from 'vitest'
import { buildBandedGradient, GRADIENT_RAMP_HEIGHT } from './gradient-banded'

// Pins the cart's per-scanline gradient buffer shape (CODE_0890E7): a flat block
// of the TOP keyframe (70 entries — the `IWT R12, #$0046` pad) followed by the
// 23×16 interpolated ramp, for 438 entries total. Verified against the
// gradient_wram.bin reference capture (70-entry constant run at offset 0). The
// camera preview omitting this pad shifted the preview sky up by 70 scanlines.

const expand5 = (v: number): number => ((v << 3) | (v >>> 2)) & 0xff
const bgr = (r: number, g: number, b: number): number => (b << 10) | (g << 5) | r

describe('buildBandedGradient', () => {
  it('matches the cart buffer height (70 top pad + 23×16 interp = 438)', () => {
    expect(GRADIENT_RAMP_HEIGHT).toBe(438)
    // 24 distinct stops, bottom→top; values are irrelevant to the length.
    const stops = Array.from({ length: 24 }, (_, i) => bgr(i, 0, 0))
    expect(buildBandedGradient(stops)).toHaveLength(GRADIENT_RAMP_HEIGHT * 3)
  })

  it('emits a 70-entry flat block of the TOP keyframe before the ramp', () => {
    // Red ramp 0..23, so the top keyframe (stops[23]) is red=23 and the rest descend.
    const stops = Array.from({ length: 24 }, (_, i) => bgr(i, 0, 0))
    const ramp = buildBandedGradient(stops)
    const top = expand5(23) // top keyframe red, RGB888-expanded

    // Entries 0..69 are the flat pad = the top color exactly.
    for (let e = 0; e < 70; e++) {
      expect([ramp[e * 3], ramp[e * 3 + 1], ramp[e * 3 + 2]]).toEqual([top, 0, 0])
    }
    // The interpolated ramp follows: by the buffer's end it has descended well
    // below the top color (toward the bottom keyframe, red≈0).
    const lastR = ramp[(GRADIENT_RAMP_HEIGHT - 1) * 3]!
    expect(lastR).toBeLessThan(top)
  })
})
