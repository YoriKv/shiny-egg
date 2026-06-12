// Pins the parity-variant index math — wrong parity→value order shows the
// designer the OPPOSITE variant, which is worse than no field at all. The
// asm-verified anchors: Egg-Plant even X = Green Eggs; Wall Lakitu even X =
// in-wall peeker; Freezegood/Flyguy use index 2*(y&1)+(x&1) (Y = high bit).

import { describe, it, expect } from 'vitest'
import {
  parityDirection,
  parityOrbitWide,
  parityPrize,
  paritySpawnBadge,
  parityVariantRows,
  SPRITE_PARITY_VARIANTS
} from './sprite-parity-variants'

describe('parityVariantRows', () => {
  it('x-axis: Egg-Plant even column spits Green Eggs, odd spits Needlenoses', () => {
    expect(parityVariantRows(0x0f4, 10, 7)[0].value).toBe('Green Eggs')
    expect(parityVariantRows(0x0f4, 11, 7)[0].value).toBe('Bouncing Needlenoses')
  })
  it('y-axis: Gusty generator arms on an odd ROW, column irrelevant', () => {
    expect(parityVariantRows(0x0e6, 10, 6)[0].value).toBe('Single Gusty')
    expect(parityVariantRows(0x0e6, 11, 6)[0].value).toBe('Single Gusty')
    expect(parityVariantRows(0x0e6, 10, 7)[0].value).toBe('Continuous generator')
  })
  it('xy-axis: Freezegood reward indexes 2*(y&1)+(x&1) — Y is the high bit', () => {
    expect(parityVariantRows(0x01c, 10, 6)[0].value).toBe('Nothing')
    expect(parityVariantRows(0x01c, 11, 6)[0].value).toBe('Star shower (up to 6, +10 each)')
    expect(parityVariantRows(0x01c, 10, 7)[0].value).toBe('1-UP')
    expect(parityVariantRows(0x01c, 11, 7)[0].value).toBe('Tackling Bumpty ambush')
  })
  it('cloud prize row matches the on-outline badge order (1-UP / 5★ / switch / 5★)', () => {
    expect(parityVariantRows(0x0b5, 0, 0)[0].value).toBe('1-UP')
    expect(parityVariantRows(0x0b5, 1, 0)[0].value).toBe('5 stars')
    expect(parityVariantRows(0x0b5, 0, 1)[0].value).toBe('Red switch')
  })
  it('returns [] for sprites without parity variants', () => {
    expect(parityVariantRows(0x185, 5, 5)).toEqual([])
  })
  it('parityDirection: Jean de Fillet even column jumps right, odd jumps left', () => {
    expect(parityDirection(0x104, 10, 7)).toBe('right')
    expect(parityDirection(0x104, 11, 7)).toBe('left')
  })
  it('parityDirection: red platform reads the Y axis (sweeps right on even rows)', () => {
    expect(parityDirection(0x089, 10, 6)).toBe('right')
    expect(parityDirection(0x089, 11, 6)).toBe('right') // column irrelevant
    expect(parityDirection(0x089, 10, 7)).toBe('left')
  })
  it('parityDirection: null for mirror-only, behavioural, and non-parity sprites', () => {
    expect(parityDirection(0x103, 10, 7)).toBeNull() // mace mirror — no true side
    expect(parityDirection(0x0f4, 10, 7)).toBeNull() // egg-plant — behavioural
    expect(parityDirection(0x185, 10, 7)).toBeNull()
  })
  it('paritySpawnBadge: Gusty generator on odd rows; Burt companion on EVEN columns', () => {
    expect(paritySpawnBadge(0x0e6, 10, 7)).toBe('generator')
    expect(paritySpawnBadge(0x0e6, 10, 6)).toBeNull()
    expect(paritySpawnBadge(0x0e7, 10, 7)).toBe('companion') // even column = pair
    expect(paritySpawnBadge(0x0e7, 11, 7)).toBeNull()
    expect(paritySpawnBadge(0x185, 10, 7)).toBeNull()
  })
  it('parityPrize matches the panel Prize row (1up / stars / switch / stars)', () => {
    expect(parityPrize(0x0b5, 0, 0)).toBe('1up')
    expect(parityPrize(0x0b5, 1, 0)).toBe('stars')
    expect(parityPrize(0x0b5, 0, 1)).toBe('switch')
    expect(parityPrize(0x0b5, 1, 1)).toBe('stars')
    expect(parityPrize(0x185, 0, 0)).toBeNull()
  })
  it('parityOrbitWide: $064 wide on EVEN rows (the init Y−8 flips bit 4 before the Main reads it; in-game verified); null for sprites without the variant', () => {
    expect(parityOrbitWide(0x064, 10, 6)).toBe(true)
    expect(parityOrbitWide(0x064, 10, 7)).toBe(false)
    expect(parityOrbitWide(0x15e, 10, 7)).toBeNull() // fixed-ring cluster
  })
  it('machine fields are structurally consistent with their values', () => {
    for (const [num, variants] of Object.entries(SPRITE_PARITY_VARIANTS)) {
      const key = `0x${Number(num).toString(16)}`
      for (const v of variants) {
        if (v.badge) expect(v.badge.index, key).toBeLessThan(v.values.length)
        if (v.prizeKinds) expect(v.prizeKinds.length, key).toBe(v.values.length)
        if (v.orbitWideIndex !== undefined) expect(v.orbitWideIndex, key).toBeLessThan(v.values.length)
      }
    }
  })
  it('every dirs tuple parallels a 2-value single-axis Direction entry', () => {
    for (const [num, variants] of Object.entries(SPRITE_PARITY_VARIANTS)) {
      for (const v of variants) {
        if (!v.dirs) continue
        expect(v.axis, `0x${Number(num).toString(16)}`).not.toBe('xy')
        expect(v.values.length, `0x${Number(num).toString(16)}`).toBe(2)
        expect(v.label).toBe('Direction')
      }
    }
  })
  it('every entry has the right value count for its axis', () => {
    for (const [num, variants] of Object.entries(SPRITE_PARITY_VARIANTS)) {
      for (const v of variants) {
        expect(v.values.length, `0x${Number(num).toString(16)} ${v.label}`).toBe(
          v.axis === 'xy' ? 4 : 2
        )
      }
    }
  })
})
