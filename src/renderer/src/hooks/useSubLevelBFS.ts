// BFS over warp exits starting from a root translevel. Streams incremental
// results so the UI can render partial lists as discovery progresses.
//
// A "sub-room" is any reachable level that is NOT itself a catalog entry in
// the main level dropdown. Catalog entries (other translevels) are pruned
// from BOTH the result list AND BFS expansion — they're reachable via the
// main menu and shouldn't get treated as sub-rooms of the current translevel.
//
// Side product: `incomingByLevel` is the reverse adjacency — "which sibling
// rooms warp INTO this destination". Built alongside subLevels so the
// canvas can show entry markers for one-way connections.

import { useEffect, useState } from 'react'
import { getLevel } from '../data/levels'
import { walkWarpGraph } from '../lib/warp-graph'
import type { IncomingExit } from '../types'

export interface SubLevelBFS {
  /** Discovered sub-room IDs in BFS order. Root included at index 0. */
  subLevels: number[]
  /** True while BFS is still in flight. */
  loading: boolean
  /** Reverse map keyed by destination level ID. */
  incomingByLevel: Map<number, IncomingExit[]>
}

const EMPTY: SubLevelBFS = {
  subLevels: [],
  loading: false,
  incomingByLevel: new Map()
}

export function useSubLevelBFS(rootLevelRecordId: number | null): SubLevelBFS {
  const [subLevels, setSubLevels] = useState<number[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [incomingByLevel, setIncomingByLevel] = useState<Map<number, IncomingExit[]>>(
    () => new Map()
  )

  useEffect(() => {
    if (rootLevelRecordId === null) {
      setSubLevels([])
      setIncomingByLevel(new Map())
      setLoading(false)
      return
    }
    let cancelled = false
    setSubLevels([rootLevelRecordId])
    setIncomingByLevel(new Map())
    setLoading(true)
    const result: number[] = [rootLevelRecordId]
    const incomingBuild = new Map<number, IncomingExit[]>()
    ;(async () => {
      // Shared warp-graph walk (lib/warp-graph). `shouldExpand` prunes catalog
      // destinations — they're full translevels, not sub-rooms, so we don't
      // descend into their sub-graph either.
      for await (const { edge, expanded } of walkWarpGraph(rootLevelRecordId, {
        shouldExpand: (id) => !getLevel(id)
      })) {
        if (cancelled) return
        // Record the incoming-reference for EVERY warp edge (independent of the
        // catalog/visited gates that govern expansion) so one-way markers show.
        const list = incomingBuild.get(edge.destLevelRecordId) ?? []
        list.push({
          sourceLevelRecordId: edge.sourceLevelRecordId,
          destX: edge.destX,
          destY: edge.destY,
          sourceScreenIndex: edge.sourceScreenIndex
        })
        incomingBuild.set(edge.destLevelRecordId, list)
        // A newly-seen, expandable (non-catalog) destination is a sub-room.
        if (expanded) result.push(edge.destLevelRecordId)
        setSubLevels([...result])
        setIncomingByLevel(new Map(incomingBuild))
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [rootLevelRecordId])

  if (rootLevelRecordId === null) return EMPTY
  return { subLevels, loading, incomingByLevel }
}
