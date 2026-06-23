// IPC for the import features. The renderer's import window picks a source ROM,
// gets back a report, then applies the chosen records into the active project's
// overlay. Two sources:
//   - ROM import (`import:*`): a modified `.sfc` diffed against the extracted
//     V1.0 base → changed-level report (src/main/rom-import.ts).
//   - GBA import (`gbaImport:*`): an SMA3 (U) `.gba` cart → its importable
//     sublevels, overwriting chosen SNES records (src/main/gba-import.ts).
// Applied edits mark the build dirty (renderer side, like the other tools).

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { analyzeRom, applyRomImport } from '../rom-import'
import { analyzeGbaRom, applyGbaImport } from '../gba-import'
import type {
  GbaImportApplyResult,
  GbaImportApplySelection,
  GbaImportReport,
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

  // Pick an SMA3 (U) GBA cart and list its importable sublevels. Returns null
  // when the dialog is cancelled.
  ipcMain.handle('gbaImport:analyze', async (): Promise<GbaImportReport | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import level from GBA (Super Mario Advance 3)',
      properties: ['openFile'],
      filters: [{ name: 'GBA ROM', extensions: ['gba', 'agb', 'bin'] }]
    }
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return null
    return analyzeGbaRom(picked.filePaths[0])
  })

  ipcMain.handle(
    'gbaImport:apply',
    async (_e, selection: GbaImportApplySelection): Promise<GbaImportApplyResult> =>
      applyGbaImport(selection)
  )
}
