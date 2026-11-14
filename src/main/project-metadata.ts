import { existsSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProjectEditorMetadata, RoomMetadataPatch } from '../shared/ipc-types.ts'

export const EDITOR_METADATA_FILE = 'editor-metadata.json'
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function readEditorMetadata(root: string): ProjectEditorMetadata {
  const file = join(root, EDITOR_METADATA_FILE)
  if (!existsSync(file)) return { version: 1, rooms: {} }
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!isObject(data) || data.version !== 1 || !isObject(data.rooms)) {
    throw new Error('Unsupported or invalid editor metadata file.')
  }
  for (const [id, room] of Object.entries(data.rooms)) {
    if (!/^0x[0-9A-F]{2}$/.test(id) || !isObject(room) ||
      (room.name !== undefined && typeof room.name !== 'string') ||
      (room.notes !== undefined && typeof room.notes !== 'string')) {
      throw new Error(`Invalid room metadata: ${id}.`)
    }
  }
  return data as ProjectEditorMetadata
}

/** Read/modify/write synchronously to serialize IPC patches. Never overwrite an
 * unreadable file; preserve all unrelated fields. Rename makes the write atomic. */
export function patchRoomMetadata(root: string, recordId: number, patch: RoomMetadataPatch): ProjectEditorMetadata {
  if (!Number.isInteger(recordId) || recordId < 0 || recordId > 0xff) throw new Error('Invalid room ID.')
  if (!isObject(patch)) throw new Error('Invalid room metadata patch.')
  const data = readEditorMetadata(root)
  const key = `0x${recordId.toString(16).toUpperCase().padStart(2, '0')}`
  const room = { ...data.rooms[key] }
  for (const field of ['name', 'notes'] as const) {
    if (!Object.hasOwn(patch, field)) continue
    const value = patch[field]
    if (typeof value !== 'string' || value.length > (field === 'name' ? 160 : 16000) ||
      (field === 'name' && /[\x00-\x1f\x7f]/.test(value))) throw new Error(`Invalid room ${field}.`)
    const trimmed = value.trim()
    if (trimmed) room[field] = trimmed
    else delete room[field]
  }
  if (Object.keys(room).length) data.rooms[key] = room
  else delete data.rooms[key]
  const temporary = join(root, `${EDITOR_METADATA_FILE}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8')
    renameSync(temporary, join(root, EDITOR_METADATA_FILE))
  } finally {
    rmSync(temporary, { force: true })
  }
  return data
}
