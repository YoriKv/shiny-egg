import { useEffect, useState } from 'react'
import type { LevelData } from '../../../preload/api'
import type { Selection } from '../types'

/**
 * The set of Map16 IDs the currently-selected object stamps — drives the Tiles
 * "Used" view's selection outline and (via the usage block→rows map) the Palette
 * panel's row highlight. Null unless exactly one object is selected.
 *
 * Reuses the existing provenance decode (`objectInfluence` with the object's
 * stream index as the lone target); each returned cell now carries the Map16 ID
 * it stamped, so the distinct set is the object's block footprint.
 */
export function useSelectedObjectBlocks(
  level: LevelData | null,
  primary: Selection | null
): Set<number> | null {
  const [ids, setIds] = useState<Set<number> | null>(null)
  const objUid = primary?.kind === 'object' ? primary.uid : null

  useEffect(() => {
    if (!level || level.empty || level.special || objUid === null) {
      setIds(null)
      return
    }
    const idx = level.objects.findIndex((o) => o.uid === objUid)
    if (idx < 0) {
      setIds(null)
      return
    }
    let cancelled = false
    void window.shinyEgg.render
      .objectInfluence({ levelRecordId: level.recordId, override: level, targetIndices: [idx] })
      .then((res) => {
        if (!cancelled) setIds(res ? new Set(res.cells.map((c) => c.mid)) : null)
      })
      .catch(() => {
        if (!cancelled) setIds(null)
      })
    return () => {
      cancelled = true
    }
  }, [level, objUid])

  return ids
}
