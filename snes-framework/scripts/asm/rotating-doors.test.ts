import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseRotatingDoorEntrances } from './rotating-doors.ts'

test('reads the four rotating-door exits from Bank0F with either line ending', () => {
  const source = readFileSync(new URL('../../yi/Banks/Bank0F.asm', import.meta.url), 'utf8')
  const expected = [
    { destLevelRecordId: 0xb8, destX: 5, destY: 0x77, entranceType: 0 },
    { destLevelRecordId: 0xc6, destX: 7, destY: 0x7a, entranceType: 0 },
    { destLevelRecordId: 0xcd, destX: 5, destY: 0x5b, entranceType: 0 },
    { destLevelRecordId: 0xd3, destX: 0, destY: 0x77, entranceType: 6 }
  ]
  for (const eol of ['\n', '\r\n']) {
    assert.deepEqual(parseRotatingDoorEntrances(source.replace(/\r\n/g, '\n').replace(/\n/g, eol)), expected)
  }
  assert.equal(parseRotatingDoorEntrances(source.replace('$05B8', '$12DC'))[0].destLevelRecordId, 0xdc)
  assert.equal(parseRotatingDoorEntrances(source.replace('$05B8', '$12DC'))[0].destX, 0x12)
  assert.throws(() => parseRotatingDoorEntrances('DATA_0F891F:\n dw $0000\nRTS'))
})
