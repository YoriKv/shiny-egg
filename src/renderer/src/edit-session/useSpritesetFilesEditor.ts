// App-owned draft for the cart's six-file sprite tileset table. The Graphics
// panel previews the draft directly; saving writes the Bank00 overlay.

import { useCallback } from 'react'
import type { SpritesetFilesModel } from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'

const eq = (a: SpritesetFilesModel, b: SpritesetFilesModel): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export interface SpritesetFilesEditorApi {
  model: SpritesetFilesModel | null
  dirty: boolean
  saving: boolean
  status: string
  error: string | null
  saveError: string | null
  save: () => Promise<boolean>
  discard: () => void
  setFileId: (row: number, slot: number, fileId: number) => void
}

export function useSpritesetFilesEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): SpritesetFilesEditorApi {
  const doc = useOverlayDocument<SpritesetFilesModel>({
    key: 'spriteset-files',
    reloadKey: `spriteset-files:${projectId ?? ''}`,
    load: () => window.shinyEgg.editor.loadResource({ kind: 'spriteset-files' }),
    persist: (draft) => window.shinyEgg.editor.saveResource({ kind: 'spriteset-files' }, draft),
    equals: eq,
    clone: (v) => structuredClone(v),
    onSaved,
    history
  })

  const setFileId = useCallback((row: number, slot: number, fileId: number) => {
    const current = doc.read()
    if (
      !current ||
      !Number.isInteger(row) || row < 0 || row >= current.rows.length ||
      !Number.isInteger(slot) || slot < 0 || slot >= 6 ||
      !Number.isInteger(fileId) || fileId < 0 || fileId > 0xff
    ) return
    const currentRow = current.rows[row]
    if (!currentRow || currentRow[slot] === fileId) return
    const rows = current.rows.slice()
    const nextRow = currentRow.slice()
    nextRow[slot] = fileId
    rows[row] = nextRow
    doc.commit({ ...current, rows })
  }, [doc])

  return {
    model: doc.draft,
    dirty: doc.dirty,
    saving: doc.saving,
    status: doc.status,
    error: doc.error,
    saveError: doc.saveError,
    save: doc.save,
    discard: doc.discard,
    setFileId
  }
}
