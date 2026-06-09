// Save / build "blockers" — one extensible model behind the editor's Save +
// Test/Build affordances, so a new reason to stop (or warn about) an action is a
// single contributor, not a bespoke UI. Each contributor pushes a `Blocker`;
// the surface (`BlockerBar`) renders them and the Save / Test buttons consult
// them by scope.

import type { LevelData, PoolBudgetReport } from '../../../preload/api'
import { MAX_LEVEL_EXITS, MAX_LEVEL_SPRITES } from '../canvas/limits'

export type BlockerSeverity = 'error' | 'warn'

/** Which action a blocker applies to. `save` gates the Save button; `build`
 *  gates Test Level / the ROM build. One reason can emit BOTH at different
 *  severities — e.g. the byte budget warns on save but hard-stops the build. */
export type BlockerScope = 'save' | 'build'

export interface Blocker {
  id: string
  severity: BlockerSeverity
  scope: BlockerScope
  message: string
  detail?: string
  /** Whether this disables the scoped action. Defaults to `severity === 'error'`.
   *  Set `false` for an error that should still SHOW red but not block — e.g. the
   *  report of a *past* save failure (the user retries by clicking Save again). */
  gating?: boolean
  /** Transient blockers the user can clear (e.g. a stale IO error). Derived
   *  blockers reappear while their condition holds, so they omit this. */
  dismissible?: boolean
}

export interface BlockerContext {
  /** Last save IO error (App-level, transient) — surfaced as a blocker. */
  saveError?: string | null
}

/** True if any blocker disables `scope`. Honours per-blocker `gating`. */
export function isBlocked(blockers: Blocker[], scope: BlockerScope): boolean {
  return blockers.some((b) => b.scope === scope && gates(b))
}

/** Whether a blocker disables its scoped action. */
export function gates(b: Blocker): boolean {
  return b.gating ?? b.severity === 'error'
}

/**
 * Synchronous blockers for a level + ambient context. Pure, so it runs every
 * render. The async byte-budget contributor folds in via `useLevelBlockers`
 * (hooks/), which appends `budgetBlockers(report)` to this list.
 */
export function levelBlockers(level: LevelData | null, ctx: BlockerContext = {}): Blocker[] {
  const out: Blocker[] = []

  if (ctx.saveError) {
    // A past failure — show it red, but don't gate (Save retries it).
    out.push({
      id: 'io-error',
      severity: 'error',
      scope: 'save',
      gating: false,
      dismissible: true,
      message: 'Save failed',
      detail: ctx.saveError
    })
  }

  if (level && !level.empty && !level.special) {
    // Entity caps. Add is blocked at the cap (limits.ts / reducer), so over-cap
    // is defensive; AT-cap is the useful "can't add more" warning.
    out.push(...capBlocker('sprite-cap', level.sprites.length, MAX_LEVEL_SPRITES, 'sprites'))
    out.push(...capBlocker('exit-cap', level.exits.length, MAX_LEVEL_EXITS, 'screen exits'))
    // Byte budget (task #14) is async (needs the other pool members' on-disk
    // sizes) — appended by `useLevelBlockers` via `budgetBlockers` below.
  }

  return out
}

function capBlocker(id: string, count: number, max: number, noun: string): Blocker[] {
  if (count > max) {
    return [{ id, severity: 'error', scope: 'save', message: `Too many ${noun}`, detail: `${count}/${max} — remove ${count - max}` }]
  }
  if (count === max) {
    return [{ id, severity: 'warn', scope: 'save', message: `At the ${noun} limit`, detail: `${max}/${max} — delete one to add more` }]
  }
  return []
}

/**
 * Byte-budget blocker from a live pool report (task #14). Emitted only when a
 * shared bank pool is OVER its limit (base capacity + any movable boundary
 * headroom). A single `build`-scope error: it shows in the BlockerBar and gates
 * Test Level / Launch, but leaves Save ungated so work-in-progress still
 * persists to the overlay.
 */
/** Short status-bar label naming the shared bank pool(s) the level draws on,
 *  with each pool's current used/limit bytes (limit = base capacity + movable
 *  headroom). Null when there's no report yet. A split level (Bank15) lists both
 *  pools. e.g. `pool Bank4C 7713/8030B`. */
export function poolSummary(report: PoolBudgetReport | null): string | null {
  if (!report || report.pools.length === 0) return null
  const toks = report.pools.map(
    (p) => `${p.poolId} ${p.usedBytes}/${p.capacityBytes + p.headroomBytes}B`
  )
  return `${report.pools.length > 1 ? 'pools' : 'pool'} ${toks.join(', ')}`
}

export function budgetBlockers(report: PoolBudgetReport | null): Blocker[] {
  if (!report || !report.over) return []
  const over = report.pools.filter((p) => p.overBy > 0)
  if (over.length === 0) return []
  const worst = over.reduce((a, b) => (b.overBy > a.overBy ? b : a))
  const limit = worst.capacityBytes + worst.headroomBytes
  // Still gates the build, but when the level can be relocated the fix is a
  // one-click migrate (Banks panel) rather than only "shrink a neighbour".
  const detail = report.canRelocate
    ? `${worst.usedBytes}/${limit} B used — migrate this level to free space (Banks panel) to build, ` +
      'or shrink a level here. You can still save.'
    : `${worst.usedBytes}/${limit} B used — shrink a level in this pool to build (you can still save).`
  return [
    {
      id: 'byte-budget',
      severity: 'error',
      scope: 'build',
      message: `Over the ${worst.poolId} byte budget by ${worst.overBy} B`,
      detail
    }
  ]
}
