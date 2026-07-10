// Music set-table editor — the App-level DRAFT of the four tables the level
// header's music value resolves through (setting → block-set row / init song /
// item flag, plus the 13 rows' upload lists) on the shared overlay-document
// engine. Draft/dirty/save/discard, EditSession registration (global Save /
// Test Level flush it before the build) and unified undo/redo for free.
// `onSaved` marks the build dirty — an asm edit with no live canvas preview
// (the Sets tab previews audibly via the composer instead). Edited from the
// Audio panel's Sets tab. See snes-framework/scripts/music-sets.ts +
// research/plan-audio-panel.md §1.10.

import { useCallback } from 'react'
import type { MusicSetsModel } from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'

const eq = (a: MusicSetsModel, b: MusicSetsModel): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export interface MusicSetsEditorApi {
  /** The draft model (null until loaded). The Sets tab reads this. */
  model: MusicSetsModel | null
  dirty: boolean
  saving: boolean
  status: string
  error: string | null
  saveError: string | null
  save: () => Promise<boolean>
  discard: () => void
  /** Commit one setting-field change (one undo step). No-op if unchanged. */
  setSetting: (setting: number, patch: { blockSetRow?: number; initSongId?: number; itemDenial?: number }) => void
  /** Commit one song-set module-slot change: `blockId` null clears the
   *  slot ($FF). The set's ids stay packed in order (a cleared middle slot
   *  shifts later ones up — upload order is meaningful). */
  setSongSetModule: (row: number, slot: number, blockId: number | null) => void
}

/** Own the music-set-table draft at App level (survives the window closing)
 *  on the shared overlay-document engine. Reloads on project change. */
export function useMusicSetsEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): MusicSetsEditorApi {
  const doc = useOverlayDocument<MusicSetsModel>({
    key: 'music-sets',
    reloadKey: `music-sets:${projectId ?? ''}`,
    load: () => window.shinyEgg.editor.loadResource({ kind: 'music-sets' }),
    persist: (draft) => window.shinyEgg.editor.saveResource({ kind: 'music-sets' }, draft),
    equals: eq,
    clone: (v) => structuredClone(v),
    onSaved,
    history
  })

  const setSetting = useCallback(
    (setting: number, patch: { blockSetRow?: number; initSongId?: number; itemDenial?: number }) => {
      const cur = doc.read()
      const entry = cur?.settings[setting]
      if (!cur || !entry) return
      const next = {
        ...entry,
        ...(patch.blockSetRow !== undefined ? { blockSetRow: patch.blockSetRow } : {}),
        ...(patch.initSongId !== undefined && entry.initSongId !== null ? { initSongId: patch.initSongId } : {}),
        ...(patch.itemDenial !== undefined && entry.itemDenial !== null ? { itemDenial: patch.itemDenial } : {})
      }
      if (JSON.stringify(next) === JSON.stringify(entry)) return
      const settings = cur.settings.slice()
      settings[setting] = next
      doc.commit({ ...cur, settings })
    },
    [doc]
  )

  const setSongSetModule = useCallback(
    (row: number, slot: number, blockId: number | null) => {
      const cur = doc.read()
      if (!cur || row < 0 || row >= cur.rows.length || slot < 0 || slot > 2) return
      const ids = cur.rows[row].slice()
      if (blockId === null) ids.splice(slot, 1)
      else if (slot < ids.length) ids[slot] = blockId
      else ids.push(blockId)
      const packed = ids.slice(0, 3)
      if (JSON.stringify(packed) === JSON.stringify(cur.rows[row])) return
      const rows = cur.rows.slice()
      rows[row] = packed
      doc.commit({ ...cur, rows })
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
    setSetting,
    setSongSetModule
  }
}
