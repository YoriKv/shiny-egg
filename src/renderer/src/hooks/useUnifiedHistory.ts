import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { IncomingExit, Selection } from '../types'
import type { LevelAction } from '../canvas/level-reducer'

// Stable empty reference so the Canvas prop doesn't churn (and trigger
// pointless redraws) when there are no incoming entries to draw.
const EMPTY_INCOMING: IncomingExit[] = []

// A cross-level warp-exit dest edit (the incoming-marker drag, §A8 #8.5). It
// auto-saves the SOURCE level (not the loaded one) but is still undoable: the
// inverse is just `setExitDest` with `before`. `screenIndex` is the source
// exit's screen.
interface CrossLevelEdit {
  sourceLevelRecordId: number
  screenIndex: number
  before: { x: number; y: number }
  after: { x: number; y: number }
}

// The entrance-type twin of CrossLevelEdit: a cross-level warp-exit entrance
// edit (the incoming-marker's Entrance dropdown). Auto-saves the SOURCE level
// (not the loaded one) and is undoable by re-applying `before` via
// `setExitEntrance`. `screenIndex` is the source exit's screen.
interface CrossLevelEntranceEdit {
  sourceLevelRecordId: number
  screenIndex: number
  before: number
  after: number
}

// One optimistic per-exit override, keyed `${sourceLevelRecordId}:${sourceScreenIndex}`.
// Only the field(s) a pending cross-level edit changed are present; the `incoming`
// memo overlays whichever are set. The x/y move the visible landing marker without
// a BFS re-walk; `entranceType` keeps a re-click's Properties dropdown correct (it
// isn't drawn on the canvas, so it only needs to survive in the marker data).
interface IncomingOverride {
  x?: number
  y?: number
  entranceType?: number
}

// One step in the unified, most-recent-first edit history. A `level` token
// defers to the per-level reducer's own undo snapshot (one token per real
// commit, kept in lockstep via the reducer's `commits` counter); a `cross`
// token carries the reversible cross-level edit; a `palette` token carries the
// full overlay edit sets before/after a master-palette colour change (undo
// re-saves `before`, redo re-saves `after`). Interleaving them here is what lets
// a single Ctrl+Z undo whichever edit was actually the most recent — loaded-
// level, cross-level, OR palette — across the session. Cleared on navigation
// (same per-session scope as the reducer's own stack); palette edits are global,
// so a nav drops only their undo *order*, not the saved overlay.
type UndoToken =
  | { kind: 'level' }
  | { kind: 'cross'; edit: CrossLevelEdit }
  | { kind: 'crossEntrance'; edit: CrossLevelEntranceEdit }
  // Generic overlay-document edit (strings, palette, …): a before/after snapshot
  // the registered applier re-applies on undo/redo. See
  // edit-session/useOverlayDocument.ts. `key` selects the applier.
  | { kind: 'doc'; key: string; before: unknown; after: unknown }

export interface UnifiedHistoryParams {
  /** The reducer's monotonic commit counter (levelState.commits). */
  commits: number
  selectedLevelRecordId: number | null
  rootLevelRecordId: number | null
  incomingByLevel: Map<number, IncomingExit[]>
  dispatchLevel: Dispatch<LevelAction>
  appendLog: (line: string) => void
  setNeedsBuild: (v: boolean) => void
  setSelection: Dispatch<SetStateAction<Selection[]>>
}

export interface UnifiedHistoryApi {
  /** Incoming markers for the loaded level, with optimistic cross-level-edit
   *  overrides applied (a dragged marker shows at its new landing cell without
   *  waiting on a BFS re-walk). */
  incoming: IncomingExit[]
  canUndo: boolean
  canRedo: boolean
  globalUndo: () => void
  globalRedo: () => void
  onMoveIncoming: (inc: IncomingExit, destX: number, destY: number) => Promise<void>
  /** Commit an entrance-type change on an incoming marker → rewrite the SOURCE
   *  exit's entranceType (auto-save), optimistic + undoable. The dropdown twin
   *  of `onMoveIncoming`. */
  onSetIncomingEntrance: (inc: IncomingExit, entranceType: number) => Promise<void>
  // ── Generic overlay-document channel (edit-session/useOverlayDocument) ──────
  /** Push one undoable before/after snapshot for the document `key`. */
  recordDocEdit: (key: string, before: unknown, after: unknown) => void
  /** Register the callback the history invokes (with `before`/`after`) when an
   *  undo/redo pops a `doc` token for `key`. */
  registerDocApplier: (key: string, apply: (snapshot: unknown) => void) => void
  unregisterDocApplier: (key: string) => void
}

