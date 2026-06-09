import { useEffect, useState } from 'react'
import type { LevelData, LevelTileUsage } from '../../../preload/api'

/**
 * Fetch the level's Map16 usage (the Tiles "Used in this level" view + the
 * Palette panel's used-rows). Refetched per level and per edit-commit — the
 * `level` reference changes on each reducer commit, so the view tracks live
 * edits (same cadence as the BG1 layer re-decode). `enabled` gates the fetch so
 * it doesn't run (and re-render the composite thumbnail) while both consuming
 * panels are closed.
 */
export function useLevelTileUsage(
  level: LevelData | null,
  enabled: boolean
): LevelTileUsage | null {
  const [usage, setUsage] = useState<LevelTileUsage | null>(null)
  useEffect(() => {
    if (!enabled || !level || level.empty || level.special) {
      setUsage(null)
      return
    }
    let cancelled = false
    void window.shinyEgg.render
      .levelTileUsage({ levelRecordId: level.recordId, override: level })
      .then((res) => {
        if (!cancelled) setUsage(res)
      })
      .catch(() => {
        if (!cancelled) setUsage(null)
      })
    return () => {
      cancelled = true
    }
  }, [level, enabled])
  return usage
}
