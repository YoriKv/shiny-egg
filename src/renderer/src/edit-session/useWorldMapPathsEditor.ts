// World-map Yoshi-path editor — the App-level DRAFT of the Bank17 path tables
// (per-world Yoshi dot positions + per-level walk checkpoints) on the shared
// overlay-document engine. Like the entrance-table editor it gets draft/dirty/
// save/discard, EditSession registration (global Save / Test Level flush it
// before a build) and unified undo/redo for free. `onSaved` marks the build
// dirty — path edits don't render live in-game; the World Map panel's preview
// markers are drawn renderer-side from this draft (drag a dot, no IPC). See
// WorldMapPathsSection.tsx + snes-framework/scripts/world-map-paths.ts.

import { useCallback } from 'react'
import type { WorldMapPathsModel } from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'

/** One draggable point in the path model — a per-world Yoshi dot, or one of a
 *  level's walk checkpoints. `world`/`dot`/`level` are 0-based (dot = level
 *  position, the cart's world*8+dot space). */
export type PathPointRef =
  | { kind: 'dot'; world: number; dot: number }
  | { kind: 'ckpt'; world: number; level: number; k: number }

export function pathPointAt(
  m: WorldMapPathsModel,
  ref: PathPointRef
): { x: number; y: number } | null {
  const p = ref.kind === 'dot' ? m.dots[ref.world]?.[ref.dot] : m.checkpoints[ref.world]?.[ref.level]?.[ref.k]
  return p ? { x: p.x, y: p.y } : null
}

/** The model with one point replaced — also the section's DISPLAY overlay for an
 *  in-flight drag (per-frame preview stays local to WorldMapPathsSection; the
 *  document is only touched on release — see commitPointFrom). */
export function withPoint(m: WorldMapPathsModel, ref: PathPointRef, x: number, y: number): WorldMapPathsModel {
  if (ref.kind === 'dot') {
    return {
      ...m,
      dots: m.dots.map((w, wi) =>
        wi === ref.world ? w.map((p, di) => (di === ref.dot ? { x, y } : p)) : w
      )
    }
  }
  return {
    ...m,
    checkpoints: m.checkpoints.map((w, wi) =>
      wi === ref.world
        ? w.map((l, li) => (li === ref.level ? l.map((p, ki) => (ki === ref.k ? { x, y } : p)) : l))
        : w
    )
  }
}

/** A level's ACTIVE checkpoints — the leading run of non-(0,0) slots (the
 *  engine stops at the first $0000 word, so anything past a zero is dead). */
export function activeCheckpoints(
  m: WorldMapPathsModel,
  world: number,
  level: number
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const p of m.checkpoints[world]?.[level] ?? []) {
    if (p.x === 0 && p.y === 0) break
    out.push(p)
  }
  return out
}

const eq = (a: WorldMapPathsModel, b: WorldMapPathsModel): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export const clampPathX = (x: number): number => Math.max(0, Math.min(511, Math.round(x)))
export const clampPathY = (y: number): number => Math.max(0, Math.min(255, Math.round(y)))

export interface WorldMapPathsEditorApi {
  /** The draft model (null until loaded). The panel's path section reads this. */
  model: WorldMapPathsModel | null
  dirty: boolean
  saving: boolean
  status: string
  error: string | null
  saveError: string | null
  save: () => Promise<boolean>
  discard: () => void
  /** Read the draft synchronously (a drag-start snapshot). */
  read: () => WorldMapPathsModel | null
  /** Commit a drag with an explicit before-snapshot (release) — one undo step
   *  covering the whole gesture. A drag's per-frame preview never touches the
   *  document (it would re-render the whole App per pointermove); it stays local
   *  to WorldMapPathsSection via `withPoint`. */
  commitPointFrom: (before: WorldMapPathsModel, ref: PathPointRef, x: number, y: number) => void
  /** Commit one discrete move (arrow-key nudge / coordinate field). */
  commitPoint: (ref: PathPointRef, x: number, y: number) => void
  /** Activate the next unused checkpoint slot of (world, level), seeded midway
   *  along the outgoing segment. Returns its ref, or null when all 4 are used. */
  addCheckpoint: (world: number, level: number) => PathPointRef | null
  /** Deactivate checkpoint `k` of (world, level), shifting later active ones up
   *  so the active run stays a prefix (the engine stops at the first zero). */
  removeCheckpoint: (world: number, level: number, k: number) => void
}

