// Save / build blockers for the active level, including the async byte-budget
// contributor (task #14). The synchronous blockers (lib/level-blockers.ts) run
// every render; the byte budget needs the OTHER pool members' on-disk sizes, so
// it's an IPC (editor.levelBudget) — fetched debounced and merged in.
//
// The budget report is held across same-level edits (re-fetched, trailing call
// wins) and cleared only on a level switch, so the over-budget banner doesn't
// flicker while the user keeps editing.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LevelData, PoolBudgetReport } from '../../../preload/api'
import { budgetBlockers, levelBlockers, type Blocker } from '../lib/level-blockers'

/** How long after the last edit to recompute the budget. The reducer returns a
 *  new `level` object per edit, so the effect re-runs on every change; the
 *  trailing timer wins. */
const BUDGET_DEBOUNCE_MS = 350

export interface LevelGate {
  blockers: Blocker[]
  /** The live pool-budget report the blockers were derived from (null while
   *  loading / for empty/special slots). Also drives the status-bar pool label. */
  budget: PoolBudgetReport | null
}

export function useLevelBlockers(
  level: LevelData | null,
  saveError: string | null,
  /** Bump to force a budget re-fetch without a level switch — e.g. after a
   *  Banks-panel migrate / de-couple toggle reclaims room in this level's bank. */
  refreshKey = 0
): LevelGate {
  const [budget, setBudget] = useState<PoolBudgetReport | null>(null)
  const lastLevelId = useRef<number | null>(null)

  useEffect(() => {
    if (!level || level.empty || level.special) {
      setBudget(null)
      lastLevelId.current = level?.recordId ?? null
      return
    }
    // Clear the previous level's report on a switch (avoid showing its pool);
    // keep it across edits of the same level so the banner is stable.
    if (level.recordId !== lastLevelId.current) {
      setBudget(null)
      lastLevelId.current = level.recordId
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      window.shinyEgg.editor
        .levelBudget(level.recordId, level)
        .then((r) => {
          if (!cancelled) setBudget(r)
        })
        .catch(() => {
          if (!cancelled) setBudget(null)
        })
    }, BUDGET_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [level, refreshKey])

  const blockers = useMemo(
    () => [...levelBlockers(level, { saveError }), ...budgetBlockers(budget)],
    [level, saveError, budget]
  )
  return { blockers, budget }
}
