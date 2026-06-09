// IPC for the project lifecycle: list / current / create / switch / info /
// rename / export / open-folder. Backs the toolbar Project menu.

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFile } from 'node:fs/promises'
import { projectRoot } from '../framework-paths'
import { buildProject } from '../build-tree'
import { getBizHawk } from '../bizhawk'
import {
  createProject,
  deleteProject,
  ensureCurrentProject,
  getProjectInfo,
  listProjects,
  renameProject,
  setCurrentProject
} from '../projects'
import type {
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

  ipcMain.handle('project:create', async (): Promise<ProjectSummary> => createProject())

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

  // Export = build the ROM, then Save-As to a user-chosen .sfc. NOTE: until
  // the per-project overlay/build-tree merge lands (plan step 3), this builds
  // from the base workRoot — which currently equals the project's state, since
  // edits aren't yet written to the overlay either.
  ipcMain.handle(
    'project:export',
    async (event, id: string): Promise<ProjectExportResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      // Release any lock EmuHawk holds on the build output before rebuilding.
      if (getBizHawk().isRunning()) getBizHawk().stop()

      let outputPath: string
      try {
        const result = buildProject({
          id,
          onProgress: (msg) => win?.webContents.send('framework:progress', msg)
        })
        outputPath = result.outputPath
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }

      const opts = {
        title: 'Export ROM',
        defaultPath: `${id}.sfc`,
        filters: [{ name: 'SNES ROM', extensions: ['sfc'] }]
      }
      const picked = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts)
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }

      try {
        await copyFile(outputPath, picked.filePath)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
      return { ok: true, savedPath: picked.filePath }
    }
  )
}
