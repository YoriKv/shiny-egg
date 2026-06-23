import { describe, it, expect } from 'vitest'
import {
  SPRITE_PRIZES,
  SPRITE_PRIZE_STYLE,
  spritePrizeAt,
  type SpritePrizeKind
} from './sprite-prizes'

describe('spritePrizeAt', () => {
  it('fixed (single-prize) clouds ignore placement', () => {
    expect(spritePrizeAt(0x0be, 3, 3)).toBe('1up') // Winged Cloud, 1-up
    expect(spritePrizeAt(0x0bd, 4, 5)).toBe('coin') // coin
    expect(spritePrizeAt(0x0bf, 0, 0)).toBe('key') // key
    expect(spritePrizeAt(0x0cc, 7, 2)).toBe('switch') // !-switch
    expect(spritePrizeAt(0x0c5, 1, 1)).toBe('watermelon') // fire watermelon
  })
  it('parity entries index by parityIndex = 2*(y&1)+(x&1)', () => {
    // $0B5: [1up, stars, switch, stars] over parityIndex 0..3
    expect(spritePrizeAt(0x0b5, 0, 0)).toBe('1up') // ee
    expect(spritePrizeAt(0x0b5, 1, 0)).toBe('stars') // oe
    expect(spritePrizeAt(0x0b5, 0, 1)).toBe('switch') // ey
    expect(spritePrizeAt(0x0b5, 1, 1)).toBe('stars') // oy
    // $067: [stars, sunflower, flower, 1up]
    expect(spritePrizeAt(0x067, 0, 0)).toBe('stars')
    expect(spritePrizeAt(0x067, 1, 1)).toBe('1up')
    // $161 defeat-all reward: [coin, key, flower, door]
    expect(spritePrizeAt(0x161, 0, 0)).toBe('coin')
    expect(spritePrizeAt(0x161, 1, 1)).toBe('door')
  })
  it('returns null for sprites without a prize', () => {
    expect(spritePrizeAt(0x01e, 5, 5)).toBeNull() // shy guy
    expect(spritePrizeAt(0x185, 0, 0)).toBeNull()
  })
  it('every prize kind used has a style entry', () => {
    const used = new Set<SpritePrizeKind>()
    for (const prizes of Object.values(SPRITE_PRIZES)) for (const p of prizes) used.add(p)
    for (const k of used) expect(SPRITE_PRIZE_STYLE[k], k).toBeDefined()
  })
})
