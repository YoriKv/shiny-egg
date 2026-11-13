import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { patchRoomMetadata, readEditorMetadata, EDITOR_METADATA_FILE } from './project-metadata.ts'
import { collectFiles, buildProjectZip } from './backup-core.ts'
import { strFromU8, unzipSync } from 'fflate'

test('metadata persists separately, preserves extension fields and is included in project backups', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shiny-room-meta-'))
  try {
    assert.deepEqual(readEditorMetadata(root), { version: 1, rooms: {} })
    writeFileSync(join(root, EDITOR_METADATA_FILE), JSON.stringify({ version: 1, rooms: {
      '0xDC': { name: 'Old', tags: ['secret'] }, '0x01': { notes: 'Keep me' }
    }, future: { settings: true } }))
    patchRoomMetadata(root, 0xdc, { name: '  Hidden garden  ', notes: 'An optional room.' })
    const data = readEditorMetadata(root)
    assert.deepEqual(data.rooms['0xDC'], { name: 'Hidden garden', notes: 'An optional room.', tags: ['secret'] })
    assert.deepEqual(data.rooms['0x01'], { notes: 'Keep me' })
    assert.deepEqual(data.future, { settings: true })
    assert.deepEqual(readdirSync(root), [EDITOR_METADATA_FILE]) // never creates an overlay/build file
    const zip = unzipSync(await buildProjectZip('demo', await collectFiles(root)))
    assert.deepEqual(JSON.parse(strFromU8(zip[`demo/${EDITOR_METADATA_FILE}`])), data)
    patchRoomMetadata(root, 0xdc, { name: '' })
    assert.equal(readEditorMetadata(root).rooms['0xDC'].name, undefined)
    assert.equal(readEditorMetadata(root).rooms['0xDC'].notes, 'An optional room.')
    patchRoomMetadata(root, 0x01, { notes: '' })
    assert.equal(readEditorMetadata(root).rooms['0x01'], undefined)
    const before = readFileSync(join(root, EDITOR_METADATA_FILE), 'utf8')
    assert.throws(() => patchRoomMetadata(root, -1, { name: 'No' }))
    assert.throws(() => patchRoomMetadata(root, 0, { name: 'Bad\nname' }))
    assert.throws(() => patchRoomMetadata(root, 0, { name: 'x'.repeat(161) }))
    assert.equal(readFileSync(join(root, EDITOR_METADATA_FILE), 'utf8'), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('unreadable and future metadata files are never overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'shiny-room-meta-'))
  try {
    for (const original of ['{broken', '{"version":2,"rooms":{}}']) {
      writeFileSync(join(root, EDITOR_METADATA_FILE), original)
      assert.throws(() => patchRoomMetadata(root, 1, { name: 'New' }))
      assert.equal(readFileSync(join(root, EDITOR_METADATA_FILE), 'utf8'), original)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