/**
 * Own the Yoshi-path draft at App level (survives the window closing) on the
 * shared overlay-document engine. Reloads the baseline on project change.
 */
export function useWorldMapPathsEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): WorldMapPathsEditorApi {
  const doc = useOverlayDocument<WorldMapPathsModel>({
    key: 'world-map-paths',
    reloadKey: `world-map-paths:${projectId ?? ''}`,
    load: () => window.shinyEgg.editor.loadResource({ kind: 'world-map-paths' }),
    persist: (draft) => window.shinyEgg.editor.saveResource({ kind: 'world-map-paths' }, draft),
    equals: eq,
    clone: (v) => structuredClone(v),
    onSaved,
    history
  })

  const commitPointFrom = useCallback(
    (before: WorldMapPathsModel, ref: PathPointRef, x: number, y: number) => {
      const cur = doc.read()
      if (!cur) return
      const after = withPoint(cur, ref, clampPathX(x), clampPathY(y))
      doc.setDraft(after)
      if (!eq(before, after)) doc.recordUndo(before, after)
    },
    [doc]
  )

  const commitPoint = useCallback(
    (ref: PathPointRef, x: number, y: number) => {
      const cur = doc.read()
      if (cur) doc.commit(withPoint(cur, ref, clampPathX(x), clampPathY(y)))
    },
    [doc]
  )

  const addCheckpoint = useCallback(
    (world: number, level: number): PathPointRef | null => {
      const cur = doc.read()
      if (!cur) return null
      const active = activeCheckpoints(cur, world, level)
      const slots = cur.checkpoints[world]?.[level]?.length ?? 0
      if (active.length >= slots) return null
      // Seed midway along the outgoing segment: from the current last path point
      // (last active checkpoint, else the level's dot) toward the next dot.
      const from = active[active.length - 1] ?? cur.dots[world]?.[level] ?? { x: 64, y: 128 }
      const next = cur.dots[world]?.[level + 1]
      const to = next ?? { x: from.x + 48, y: from.y }
      let x = clampPathX((from.x + to.x) / 2)
      let y = clampPathY((from.y + to.y) / 2)
      if (x === 0 && y === 0) x = 1 // (0,0) means "unused" — never seed it
      const ref: PathPointRef = { kind: 'ckpt', world, level, k: active.length }
      doc.commit(withPoint(cur, ref, x, y))
      return ref
    },
    [doc]
  )

  const removeCheckpoint = useCallback(
    (world: number, level: number, k: number) => {
      const cur = doc.read()
      if (!cur) return
      const row = cur.checkpoints[world]?.[level]
      if (!row || k < 0 || k >= row.length) return
      const shifted = [...row.slice(0, k), ...row.slice(k + 1), { x: 0, y: 0 }]
      doc.commit({
        ...cur,
        checkpoints: cur.checkpoints.map((w, wi) =>
          wi === world ? w.map((l, li) => (li === level ? shifted : l)) : w
        )
      })
    },
    [doc]
  )

  return {
    model: doc.draft,
    dirty: doc.dirty,
    saving: doc.saving,
    status: doc.status,
    error: doc.error,
    saveError: doc.saveError,
    save: doc.save,
    discard: doc.discard,
    read: doc.read,
    commitPointFrom,
    commitPoint,
    addCheckpoint,
    removeCheckpoint
  }
}
