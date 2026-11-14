import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test } from 'vitest'
import { RoomsDialog } from './RoomsDialog'
import { setCatalog } from './data/levels'
import { setRoomMetadata } from './data/room-metadata'
import { LevelPicker } from './panels/field-widgets'
import { PropertiesBody } from './panels/PropertiesPanel'
import type { IncomingExit } from './types'

afterEach(() => {
  setCatalog({ groups: [] })
  setRoomMetadata({ version: 1, rooms: {} })
})

test('all rooms and destination pickers include named orphans and IDs without an Unused Rooms stage group', () => {
  setCatalog({ recordCount: 3, groups: [
    { label: 'World 1', levels: [{ recordId: 0, translevelId: 0, slot: '1-1', name: 'Stage One', world: 'World 1' }] },
    { label: 'Unused Rooms', levels: [{ recordId: 2, slot: '0x02', name: 'Room 0x02', world: 'Unused Rooms' }] }
  ] })
  setRoomMetadata({ version: 1, rooms: { '0x01': { name: 'Secret Cave' } } })
  const html = renderToStaticMarkup(createElement(RoomsDialog, {
    onClose: () => {}, onSelect: () => {}, onContextMenu: () => {}
  }))
  expect(html).toContain('1-1 Stage One (0x00)')
  expect(html).toContain('Secret Cave (0x01)')
  expect(html).toContain('Room 0x02')
  const picker = renderToStaticMarkup(createElement(LevelPicker, {
    value: 1, source: { kind: 'catalog' }, onCommit: () => {}
  }))
  expect(picker).toContain('Secret Cave (0x01)')
  expect(picker).toContain('label="Rooms"')
  expect(picker).not.toContain('Unused Rooms')
})

test('sprite-generated entrances resolve the selected door and expose read-only destinations', () => {
  const base: IncomingExit = {
    sourceLevelRecordId: 0, sourceScreenIndex: 0, kind: 'rotating-door', sourceSpriteIndex: 2,
    doorIndex: 0, destX: 10, destY: 11, entranceType: 0
  }
  const selected = { ...base, doorIndex: 1, destX: 20, destY: 22 }
  const html = renderToStaticMarkup(createElement(PropertiesBody, {
    selection: [{ kind: 'incoming', incoming: selected }], incoming: [base, selected], level: null,
    currentLevelRecordId: 1, rootLevelRecordId: 0, rootTranslevelId: 0,
    selectedObjectInfluence: null, dispatchLevel: () => {}, onIncomingEntranceCommit: () => {}
  }))
  expect(html).toContain('Rotating door 2 entrance (table-defined)')
  expect(html).toContain('20, 22')
  expect(html).not.toContain('<select')
})
