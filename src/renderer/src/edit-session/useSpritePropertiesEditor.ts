// App-owned draft for the per-ID normal-sprite property tables (SuperFX Bank0A
// `;@editable:sprite-*` regions). These are GLOBAL spawn defaults — one word per
// sprite ID, shared by every placement of that sprite in every level. Saving
// writes the Bank0A overlay; the three render-affecting tables (palette/flip
// attr, gfx file, OAM count) preview live on the canvas via useTablePreview.

import { useCallback, useState } from 'react'
import type { SpritePropertiesModel, SpritePropertyTableKey } from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'
import { useTablePreview } from './useTablePreview'

const eq = (a: SpritePropertiesModel, b: SpritePropertiesModel): boolean =>
  JSON.stringify(a.tables) === JSON.stringify(b.tables)

export interface SpritePropertiesEditorApi {
  model: SpritePropertiesModel | null
  dirty: boolean
  saving: boolean
  status: string
  error: string | null
  saveError: string | null
  save: () => Promise<boolean>
  discard: () => void
  setWord: (table: SpritePropertyTableKey, spriteId: number, value: number) => void
  /** Restore one sprite's seven words to the base cart. */
  resetSprite: (spriteId: number) => void
  /** Restore every table to the base cart. */
  resetAll: () => void
  /** Sprite the window is showing (session state). */
  spriteId: number
  setSpriteId: (id: number) => void
}

export function useSpritePropertiesEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory,
  onPreviewApplied: () => void
): SpritePropertiesEditorApi {
  const doc = useOverlayDocument<SpritePropertiesModel>({
    key: 'sprite-properties',
    reloadKey: `sprite-properties:${projectId ?? ''}`,
    load: () => window.shinyEgg.editor.loadResource({ kind: 'sprite-properties' }),
    persist: (draft) => window.shinyEgg.editor.saveResource({ kind: 'sprite-properties' }, draft),
    equals: eq,
    clone: (v) => structuredClone(v),
    onSaved,
    history
  })
  useTablePreview('sprite-priority-attr', doc.draft, doc.dirty, onPreviewApplied)
  useTablePreview('sprite-gfx-files', doc.draft, doc.dirty, onPreviewApplied)
  useTablePreview('sprite-render-control', doc.draft, doc.dirty, onPreviewApplied)
  const [spriteId, setSpriteId] = useState(0x01e)

  const setWord = useCallback(
    (table: SpritePropertyTableKey, id: number, value: number) => {
      const current = doc.read()
      const words = current?.tables[table]
      if (!current || !words || id < 0 || id >= words.length) return
      if (!Number.isInteger(value) || value < 0 || value > 0xffff || words[id] === value) return
      const next = words.slice()
      next[id] = value
      doc.commit({ ...current, tables: { ...current.tables, [table]: next } })
    },
    [doc]
  )

  const resetSprite = useCallback(
    (id: number) => {
      const current = doc.read()
      if (!current?.reference) return
      const ref = current.reference
      let changed = false
      const tables = { ...current.tables }
      for (const key of Object.keys(tables) as SpritePropertyTableKey[]) {
        if (tables[key][id] !== ref[key][id]) {
          tables[key] = tables[key].slice()
          tables[key][id] = ref[key][id]!
          changed = true
        }
      }
      if (changed) doc.commit({ ...current, tables })
    },
    [doc]
  )

  const resetAll = useCallback(() => {
    const current = doc.read()
    if (!current?.reference) return
    const tables = structuredClone(current.reference)
    if (JSON.stringify(tables) !== JSON.stringify(current.tables)) doc.commit({ ...current, tables })
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
    setWord,
    resetSprite,
    resetAll,
    spriteId,
    setSpriteId
  }
}
