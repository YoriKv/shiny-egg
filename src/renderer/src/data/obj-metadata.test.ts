// Pins the neighbour-dependency ENFORCE inventory — the exact set of deps that
// drive the always-on red error indicator. Loose-direction guard the shipped-
// level harness cannot provide: it pins per-class MET counts (info-only deps
// included), so a metadata-regen bug that flips an enforced dep to
// enforce:false keeps the harness green while the editor silently stops
// flagging real errors. Update this list deliberately, alongside the TSV +
// tmp/gen-neighbor-deps.ts (see research/notes-sprite-neighbor-dependencies.md
// Part 4).

import { describe, it, expect } from 'vitest'
import { getSprite, listSprites } from './obj-metadata'

// "0xNNN cls/spatial" per enforced dep. 29 = 11 rail + 7 tile-read +
// 6 sprite-pair + 5 screen-exit.
const EXPECTED_ENFORCED = [
  '0x185 rail-follower/path', '0x186 rail-follower/path', '0x187 rail-follower/path',
  '0x188 rail-follower/path', '0x189 rail-follower/path', '0x18A rail-follower/path',
  '0x18B rail-follower/path', '0x18C rail-follower/path', '0x18D rail-follower/path',
  '0x18E rail-follower/path', '0x18F rail-follower/path',
  '0x03F tile-read/offset-cell', '0x0DE tile-read/same-cell',
  '0x105 tile-read/row', '0x106 tile-read/row',
  '0x190 tile-read/same-cell', '0x1A4 tile-read/same-cell', '0x1E0 tile-read/level',
  '0x033 sprite-pair/proximity', '0x067 sprite-pair/proximity',
  '0x15C sprite-pair/global', '0x15D sprite-pair/global',
  '0x15F sprite-pair/global', '0x160 sprite-pair/global',
  '0x042 screen-exit/screen', '0x084 screen-exit/screen',
  '0x0D0 screen-exit/screen', '0x0D1 screen-exit/screen', '0x147 screen-exit/screen'
].sort()

describe('neighborDeps enforce inventory', () => {
  const all = listSprites().flatMap(({ id, info }) =>
    (info.neighborDeps ?? []).map((d) => ({ id, dep: d }))
  )

  it('exactly the audited deps are enforced (drive the red error indicator)', () => {
    const enforced = all
      .filter(({ dep }) => dep.enforce)
      .map(({ id, dep }) => `0x${id.toString(16).toUpperCase().padStart(3, '0')} ${dep.cls}/${dep.spatial}`)
      .sort()
    expect(enforced).toEqual(EXPECTED_ENFORCED)
  })

  // 2026-06-11: down from 68/74 — the auto-rotating pinwheels $064/$15E lost
  // their rail-follower rows (they branch around the $87 spawn-cell probe,
  // CODE_04C530, and never travel; see docs/sprite-neighbor-dependencies.md
  // Class A correction).
  it('total dep inventory matches the audited model (66 sprites / 72 deps)', () => {
    expect(all.length).toBe(72)
    expect(new Set(all.map(({ id }) => id)).size).toBe(66)
  })

  it('annotation deps (spatial note) and carried deps are never enforced', () => {
    for (const { dep } of all) {
      if (dep.spatial === 'note' || dep.spatial === 'carried') {
        expect(dep.enforce).toBe(false)
      }
    }
  })
})

// The `spawnedOnly` flag (runtime-spawned children the picker badges "spawn-only").
// The exact set vs the asm derivation is gated by engine/spawned-only.test.ts;
// these always-run pins guard the metadata against hand-edits + the count drift
// (regenerate with tmp/gen-spawned-only.ts after sprite-spawn asm changes).
describe('spawnedOnly flag', () => {
  // Representative runtime-spawned children (projectile / sub-part / event /
  // mini-battle prop) — flagged; and clearly placeable enemies — not flagged.
  const FLAGGED = [0x075, 0x060, 0x09c, 0x114, 0x1b2] // spike ball, bomb, mace, snifit bullet, mini-battle coin
  const PLACEABLE = [0x074, 0x01e, 0x072] // spike, shy guy, train bandit

  it('flags the known runtime-spawned children', () => {
    for (const id of FLAGGED) expect(getSprite(id).spawnedOnly).toBe(true)
  })

  it('leaves placeable enemies unflagged', () => {
    for (const id of PLACEABLE) expect(getSprite(id).spawnedOnly).not.toBe(true)
  })

  it('the flagged set is the audited size + sprite-only + always < 0x1BA', () => {
    const flagged = listSprites().filter(({ info }) => info.spawnedOnly)
    expect(flagged.length).toBe(71)
    for (const { id, info } of flagged) {
      expect(info.spawnedOnly).toBe(true) // a definite boolean, never truthy-other
      expect(id).toBeLessThan(0x1ba) // normal sprites only; specials use another path
    }
  })
})
