import { describe, expect, test } from 'vitest'
import type { LevelData, LevelDecodeSignals } from '../../../preload/api'
import { checkLevelCore, countCollectibles, validateAll } from './validation'

// Minimal LevelData factory — only the fields the checks read.
function lvl(partial: Partial<LevelData>): LevelData {
  return {
    recordId: 0x10,
    header: new Array(15).fill(0),
    objects: [],
    sprites: [],
    exits: [],
    empty: false,
    special: false,
    ...partial
  } as LevelData
}

// A screen→page map where every screen maps to its own page (identity), so two
// sprites in the same screen share a page and column ⇒ collision; sprites in
// different screens get different pages.
function identitySignals(over: Partial<LevelDecodeSignals> = {}): LevelDecodeSignals {
  const screenPageMap = Array.from({ length: 128 }, (_, i) => (i % 63) + 1)
  return { decoded: true, screenPageMap, pageCount: 5, overflowed: false, aborted: false, ...over }
}

const sprite = (num: number, x: number, y: number): LevelData['sprites'][number] =>
  ({ num, x, y, index: 0 }) as LevelData['sprites'][number]

describe('countCollectibles', () => {
  test('tallies flowers, red coins, coins', () => {
    const level = lvl({
      sprites: [
        sprite(0x0fa, 0, 0), // flower
        sprite(0x110, 16, 0), // flower variant
        sprite(0x065, 32, 0), // red coin
        sprite(0x065, 48, 0), // red coin
        sprite(0x1af, 64, 0) // floating coin
      ],
      objects: [{ num: 0x68, exnum: undefined, x: 0, y: 0 } as LevelData['objects'][number]]
    })
    const c = countCollectibles(level)
    expect(c.flowers).toBe(2)
    expect(c.redCoins).toBe(2)
    expect(c.coins).toBe(2) // floating-coin sprite + coin object
    expect(c.tracked).toBe(5) // broad item-memory family (incl. floating coin)
  })
})

