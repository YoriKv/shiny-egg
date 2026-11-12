import { afterEach, describe, expect, test } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LevelMenu } from '../LevelMenu'
import type { LevelsCatalog, WorldMapModel } from '../../../preload/api'
import { getLevel, getLevelByTranslevel, levelLabel, setCatalog, setWorldMapCatalogDraft } from './levels'
import { worldMapSpawns } from '../lib/world-map-spawns'

const catalog: LevelsCatalog = { groups: [
  { label: 'World 1', levels: [
    { recordId: 0, translevelId: 0, world: 'World 1', slot: '1-1', name: 'Make Eggs, Throw Eggs' },
    { recordId: 1, translevelId: 1, world: 'World 1', slot: '1-2', name: 'Watch Out Below!' }
  ] },
  { label: 'Unused Rooms', levels: [
    { recordId: 0xdc, world: 'Unused Rooms', slot: '0xDC', name: 'Room 0xDC' }
  ] }
] }

function worldMap(): WorldMapModel {
  return {
    entrances: [
      { index: 0, levelDataId: 0, spawnX: 2, spawnY: 3, progTarget: 1 },
      { index: 1, levelDataId: 1, spawnX: 4, spawnY: 5, progTarget: 2 },
      { index: 2, levelDataId: 0, spawnX: 90, spawnY: 90, progTarget: 0 }
    ],
    translevelToRecordIndex: { '0x00': 0, '0x01': 1 }, midway: [], midwayIndex: {}
  }
}

afterEach(() => {
  setWorldMapCatalogDraft(null)
  setCatalog({ groups: [] })
})

describe('live stage mapping and spawns', () => {
  test('a remapped stage keeps its name over a baked unused-room entry', () => {
    setCatalog(catalog)
    const draft = worldMap()
    draft.entrances[1].levelDataId = 0xdc
    setWorldMapCatalogDraft(draft)
    expect(getLevel(0xdc)?.translevelId).toBe(1)
    expect(levelLabel(0xdc)).toBe('1-2 Watch Out Below!')
    expect(getLevelByTranslevel(1)?.recordId).toBe(0xdc)
    expect(getLevel(1)).toBeUndefined()
    expect(catalog.groups[0].levels[1].recordId).toBe(1) // saved data untouched
    setWorldMapCatalogDraft(worldMap()) // undo/discard
    expect(getLevel(1)?.slot).toBe('1-2')
    expect(getLevel(0xdc)?.translevelId).toBeUndefined()
  })

  test('a saved remap also takes precedence over the unused-room group', () => {
    const saved = structuredClone(catalog)
    saved.groups[0].levels[1].recordId = 0xdc
    setCatalog(saved)
    expect(getLevel(0xdc)?.slot).toBe('1-2')
  })

  test('moving a spawn to another room removes its old marker, including unused table aliases', () => {
    const draft = worldMap()
    expect(worldMapSpawns(draft, 0)).toEqual([{ x: 2, y: 3, entranceIndex: 0 }])
    draft.entrances[0].levelDataId = 0xdc
    expect(worldMapSpawns(draft, 0)).toEqual([])
    expect(worldMapSpawns(draft, 0xdc)).toEqual([{ x: 2, y: 3, entranceIndex: 0 }])
    delete draft.translevelToRecordIndex['0x00'] // unwire the stage
    expect(worldMapSpawns(draft, 0xdc)).toEqual([])
  })

  test('shared rooms retain separate editable world-map spawns', () => {
    const draft = worldMap()
    draft.entrances[1].levelDataId = 0
    expect(worldMapSpawns(draft, 0)).toEqual([
      { x: 2, y: 3, entranceIndex: 0 }, { x: 4, y: 5, entranceIndex: 1 }
    ])
    draft.entrances[0].spawnX = 12
    expect(worldMapSpawns(draft, 0)[1]).toEqual({ x: 4, y: 5, entranceIndex: 1 })
  })

  test('the level menu displays the chosen stage when two stages share their entry room', () => {
    const shared = structuredClone(catalog)
    shared.groups[0].levels[1].recordId = 0
    setCatalog(shared)
    const html = renderToStaticMarkup(createElement(LevelMenu, {
      selectedId: 0, selectedTranslevelId: 1, onSelect: () => {}
    }))
    expect(html).toContain('1-2')
    expect(html).toContain('Watch Out Below!')
    expect(html).not.toContain('Make Eggs, Throw Eggs')
  })
})
