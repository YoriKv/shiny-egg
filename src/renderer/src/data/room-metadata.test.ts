import { afterEach, expect, test, vi } from 'vitest'
import { getRoomMetadata, refreshRoomMetadata, saveRoomMetadata, setRoomMetadata } from './room-metadata'
import { levelLabel, roomLabel, setCatalog } from './levels'

afterEach(() => {
  setRoomMetadata({ version: 1, rooms: {} })
  setCatalog({ groups: [] })
  vi.unstubAllGlobals()
})

test('custom labels include IDs and clearing them restores stage/fallback labels', () => {
  setCatalog({ groups: [{ label: 'World 1', levels: [
    { recordId: 0xdc, translevelId: 1, slot: '1-2', name: 'Watch Out Below!', world: 'World 1' }
  ] }] })
  setRoomMetadata({ version: 1, rooms: { '0xDC': { name: 'Hidden Garden' } } })
  expect(levelLabel(0xdc)).toBe('Hidden Garden (0xDC)')
  expect(roomLabel(0xdc)).toBe('Hidden Garden (0xDC)')
  setRoomMetadata({ version: 1, rooms: {} })
  expect(levelLabel(0xdc)).toBe('1-2 Watch Out Below!')
  expect(roomLabel(0xdc)).toBe('1-2 Watch Out Below! (0xDC)')
  expect(roomLabel(0xdd)).toBe('Room 0xDD')
})

test('late reads and saves cannot leak metadata across project switches', async () => {
  let finishRead!: (value: unknown) => void
  let finishSave!: (value: unknown) => void
  const named = { version: 1, rooms: { '0x00': { name: 'Project A' } } }
  vi.stubGlobal('window', { shinyEgg: { projects: {
    metadata: vi.fn((id: string) => id === 'a' ? new Promise((r) => { finishRead = r }) :
      Promise.resolve({ version: 1, rooms: {} })),
    patchRoomMetadata: vi.fn(() => new Promise((r) => { finishSave = r }))
  } } })
  const read = refreshRoomMetadata('a')
  await refreshRoomMetadata('b')
  finishRead(named)
  await read
  expect(getRoomMetadata(0)).toBeUndefined()
  const save = saveRoomMetadata('b', 0, { name: 'Project B' })
  await refreshRoomMetadata('c')
  finishSave(named)
  await save
  expect(getRoomMetadata(0)).toBeUndefined()
})
