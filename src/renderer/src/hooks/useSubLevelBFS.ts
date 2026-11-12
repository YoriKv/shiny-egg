// A project-wide warp index makes incoming markers independent of the stage
// used to open a room. Room lists follow actual outgoing links.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LevelData } from '../../../preload/api'
import { useLevelsCatalog, useRemovedRecords } from '../data/levels'
import { loadWarpEdges, roomGraph, withLiveWarpEdges, type WarpEdge } from '../lib/warp-graph'
import type { IncomingExit } from '../types'

export interface SubLevelBFS {
  subLevels: number[]
  loading: boolean
  incomingByLevel: Map<number, IncomingExit[]>
  edges: WarpEdge[]
  allEdges: WarpEdge[]
  recordSavedLevel: (level: LevelData) => void
}

export function useSubLevelBFS(
  root: number | null,
  selected: number | null,
  liveLevel: LevelData | null,
  scope: string,
  refreshToken = 0
): SubLevelBFS {
  const catalog = useLevelsCatalog()
  const removed = useRemovedRecords()
  const count = catalog.recordCount ?? 0x100
  const enabled = catalog.groups.length > 0
  const [snapshot, setSnapshot] = useState<{ scope: string; edges: WarpEdge[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const recordSavedLevel = useCallback((level: LevelData) => {
    setSnapshot((previous) => ({ scope, edges: withLiveWarpEdges(
      previous?.scope === scope ? previous.edges : [], level.recordId, level.exits) }))
  }, [scope])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const edges: WarpEdge[] = []
      // Bound IPC concurrency. Include orphan/unused rooms for one-way links.
      for (let start = 0; start < count; start += 8) {
        if (cancelled) return
        const batch = await Promise.all(
          Array.from({ length: Math.min(8, count - start) }, (_, i) => start + i)
            .map(async (id) => removed.has(id) ? [] : loadWarpEdges(id).catch(() => []))
        )
        edges.push(...batch.flat())
      }
      if (cancelled) return
      setSnapshot({ scope, edges })
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [enabled, scope, count, removed, refreshToken])

  return useMemo(() => {
    let edges = enabled && snapshot?.scope === scope ? snapshot.edges : []
    if (liveLevel && !liveLevel.empty && !liveLevel.special && liveLevel.recordId === selected) {
      edges = withLiveWarpEdges(edges, liveLevel.recordId, liveLevel.exits)
    }
    if (root === null) return { subLevels: [], edges: [], allEdges: edges, incomingByLevel: new Map(), loading, recordSavedLevel }
    return { ...roomGraph(root, selected, edges), allEdges: edges, loading, recordSavedLevel }
  }, [root, selected, liveLevel, snapshot, scope, loading, enabled, recordSavedLevel])
}
