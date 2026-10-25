// Pins the Level Header panel's bit helpers (header-schema): packHeader is the
// MSB-first inverse of the engine's unpackLevelHeader (75 bits → 10 bytes, 5 pad
// bits zero), and headerFieldBits locates each field in that stream. Verified
// once against every shipped level's on-disc header bytes.

import { describe, expect, it } from 'vitest'
import { HEADER_BIT_WIDTHS } from '../canvas/limits'
import { headerFieldBits, packHeader } from './header-schema'

describe('packHeader', () => {
  it('packs all-max fields into 75 set bits and 5 zero pad bits', () => {
    const max = HEADER_BIT_WIDTHS.map((w) => (1 << w) - 1)
    expect(Array.from(packHeader(max))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe0])
  })

  it('places fields MSB-first in order', () => {
    const h = new Array(15).fill(0)
    h[0] = 0x01 // 5-bit BG color: bit 4 of byte 0
    h[1] = 0x8 // 4-bit BG1 tileset, starting at bit 5: bit 2 of byte 0
    h[14] = 0x3 // 2-bit item memory, bits 73–74: bits 6–5 of byte 9
    expect(Array.from(packHeader(h))).toEqual([0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0x60])
  })
})

describe('headerFieldBits', () => {
  it('locates fields by cumulative width', () => {
    expect(headerFieldBits(0)).toEqual({ start: 0, width: 5 })
    expect(headerFieldBits(1)).toEqual({ start: 5, width: 4 })
    expect(headerFieldBits(14)).toEqual({ start: 73, width: 2 })
  })
})
