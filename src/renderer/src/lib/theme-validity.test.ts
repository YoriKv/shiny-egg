// Pins for the object theme-validity check (objectThemeVerdict) — the
// bg1Tilesets-field → verdict mapping the picker filter and the engine's
// shipped-cart gate share.

import { describe, expect, it } from 'vitest'
import { objectThemeAllowed, objectThemeVerdict } from './theme-validity'

describe('objectThemeVerdict', () => {
  it('field absent ⇒ allowed everywhere (universal / not gated)', () => {
    expect(objectThemeVerdict(undefined, [0x4])).toBe('allowed')
  })

  it('null ⇒ unknown (never shipped, nothing derivable — badge, never hide)', () => {
    expect(objectThemeVerdict(null, [0x4])).toBe('unknown')
  })

  it('explicit [] ⇒ locked everywhere (runtime-streamed Baby-Bowser-room scenery)', () => {
    expect(objectThemeVerdict([], [0x0])).toBe('locked')
    expect(objectThemeVerdict([], [0xf])).toBe('locked')
  })

  it('allowed iff ANY effective tileset is in the set (changer bands)', () => {
    expect(objectThemeVerdict(['0xF'], [0x1, 0xf])).toBe('allowed') // 0x58: ts1 + ts15 band
    expect(objectThemeVerdict(['0xF'], [0x1])).toBe('locked') // plain ts1 level
    expect(objectThemeVerdict(['0x2', '0x5'], [0x4])).toBe('locked') // pond-under-snow (0x26)
  })

  it('hex-string ids parse case-insensitively', () => {
    expect(objectThemeAllowed(['0xa'], 0xa)).toBe(true)
    expect(objectThemeAllowed(['0xA'], 0xa)).toBe(true)
  })
})