describe('checkLevelCore', () => {
  test('flags sprite count over the cap as an error', () => {
    const sprites = Array.from({ length: 300 }, (_, i) => sprite(0x000, i & 0xff, 0))
    const issues = checkLevelCore(lvl({ sprites }), identitySignals(), 0x10)
    expect(issues.some((i) => i.check === 'sprite-cap' && i.severity === 'error')).toBe(true)
  })

  test('flags page-pool overflow from decode signals', () => {
    const issues = checkLevelCore(lvl({}), identitySignals({ overflowed: true }), 0x10)
    expect(issues.some((i) => i.check === 'page-overflow' && i.severity === 'error')).toBe(true)
  })

  test('flags item-memory collision for two HIGH items in the same screen column', () => {
    // Both red coins in screen 0 (tileY < 16), same tile-column (x&0x0f == 2),
    // different rows within the screen — Y collapses, so they share one bit.
    const sprites = [sprite(0x065, 0x02, 0x00), sprite(0x065, 0x02, 0x0a)]
    const issues = checkLevelCore(lvl({ sprites }), identitySignals(), 0x10)
    expect(issues.some((i) => i.check === 'item-memory')).toBe(true)
  })

  test('flags a HIGH + LOW collision (red coin stacked over a floating coin)', () => {
    // The priority model's whole point: a high item losing its bit to a coin.
    const sprites = [sprite(0x065, 0x02, 0x00), sprite(0x1af, 0x02, 0x0a)]
    const issues = checkLevelCore(lvl({ sprites }), identitySignals(), 0x10)
    expect(issues.some((i) => i.check === 'item-memory')).toBe(true)
  })

  test('item-memory issue lists every colliding sprite (id + position)', () => {
    const sprites = [sprite(0x065, 0x02, 0x00), sprite(0x1af, 0x02, 0x0a)]
    const im = checkLevelCore(lvl({ sprites }), identitySignals(), 0x10).find((i) => i.check === 'item-memory')
    expect(im?.sprites).toEqual([
      { num: 0x065, x: 0x02, y: 0x00 },
      { num: 0x1af, x: 0x02, y: 0x0a }
    ])
  })

  test('does NOT flag LOW + LOW (two floating coins) — coins may share a column', () => {
    const sprites = [sprite(0x1af, 0x02, 0x00), sprite(0x1af, 0x02, 0x0a)]
    const issues = checkLevelCore(lvl({ sprites }), identitySignals(), 0x10)
    expect(issues.some((i) => i.check === 'item-memory')).toBe(false)
  })

  test('no item-memory collision when HIGH items are in different columns', () => {
    const sprites = [sprite(0x065, 0x02, 0x00), sprite(0x065, 0x05, 0x00)]
    const issues = checkLevelCore(lvl({ sprites }), identitySignals(), 0x10)
    expect(issues.some((i) => i.check === 'item-memory')).toBe(false)
  })

  test('flags duplicate exits on one screen as an error (one slot per screen)', () => {
    const exits = [
      { variant: 'warp', screenIndex: 3, destLevelRecordId: 0x12, destX: 0, destY: 0, entranceType: 0 },
      { variant: 'warp', screenIndex: 3, destLevelRecordId: 0x13, destX: 0, destY: 0, entranceType: 0 }
    ] as LevelData['exits']
    const issues = checkLevelCore(lvl({ exits }), identitySignals(), 0x10)
    expect(issues.some((i) => i.check === 'dup-exit' && i.severity === 'error')).toBe(true)
  })

  test('skips exit-based checks when the exit section is malformed (screen > 0x7F)', () => {
    // The garbage marker: a valid screen index is 0x00-0x7F. An out-of-range one
    // (the over-read orphan 0x7D) means the section is junk — skip dup/warp.
    const exits = [
      { variant: 'warp', screenIndex: 3, destLevelRecordId: 0xda, destX: 0, destY: 0, entranceType: 0 },
      { variant: 'warp', screenIndex: 3, destLevelRecordId: 0x13, destX: 0, destY: 0, entranceType: 0 },
      { variant: 'warp', screenIndex: 0xf4, destLevelRecordId: 0x30, destX: 0, destY: 0, entranceType: 0 }
    ] as LevelData['exits']
    const issues = checkLevelCore(lvl({ exits }), identitySignals(), 0x10)
    expect(issues.some((i) => i.check === 'dup-exit')).toBe(false)
    expect(issues.some((i) => i.check === 'warp-dest')).toBe(false)
  })

  test('flags a warp to a sentinel slot (0xDA) as a warning, but not special end-markers', () => {
    const exits = [
      { variant: 'warp', screenIndex: 1, destLevelRecordId: 0xda, destX: 0, destY: 0, entranceType: 0 },
      // 0xFF is a valid special end-marker in vanilla, not a typo'd level id.
      { variant: 'warp', screenIndex: 2, destLevelRecordId: 0xff, destX: 0, destY: 0, entranceType: 0 }
    ] as LevelData['exits']
    const issues = checkLevelCore(lvl({ exits }), identitySignals(), 0x10)
    const warpIssues = issues.filter((i) => i.check === 'warp-dest')
    expect(warpIssues.length).toBe(1)
    expect(warpIssues[0].severity).toBe('warning')
  })

  test('flags a glitched header value', () => {
    const header = new Array(15).fill(0)
    header[3] = 0x11 // BG2 tileset "Glitched"
    const issues = checkLevelCore(lvl({ header }), identitySignals(), 0x10)
    expect(issues.some((i) => i.check === 'header-glitched')).toBe(true)
  })

  test('decode-dependent checks are skipped when signals.decoded is false', () => {
    const noDecode: LevelDecodeSignals = {
      decoded: false,
      screenPageMap: [],
      pageCount: 0,
      overflowed: false,
      aborted: false
    }
    const sprites = [sprite(0x065, 0x02, 0x00), sprite(0x065, 0x02, 0x30)]
    const issues = checkLevelCore(lvl({ sprites }), noDecode, 0x10)
    expect(issues.some((i) => i.check === 'item-memory')).toBe(false)
    expect(issues.some((i) => i.check === 'page-overflow')).toBe(false)
  })
})

