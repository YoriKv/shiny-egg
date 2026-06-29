// The backdrop-gradient color-edit document — an App-level overlay-document hook
// (sibling of usePaletteEditor) on the shared useOverlayDocument engine, so it
// gets draft/dirty/save/discard, EditSession registration (global Save / Test
// Level flush it before the build) AND unified undo/redo. Its `draft` (BASE ⊕
// edits, resolved per-level by the panel) feeds the canvas as `gradientOverride`
// for live preview. Reloads on project change.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GradientEdit } from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'
import { GRADIENT_STOPS, GRADIENT_STRIDE_BYTES, gradientOffset } from '../lib/gradient'

const EMPTY_EDITS: GradientEdit[] = []
const arrToMap = (a: GradientEdit[]): Map<number, number> => new Map(a.map((e) => [e.offset, e.value]))
const mapToArr = (m: Map<number, number>): GradientEdit[] =>
  [...m].map(([offset, value]) => ({ offset, value }))
function editsEqual(a: GradientEdit[], b: GradientEdit[]): boolean {
  if (a.length !== b.length) return false
  const m = arrToMap(a)
  for (const e of b) if (m.get(e.offset) !== e.value) return false
  return true
}

/** The gradient editor's API — the App-level gradient-stop edit DRAFT (a global
 *  set of flat-offset → BGR-15 edits across the 16 tables) on the shared
 *  overlay-document engine, plus stop mutators honouring the throttled-preview /
 *  one-undo-per-drag model and the per-table generate ops (clear / fill). */
export interface GradientEditorApi {
  /** Draft edits as the array fed (resolved per-level by the panel) to the render
   *  `gradientOverride`. */
  draft: GradientEdit[]
  /** Draft as a Map for O(1) stop lookups. */
  draftMap: Map<number, number>
  /** The 16×24 pristine base gradient colors (null until loaded); the panel
   *  overlays the draft on these to display + to compute minimal diffs. */
  baseColors: number[][] | null
  dirty: boolean
  saving: boolean
  saveError: string | null
  save: () => Promise<boolean>
  discard: () => void
  read: () => GradientEdit[]
  /** Set one stop WITHOUT an undo step — a picker drag's (throttled) frames. */
  preview: (offset: number, value: number) => void
  /** Commit one undo step: set the stop and record `before`→draft (drag release). */
  commitFrom: (before: GradientEdit[], offset: number, value: number) => void
  /** Replace ALL 24 stops of one gradient table with `colors` (one undo step) —
   *  the Clear / Fill generate ops. Diffs vs base so the draft stays minimal. */
  setTableColors: (gradientId: number, colors: readonly number[]) => void
  /** Revert one gradient table to base (drop its 24 stops) — one undo step,
   *  IMMEDIATE save (matches the palette Reset convention). */
  resetTable: (gradientId: number) => void
  /** Revert every gradient table to base — one undo step, immediate save. */
  resetAll: () => void
}

export function useGradientEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): GradientEditorApi {
  const doc = useOverlayDocument<GradientEdit[]>({
    key: 'gradient',
    reloadKey: `gradient:${projectId ?? ''}`,
    load: () => window.shinyEgg.editor.loadGradientEdits(),
    persist: (draft) => window.shinyEgg.editor.saveGradientEdits(draft),
    equals: editsEqual,
    clone: (v) => v.map((e) => ({ ...e })),
    onSaved,
    history
  })

  // The pristine base colors are constant per project — fetched once (not part
  // of the editable document), keyed on the project.
  const [baseColors, setBaseColors] = useState<number[][] | null>(null)
  useEffect(() => {
    let cancelled = false
    setBaseColors(null)
    if (projectId === null) return
    void window.shinyEgg.editor
      .gradientBaseColors()
      .then((b) => {
        if (!cancelled) setBaseColors(b)
      })
      .catch(() => {
        if (!cancelled) setBaseColors(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const draft = doc.draft ?? EMPTY_EDITS
  const draftMap = useMemo(() => arrToMap(draft), [draft])
  const read = useCallback((): GradientEdit[] => doc.read() ?? EMPTY_EDITS, [doc])

  const preview = useCallback(
    (offset: number, value: number) => {
      const m = arrToMap(doc.read() ?? EMPTY_EDITS)
      m.set(offset, value & 0xffff)
      doc.setDraft(mapToArr(m))
    },
    [doc]
  )

  const commitFrom = useCallback(
    (before: GradientEdit[], offset: number, value: number) => {
      const m = arrToMap(doc.read() ?? EMPTY_EDITS)
      m.set(offset, value & 0xffff)
      const after = mapToArr(m)
      doc.setDraft(after)
      if (!editsEqual(before, after)) doc.recordUndo(before, after)
    },
    [doc]
  )

  // Replace a whole table: for each stop, edit it iff it differs from base (so the
  // draft is the minimal diff, matching what a reload would reconstruct), dropping
  // any stale edits for that table. One undo step.
  const setTableColors = useCallback(
    (gradientId: number, colors: readonly number[]) => {
      const base = baseColors?.[gradientId]
      if (!base) return
      const before = doc.read() ?? EMPTY_EDITS
      const m = arrToMap(before)
      for (let stop = 0; stop < GRADIENT_STOPS; stop++) {
        const off = gradientOffset(gradientId, stop)
        const v = (colors[stop] ?? base[stop]!) & 0xffff
        if (v === base[stop]) m.delete(off)
        else m.set(off, v)
      }
      const after = mapToArr(m)
      doc.setDraft(after)
      if (!editsEqual(before, after)) doc.recordUndo(before, after)
    },
    [doc, baseColors]
  )

  const resetTable = useCallback(
    (gradientId: number) => {
      const before = doc.read() ?? EMPTY_EDITS
      const lo = gradientId * GRADIENT_STRIDE_BYTES
      const hi = lo + GRADIENT_STRIDE_BYTES
      const after = before.filter((e) => e.offset < lo || e.offset >= hi)
      if (after.length === before.length) return
      doc.setDraft(after)
      doc.recordUndo(before, after)
      void doc.save()
    },
    [doc]
  )

  const resetAll = useCallback(() => {
    const before = doc.read() ?? EMPTY_EDITS
    if (before.length === 0) return
    doc.setDraft([])
    doc.recordUndo(before, [])
    void doc.save()
  }, [doc])

  return {
    draft,
    draftMap,
    baseColors,
    dirty: doc.dirty,
    saving: doc.saving,
    saveError: doc.saveError,
    save: doc.save,
    discard: doc.discard,
    read,
    preview,
    commitFrom,
    setTableColors,
    resetTable,
    resetAll
  }
}
