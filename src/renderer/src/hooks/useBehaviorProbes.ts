import { useEffect, useState } from 'react'
import type { LevelData } from '../../../preload/api'
import { getCollisionTable } from '../data/collision-info'
import type { BehaviorMark } from '../data/sprite-behavior-extents'
import {
  hasProbe,
  isRailFollower,
  probeMarks,
  railComponentCells,
  type ProbeContext
} from '../lib/sprite-probe-marks'

/** Per-sprite probe results, keyed by editor uid. Only sprites with a probe
 *  (chains, marker tracks, icicles, rail followers) appear. */
export interface ProbeResult {
  marks: BehaviorMark[]
  /** Connected rail cells (packed `cy*256+cx`) for rail followers. */
  railCells?: number[]
}
export type BehaviorProbeMap = Map<number, ProbeResult>

// Same Map16 cell reader as useNeighborDependencies (mirrors
// engine/cell-grid.ts resolveCellGrid — see that hook for the contract).
function makeMap16At(buf: Uint8Array, pageMap: Uint8Array): (cx: number, cy: number) => number | undefined {
  return (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= 256 || cy >= 128) return undefined
    const slot = pageMap[((cy >> 4) << 4) | (cx >> 4)]
    if (slot === undefined || slot === 0x80) return 0
    const page = slot & 0x3f
    if (page === 0) return 0
    const off = page * 512 + ((cy & 0x0f) << 5) + (cx & 0x0f) * 2
    return buf[off]! | (buf[off + 1]! << 8)
  }
}

/**
 * Measure every probe-carrying placed sprite against the live level data
 * (chain lengths from ceiling distance, marker-tile march tracks, icicle
 * heights, connected rail components). Re-runs per edit commit like
 * useNeighborDependencies — dragging the sprite or repainting the terrain
 * updates the geometry. `enabled` gates the IPC (the overlay rides the
 * Sprite-Editing layer).
 */
export function useBehaviorProbes(level: LevelData | null, enabled: boolean): BehaviorProbeMap | null {
  const [probes, setProbes] = useState<BehaviorProbeMap | null>(null)
  useEffect(() => {
    if (!enabled || !level || level.empty || level.special) {
      setProbes(null)
      return
    }
    const relevant = level.sprites.filter((s) => s.uid !== undefined && hasProbe(s.num))
    if (relevant.length === 0) {
      setProbes(new Map())
      return
    }
    let cancelled = false
    void Promise.all([
      window.shinyEgg.render.decodeLevelLayout({ levelRecordId: level.recordId, override: level }),
      getCollisionTable()
    ])
      .then(([layout, table]) => {
        if (cancelled) return
        if (!layout) {
          setProbes(new Map())
          return
        }
        const ctx: ProbeContext = {
          map16At: makeMap16At(layout.levelDataBuffer, layout.screenPageMap),
          isSolidPage: (page) => table[page]?.flags.al ?? false
        }
        const map: BehaviorProbeMap = new Map()
        for (const s of relevant) {
          const sprite = { num: s.num, x: s.x, y: s.y }
          const result: ProbeResult = { marks: probeMarks(ctx, sprite) }
          if (isRailFollower(s.num)) {
            const cells = railComponentCells(ctx, sprite)
            if (cells.length > 0) result.railCells = cells
          }
          if (result.marks.length > 0 || result.railCells) map.set(s.uid!, result)
        }
        setProbes(map)
      })
      .catch(() => {
        if (!cancelled) setProbes(null)
      })
    return () => {
      cancelled = true
    }
  }, [level, enabled])
  return probes
}
