// Shared editing engine for the editor's "overlay documents" — a tool whose
// edits are an in-memory DRAFT over a last-saved BASELINE, persisted to the
// project overlay on demand (Save / global Save), revertible (discard), and
// undoable through the unified history. Strings + palette (and future asm-region
// tools) are all this exact shape; the level editor is the one exception (it's
// reducer-based with structural sharing for the render override, so it keeps its
// own machinery — see canvas/level-reducer.ts + useUnifiedHistory's `level`
// token).
//
// What it gives a tool:
//   • baseline/draft state + a `dirty` flag (draft ≠ baseline),
//   • `setDraft` (live preview — no undo step) and `commit` (one undo step),
//   • `save`/`discard` wired to the project overlay,
//   • EditSession registration (so global Save / the unsaved-changes prompt see
//     it) and unified-history registration (so Ctrl+Z drives it via a `doc`
//     token — see useUnifiedHistory).
//
// See research/notes-edit-architecture.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditDocument } from './EditSession'

/** The slice of the unified history a document needs: record an undoable
 *  before/after snapshot, and register/unregister the applier the history calls
 *  on undo/redo. Supplied by useUnifiedHistory. */
export interface DocHistory {
  recordDocEdit: (key: string, before: unknown, after: unknown) => void
  registerDocApplier: (key: string, apply: (snapshot: unknown) => void) => void
  unregisterDocApplier: (key: string) => void
}

export interface OverlayDocumentConfig<T> {
  /** Stable key — the EditSession + unified-history identifier for this doc. */
  key: string
  /** Re-load the baseline when this string changes (e.g. `${id}:${projectId}`). */
  reloadKey: string
  /** Load the baseline draft from the overlay/base. */
  load: () => Promise<T>
  /** Persist the draft to the overlay. */
  persist: (draft: T) => Promise<{ ok: boolean; error?: string }>
  /** Dirty check — true when the two drafts differ. */
  equals: (a: T, b: T) => boolean
  /** Deep copy (baseline ↔ draft must not share mutable structure). */
  clone: (v: T) => T
  /** Called after a successful save — marks the build dirty (and, for tools with
   *  live preview, bumps the preview). */
  onSaved: () => void
  history: DocHistory
}

export interface OverlayDocument<T> {
  draft: T | null
  status: string
  error: string | null
  saveError: string | null
  saving: boolean
  dirty: boolean
  /** Replace the draft WITHOUT recording an undo step (live preview / a drag's
   *  intermediate frames). Pair with `recordUndo` on release for one-step-per-drag. */
  setDraft: (next: T) => void
  /** Replace the draft AND record one undo step (before = current draft). The
   *  discrete-edit path (e.g. a string line blur). */
  commit: (next: T) => void
  /** Record a single undo step with an explicit before/after — for a drag whose
   *  frames went through `setDraft` (before = drag-start snapshot). */
  recordUndo: (before: T, after: T) => void
  /** Latest draft synchronously (read a before-snapshot mid-render-cycle). */
  read: () => T | null
  save: () => Promise<boolean>
  discard: () => void
}

/**
 * Own one overlay document's editing state. Call at App level (not inside a
 * floating window) so the draft + registrations survive the window closing and
 * tab switches.
 */
export function useOverlayDocument<T>(cfg: OverlayDocumentConfig<T>): OverlayDocument<T> {
  const [baseline, setBaseline] = useState<T | null>(null)
  const [draft, setDraftState] = useState<T | null>(null)
  // Synchronous mirror of `draft` so `commit`/`save` read the latest value even
  // when a commit-on-blur fires in the same click as Save (state hasn't
  // re-rendered yet).
  const draftRef = useRef<T | null>(null)
  const [status, setStatus] = useState('Loading…')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // cfg is a fresh literal each render; mirror it so the stable callbacks below
  // always reach the latest load/persist/equals/clone/onSaved/history.
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg

  const setDraft = useCallback((next: T) => {
    draftRef.current = next
    setDraftState(next)
  }, [])
  const read = useCallback(() => draftRef.current, [])

  // Load (and re-load on reloadKey change).
  useEffect(() => {
    let cancelled = false
    setStatus('Loading…')
    setError(null)
    setSaveError(null)
    void (async () => {
      try {
        const m = await cfgRef.current.load()
        if (cancelled) return
        setBaseline(m)
        const fresh = cfgRef.current.clone(m)
        draftRef.current = fresh
        setDraftState(fresh)
        setStatus('')
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cfg.reloadKey])

  // Register the applier so the unified history can drive this doc on undo/redo.
  useEffect(() => {
    const { history } = cfgRef.current
    history.registerDocApplier(cfg.key, (snap) => setDraft(snap as T))
    return () => history.unregisterDocApplier(cfg.key)
  }, [cfg.key, setDraft])

  const dirty = useMemo(() => {
    if (draft == null || baseline == null) return false
    return !cfgRef.current.equals(draft, baseline)
  }, [draft, baseline])

  const recordUndo = useCallback(
    (before: T, after: T) => cfgRef.current.history.recordDocEdit(cfg.key, before, after),
    [cfg.key]
  )

  const commit = useCallback(
    (next: T) => {
      const before = draftRef.current
      setDraft(next)
      if (before != null) recordUndo(before, next)
    },
    [setDraft, recordUndo]
  )

  const save = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current
    if (current == null) return false
    setSaving(true)
    setSaveError(null)
    try {
      const r = await cfgRef.current.persist(current)
      if (!r.ok) {
        setSaveError(r.error ?? 'Save failed.')
        return false
      }
      setBaseline(cfgRef.current.clone(current))
      cfgRef.current.onSaved()
      return true
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e))
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  const discard = useCallback(() => {
    const reverted = baseline != null ? cfgRef.current.clone(baseline) : null
    draftRef.current = reverted
    setDraftState(reverted)
    setSaveError(null)
  }, [baseline])

  useEditDocument(cfg.key, { dirty, save, discard })

  return {
    draft,
    status,
    error,
    saveError,
    saving,
    dirty,
    setDraft,
    commit,
    recordUndo,
    read,
    save,
    discard
  }
}
