// IPC handlers for the BizHawk supervisor. The supervisor itself lives in
// `../bizhawk.ts`; this module just wraps each method as an `ipcMain.handle`.

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { getBizHawk, resolveBizhawkExe } from '../bizhawk'
import { bizhawkExeName, screenshotPath } from '../framework-paths'
import { updateSettings } from '../settings'
import type { BizhawkWarp, CaptureAtResult, LocateBizhawkResult } from '../../shared/ipc-types'

export function registerBizHawkIpc(): void {
  ipcMain.handle('bizhawk:ping', async (): Promise<string> => getBizHawk().ping())

  ipcMain.handle('bizhawk:info', async (): Promise<string> => getBizHawk().info())

  ipcMain.handle('bizhawk:dumpVram', async (): Promise<Uint8Array> => {
    const buf = await getBizHawk().dumpVram()
    return new Uint8Array(buf)
  })

  ipcMain.handle('bizhawk:dumpCgram', async (): Promise<Uint8Array> => {
    const buf = await getBizHawk().dumpCgram()
    return new Uint8Array(buf)
  })

  ipcMain.handle(
    'bizhawk:loadLevel',
    async (
      _e,
      translevelId: number,
      warps?: ReadonlyArray<BizhawkWarp>
    ): Promise<string> => {
      return getBizHawk().loadLevel(translevelId, warps)
    }
  )

  ipcMain.handle(
    'bizhawk:readMem',
    async (_e, domain: string, addr: number, len: number): Promise<Uint8Array> => {
      const buf = await getBizHawk().readMem(domain, addr, len)
      return new Uint8Array(buf)
    }
  )

  ipcMain.handle(
    'bizhawk:captureAt',
    async (_e, x: number, y: number): Promise<CaptureAtResult> => {
      const path = screenshotPath()
      await mkdir(dirname(path), { recursive: true })
      const reply = await getBizHawk().captureAt(x, y, path)
      const buf = await readFile(path)
      return { png: new Uint8Array(buf), message: reply }
    }
  )

  ipcMain.handle('bizhawk:stop', async (): Promise<void> => {
    getBizHawk().stop()
  })

  ipcMain.handle('bizhawk:launch', async (): Promise<void> => {
    await getBizHawk().ensureRunning()
  })

  // Resolved EmuHawk.exe path (saved location, then the dev fallback), or null
  // when BizHawk hasn't been located. The toolbar shows Launch / Test Level when
  // non-null, "Locate BizHawk" otherwise.
  ipcMain.handle('bizhawk:getExe', async (): Promise<string | null> => resolveBizhawkExe())

  // "Locate BizHawk": pick the BizHawk launcher (EmuHawk.exe on Windows,
  // EmuHawk.sh on Linux/macOS) and persist it to settings. Validates the
  // filename so a stray file doesn't get saved as the emulator.
  ipcMain.handle('bizhawk:locate', async (): Promise<LocateBizhawkResult> => {
    const win = BrowserWindow.getFocusedWindow()
    const exeName = bizhawkExeName()
    const ext = exeName.slice(exeName.lastIndexOf('.') + 1)
    const opts: Electron.OpenDialogOptions = {
      title: `Locate BizHawk (${exeName})`,
      properties: ['openFile'],
      filters: [{ name: 'EmuHawk', extensions: [ext] }]
    }
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false }
    const p = picked.filePaths[0]!
    if (basename(p).toLowerCase() !== exeName.toLowerCase()) {
      return { ok: false, error: `Select ${exeName} (got ${basename(p)}).` }
    }
    updateSettings({ bizhawkPath: p })
    return { ok: true, path: p }
  })
}
