// IPC for the ROM-import feature (plan-rom-import.md). The renderer's import
// window picks a modified `.sfc`, gets back a diff report (anchors + changed
// levels + overwrite warnings), then applies the chosen records into the active
// project's overlay. Applied edits mark the build dirty (renderer side, like the
// other tools). Analysis/apply live in src/main/rom-import.ts.

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { analyzeRom, applyRomImport } from '../rom-import'
import type {
  RomImportApplyResult,
  RomImportReport,
  RomImportSelection
} from '../../shared/ipc-types'

export function registerImportIpc(): void {
  // Pick a modified ROM and analyse it against the extracted base. Returns null
  // when the dialog is cancelled (so the UI can leave its state untouched).
  ipcMain.handle('import:analyze', async (): Promise<RomImportReport | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import from modified ROM',
      properties: ['openFile'],
      filters: [{ name: 'SNES ROM', extensions: ['sfc', 'smc'] }]
    }
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return null
    return analyzeRom(picked.filePaths[0])
  })

  ipcMain.handle(
    'import:apply',
    async (_e, selection: RomImportSelection): Promise<RomImportApplyResult> =>
      applyRomImport(selection)
  )
}
