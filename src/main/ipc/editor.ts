// IPC handlers for the generic editable-resource layer (editor:*): the
// load/save resource dispatch (the registry the level editor + every overlay
// tool save through), palette-color edits, the live level-data byte budget +
// pool overview, free-space migration / de-couple state, level reset, and the
// cross-level warp-exit destination edit. Split out of framework.ts so each API
// namespace maps 1:1 to an ipc/*.ts file. Registered once from main/index.

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type {
  EditableResource,
  GradientEdit,
  LevelData,
  PaletteEdit,
  PoolBudgetReport,
  PoolOverview,
  SaveResourceResult
} from 'snes-framework/types'
import { exportGfxPngsToDir } from '../gfx-png-export'
import { exportBgRegionToDir, importBgRegionFolder, listM1Files } from '../bg-region-io'
import { importGraphicsFolder } from '../graphics-folder-io'
import { addRegionExportFolder, listRegionExportFolders, removeRegionExportFolder } from '../region-exports'
import { asepriteInfo, openInAseprite } from '../aseprite-app'
import { openInM1te } from '../m1te-app'
import { updateSettings } from '../settings'
import { basename, join } from 'node:path'
import { loadMap16Block, saveMap16Block, resetMap16Block, listMap16BlockEdits } from '../map16-edits'
import { buildMetatileContext, renderMap16Block } from 'snes-framework/object-metatile'
import { loadRomAndSymbols } from '../render/rom-cache'
import {
  getCurrentProjectId,
  getRelocationState,
  setLevelDecoupled,
  setLevelRelocation
} from '../projects'
import {
  activeLevelBudget,
  activePoolOverview,
  listGfxEdits,
  gfxFileRole,
  loadPaletteEdits,
  loadGradientEdits,
  loadGradientBaseColors,
  loadResource,
  resetGfxEdit,
  resetGfxEditFile,
  resetLevelResource,
  savePaletteEdits,
  saveGradientEdits,
  saveGfxEdit,
  saveResource,
  setExitDestResource,
  setExitEntranceResource
} from '../resources'
import { computeSpriteProperties } from '../sprite-properties'
import {
  applyLevelRemoval,
  createLevel,
  listCreatableSlots,
  listRemovedLevels,
  previewLevelRemoval,
  removableVanillaLevels,
  restoreLevels
} from '../level-removal'
import type {
  BgRegionExportArgs,
  BgRegionExportResult,
  BgRegionImportResult,
  M1ExportFile,
  CreatableSlot,
  CreateLevelResult,
  ExportGfxOptions,
  ExportGfxResult,
  GfxEditEntry,
  GfxFileRole,
  ImportGraphicsResult,
  LocateAsepriteResult,
  AsepriteInfo,
  Map16BlockPreview,
  Map16SubTileEdit,
  RelocationState,
  RenderHeaderRequest,
  RemovableVanillaLevels,
  RemovalPreviewResult,
  RemovedLevelEntry,
  RemoveLevelsResult,
  ResetGfxEditResult,
  ResetLevelResult,
  RestoreLevelsResult,
  SaveGfxEditResult,
  SetExitDestResult,
  SetExitEntranceResult,
  SpriteProperty,
  SpritePropertiesRequest
} from '../../shared/ipc-types'

