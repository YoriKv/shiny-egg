// App-owned draft for the autoscroll tables (Bank03 `;@editable:autoscroll`).
// Edited from the Autoscroll window and directly on the level canvas (drag a
// checkpoint, context-menu insert/delete). Each edit is one undo step through
// the shared doc history; saving writes the Bank03 overlay (build dirty). Pure
// edit ops live in lib/autoscroll-edit.ts.
//
// `ui` (the active track / checkpoint) is session state shared by the window
// and the canvas overlay; it is not part of the document.

import { useCallback, useState } from 'react'
import type { AutoscrollModel } from '../../../preload/api'
import { validateAutoscroll } from 'snes-framework/autoscroll-model'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'
import { removeCheckpoint, type CheckpointRef } from '../lib/autoscroll-edit'
import { persistedState } from '../lib/persisted-state'

const eq = (a: AutoscrollModel, b: AutoscrollModel): boolean =>
  JSON.stringify([a.sequences, a.tracks]) === JSON.stringify([b.sequences, b.tracks])

/** When the canvas draws autoscroll paths: for the selected autoscroll sprite
 *  (and the Autoscroll window's track while it is open), for every autoscroll
 *  sprite in the room, or never. Always also gated by the Sprite-editing layer. */
export type AutoscrollShowMode = 'selected' | 'all' | 'off'

const SHOW_STORE = persistedState<{ show: AutoscrollShowMode }>('shinyEgg.autoscrollPaths.v1', { show: 'selected' })

export interface AutoscrollUiState {
  /** Track (0-11 = sprite $1CA-$1D5) the window shows and the canvas draws. */
  track: number
  /** Highlighted checkpoint (camera box drawn on the canvas), or null. */
  checkpoint: CheckpointRef | null
  show: AutoscrollShowMode
}

export interface AutoscrollEditorApi {
  model: AutoscrollModel | null
  dirty: boolean
  saving: boolean
  status: string
  error: string | null
  saveError: string | null
  /** Hard validation error of the current draft (blocks save), or null. */
  invalid: string | null
  save: () => Promise<boolean>
  discard: () => void
  /** Commit a new model (one undo step). Ignores null (a refused op). */
  apply: (next: AutoscrollModel | null) => void
  deleteCheckpoint: (ref: CheckpointRef) => string | null
  ui: AutoscrollUiState
  setUi: (patch: Partial<AutoscrollUiState>) => void
}

export function useAutoscrollEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): AutoscrollEditorApi {
  const doc = useOverlayDocument<AutoscrollModel>({
    key: 'autoscroll',
    reloadKey: `autoscroll:${projectId ?? ''}`,
    load: () => window.shinyEgg.editor.loadResource({ kind: 'autoscroll' }),
    persist: async (draft) => {
      const err = validateAutoscroll(draft)
      if (err) return { ok: false, error: err }
      return window.shinyEgg.editor.saveResource({ kind: 'autoscroll' }, draft)
    },
    equals: eq,
    clone: (v) => structuredClone(v),
    onSaved,
    history
  })
  const [ui, setUiState] = useState<AutoscrollUiState>(() => ({ track: 1, checkpoint: null, show: SHOW_STORE.load().show }))
  const setUi = useCallback((patch: Partial<AutoscrollUiState>) => {
    if (patch.show) SHOW_STORE.save({ show: patch.show })
    setUiState((u) => ({ ...u, ...patch }))
  }, [])

  const apply = useCallback(
    (next: AutoscrollModel | null) => {
      if (!next) return
      const current = doc.read()
      if (current && eq(current, next)) return
      doc.commit(next)
    },
    [doc]
  )

  const deleteCheckpoint = (ref: CheckpointRef): string | null => {
    const current = doc.read()
    if (!current) return 'Autoscroll tables are unavailable.'
    const result = removeCheckpoint(current, ref)
    if ('reason' in result) return result.reason
    doc.commit(result.model)
    setUi({ checkpoint: null })
    return null
  }

  return {
    model: doc.draft,
    dirty: doc.dirty,
    saving: doc.saving,
    status: doc.status,
    error: doc.error,
    saveError: doc.saveError,
    invalid: doc.draft ? validateAutoscroll(doc.draft) : null,
    save: doc.save,
    discard: doc.discard,
    apply,
    deleteCheckpoint,
    ui,
    setUi
  }
}