// A warp exit to `dest`.
const warpTo = (screen: number, dest: number): LevelData['exits'][number] =>
  ({ variant: 'warp', screenIndex: screen, destLevelRecordId: dest, destX: 0, destY: 0, entranceType: 0 }) as LevelData['exits'][number]

describe('validateAll', () => {
  test('aggregates per-level issues; sentinel warp flagged, normal/special dests not', () => {
    const inputs = [
      {
        levelRecordId: 0x10,
        isRoot: true,
        signals: identitySignals(),
        level: lvl({
          recordId: 0x10,
          exits: [warpTo(0, 0x11), warpTo(1, 0x77), warpTo(2, 0xda)] as LevelData['exits']
        })
      },
      { levelRecordId: 0x11, isRoot: false, signals: identitySignals(), level: lvl({ recordId: 0x11 }) }
    ]
    const result = validateAll(inputs)
    expect(result.levelsChecked).toBe(2)
    const lvl10 = result.levels.find((l) => l.levelRecordId === 0x10)
    const warps = lvl10?.issues.filter((i) => i.check === 'warp-dest') ?? []
    // Only the 0xDA sentinel is flagged — 0x11 (backed) and 0x77 (plain
    // unbacked) are not, matching the engine's own permissive warp handling.
    expect(warps.length).toBe(1)
    expect(warps[0].severity).toBe('warning')
    expect(result.crossLevel).toEqual([])
  })

  test('cross-level collision: a root + its private sub-room sharing a slot', () => {
    // 0x20 (root) → 0x21 (private sub-room). Red coin in 0x20 and flower in 0x21
    // both at (0,0) → same (page 1, column 0) slot, same bitmap → collision.
    const inputs = [
      {
        levelRecordId: 0x20,
        isRoot: true,
        signals: identitySignals(),
        level: lvl({ recordId: 0x20, sprites: [sprite(0x065, 0, 0)], exits: [warpTo(0, 0x21)] as LevelData['exits'] })
      },
      { levelRecordId: 0x21, isRoot: false, signals: identitySignals(), level: lvl({ recordId: 0x21, sprites: [sprite(0x0fa, 0, 0)] }) }
    ]
    const result = validateAll(inputs)
    expect(result.crossLevel.some((i) => i.check === 'item-memory-cross')).toBe(true)
    expect(result.totalWarnings).toBeGreaterThan(0)
  })

  test('no cross-level collision when the collectibles are in different columns', () => {
    const inputs = [
      {
        levelRecordId: 0x20,
        isRoot: true,
        signals: identitySignals(),
        level: lvl({ recordId: 0x20, sprites: [sprite(0x065, 0x00, 0)], exits: [warpTo(0, 0x21)] as LevelData['exits'] })
      },
      { levelRecordId: 0x21, isRoot: false, signals: identitySignals(), level: lvl({ recordId: 0x21, sprites: [sprite(0x0fa, 0x05, 0)] }) }
    ]
    expect(validateAll(inputs).crossLevel).toEqual([])
  })

  test('no cross-level collision across two roots (each entered fresh from the map)', () => {
    // Two ROOTS with colliding slots, bridged by a shared sub-room 0x21 — never
    // one session, and 0x21 is shared (reached from both) so it's excluded too.
    const inputs = [
      {
        levelRecordId: 0x20,
        isRoot: true,
        signals: identitySignals(),
        level: lvl({ recordId: 0x20, sprites: [sprite(0x065, 0, 0)], exits: [warpTo(0, 0x21)] as LevelData['exits'] })
      },
      {
        levelRecordId: 0x22,
        isRoot: true,
        signals: identitySignals(),
        level: lvl({ recordId: 0x22, sprites: [sprite(0x0fa, 0, 0)], exits: [warpTo(0, 0x21)] as LevelData['exits'] })
      },
      { levelRecordId: 0x21, isRoot: false, signals: identitySignals(), level: lvl({ recordId: 0x21 }) }
    ]
    expect(validateAll(inputs).crossLevel).toEqual([])
  })
})
