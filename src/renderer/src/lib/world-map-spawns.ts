import type { WorldMapModel } from '../../../preload/api'
import type { WorldMapSpawn } from '../types'

/** Only wired entrances create markers; unused table records are not spawns. */
export function worldMapSpawns(model: WorldMapModel | null, levelDataId: number): WorldMapSpawn[] {
  if (!model) return []
  const active = new Set(Object.values(model.translevelToRecordIndex))
  return model.entrances
    .filter((e) => active.has(e.index) && e.levelDataId === levelDataId)
    .map((e) => ({ x: e.spawnX, y: e.spawnY, entranceIndex: e.index }))
}
