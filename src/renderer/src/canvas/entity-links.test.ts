// Pins the exit ↔ pipe/sprite association rules (entity-links):
//  - exitTrigger OBJECTS (door tiles / tile-enterable pipes like std 0x3C)
//    link to their screen's exit directly — no sprite needed (the level-0x3B
//    lesson; see data/exit-triggers.ts).
//  - the sprite-driven link (entrance sprite on the exit's screen), plus the
//    pipe-host extension for the UN-enterable pipe family (std 0xF4): the
//    pipe joins the link set iff an exit-trigger sprite sits inside its cell
//    box; decorative pipes that merely share the screen stay unlinked.
// Metadata facts these tests lean on: sprite 0x042 (Vertical pipe entrance)
// is exitTrigger-flagged; std 0x3C is exitTrigger (tile-enterable mouth);
// std 0xF4 is category 'pipe' but NOT exitTrigger; std 0x6E is neither.
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { describe, test, expect } from 'vitest'
import { linksFor } from './entity-links'
import type { LevelData, LevelObject, LevelSprite, ScreenExit } from '../../../preload/api'

const ENTERABLE_PIPE = 0x3c // Enterable vertical pipe — exitTrigger (tile-driven)
const UNENTERABLE_PIPE = 0xf4 // Unenterable vertical pipe — category 'pipe', no trigger
const ENTRANCE_SPRITE = 0x042 // Vertical pipe entrance — exitTrigger sprite
const TERRAIN_NUM = 0x6e // ordinary terrain — neither pipe nor trigger

let uid = 1
const obj = (num: number, x: number, y: number, w: number, h: number): LevelObject =>
  ({ uid: uid++, index: 0, num, x, y, w, h }) as unknown as LevelObject
const spr = (num: number, x: number, y: number): LevelSprite =>
  ({ uid: uid++, index: 0, num, x, y }) as unknown as LevelSprite
const exitAt = (screenIndex: number): ScreenExit =>
  ({ uid: uid++, screenIndex, variant: 'warp', destLevelRecordId: 0 }) as unknown as ScreenExit

const level = (
  objects: LevelObject[],
  sprites: LevelSprite[],
  exits: ScreenExit[]
): LevelData => ({ objects, sprites, exits }) as unknown as LevelData

// All fixtures live on screen 0x10 (cells x 0..15, y 16..31).
describe('tile-enterable pipe (exitTrigger object) links', () => {
  test('selecting the pipe links to its screen exit — no sprite involved', () => {
    const pipe = obj(ENTERABLE_PIPE, 10, 20, 1, 7)
    const exit = exitAt(0x10)
    const lines = linksFor({ kind: 'object', obj: pipe }, level([pipe], [], [exit]))
    expect(lines).toHaveLength(1)
  })

  test('selecting the exit links back to the pipe', () => {
    const pipe = obj(ENTERABLE_PIPE, 10, 20, 1, 7)
    const exit = exitAt(0x10)
    const lines = linksFor({ kind: 'exit', exit }, level([pipe], [], [exit]))
    expect(lines).toHaveLength(1)
  })
})

describe('exit ↔ pipe-host links (un-enterable pipes need an entrance sprite)', () => {
  test('exit links to BOTH the entrance sprite and its host pipe', () => {
    const pipe = obj(UNENTERABLE_PIPE, 10, 20, 1, 4)
    const entrance = spr(ENTRANCE_SPRITE, 10, 20) // on the pipe's anchor — the shipped pattern
    const exit = exitAt(0x10)
    const lines = linksFor({ kind: 'exit', exit }, level([pipe], [entrance], [exit]))
    expect(lines).toHaveLength(2)
  })

  test('a decorative pipe on the same screen (sprite NOT inside it) stays unlinked', () => {
    const decorative = obj(UNENTERABLE_PIPE, 2, 20, 1, 4)
    const entrance = spr(ENTRANCE_SPRITE, 10, 20)
    const exit = exitAt(0x10)
    const lines = linksFor({ kind: 'exit', exit }, level([decorative], [entrance], [exit]))
    expect(lines).toHaveLength(1) // the entrance sprite only
  })

  test('selecting the host pipe links to its screen exit', () => {
    const pipe = obj(UNENTERABLE_PIPE, 10, 20, 1, 4)
    const entrance = spr(ENTRANCE_SPRITE, 10, 22) // inside the 1×4 box, not on the anchor
    const exit = exitAt(0x10)
    const lines = linksFor({ kind: 'object', obj: pipe }, level([pipe], [entrance], [exit]))
    expect(lines).toHaveLength(1)
  })

  test('an un-enterable pipe with no hosted entrance sprite has no links', () => {
    const pipe = obj(UNENTERABLE_PIPE, 10, 20, 1, 4)
    const exit = exitAt(0x10)
    const lines = linksFor({ kind: 'object', obj: pipe }, level([pipe], [], [exit]))
    expect(lines).toHaveLength(0)
  })

  test('a non-pipe object containing the sprite does not link', () => {
    const terrain = obj(TERRAIN_NUM, 10, 20, 4, 4)
    const entrance = spr(ENTRANCE_SPRITE, 10, 20)
    const exit = exitAt(0x10)
    const lines = linksFor({ kind: 'object', obj: terrain }, level([terrain], [entrance], [exit]))
    expect(lines).toHaveLength(0)
  })
})
