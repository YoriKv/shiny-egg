import { useEffect, useState } from 'react'
import type { DecodedObjectInfluence, LevelData } from '../../../preload/api'
import type { Selection } from '../types'

/**
 * Provenance decode for the currently-selected object (`objectInfluence` with
 * the object's stream index as the lone target): its exact stamped cells, each
 * carrying the Map16 id it stamped and a footprint/neighbor/buried class.
 * Null unless exactly one object is selected.
 *
 * ONE decode per selection, shared by every consumer — the Tiles "Used" view's
 * block set + the Palette row highlight (via `influenceBlockIds`) and the
 * Properties panel's collision summary (`summarizeObjectCollision`) all derive
 * from this result.
 */
export function useSelectedObjectInfluence(
  level: LevelData | null,
  primary: Selection | null
): DecodedObjectInfluence | null {
  const [influence, setInfluence] = useState<DecodedObjectInfluence | null>(null)
  const objUid = primary?.kind === 'object' ? primary.uid : null

  useEffect(() => {
    if (!level || level.empty || level.special || objUid === null) {
      setInfluence(null)
      return
    }
    const idx = level.objects.findIndex((o) => o.uid === objUid)
    if (idx < 0) {
      setInfluence(null)
      return
    }
    let cancelled = false
    void window.shinyEgg.render
      .objectInfluence({ levelRecordId: level.recordId, override: level, targetIndices: [idx] })
      .then((res) => {
        if (!cancelled) setInfluence(res)
      })
      .catch(() => {
        if (!cancelled) setInfluence(null)
      })
    return () => {
      cancelled = true
    }
  }, [level, objUid])

  return influence
}

/** Distinct Map16 ids the selected object itself stamps — drives the Tiles
 *  "Used" selection outline + the Palette row highlight. Buried cells are
 *  excluded: their final tile belongs to the overwriting object, not this
 *  one (the provenance `mid` is the buffer's final value). */
export function influenceBlockIds(influence: DecodedObjectInfluence | null): Set<number> | null {
  if (!influence) return null
  const ids = new Set<number>()
  for (const c of influence.cells) {
    if (c.cls === 'buried' || c.cls === 'buriedNeighbor') continue
    ids.add(c.mid)
  }
  return ids
}
