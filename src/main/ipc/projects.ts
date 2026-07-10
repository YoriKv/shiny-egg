// IPC for the project lifecycle: list / current / create / switch / info /
// rename / export / open-folder. Backs the toolbar Project menu.

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { encodeBps } from 'snes-framework/patches'
import { projectRoot, referenceCartPath } from '../framework-paths'
import { buildProject } from '../build-tree'
import { anyEmulatorRunning, stopAllEmulators } from '../emulator/registry'
import {
  backupProject,
  createProject,
  deleteProject,
  ensureCurrentProject,
  getProjectInfo,
  listProjects,
  renameProject,
  setCurrentProject
} from '../projects'
import { applyOverlayUpgrades, detectOutdatedOverlays } from '../overlay-upgrade'
import type {
  OverlayDriftReport,
  OverlayUpgradeResult,
  ProjectBackupResult,
  ProjectDeleteResult,
  ProjectExportResult,
  ProjectInfo,
  ProjectRenameResult,
  ProjectSummary,
  RenameProjectArgs
} from '../../shared/ipc-types'

export function registerProjectsIpc(): void {
  ipcMain.handle('project:list', async (): Promise<ProjectSummary[]> => listProjects())

  ipcMain.handle('project:ensureCurrent', async (): Promise<ProjectSummary> =>
    ensureCurrentProject()
  )

  ipcMain.handle(
    'project:create',
    async (_e, name?: string): Promise<ProjectSummary> => createProject(name || undefined)
  )

  ipcMain.handle('project:switch', async (_e, id: string): Promise<ProjectSummary> => {
    const p = setCurrentProject(id)
    if (!p) throw new Error(`Project "${id}" not found.`)
    return p
  })

  ipcMain.handle('project:info', async (_e, id: string): Promise<ProjectInfo> => {
    const info = getProjectInfo(id)
    if (!info) throw new Error(`Project "${id}" not found.`)
    return info
  })

  // Result object (not a thrown error) so the friendly message reaches the UI
  // without the "Error invoking remote method 'project:rename'" IPC wrapper.
  ipcMain.handle(
    'project:rename',
    async (_e, args: RenameProjectArgs): Promise<ProjectRenameResult> => {
      try {
        return { ok: true, project: renameProject(args.id, args.newName) }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle('project:openFolder', async (_e, id: string): Promise<void> => {
    await shell.openPath(projectRoot(id))
  })

  // Outdated-overlay checker: detect overlay `.asm` drift, back up (duplicate
  // the project), and upgrade selected files. See src/main/overlay-upgrade.ts.
  ipcMain.handle(
    'project:checkOverlays',
    async (_e, id: string): Promise<OverlayDriftReport> => detectOutdatedOverlays(id)
  )

  // Result object (not a thrown error) so the friendly message reaches the UI.
  ipcMain.handle('project:backup', async (_e, id: string): Promise<ProjectBackupResult> => {
    try {
      return { ok: true, project: backupProject(id) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    'project:upgradeOverlays',
    async (_e, args: { id: string; files: string[] }): Promise<OverlayUpgradeResult> =>
      applyOverlayUpgrades(args.id, args.files)
  )

  // Result object (not a thrown error) so the friendly "folder open" message
  // reaches the UI cleanly. On success returns the new current project (the
  // most-recent remaining one, or a freshly created default).
  ipcMain.handle(
    'project:delete',
    async (_e, id: string): Promise<ProjectDeleteResult> => {
      try {
        deleteProject(id)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
      return { ok: true, current: ensureCurrentProject() }
    }
  )

  // Both export flavors = build the ROM, then Save-As. NOTE: until the
  // per-project overlay/build-tree merge lands, this builds from the base
  // workRoot — which currently equals the project's state, since edits aren't
  // yet written to the overlay either.

  /** Build `id` for an export, streaming progress to the caller's window.
   *  Stops any running emulator first (it holds a lock on the build output).
   *  Throws on a build failure (the handlers turn that into `{ ok:false }`). */
  function buildForExport(event: Electron.IpcMainInvokeEvent, id: string): string {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (anyEmulatorRunning()) stopAllEmulators()
    return buildProject({
      id,
      onProgress: (msg) => win?.webContents.send('framework:progress', msg)
    }).outputPath
  }

  async function pickSavePath(
    event: Electron.IpcMainInvokeEvent,
    opts: Electron.SaveDialogOptions
  ): Promise<string | null> {
    const win = BrowserWindow.fromWebContents(event.sender)
    const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return picked.canceled || !picked.filePath ? null : picked.filePath
  }

  // Export as ROM: copy the built .sfc to a user-chosen path.
  ipcMain.handle(
    'project:export',
    async (event, id: string): Promise<ProjectExportResult> => {
      let outputPath: string
      try {
        outputPath = buildForExport(event, id)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }

      const savedPath = await pickSavePath(event, {
        title: 'Export ROM',
        defaultPath: `${id}.sfc`,
        filters: [{ name: 'SNES ROM', extensions: ['sfc'] }]
      })
      if (!savedPath) return { ok: false, canceled: true }

      try {
        await copyFile(outputPath, savedPath)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
      return { ok: true, savedPath }
    }
  )

  // Export as Patch: BPS-encode the built ROM against the reference cart, so the
  // project distributes as a small patch instead of the (copyrighted) full ROM.
  // The reference stash is the extracted cart — the same base the build targets.
  ipcMain.handle(
    'project:exportPatch',
    async (event, id: string): Promise<ProjectExportResult> => {
      let patch: Uint8Array
      try {
        const outputPath = buildForExport(event, id)
        if (!existsSync(referenceCartPath())) {
          return { ok: false, error: 'No reference cart found — extract a cart first.' }
        }
        const source = new Uint8Array(await readFile(referenceCartPath()))
        const target = new Uint8Array(await readFile(outputPath))
        patch = encodeBps(source, target)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }

      const savedPath = await pickSavePath(event, {
        title: 'Export Patch',
        defaultPath: `${id}.bps`,
        filters: [{ name: 'BPS patch', extensions: ['bps'] }]
      })
      if (!savedPath) return { ok: false, canceled: true }

      try {
        await writeFile(savedPath, patch)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
      return { ok: true, savedPath }
    }
  )
}
