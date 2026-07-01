// Per-level Yoshi-color editor — the App-level DRAFT of the DATA_yoshi_level_colors
// table (one Yoshi color id per translevel slot) on the shared overlay-document
// engine. Like the world-map + palette editors it gets draft/dirty/save/discard,
// EditSession registration (so global Save / Test Level flush it before the
// build) and unified undo/redo for free. `onSaved` marks the build dirty — the
// table is an asm edit that doesn't render live (no overworld renderer). Edited
// from the World Map panel. See scripts/yoshi-colors.ts + WorldMapPanel.tsx.

import { useCallback } from 'react'
import type { YoshiColorsModel } from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'

const eq = (a: YoshiColorsModel, b: YoshiColorsModel): boolean =>
  a.colors.length === b.colors.length && a.colors.every((c, i) => c === b.colors[i])

export interface YoshiColorsEditorApi {
  /** The draft model (null until loaded). The panel reads this. */
  model: YoshiColorsModel | null
  dirty: boolean
  saving: boolean
  status: string
  error: string | null
  saveError: string | null
  save: () => Promise<boolean>
  /** Revert the draft to the last-saved baseline (the close-prompt "Discard"). */
  discard: () => void
  /** The Yoshi color id (0..7) for a translevel slot, or null if unloaded / out of range. */
  colorFor: (translevelId: number) => number | null
  /** Commit one color change for a translevel slot (one undo step). No-op if unchanged. */
  setColor: (translevelId: number, colorId: number) => void
}

/**
 * Own the Yoshi-color draft at App level (survives the window closing) on the
 * shared overlay-document engine. Reloads the baseline on project change.
 */
export function useYoshiColorsEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): YoshiColorsEditorApi {
  const doc = useOverlayDocument<YoshiColorsModel>({
    key: 'yoshi-colors',
    reloadKey: `yoshi-colors:${projectId ?? ''}`,
    load: () => window.shinyEgg.editor.loadResource({ kind: 'yoshi-colors' }),
    persist: (draft) => window.shinyEgg.editor.saveResource({ kind: 'yoshi-colors' }, draft),
    equals: eq,
    clone: (v) => structuredClone(v),
    onSaved,
    history
  })

  const colorFor = useCallback(
    (translevelId: number): number | null => {
      const m = doc.draft
      if (!m || translevelId < 0 || translevelId >= m.colors.length) return null
      return m.colors[translevelId] ?? null
    },
    [doc.draft]
  )

  const setColor = useCallback(
    (translevelId: number, colorId: number) => {
      const cur = doc.read()
      if (!cur || translevelId < 0 || translevelId >= cur.colors.length) return
      if (cur.colors[translevelId] === colorId) return
      const colors = cur.colors.slice()
      colors[translevelId] = colorId
      doc.commit({ ...cur, colors })
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
    colorFor,
    setColor
  }
}
