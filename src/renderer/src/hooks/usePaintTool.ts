import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react'
import type { LevelObject } from '../../../preload/api'
import type { LevelAction, LevelState } from '../canvas/level-reducer'

export interface PaintTool {
  /** Editable surface curve (cell-corner column → row) for the current level. */
  heights: Map<number, number>
  /** Canvas reports a finished paint gesture: cols painted (col→row) + cols erased. */
  onStroke: (setCols: Array<[number, number]>, erasedCols: number[]) => void
  /** Fit tileset (paint panel selection); null → the level's own. */
  tileset: number | null
  onTileset: (t: number) => void
  fillDepth: number
  onFillDepth: (n: number) => void
  onClear: () => void
}

/**
 * The surface-paint tool: an ephemeral height curve (v1, not persisted) re-fitted
 * to std objects on each edit. Dormant in v1 — the paint tool/window are commented
 * out of the toolbar — but fully wired; kept self-contained so the dormant feature
 * is one hook rather than ~90 lines of state/effects/callbacks spread through App.
 *
 * Paint-owned objects are tracked out-of-band by uid (deleted before each re-fit).
 * `nextUidRef` mirrors the reducer's `nextUid` so a refit can predict the uids
 * `addEntities` will assign (it stamps objects-first from nextUid; deleteEntities
 * doesn't change it).
 */
export function usePaintTool(
  selectedLevelRecordId: number | null,
  levelState: LevelState,
  dispatchLevel: Dispatch<LevelAction>
): PaintTool {
  const [heights, setHeights] = useState<Map<number, number>>(() => new Map())
  const ownedUidsRef = useRef<number[]>([])
  const [tileset, setTileset] = useState<number | null>(null)
  const [fillDepth, setFillDepth] = useState<number>(8)

  const nextUidRef = useRef(0)
  useEffect(() => { nextUidRef.current = levelState.nextUid }, [levelState.nextUid])

  // Reset the painted curve when the level changes; re-default the paint tileset
  // to the (newly loaded) level's own tileset until the user overrides it.
  useEffect(() => {
    setHeights(new Map())
    ownedUidsRef.current = []
    setTileset(null)
  }, [selectedLevelRecordId])
  useEffect(() => {
    const ts = levelState.level?.header?.[1]
    if (ts != null && tileset == null) setTileset(ts)
  }, [levelState.level, tileset])

  // Re-fit the whole painted curve to std objects: remove the previous paint-owned
  // objects, then add the freshly fitted ones (the override/repaint loop redraws).
  // `tileset`/`fillDepth` are passed in (not closed over) so a panel change can
  // re-fit the existing curve with the NEW value without a stale-closure race.
  const refit = useCallback(
    async (h: Map<number, number>, ts: number, depth: number): Promise<void> => {
      const rec = selectedLevelRecordId
      if (rec === null) return
      const oldUids = ownedUidsRef.current
      if (h.size === 0) {
        if (oldUids.length) dispatchLevel({ type: 'deleteEntities', objectUids: oldUids, spriteUids: [] })
        ownedUidsRef.current = []
        return
      }
      const corners = [...h.entries()].map(([col, row]) => ({ col, row }))
      let maxRow = 0
      for (const r of h.values()) maxRow = Math.max(maxRow, r)
      const baseline = Math.min(127, maxRow + depth)
      let objects: LevelObject[]
      try {
        objects = await window.shinyEgg.render.fitSurface({ levelRecordId: rec, tileset: ts, corners, baseline })
      } catch (err) {
        console.error('Paint fit failed:', err)
        return
      }
      const firstUid = nextUidRef.current // delete leaves nextUid; add assigns from here
      if (oldUids.length) dispatchLevel({ type: 'deleteEntities', objectUids: oldUids, spriteUids: [] })
      if (objects.length) dispatchLevel({ type: 'addEntities', objects, sprites: [] })
      ownedUidsRef.current = objects.map((_, i) => firstUid + i)
    },
    [selectedLevelRecordId, dispatchLevel]
  )
  // Resolve the tileset to fit with (panel selection → level's own → cave/grass).
  const resolveTileset = useCallback(
    (t: number | null): number => t ?? levelState.level?.header?.[1] ?? 1,
    [levelState.level]
  )

  const onStroke = useCallback(
    (setCols: Array<[number, number]>, erasedCols: number[]): void => {
      const next = new Map(heights)
      for (const [c, r] of setCols) next.set(c, r)
      for (const c of erasedCols) next.delete(c)
      setHeights(next)
      void refit(next, resolveTileset(tileset), fillDepth)
    },
    [heights, refit, resolveTileset, tileset, fillDepth]
  )
  // Panel changes re-fit the EXISTING curve with the new value immediately (the
  // new value is passed explicitly so it isn't lost to the async state update).
  const onTileset = useCallback(
    (t: number): void => {
      setTileset(t)
      void refit(heights, t, fillDepth)
    },
    [heights, refit, fillDepth]
  )
  const onFillDepth = useCallback(
    (n: number): void => {
      setFillDepth(n)
      void refit(heights, resolveTileset(tileset), n)
    },
    [heights, refit, resolveTileset, tileset]
  )
  const onClear = useCallback((): void => {
    setHeights(new Map())
    void refit(new Map(), resolveTileset(tileset), fillDepth)
  }, [refit, resolveTileset, tileset, fillDepth])

  return { heights, onStroke, tileset, onTileset, fillDepth, onFillDepth, onClear }
}
