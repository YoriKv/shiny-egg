import { useEffect, useState } from 'react'
import type { LevelData } from '../../../preload/api'

/** Per-object drawn-tile footprints for the canvas's drawn-tiles hit-testing:
 *  `uid → Set<cellIndex>` where cellIndex = `y * 256 + x`. Objects absent from the
 *  map (command objects / unported handlers, or a just-added object whose refetch
 *  hasn't resolved yet) fall back to their bounding box in hit-test.ts. */
export type ObjectFootprints = Map<number, Set<number>> | null

/**
 * Fetch + cache the per-object drawn-tile footprints for the loaded level.
 *
 * Re-fetches only when the object state changes (a new `level` object from a
 * reducer commit); selection / hover / view / palette changes don't create a new
 * `level`, so they never refetch. A sprite-only edit does create a new `level`
 * but hashes to the SAME object-state token, so main returns its cached decode
 * (no re-decode) — see `render:objectCells`. Cancellable / keep-latest: only the
 * latest level's response is applied, so the map always matches the request's
 * object list (index → uid) with no race.
 *
 * Returns `Map<uid, Set<cellIndex>>` (only objects that stamp ≥1 tile), or null
 * before the first fetch resolves / for empty-special levels.
 */
export function useObjectCells(level: LevelData | null): ObjectFootprints {
  const [footprints, setFootprints] = useState<ObjectFootprints>(null)

  useEffect(() => {
    if (!level || level.empty || level.special) {
      setFootprints(null)
      return
    }
    let cancelled = false
    void window.shinyEgg.render
      .objectCells({ levelRecordId: level.recordId, override: level })
      .then((res) => {
        if (cancelled) return
        if (!res) {
          setFootprints(null)
          return
        }
        // Map decode stream index → uid using THIS request's object list (the
        // response aligns with it; a superseding level cancelled this one).
        const map = new Map<number, Set<number>>()
        for (let i = 0; i < res.footprints.length; i++) {
          const cells = res.footprints[i]
          const uid = level.objects[i]?.uid
          if (uid != null && cells && cells.length > 0) map.set(uid, new Set(cells))
        }
        setFootprints(map)
      })
      .catch(() => {
        if (!cancelled) setFootprints(null)
      })
    return () => {
      cancelled = true
    }
  }, [level])

  return footprints
}
