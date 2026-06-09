// The palette colour-edit document — an App-level overlay-document hook on the
// shared useOverlayDocument engine (the sibling of useWorldMapEditor; it lived
// in PalettePanel.tsx until the panel body and the App-level state were split).

import { useCallback, useMemo } from 'react'
import type { PaletteEdit } from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'

const EMPTY_EDITS: PaletteEdit[] = []
const arrToMap = (a: PaletteEdit[]): Map<number, number> => new Map(a.map((e) => [e.offset, e.value]))
const mapToArr = (m: Map<number, number>): PaletteEdit[] =>
  [...m].map(([offset, value]) => ({ offset, value }))
function editsEqual(a: PaletteEdit[], b: PaletteEdit[]): boolean {
  if (a.length !== b.length) return false
  const m = arrToMap(a)
  for (const e of b) if (m.get(e.offset) !== e.value) return false
  return true
}

/** The palette editor's API — the App-level colour-edit DRAFT (a global set of
 *  blob-offset → BGR-15 edits) on the shared overlay-document engine, plus colour
 *  mutators that honour the throttled-preview / one-undo-per-drag model. */
export interface PaletteEditorApi {
  /** Draft edits as the array fed to the render `paletteOverride` (live preview). */
  draft: PaletteEdit[]
  /** Draft as a Map for O(1) swatch lookups. */
  draftMap: Map<number, number>
  dirty: boolean
  saving: boolean
  saveError: string | null
  save: () => Promise<boolean>
  /** Revert the draft to the last-saved baseline (the close-prompt "Discard"). */
  discard: () => void
  /** Read the draft synchronously (the drag-start snapshot). */
  read: () => PaletteEdit[]
  /** Set one colour WITHOUT an undo step — a drag's (throttled) preview frames. */
  preview: (offset: number, value: number) => void
  /** Commit one undo step: set the colour and record `before`→draft (drag release). */
  commitFrom: (before: PaletteEdit[], offset: number, value: number) => void
  /** Revert one colour to base (drop its offset) — one undo step. */
  resetColor: (offset: number) => void
  /** Revert every colour to base — one undo step. */
  resetAll: () => void
}

/**
 * Own the palette colour-edit draft at App level (survives the window closing),
 * on the shared overlay-document engine — so it gets draft/dirty/save/discard,
 * EditSession registration (global Save / Test Level flush it BEFORE the build,
 * fixing the build-tree race), AND unified undo/redo. `onSaved` marks the build
 * dirty. Reloads the baseline on project change.
 */
export function usePaletteEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): PaletteEditorApi {
  const doc = useOverlayDocument<PaletteEdit[]>({
    key: 'palette',
    reloadKey: `palette:${projectId ?? ''}`,
    load: () => window.shinyEgg.editor.loadPaletteEdits(),
    persist: (draft) => window.shinyEgg.editor.savePaletteEdits(draft),
    equals: editsEqual,
    clone: (v) => v.map((e) => ({ ...e })),
    onSaved,
    history
  })

  const draft = doc.draft ?? EMPTY_EDITS
  const draftMap = useMemo(() => arrToMap(draft), [draft])
  const read = useCallback((): PaletteEdit[] => doc.read() ?? EMPTY_EDITS, [doc])

  const preview = useCallback(
    (offset: number, value: number) => {
      const m = arrToMap(doc.read() ?? EMPTY_EDITS)
      m.set(offset, value & 0xffff)
      doc.setDraft(mapToArr(m))
    },
    [doc]
  )

  const commitFrom = useCallback(
    (before: PaletteEdit[], offset: number, value: number) => {
      const m = arrToMap(doc.read() ?? EMPTY_EDITS)
      m.set(offset, value & 0xffff)
      const after = mapToArr(m)
      doc.setDraft(after)
      if (!editsEqual(before, after)) doc.recordUndo(before, after)
    },
    [doc]
  )

  // Resets are IMMEDIATE — they persist (and clear dirty) on click, matching the
  // app's "Reset = apply now" convention (the level Reset deletes the overlay
  // immediately). A deferred draft reset left the overlay/ROM carrying the old
  // colours until a later Save ("changes persist after reset"). Still one undo
  // step. (Resetting one colour while OTHER colours are unsaved persists those
  // too — a reset is a deliberate "commit this state, minus X".)
  const resetColor = useCallback(
    (offset: number) => {
      const before = doc.read() ?? EMPTY_EDITS
      const m = arrToMap(before)
      if (!m.has(offset)) return
      m.delete(offset)
      const after = mapToArr(m)
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
    dirty: doc.dirty,
    saving: doc.saving,
    saveError: doc.saveError,
    save: doc.save,
    discard: doc.discard,
    read,
    preview,
    commitFrom,
    resetColor,
    resetAll
  }
}