export function registerEditorIpc(): void {
  // Generic editable-resource dispatch (the registry) — the level editor and
  // all new tools load/save through this.
  // Per-sprite-type computed read-only properties (Properties panel).
  ipcMain.handle(
    'editor:spriteProperties',
    async (_event, req: SpritePropertiesRequest): Promise<SpriteProperty[]> =>
      computeSpriteProperties(req)
  )

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

  // Palette-color editing (§B10): the saved overlay's edit set (the
  // usePaletteEditor baseline) + the full-set save back into Bank57.asm → project
  // overlay. Renderer marks the build dirty on save (asm edit).
  ipcMain.handle('editor:loadPaletteEdits', async (): Promise<PaletteEdit[]> => loadPaletteEdits())
  ipcMain.handle(
    'editor:savePaletteEdits',
    async (_event, edits: PaletteEdit[]): Promise<SaveResourceResult> =>
      savePaletteEdits(edits)
  )

  // Backdrop-gradient editing: the saved overlay's gradient stop edits (the
  // useGradientEditor baseline) + the full-set save (also into Bank57.asm), plus
  // the 16×24 pristine base colors the panel overlays the draft on for display.
  ipcMain.handle('editor:loadGradientEdits', async (): Promise<GradientEdit[]> => loadGradientEdits())
  ipcMain.handle(
    'editor:saveGradientEdits',
    async (_event, edits: GradientEdit[]): Promise<SaveResourceResult> => saveGradientEdits(edits)
  )
  ipcMain.handle('editor:gradientBaseColors', async (): Promise<number[][]> => loadGradientBaseColors())

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

  // Graphics editing: re-encode edited decompressed tiles → overlay blob (the
  // build's reinsert pipeline places it; renderer marks the build dirty — gfx
  // edits don't render live), and reset back to base.
  ipcMain.handle(
    'editor:saveGfxEdit',
    async (
      _event,
      format: 'lz2' | 'lz16',
      fileId: number,
      tiles: Uint8Array,
      rowCount?: number
    ): Promise<SaveGfxEditResult> => saveGfxEdit(format, fileId, tiles, rowCount)
  )
  ipcMain.handle(
    'editor:resetGfxEdit',
    async (_event, format: 'lz2' | 'lz16', fileId: number): Promise<ResetGfxEditResult> =>
      resetGfxEdit(format, fileId)
  )
  // Changed-graphics list + per-file reset-to-vanilla (the Graphics panel).
  ipcMain.handle('editor:listGfxEdits', async (): Promise<GfxEditEntry[]> => listGfxEdits())
  ipcMain.handle('editor:gfxFileRole', async (_event, file: string): Promise<GfxFileRole> => gfxFileRole(file))
  ipcMain.handle(
    'editor:resetGfxEditFile',
    async (_event, file: string): Promise<ResetGfxEditResult> => resetGfxEditFile(file)
  )

  // Graphics panel: export the current level's gfx files to a chosen folder as
  // PNGs (+ manifest), and import edited PNGs back. Folder picked via dialog.
  ipcMain.handle(
    'editor:exportGfxPngs',
    async (
      _event,
      header: RenderHeaderRequest | null, // null ⇒ no level loaded (only the screens track runs)
      exportOpts?: ExportGfxOptions
    ): Promise<ExportGfxResult> => {
      const win = BrowserWindow.getFocusedWindow()
      const opts: Electron.OpenDialogOptions = {
        title: 'Export graphics PNGs to folder',
        properties: ['openDirectory', 'createDirectory']
      }
      const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
      const dir = picked.filePaths[0]!
      try {
        // The picked folder is ONE export folder: exportGfxPngsToDir nests each export type in
        // its own subfolder (each with its own gfx-manifest) under it, sharing one README. The
        // unified import scans the folder's subfolders, so remember/return the picked folder.
        const { count } = exportGfxPngsToDir(header, dir, exportOpts ?? {})
        addRegionExportFolder(dir) // remember it for the unified exported-folders list
        return { ok: true, count, dir }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
  // Graphics panel "Region" tab: export a BG layer region (BG1 = a selected level
  // area; BG2/BG3 = the whole rendered tilemap) to a PNG + sidecar, and import the
  // edited PNG back (slice → saveGfxEdit). Folder picked via dialog.
  ipcMain.handle(
    'editor:exportBgRegion',
    async (_event, header: RenderHeaderRequest, args: BgRegionExportArgs): Promise<BgRegionExportResult> => {
      const win = BrowserWindow.getFocusedWindow()
      const opts: Electron.OpenDialogOptions = {
        title: 'Export BG region to folder',
        properties: ['openDirectory', 'createDirectory']
      }
      const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
      const dir = picked.filePaths[0]!
      const r = exportBgRegionToDir(header, args.level, args.layer, args.rect ?? null, dir, args.format ?? 'png')
      if (r.ok) addRegionExportFolder(dir) // remember the folder for the Region tab's list
      return r
    }
  )
  // "Locate Aseprite" (Graphics panel header): the resolved exe (saved → common
  // install locations) + its probed version, or null when not located; and a picker
  // that persists it. The version gates the panel's tilemap-export option (1.3+).
  ipcMain.handle('aseprite:getExe', async (): Promise<AsepriteInfo | null> => asepriteInfo())
  ipcMain.handle('aseprite:locate', async (): Promise<LocateAsepriteResult> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = { title: 'Locate Aseprite', properties: ['openFile'] }
    if (process.platform === 'win32') opts.filters = [{ name: 'Aseprite', extensions: ['exe'] }]
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false }
    const p = picked.filePaths[0]!
    if (!basename(p).toLowerCase().includes('aseprite')) {
      return { ok: false, error: `Select the Aseprite executable (got ${basename(p)}).` }
    }
    updateSettings({ asepritePath: p })
    return { ok: true, path: p }
  })
  // Open a single exported file (image) in Aseprite (the "Auto-Open Exports" toggle).
  ipcMain.handle('aseprite:open', async (_event, dir: string, file: string): Promise<boolean> => openInAseprite(join(dir, file)))
  // Open an exported .M1 session in the bundled M1TE editor, straight to its BG layer
  // (the "Auto-Open Exports" toggle for the M1TE2 export). Windows-native or via Wine.
  ipcMain.handle('m1te:open', async (_event, dir: string, file: string, bg?: 1 | 2 | 3): Promise<boolean> => openInM1te(join(dir, file), bg))

  // Folders this project has exported region(s) to — listed in the Region tab with
  // their own import / remove buttons (region-exports.ts).
  ipcMain.handle('editor:listRegionExports', async (): Promise<string[]> => listRegionExportFolders())
  ipcMain.handle('editor:removeRegionExport', async (_event, dir: string): Promise<string[]> => removeRegionExportFolder(dir))
  ipcMain.handle('editor:openRegionFolder', async (_event, dir: string): Promise<void> => { void shell.openPath(dir) })
  // The .M1 session files in an export folder (with each one's BG layer), for the
  // panel's clickable "open in M1TE" list under each folder.
  ipcMain.handle('editor:listM1Files', async (_event, dir: string): Promise<M1ExportFile[]> => listM1Files(dir))

  // Unified import: auto-detect the all-graphics manifest AND/OR BG-region files in
  // a folder, import both, merge into one log. Per-folder (no dialog) + a dialog form.
  ipcMain.handle('editor:importGraphicsFolder', async (_event, dir: string): Promise<ImportGraphicsResult> => importGraphicsFolder(dir))
  ipcMain.handle('editor:importGraphics', async (): Promise<ImportGraphicsResult> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = { title: 'Import edited graphics from folder', properties: ['openDirectory'] }
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
    const dir = picked.filePaths[0]!
    const r = await importGraphicsFolder(dir)
    if (r.ok) addRegionExportFolder(dir)
    return r
  })
  // Import a specific tracked folder (no dialog) — slices every region back + logs.
  ipcMain.handle('editor:importRegionFolder', async (_event, dir: string): Promise<BgRegionImportResult> => importBgRegionFolder(dir))
  // Ad-hoc import via folder dialog (also remembers the folder).
  ipcMain.handle('editor:importBgRegion', async (): Promise<BgRegionImportResult> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import edited BG region from folder',
      properties: ['openDirectory']
    }
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
    const dir = picked.filePaths[0]!
    const r = await importBgRegionFolder(dir)
    if (r.ok) addRegionExportFolder(dir)
    return r
  })

  // Structured Map16 block editor (object-metatile Phase 3). Load/save a block's
  // 4 sub-tile descriptors, render a live preview, list + reset edits. Saved edits
  // apply as post-build byte patches to the $4C region (renderer marks dirty).
  ipcMain.handle(
    'editor:loadMap16Block',
    async (_event, map16Id: number): Promise<Map16SubTileEdit[] | null> => loadMap16Block(map16Id)
  )
  ipcMain.handle(
    'editor:saveMap16Block',
    async (
      _event,
      map16Id: number,
      subtiles: Map16SubTileEdit[]
    ): Promise<{ ok: true } | { ok: false; error: string }> => saveMap16Block(map16Id, subtiles)
  )
  ipcMain.handle(
    'editor:resetMap16Block',
    async (
      _event,
      map16Id: number
    ): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> => resetMap16Block(map16Id)
  )
  ipcMain.handle('editor:listMap16BlockEdits', async (): Promise<number[]> => listMap16BlockEdits())
  ipcMain.handle(
    'editor:renderMap16Block',
    async (
      _event,
      header: RenderHeaderRequest,
      subtiles: Map16SubTileEdit[]
    ): Promise<Map16BlockPreview | null> => {
      try {
        const { rom, symbols } = loadRomAndSymbols()
        const ctx = buildMetatileContext(rom, symbols, header)
        return { rgba: renderMap16Block(ctx, subtiles), width: 16, height: 16 }
      } catch {
        return null
      }
    }
  )

  // Vanilla-level removal (level-removal.ts): dry-run impact for the confirm
  // dialog, the actual removal (world-map rewire + project flag + overlay
  // cleanup; the renderer marks the build dirty), and the bulk "remove all
  // vanilla" candidate-set computation.
  ipcMain.handle(
    'editor:removeLevelsPreview',
    async (_event, recordIds: number[]): Promise<RemovalPreviewResult> =>
      previewLevelRemoval(recordIds)
  )
  ipcMain.handle(
    'editor:removeLevels',
    async (_event, recordIds: number[]): Promise<RemoveLevelsResult> =>
      applyLevelRemoval(recordIds)
  )
  ipcMain.handle(
    'editor:removableVanillaLevels',
    async (): Promise<RemovableVanillaLevels | { error: string }> => removableVanillaLevels()
  )
  ipcMain.handle(
    'editor:removedLevels',
    async (): Promise<RemovedLevelEntry[]> => listRemovedLevels()
  )
  ipcMain.handle(
    'editor:restoreLevels',
    async (_event, recordIds: number[]): Promise<RestoreLevelsResult> => restoreLevels(recordIds)
  )
  ipcMain.handle(
    'editor:creatableSlots',
    async (): Promise<CreatableSlot[]> => listCreatableSlots()
  )
  ipcMain.handle(
    'editor:createLevel',
    async (_event, recordId: number): Promise<CreateLevelResult> => createLevel(recordId)
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

  // Cross-level warp-exit entrance-type edit (incoming-marker Entrance dropdown):
  // rewrite the source level's overlay so its exit applies `entranceType`.
  ipcMain.handle(
    'editor:setExitEntrance',
    async (
      _event,
      sourceLevelRecordId: number,
      screenIndex: number,
      entranceType: number
    ): Promise<SetExitEntranceResult> =>
      setExitEntranceResource(sourceLevelRecordId, screenIndex, entranceType)
  )
}
