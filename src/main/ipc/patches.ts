// IPC for the custom-patch system. The renderer's Patches panel lists the
// active project's local patches (toggle on/off) + the prepackaged catalog (add
// into the project), imports external `.ips` files, and opens the project's
// patches folder. Patches are applied post-build by buildProject (see
// src/main/patches.ts).

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  addPrepackagedToProject,
  createTemplatePatch,
  ensureProjectPatchesDir,
  getPatchPoolSettings,
  importAsm,
  importIps,
  listPrepackagedPatches,
  listProjectPatches,
  patchAuthoringPaths,
  previewPatch,
  removePatch,
  reorderPatches,
  setPatchEnabled,
  setPatchPoolKB
} from '../patches'
import type {
  PatchAuthoringPaths,
  PatchImportResult,
  PatchMutationResult,
  PatchPoolSettings,
  PatchPreview,
  PatchSummary,
  PrepackagedPatch
} from '../../shared/ipc-types'

export function registerPatchesIpc(): void {
  ipcMain.handle('patches:listProject', async (): Promise<PatchSummary[]> => listProjectPatches())

  ipcMain.handle('patches:listPrepackaged', async (): Promise<PrepackagedPatch[]> =>
    listPrepackagedPatches()
  )

  ipcMain.handle('patches:add', async (_e, builtinId: string): Promise<PatchMutationResult> =>
    addPrepackagedToProject(builtinId)
  )

  // Pick one or more `.ips` / `.asm` files and import them into the active
  // project, dispatching by extension: `.ips` → binary chunks; `.asm` → an
  // asar-style hack converted to the build-compatible form (see importAsm).
  ipcMain.handle('patches:import', async (): Promise<PatchImportResult[]> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import patch (.ips / .asm)',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Patch (.ips / .asm)', extensions: ['ips', 'asm'] },
        { name: 'IPS patch', extensions: ['ips'] },
        { name: 'asar patch', extensions: ['asm'] }
      ]
    }
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return []
    return picked.filePaths.map((p) => (/\.asm$/i.test(p) ? importAsm(p) : importIps(p)))
  })

  // Create a new self-documenting template patch (disabled) for the user to edit.
  ipcMain.handle('patches:newTemplate', async (): Promise<PatchImportResult> => createTemplatePatch())

  ipcMain.handle('patches:setEnabled', async (_e, id: string, enabled: boolean): Promise<PatchMutationResult> =>
    setPatchEnabled(id, enabled)
  )

  ipcMain.handle('patches:reorder', async (_e, ids: string[]): Promise<PatchMutationResult> =>
    reorderPatches(ids)
  )

  ipcMain.handle('patches:remove', async (_e, id: string): Promise<PatchMutationResult> =>
    removePatch(id)
  )

  // Asm-patch pool size (KB reserved off the SuperFX free region). Read its
  // current value + UI bounds; set it (clamped). Changes the build layout, so the
  // renderer marks the build dirty after a successful set.
  ipcMain.handle('patches:getPatchPool', async (): Promise<PatchPoolSettings> => getPatchPoolSettings())
  ipcMain.handle('patches:setPatchPoolKB', async (_e, kb: number): Promise<PatchMutationResult> =>
    setPatchPoolKB(kb)
  )

  ipcMain.handle('patches:preview', async (_e, id: string): Promise<PatchPreview | null> =>
    previewPatch(id)
  )

  // Open the active project's patches folder in the OS file manager (the "edit"
  // affordance — users manage `.ips`/`.json` files directly).
  ipcMain.handle('patches:openFolder', async (): Promise<void> => {
    const dir = ensureProjectPatchesDir()
    if (dir) await shell.openPath(dir)
  })

  // Authoring help: where the framework asm source + the project's build symbol
  // files live, and an open-in-file-manager affordance for each.
  ipcMain.handle('patches:authoringPaths', async (): Promise<PatchAuthoringPaths> => patchAuthoringPaths())
  ipcMain.handle('patches:openAuthoringFolder', async (_e, which: 'asm' | 'sym'): Promise<void> => {
    const p = patchAuthoringPaths()
    const dir = which === 'asm' ? p.asmDir : p.symDir
    if (dir) await shell.openPath(dir)
  })
}
