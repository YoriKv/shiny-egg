// Pins the two cap semantics: 'placement' caps (non-resetting counters,
// e.g. POW $0E25) warn when exceeded; 'alive' guards (cleared on despawn,
// e.g. the BG3 $0CB2 machine group) NEVER warn — the stock cart ships up to
// 15 group placements in one level (left/right spawn-point pairs +
// sequential machines), so a placement-count warning there is a false alarm.
// Regression context: sprite 0x03D showed "12/1 placed — extras may not
// spawn" on Burt's Fort, which ships 10×0x036 + 2×0x03D legally.
import { describe, expect, it } from 'vitest'
import { capForNum, capStatus, SPRITE_CAPS } from './sprite-level-caps'

const sprites = (...nums: number[]): { num: number }[] => nums.map((num) => ({ num }))

describe('capStatus', () => {
  it('alive guards never report exceeded, whatever the placed count', () => {
    // Burt's Fort shape: 10 falling walls + 2 seesaws = 12 of the BG3 group.
    const level = sprites(...Array(10).fill(0x036), 0x03d, 0x03d)
    const status = capStatus(0x03d, level)!
    expect(status.cap.kind).toBe('alive')
    expect(status.count).toBe(12)
    expect(status.exceeded).toBe(false)
  })

  it('placement caps warn past max', () => {
    const status = capStatus(0x097, sprites(0x097, 0x097, 0x097, 0x097))!
    expect(status.cap.kind).toBe('placement')
    expect(status.exceeded).toBe(true)
    expect(capStatus(0x097, sprites(0x097, 0x097, 0x097))!.exceeded).toBe(false)
  })

  it('counts the whole guard group, not just the selected id', () => {
    const status = capStatus(0x051, sprites(0x051, 0x036, 0x073, 0x1e2))!
    expect(status.count).toBe(3)
  })

  it('returns null for un-capped sprites', () => {
    expect(capStatus(0x01e, sprites(0x01e, 0x01e))).toBeNull()
  })
})

describe('SPRITE_CAPS data', () => {
  it('every $0CB2 consumer is in the BG3 alive group', () => {
    const bg3 = SPRITE_CAPS.find((c) => c.label === 'BG3 machine')!
    expect(bg3.kind).toBe('alive')
    for (const id of [0x036, 0x039, 0x03d, 0x03f, 0x050, 0x051, 0x073]) {
      expect(capForNum(id)).toBe(bg3)
    }
  })

  it('the spawn-point-pair pattern is surfaced to the user', () => {
    const bg3 = SPRITE_CAPS.find((c) => c.label === 'BG3 machine')!
    expect(bg3.note).toMatch(/pair/i)
  })

  it('only verified non-resetting counters are warning-grade', () => {
    const placement = SPRITE_CAPS.filter((c) => c.kind === 'placement')
    expect(placement.map((c) => c.label)).toEqual(['POW Block'])
  })
})
