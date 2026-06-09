// IPC handlers for the generic editable-resource layer (editor:*): the
// load/save resource dispatch (the registry the level editor + every overlay
// tool save through), palette-colour edits, the live level-data byte budget +
// pool overview, free-space migration / de-couple state, level reset, and the
// cross-level warp-exit destination edit. Split out of framework.ts so each API
// namespace maps 1:1 to an ipc/*.ts file. Registered once from main/index.

import { ipcMain } from 'electron'
import type {
  EditableResource,
  LevelData,
  PaletteEdit,
  PoolBudgetReport,
  PoolOverview,
  SaveResourceResult
} from 'snes-framework/types'
import {
  getCurrentProjectId,
  getRelocationState,
  setLevelDecoupled,
  setLevelRelocation
} from '../projects'
import {
  activeLevelBudget,
  activePoolOverview,
  loadPaletteEdits,
  loadResource,
  resetLevelResource,
  savePaletteEdits,
  saveResource,
  setExitDestResource
} from '../resources'
import type {
  RelocationState,
  ResetLevelResult,
  SetExitDestResult
} from '../../shared/ipc-types'

export function registerEditorIpc(): void {
  // Generic editable-resource dispatch (the registry) — the level editor and
  // all new tools load/save through this.
  ipcMain.handle(
    'editor:loadResource',
    async (_event, resource: EditableResource): Promise<unknown> =>
      loadResource(resource)
  )

  ipcMain.handle(
    'editor:saveResource',
    async (
      _event,
      resource: EditableResource,
      model: unknown
    ): Promise<SaveResourceResult> => saveResource(resource, model)
  )

  // Palette-colour editing (§B10): the saved overlay's edit set (the
  // usePaletteEditor baseline) + the full-set save back into Bank57.asm → project
  // overlay. Renderer marks the build dirty on save (asm edit).
  ipcMain.handle('editor:loadPaletteEdits', async (): Promise<PaletteEdit[]> => loadPaletteEdits())
  ipcMain.handle(
    'editor:savePaletteEdits',
    async (_event, edits: PaletteEdit[]): Promise<SaveResourceResult> =>
      savePaletteEdits(edits)
  )

  // Live level-data byte-budget for the editor's warn/block surfaces (task #14).
  // Null when there's no pool map yet (unbuilt) or the level has no streams.
  ipcMain.handle(
    'editor:levelBudget',
    async (_event, levelRecordId: number, level: LevelData): Promise<PoolBudgetReport | null> =>
      activeLevelBudget(levelRecordId, level)
  )

  // Cross-pool byte-budget overview (pools + free regions) for the "Banks" panel. The active
  // (being-edited) level is passed so its blobs reflect live unsaved sizes;
  // null/empty args fall back to on-disk sizes. Null pre-build (no pool map).
  ipcMain.handle(
    'editor:poolOverview',
    async (
      _event,
      activeLevelRecordId: number | null,
      activeLevel: LevelData | null
    ): Promise<PoolOverview | null> => activePoolOverview(activeLevelRecordId, activeLevel)
  )

  // Free-space migration + de-couple state (persisted in project.json). The
  // renderer marks the build dirty after a toggle (layout changes don't render
  // live — Test Level / Launch rebuild).
  ipcMain.handle(
    'editor:getRelocationState',
    async (): Promise<RelocationState> => getRelocationState(getCurrentProjectId())
  )
  ipcMain.handle(
    'editor:setLevelRelocation',
    async (_event, levelRecordId: number, relocated: boolean): Promise<RelocationState> => {
      const id = getCurrentProjectId()
      if (!id) throw new Error('No active project.')
      return setLevelRelocation(id, levelRecordId, relocated)
    }
  )
  ipcMain.handle(
    'editor:setLevelDecoupled',
    async (_event, levelRecordId: number, decoupled: boolean): Promise<RelocationState> => {
      const id = getCurrentProjectId()
      if (!id) throw new Error('No active project.')
      return setLevelDecoupled(id, levelRecordId, decoupled)
    }
  )

  // Reset a level: delete its overlay `.bin`(s) so it reloads from base.
  ipcMain.handle(
    'editor:resetLevel',
    async (_event, levelRecordId: number): Promise<ResetLevelResult> =>
      resetLevelResource(levelRecordId)
  )

  // Cross-level warp-exit destination edit (incoming-marker drag, §A8 #8.5):
  // rewrite the source level's overlay so its exit lands at (destX, destY).
  ipcMain.handle(
    'editor:setExitDest',
    async (
      _event,
      sourceLevelRecordId: number,
      screenIndex: number,
      destX: number,
      destY: number
    ): Promise<SetExitDestResult> =>
      setExitDestResource(sourceLevelRecordId, screenIndex, destX, destY)
  )
}
