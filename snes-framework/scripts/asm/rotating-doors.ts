import { findDataWords } from './data-words.ts'
import type { RoomWarpDestination } from '../types.ts'

/** CODE_0F892F copies one of four 4-byte screen-exit records from this table. */
export function parseRotatingDoorEntrances(text: string): RoomWarpDestination[] {
  const words = findDataWords(text, 'DATA_0F891F')
  if (words.length !== 8) throw new Error('Rotating-door entrance table must contain eight words.')
  return Array.from({ length: 4 }, (_, i) => ({
    destLevelRecordId: words[i * 2].value & 0xff,
    destX: words[i * 2].value >>> 8,
    destY: words[i * 2 + 1].value & 0xff,
    entranceType: words[i * 2 + 1].value >>> 8
  }))
}
