import { useSyncExternalStore } from 'react'
import type { ProjectEditorMetadata, RoomMetadataPatch } from '../../../shared/project-metadata'
import { hex0x } from '../lib/hex'

let current: ProjectEditorMetadata = { version: 1, rooms: {} }
let project: string | null = null
let generation = 0
const listeners = new Set<() => void>()
export function setRoomMetadata(data: ProjectEditorMetadata): void {
  current = data
  for (const notify of listeners) notify()
}
export const getRoomMetadata = (id: number) => current.rooms[hex0x(id, 2)]
export function useRoomMetadata(): ProjectEditorMetadata {
  return useSyncExternalStore((notify) => { listeners.add(notify); return () => listeners.delete(notify) },
    () => current, () => current)
}
export async function refreshRoomMetadata(id: string | null): Promise<void> {
  const request = ++generation
  project = id
  setRoomMetadata({ version: 1, rooms: {} })
  if (!id) return
  const data = await window.shinyEgg.projects.metadata(id)
  if (request === generation) setRoomMetadata(data)
}
export async function saveRoomMetadata(id: string, recordId: number, patch: RoomMetadataPatch): Promise<void> {
  const request = generation
  const data = await window.shinyEgg.projects.patchRoomMetadata(id, recordId, patch)
  if (project === id && request === generation) setRoomMetadata(data)
}
