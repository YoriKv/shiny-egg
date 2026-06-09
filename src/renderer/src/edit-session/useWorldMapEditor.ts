// World-map entrance-table editor — the App-level DRAFT of the entrance records
// (spawn cell / progression target / level-data id per world-map slot) on the
// shared overlay-document engine. Like the palette + strings editors it gets
// draft/dirty/save/discard, EditSession registration (so global Save / Test
// Level flush it before the build) and unified undo/redo for free. `onSaved`
// marks the build dirty — entrance edits don't render live (no overworld
// renderer), EXCEPT spawn X/Y, whose marker is drawn renderer-side from this
// draft (move the glyph, no IPC). See WorldMapPanel.tsx + scripts/world-map.ts.

import { useCallback } from 'react'
import type { WorldMapEntrance, WorldMapMidwayEntrance, WorldMapModel } from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from './useOverlayDocument'

/** Last (highest-index) entrance record whose level-data id matches — mirrors the
 *  extract-time "last write wins" that produced `LevelData.spawn`, so the marker
 *  the canvas shows and the record this edits are the same one. -1 when the level
 *  has no world-map entrance (sub-rooms). */
function spawnRecordIndex(m: WorldMapModel, levelDataId: number): number {
  let idx = -1
  for (const e of m.entrances) if (e.levelDataId === levelDataId) idx = e.index
  return idx
}

function withEntrance(
  m: WorldMapModel,
  index: number,
  patch: Partial<Omit<WorldMapEntrance, 'index'>>
): WorldMapModel {
  return { ...m, entrances: m.entrances.map((e) => (e.index === index ? { ...e, ...patch } : e)) }
}

function withMidway(
  m: WorldMapModel,
  index: number,
  patch: Partial<Omit<WorldMapMidwayEntrance, 'index'>>
): WorldMapModel {
  return { ...m, midway: m.midway.map((e) => (e.index === index ? { ...e, ...patch } : e)) }
}

const eq = (a: WorldMapModel, b: WorldMapModel): boolean =>
  JSON.stringify(a.entrances) === JSON.stringify(b.entrances) &&
  JSON.stringify(a.midway) === JSON.stringify(b.midway)

export interface WorldMapEditorApi {
  /** The draft model (null until loaded). The panel + canvas marker read this. */
  model: WorldMapModel | null
  dirty: boolean
  saving: boolean
  status: string
  error: string | null
  saveError: string | null
  save: () => Promise<boolean>
  /** Revert the draft to the last-saved baseline (the close-prompt "Discard"). */
  discard: () => void
  /** Read the draft synchronously (a drag-start snapshot). */
  read: () => WorldMapModel | null
  /** Draft-aware spawn cell for a level (the entrance Yoshi spawns into), or null
   *  when the level has no world-map entrance. Drives the live marker. */
  spawnFor: (levelDataId: number) => { x: number; y: number } | null
  /** Set a level's spawn WITHOUT an undo step — a drag's preview frames. */
  previewSpawn: (levelDataId: number, x: number, y: number) => void
  /** Commit a spawn edit with an explicit before-snapshot (drag release). One
   *  undo step covering the whole gesture. */
  commitSpawnFrom: (before: WorldMapModel, levelDataId: number, x: number, y: number) => void
  /** Commit a discrete spawn edit for a level (the Properties X/Y fields). One
   *  undo step; the canvas marker follows via `spawnFor`. */
  commitSpawn: (levelDataId: number, x: number, y: number) => void
  /** Commit one discrete field edit on a main-entrance record by index. */
  setEntranceField: (index: number, patch: Partial<Omit<WorldMapEntrance, 'index'>>) => void
  /** Commit one discrete field edit on a midway/checkpoint record by index. */
  setMidwayField: (index: number, patch: Partial<Omit<WorldMapMidwayEntrance, 'index'>>) => void
}

/**
 * Own the world-map entrance draft at App level (survives the window closing) on
 * the shared overlay-document engine. Reloads the baseline on project change.
 */
export function useWorldMapEditor(
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): WorldMapEditorApi {
  const doc = useOverlayDocument<WorldMapModel>({
    key: 'world-map',
    reloadKey: `world-map:${projectId ?? ''}`,
    load: () => window.shinyEgg.editor.loadResource({ kind: 'world-map' }),
    persist: (draft) => window.shinyEgg.editor.saveResource({ kind: 'world-map' }, draft),
    equals: eq,
    clone: (v) => structuredClone(v),
    onSaved,
    history
  })

  const spawnFor = useCallback(
    (levelDataId: number): { x: number; y: number } | null => {
      const m = doc.draft
      if (!m) return null
      const idx = spawnRecordIndex(m, levelDataId)
      if (idx < 0) return null
      const e = m.entrances.find((x) => x.index === idx)
      return e ? { x: e.spawnX, y: e.spawnY } : null
    },
    [doc.draft]
  )

  const previewSpawn = useCallback(
    (levelDataId: number, x: number, y: number) => {
      const m = doc.read()
      if (!m) return
      const idx = spawnRecordIndex(m, levelDataId)
      if (idx < 0) return
      doc.setDraft(withEntrance(m, idx, { spawnX: x, spawnY: y }))
    },
    [doc]
  )

  const commitSpawnFrom = useCallback(
    (before: WorldMapModel, levelDataId: number, x: number, y: number) => {
      const cur = doc.read()
      if (!cur) return
      const idx = spawnRecordIndex(cur, levelDataId)
      if (idx < 0) return
      const after = withEntrance(cur, idx, { spawnX: x, spawnY: y })
      doc.setDraft(after)
      if (!eq(before, after)) doc.recordUndo(before, after)
    },
    [doc]
  )

  const commitSpawn = useCallback(
    (levelDataId: number, x: number, y: number) => {
      const cur = doc.read()
      if (!cur) return
      const idx = spawnRecordIndex(cur, levelDataId)
      if (idx < 0) return
      doc.commit(withEntrance(cur, idx, { spawnX: x, spawnY: y }))
    },
    [doc]
  )

  const setEntranceField = useCallback(
    (index: number, patch: Partial<Omit<WorldMapEntrance, 'index'>>) => {
      const cur = doc.read()
      if (!cur) return
      doc.commit(withEntrance(cur, index, patch))
    },
    [doc]
  )

  const setMidwayField = useCallback(
    (index: number, patch: Partial<Omit<WorldMapMidwayEntrance, 'index'>>) => {
      const cur = doc.read()
      if (!cur) return
      doc.commit(withMidway(cur, index, patch))
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
    read: doc.read,
    spawnFor,
    previewSpawn,
    commitSpawnFrom,
    commitSpawn,
    setEntranceField,
    setMidwayField
  }
}
