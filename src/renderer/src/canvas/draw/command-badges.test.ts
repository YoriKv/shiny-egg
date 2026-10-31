// Pins which sprites get the slate raw-ID stand-in badge: only a sprite with no
// cel bounds from the sprite render AND no other stand-in (completion flag,
// entrance/teleport glyph, generator badge, command badge).
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { describe, test, expect } from 'vitest'
import { spriteNeedsRawIdBadge } from './command-badges'
import type { LevelSprite, SpriteCelBounds } from '../../../../preload/api'
import { getSprite } from '../../data/obj-metadata'
import { generatorSpawn } from '../../data/generator-spawns'

const spr = (num: number): LevelSprite => ({ num, x: 4, y: 4, index: 0 }) as LevelSprite
const bounds = (...nums: number[]): Map<number, SpriteCelBounds> =>
  new Map(nums.map((num) => [num, { num, originX: 0, originY: 0, width: 16, height: 16 }]))

describe('spriteNeedsRawIdBadge', () => {
  test('a sprite the renderer drew has bounds → no badge', () => {
    expect(spriteNeedsRawIdBadge(spr(0x051), bounds(0x051))).toBe(false)
  })

  test('a sprite with no bounds and no other stand-in → badge (Large log, BG3)', () => {
    expect(spriteNeedsRawIdBadge(spr(0x051), bounds())).toBe(true)
  })

  test('sprites with their own stand-in never double up', () => {
    expect(spriteNeedsRawIdBadge(spr(0x00d), bounds())).toBe(false) // Goal: completion flag
    expect(spriteNeedsRawIdBadge(spr(0x0d0), bounds())).toBe(false) // horizontal entrance: arrow glyph
    expect(spriteNeedsRawIdBadge(spr(0x084), bounds())).toBe(false) // teleport: portal glyph
  })

  test('command and generator sprites keep their own badges', () => {
    const command = [...Array(0x1f5).keys()].find((n) => getSprite(n).category === 'command')!
    expect(spriteNeedsRawIdBadge(spr(command), bounds())).toBe(false)
    const generator = [...Array(0x1f5).keys()].find((n) => generatorSpawn(n) !== null)!
    expect(spriteNeedsRawIdBadge(spr(generator), bounds())).toBe(false)
  })
})
