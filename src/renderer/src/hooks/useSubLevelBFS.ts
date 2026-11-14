// A project-wide warp index makes incoming markers independent of the stage
// used to open a room. Room lists follow actual outgoing links.
//
// The index is one entry per source record (its warp edges, possibly empty).
// A full scan decodes every record over IPC, so it runs only when the project
// scope / record count changes or on an explicit `refreshToken` bump (ROM
// import). Every other change is incremental: a level save or reset replaces
// that record from its in-memory data (`recordSavedLevel`), and a cross-level
// exit edit re-reads just the edited source (`reloadLevelEdges`). Removed
// records are filtered at read time, so removing one never rescans, and a
// record that leaves the removed set is re-read on its own.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LevelData, RoomWarpDestination } from '../../../preload/api'
import { useLevelsCatalog, useRemovedRecords } from '../data/levels'
import { loadWarpEdges, roomGraph, withLiveWarpEdges, type WarpEdge } from '../lib/warp-graph'
import type { IncomingExit } from '../types'
const EMPTY_DOORS: RoomWarpDestination[] = []
const SCAN_CONCURRENCY = 8

export interface SubLevelBFS {
  subLevels: number[]
  loading: boolean
  incomingByLevel: Map<number, IncomingExit[]>
  edges: WarpEdge[]
  allEdges: WarpEdge[]
  /** The complete project edge set (live edits of the loaded level included).
   *  Resolves immediately when the index is complete, else once the running
   *  scan finishes. Graph walks (Test Level's warp chain, owner lookup) read
   *  this rather than re-reading disk. */
  readEdges: () => Promise<WarpEdge[]>
  /** Replace one record's edges from in-memory level data (after save / reset). */
  recordSavedLevel: (level: LevelData) => void
  /** Re-read one record's edges from disk (after a cross-level exit edit). */
  reloadLevelEdges: (levelRecordId: number) => void
}

type EdgeIndex = { scope: string; bySource: ReadonlyMap<number, WarpEdge[]> }

export function useSubLevelBFS(
  root: number | null,
  selected: number | null,
  liveLevel: LevelData | null,
  scope: string,
  refreshToken = 0
): SubLevelBFS {
  const catalog = useLevelsCatalog()
  const removed = useRemovedRecords()
  const removedRef = useRef(removed)
  removedRef.current = removed
  const count = catalog.recordCount ?? 0x100
  const enabled = catalog.groups.length > 0
  const [index, setIndex] = useState<EdgeIndex | null>(null)
  const [loading, setLoading] = useState(false)
  const [doorTable, setDoorTable] = useState<{ scope: string; destinations: RoomWarpDestination[] } | null>(null)
  const doors = doorTable?.scope === scope ? doorTable.destinations : EMPTY_DOORS
  const doorsRef = useRef(doors)
  doorsRef.current = doors

  /** Merge per-record entries into the index for `forScope` (dropped if the
   *  scope moved on while they were loading). */
  const mergeEntries = useCallback((forScope: string, entries: [number, WarpEdge[]][]) => {
    if (entries.length === 0) return
    setIndex((previous) => {
      const bySource = new Map(previous?.scope === forScope ? previous.bySource : [])
      for (const [id, edges] of entries) bySource.set(id, edges)
      return { scope: forScope, bySource }
    })
  }, [])

  const recordSavedLevel = useCallback((level: LevelData) => {
    mergeEntries(scope, [[level.recordId, withLiveWarpEdges([], level.recordId, level.exits, level.sprites, doorsRef.current)]])
  }, [scope, mergeEntries])

  // Single-record reads in flight. A request while one is pending queues one
  // follow-up read (the pending read may predate the newer write).
  const pendingRef = useRef(new Map<string, boolean>())
  const reloadLevelEdges = useCallback((levelRecordId: number) => {
    const forScope = scope
    const key = `${forScope}:${levelRecordId}`
    if (pendingRef.current.has(key)) {
      pendingRef.current.set(key, true)
      return
    }
    const read = (): void => {
      pendingRef.current.set(key, false)
      void loadWarpEdges(levelRecordId, doorsRef.current)
        .catch(() => [])
        .then((edges) => {
          mergeEntries(forScope, [[levelRecordId, edges]])
          if (pendingRef.current.get(key)) read()
          else pendingRef.current.delete(key)
        })
    }
    read()
  }, [scope, mergeEntries])

  // Full scan. Partial results publish per batch so the room list and markers
  // fill in as the scan runs; a refresh in the same scope keeps the previous
  // entries visible until each is replaced.
  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const destinations = await window.shinyEgg.editor.rotatingDoorEntrances().catch(() => [])
      if (cancelled) return
      setDoorTable({ scope, destinations })
      for (let start = 0; start < count; start += SCAN_CONCURRENCY) {
        if (cancelled) return
        // Include orphan/unused rooms for one-way links; removed records are
        // read on restore instead.
        const ids = Array.from({ length: Math.min(SCAN_CONCURRENCY, count - start) }, (_, i) => start + i)
          .filter((id) => !removedRef.current.has(id))
        const batch = await Promise.all(ids.map(async (id): Promise<[number, WarpEdge[]]> =>
          [id, await loadWarpEdges(id, destinations).catch(() => [])]))
        if (cancelled) return
        mergeEntries(scope, batch)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, scope, count, refreshToken, mergeEntries])

  // A record leaving the removed set (restored, or a new level created in its
  // slot) is re-read: the scan may have skipped it, or its cached edges predate
  // the new content.
  const prevRemovedRef = useRef(removed)
  useEffect(() => {
    const previous = prevRemovedRef.current
    prevRemovedRef.current = removed
    for (const id of previous) if (!removed.has(id)) reloadLevelEdges(id)
  }, [removed, reloadLevelEdges])

  const allEdges = useMemo(() => {
    if (!enabled || index?.scope !== scope) return []
    const live = liveLevel && !liveLevel.empty && !liveLevel.special && liveLevel.recordId === selected
      ? liveLevel : null
    const edges: WarpEdge[] = []
    for (const [id, list] of index.bySource) if (!removed.has(id)) edges.push(...list)
    return live ? withLiveWarpEdges(edges, live.recordId, live.exits, live.sprites, doors) : edges
  }, [enabled, index, scope, liveLevel, selected, removed, doors])

  // readEdges: resolve waiters once a scan completes (or the index is disabled).
  const allEdgesRef = useRef(allEdges)
  allEdgesRef.current = allEdges
  const loadingRef = useRef(loading)
  loadingRef.current = loading
  const waitersRef = useRef<((edges: WarpEdge[]) => void)[]>([])
  useEffect(() => {
    if (loading) return
    const waiters = waitersRef.current
    waitersRef.current = []
    for (const resolve of waiters) resolve(allEdgesRef.current)
  }, [loading, allEdges])
  const readEdges = useCallback((): Promise<WarpEdge[]> => {
    if (!loadingRef.current) return Promise.resolve(allEdgesRef.current)
    return new Promise((resolve) => waitersRef.current.push(resolve))
  }, [])

  return useMemo(() => {
    const graph = root === null
      ? { subLevels: [], edges: [], incomingByLevel: new Map<number, IncomingExit[]>() }
      : roomGraph(root, selected, allEdges)
    return { ...graph, allEdges, loading, readEdges, recordSavedLevel, reloadLevelEdges }
  }, [root, selected, allEdges, loading, readEdges, recordSavedLevel, reloadLevelEdges])
}
