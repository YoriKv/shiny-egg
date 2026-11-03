// App-owned draft for the cart's six-file sprite tileset table. Saving writes
// the Bank00 overlay; while unsaved, the draft is previewed on every render
// (level canvas included) through useTablePreview.

import { useCallback } from 'react'
import type { SpritesetFilesModel } from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'
import { useTablePreview } from './useTablePreview'

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
  setRow: (row: number, files: number[]) => void
  setFileId: (row: number, slot: number, fileId: number) => void
}

export function useSpritesetFilesEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory,
  /** Re-render after the live draft preview changed the render ROM. */
  onPreviewApplied: () => void
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
  useTablePreview('spriteset-files', doc.draft, doc.dirty, onPreviewApplied)

  const setRow = useCallback((row: number, files: number[]) => {
    const current = doc.read()
    if (
      !current ||
      !Number.isInteger(row) || row < 0 || row >= current.rows.length ||
      files.length !== 6 ||
      files.some((fileId) => !Number.isInteger(fileId) || fileId < 0 || fileId > 0xff)
    ) return
    const currentRow = current.rows[row]
    if (!currentRow || JSON.stringify(currentRow) === JSON.stringify(files)) return
    const rows = current.rows.slice()
    rows[row] = files.slice()
    doc.commit({ ...current, rows })
  }, [doc])

  const setFileId = useCallback((row: number, slot: number, fileId: number) => {
    const current = doc.read()
    const currentRow = current?.rows[row]
    if (
      !currentRow ||
      !Number.isInteger(slot) || slot < 0 || slot >= 6 ||
      !Number.isInteger(fileId) || fileId < 0 || fileId > 0xff ||
      currentRow[slot] === fileId
    ) return
    const nextRow = currentRow.slice()
    nextRow[slot] = fileId
    setRow(row, nextRow)
  }, [doc, setRow])

  return {
    model: doc.draft,
    dirty: doc.dirty,
    saving: doc.saving,
    status: doc.status,
    error: doc.error,
    saveError: doc.saveError,
    save: doc.save,
    discard: doc.discard,
    setRow,
    setFileId
  }
}