/**
 * Unified, most-recent-first edit history that interleaves loaded-level reducer
 * commits with cross-level warp-exit edits (the incoming-marker drag, §A8 #8.5),
 * so one Ctrl+Z reverts the latest action regardless of which level it touched.
 * Also owns the optimistic incoming-marker patch layer that lets a dragged
 * marker move in the same render as the drag overlay clears (no BFS re-walk
 * flicker). The reducer still owns the loaded-level snapshots; this stack
 * records only the ORDER of edits.
 */
export function useUnifiedHistory({
  commits,
  selectedLevelRecordId,
  rootLevelRecordId,
  incomingByLevel,
  dispatchLevel,
  appendLog,
  setNeedsBuild,
  setSelection
}: UnifiedHistoryParams): UnifiedHistoryApi {
  // Optimistic per-exit overrides for incoming markers, keyed by
  // `${sourceLevelRecordId}:${sourceScreenIndex}`. A cross-level exit edit writes
  // disk AND patches the marker here, so a dragged marker moves instantly in the
  // same render as the drag overlay clears — no full BFS re-walk (which would
  // blank + repopulate every marker, the flicker). An entrance-type edit patches
  // the same map (the dropdown twin) so re-selecting the marker shows the new
  // value. Cleared when the root changes (the BFS then re-reads disk, which
  // already has the saved edit).
  const [incomingPatch, setIncomingPatch] = useState<Map<string, IncomingOverride>>(
    () => new Map()
  )
  const incomingPatchRef = useRef(incomingPatch)
  incomingPatchRef.current = incomingPatch
  // Drop optimistic patches when the root changes — the BFS re-walks from disk,
  // which already reflects any saved cross-level edits.
  useEffect(() => {
    setIncomingPatch(new Map())
  }, [rootLevelRecordId])
  const incoming = useMemo<IncomingExit[]>(() => {
    const base =
      selectedLevelRecordId !== null
        ? incomingByLevel.get(selectedLevelRecordId) ?? EMPTY_INCOMING
        : EMPTY_INCOMING
    if (incomingPatch.size === 0 || base.length === 0) return base
    let changed = false
    const out = base.map((inc) => {
      // Entries sourced from the LOADED level are live (App overlays its
      // in-memory exits), so a leftover optimistic patch for them is stale by
      // definition — the disk edit it mirrored was read back at level load.
      if (inc.sourceLevelRecordId === selectedLevelRecordId) return inc
      const p = incomingPatch.get(`${inc.sourceLevelRecordId}:${inc.sourceScreenIndex}`)
      if (!p) return inc
      const next = { ...inc }
      let did = false
      if (p.x !== undefined && p.x !== inc.destX) { next.destX = p.x; did = true }
      if (p.y !== undefined && p.y !== inc.destY) { next.destY = p.y; did = true }
      if (p.entranceType !== undefined && p.entranceType !== inc.entranceType) {
        next.entranceType = p.entranceType
        did = true
      }
      if (!did) return inc
      changed = true
      return next
    })
    return changed ? out : base
  }, [selectedLevelRecordId, incomingByLevel, incomingPatch])

  // Refs mirror the stacks for synchronous reads in the (user-triggered)
  // undo/redo handlers.
  const [undoStack, setUndoStack] = useState<UndoToken[]>([])
  const [redoStack, setRedoStack] = useState<UndoToken[]>([])
  const undoStackRef = useRef(undoStack)
  undoStackRef.current = undoStack
  const redoStackRef = useRef(redoStack)
  redoStackRef.current = redoStack
  const canUndo = undoStack.length > 0
  const canRedo = redoStack.length > 0
  const resetEditHistory = useCallback(() => {
    setUndoStack([])
    setRedoStack([])
  }, [])
  // Mirrors the reducer's commit counter so the observer effect pushes exactly
  // one `level` token per real commit (a no-op action never bumps it).
  const lastCommitsRef = useRef(commits)

  // Observe the reducer's commit counter: a real loaded-level commit pushes one
  // `level` token (and invalidates redo); a load/reset (counter → 0) clears the
  // unified stack so it can't drive a stale reducer-undo against a fresh level.
  useEffect(() => {
    const c = commits
    const prev = lastCommitsRef.current
    lastCommitsRef.current = c
    if (c > prev) {
      const added: UndoToken[] = Array.from({ length: c - prev }, () => ({ kind: 'level' }))
      setUndoStack((s) => [...s, ...added])
      setRedoStack([])
    } else if (c < prev) {
      resetEditHistory()
    }
  }, [commits, resetEditHistory])

  // A level switch resets the per-session history (matches the reducer, whose
  // own stack clears on load); same-id reloads are covered by the observer.
  useEffect(() => {
    resetEditHistory()
  }, [selectedLevelRecordId, resetEditHistory])

  // Write the source level's overlay for a cross-level edit in a given
  // direction (auto-save). Marks the build dirty + refreshes the markers on
  // success; logs and bails on failure. Returns whether it stuck.
  const applyCrossLevel = useCallback(
    async (edit: CrossLevelEdit, target: { x: number; y: number }): Promise<boolean> => {
      const key = `${edit.sourceLevelRecordId}:${edit.screenIndex}`
      const prev = incomingPatchRef.current.get(key)
      // Optimistic, synchronous marker move BEFORE the async write: it lands in
      // the same render as Canvas's drag-overlay clear (no snap-back) and avoids
      // a full BFS re-walk. Restored to its prior value if the write fails.
      setIncomingPatch((m) => new Map(m).set(key, { ...m.get(key), x: target.x, y: target.y }))
      const restore = (): void =>
        setIncomingPatch((m) => {
          const n = new Map(m)
          if (prev) n.set(key, prev)
          else n.delete(key)
          return n
        })
      try {
        const r = await window.shinyEgg.editor.setExitDest(
          edit.sourceLevelRecordId,
          edit.screenIndex,
          target.x,
          target.y
        )
        if (!r.ok) {
          appendLog(`Exit edit failed — ${r.error}`)
          restore()
          return false
        }
        setNeedsBuild(true)
        return true
      } catch (err) {
        appendLog(`Exit edit failed — ${(err as Error).message}`)
        restore()
        return false
      }
    },
    [appendLog, setNeedsBuild]
  )

  // The entrance-type twin of applyCrossLevel: write the source exit's
  // entranceType (auto-save) and optimistically patch the marker's value so a
  // re-select shows it without a BFS re-walk. Restores the prior override if the
  // write fails. Marks the build dirty on success.
  const applyCrossLevelEntrance = useCallback(
    async (edit: CrossLevelEntranceEdit, target: number): Promise<boolean> => {
      const key = `${edit.sourceLevelRecordId}:${edit.screenIndex}`
      const prev = incomingPatchRef.current.get(key)
      setIncomingPatch((m) => new Map(m).set(key, { ...m.get(key), entranceType: target }))
      const restore = (): void =>
        setIncomingPatch((m) => {
          const n = new Map(m)
          if (prev) n.set(key, prev)
          else n.delete(key)
          return n
        })
      try {
        const r = await window.shinyEgg.editor.setExitEntrance(
          edit.sourceLevelRecordId,
          edit.screenIndex,
          target
        )
        if (!r.ok) {
          appendLog(`Exit entrance edit failed — ${r.error}`)
          restore()
          return false
        }
        setNeedsBuild(true)
        return true
      } catch (err) {
        appendLog(`Exit entrance edit failed — ${(err as Error).message}`)
        restore()
        return false
      }
    },
    [appendLog, setNeedsBuild]
  )

  // Generic overlay-document channel. Documents (useOverlayDocument) register an
  // applier keyed by their doc key; recordDocEdit pushes a before/after snapshot,
  // and undo/redo of a `doc` token calls the applier with the opposite snapshot.
  const docAppliers = useRef(new Map<string, (snapshot: unknown) => void>())
  const registerDocApplier = useCallback((key: string, apply: (snapshot: unknown) => void): void => {
    docAppliers.current.set(key, apply)
  }, [])
  const unregisterDocApplier = useCallback((key: string): void => {
    docAppliers.current.delete(key)
  }, [])
  const recordDocEdit = useCallback((key: string, before: unknown, after: unknown): void => {
    setUndoStack((s) => [...s, { kind: 'doc', key, before, after }])
    setRedoStack([])
  }, [])

  // Unified undo/redo: pop the most-recent token and route it — `level` → the
  // reducer's own undo/redo (its snapshot stack stays in lockstep via the
  // commit counter), `cross` → replay the inverse exit edit. Used by Ctrl+Z/Y
  // AND the toolbar buttons.
  const globalUndo = useCallback(() => {
    const top = undoStackRef.current[undoStackRef.current.length - 1]
    if (!top) return
    if (top.kind === 'level') dispatchLevel({ type: 'undo' })
    else if (top.kind === 'cross') void applyCrossLevel(top.edit, top.edit.before)
    else if (top.kind === 'crossEntrance') void applyCrossLevelEntrance(top.edit, top.edit.before)
    else docAppliers.current.get(top.key)?.(top.before)
    setUndoStack((s) => s.slice(0, -1))
    setRedoStack((s) => [...s, top])
  }, [applyCrossLevel, applyCrossLevelEntrance, dispatchLevel])
  const globalRedo = useCallback(() => {
    const top = redoStackRef.current[redoStackRef.current.length - 1]
    if (!top) return
    if (top.kind === 'level') dispatchLevel({ type: 'redo' })
    else if (top.kind === 'cross') void applyCrossLevel(top.edit, top.edit.after)
    else if (top.kind === 'crossEntrance') void applyCrossLevelEntrance(top.edit, top.edit.after)
    else docAppliers.current.get(top.key)?.(top.after)
    setRedoStack((s) => s.slice(0, -1))
    setUndoStack((s) => [...s, top])
  }, [applyCrossLevel, applyCrossLevelEntrance, dispatchLevel])

  // Incoming-marker drag commit (from Canvas): edit the SOURCE exit's landing
  // cell, auto-save it, and record a reversible cross-level undo entry. Keep the
  // marker selected at its new spot (the BFS refresh updates the array; the
  // selection snapshot would otherwise show the stale "Lands at").
  const onMoveIncoming = useCallback(
    async (inc: IncomingExit, destX: number, destY: number) => {
      if (inc.destX === destX && inc.destY === destY) return
      const edit: CrossLevelEdit = {
        sourceLevelRecordId: inc.sourceLevelRecordId,
        screenIndex: inc.sourceScreenIndex,
        before: { x: inc.destX, y: inc.destY },
        after: { x: destX, y: destY }
      }
      if (!(await applyCrossLevel(edit, edit.after))) return
      setUndoStack((s) => [...s, { kind: 'cross', edit }])
      setRedoStack([])
      setSelection([{ kind: 'incoming', incoming: { ...inc, destX, destY } }])
    },
    [applyCrossLevel, setSelection]
  )

  // Incoming-marker entrance commit (from the Properties dropdown): edit the
  // SOURCE exit's entranceType, auto-save it, and record a reversible cross-level
  // undo entry. Keep the marker selected with its new value (the selection holds
  // a snapshot, so the dropdown would otherwise show the stale entrance).
  const onSetIncomingEntrance = useCallback(
    async (inc: IncomingExit, entranceType: number) => {
      if (inc.entranceType === entranceType) return
      const edit: CrossLevelEntranceEdit = {
        sourceLevelRecordId: inc.sourceLevelRecordId,
        screenIndex: inc.sourceScreenIndex,
        before: inc.entranceType,
        after: entranceType
      }
      if (!(await applyCrossLevelEntrance(edit, edit.after))) return
      setUndoStack((s) => [...s, { kind: 'crossEntrance', edit }])
      setRedoStack([])
      setSelection([{ kind: 'incoming', incoming: { ...inc, entranceType } }])
    },
    [applyCrossLevelEntrance, setSelection]
  )

  return {
    incoming,
    canUndo,
    canRedo,
    globalUndo,
    globalRedo,
    onMoveIncoming,
    onSetIncomingEntrance,
    recordDocEdit,
    registerDocApplier,
    unregisterDocApplier
  }
}
