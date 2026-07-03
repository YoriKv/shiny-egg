// IPC handlers for the emulator backends (BizHawk / Mesen). The supervisors live
// in ../bizhawk.ts + ../mesen.ts behind the shared base + the ../emulator/registry
// selector; this module wraps each control method as an `ipcMain.handle` against
// the ACTIVE backend, and adds the selection/locate channels the toolbar uses.
//
// The control channels keep their historical `bizhawk:*` names (they now mean
// "the selected emulator" — renaming them would churn every renderer caller for
// no behavioral gain); the emulator switcher uses the newer `emulator:*` names.

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import {
  getEmulator,
  getEmulatorState,
  setEmulatorKind,
  stopAllEmulators
} from '../emulator/registry'
import { bizhawkExeName, mesenLaunchBinary, screenshotPath } from '../framework-paths'
import { updateSettings } from '../settings'
import type {
  BizhawkWarp,
  CaptureAtResult,
  EmulatorKind,
  EmulatorState,
  LocateEmulatorResult,
  TestInventory
} from '../../shared/ipc-types'

export function registerEmulatorIpc(): void {
  ipcMain.handle('bizhawk:ping', async (): Promise<string> => getEmulator().ping())

  ipcMain.handle('bizhawk:info', async (): Promise<string> => getEmulator().info())

  ipcMain.handle('bizhawk:dumpVram', async (): Promise<Uint8Array> => {
    const buf = await getEmulator().dumpVram()
    return new Uint8Array(buf)
  })

  ipcMain.handle('bizhawk:dumpCgram', async (): Promise<Uint8Array> => {
    const buf = await getEmulator().dumpCgram()
    return new Uint8Array(buf)
  })

  ipcMain.handle(
    'bizhawk:loadLevel',
    async (
      _e,
      translevelId: number,
      warps?: ReadonlyArray<BizhawkWarp>,
      inventory?: TestInventory
    ): Promise<string> => {
      return getEmulator().loadLevel(translevelId, warps, inventory)
    }
  )

  ipcMain.handle(
    'bizhawk:readMem',
    async (_e, domain: string, addr: number, len: number): Promise<Uint8Array> => {
      const buf = await getEmulator().readMem(domain, addr, len)
      return new Uint8Array(buf)
    }
  )

  // Generic memory-write pathway (the write twin of readMem). `bizhawk:applyPaletteLive`
  // (registered in ipc/render.ts, where the level/provenance plumbing lives) is the
  // first consumer.
  ipcMain.handle(
    'bizhawk:writeMem',
    async (_e, domain: string, addr: number, bytes: Uint8Array): Promise<string> => {
      return getEmulator().writeMem(domain, addr, bytes)
    }
  )

  // Whether the selected emulator is running + connected. Lets live-edit pushes
  // no-op (without booting) when there's nothing to push to.
  ipcMain.handle('bizhawk:isRunning', async (): Promise<boolean> => getEmulator().isRunning())

  ipcMain.handle(
    'bizhawk:captureAt',
    async (_e, x: number, y: number): Promise<CaptureAtResult> => {
      const path = screenshotPath()
      await mkdir(dirname(path), { recursive: true })
      const reply = await getEmulator().captureAt(x, y, path)
      const buf = await readFile(path)
      return { png: new Uint8Array(buf), message: reply }
    }
  )

  // Stop BOTH backends — the user may have switched selection while one was
  // running, and "Stop" should stop whatever is actually up.
  ipcMain.handle('bizhawk:stop', async (): Promise<void> => {
    stopAllEmulators()
  })

  ipcMain.handle('bizhawk:launch', async (): Promise<void> => {
    await getEmulator().ensureRunning()
  })

  // ── Emulator selection / locate ────────────────────────────────────────────

  // The toolbar's source of truth: which backend is selected + each backend's
  // located status (so it can show two side-by-side Locate buttons, then Launch /
  // Test Level once the selected one is located).
  ipcMain.handle('emulator:getState', async (): Promise<EmulatorState> => getEmulatorState())

  // Switch the selected backend (the right-click menu). Persisted; returns the
  // fresh state.
  ipcMain.handle('emulator:setKind', async (_e, kind: EmulatorKind): Promise<EmulatorState> =>
    setEmulatorKind(kind)
  )

  // "Locate BizHawk" / "Locate Mesen": pick the executable, persist it, and
  // select that backend (locating one selects it). BizHawk validates the exact
  // launcher name; Mesen is lenient (its binary name varies: Mesen.exe / Mesen /
  // the Mesen.app bundle on macOS, whose inner Mach-O we resolve + store).
  ipcMain.handle(
    'emulator:locate',
    async (_e, kind: EmulatorKind): Promise<LocateEmulatorResult> => {
      const win = BrowserWindow.getFocusedWindow()
      if (kind === 'bizhawk') {
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
        updateSettings({ bizhawkPath: p, emulator: 'bizhawk' })
        return { ok: true, path: p }
      }

      // Mesen.
      const opts: Electron.OpenDialogOptions = {
        title: 'Locate Mesen',
        properties: ['openFile']
      }
      const picked = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false }
      // On macOS the user picks `Mesen.app` (a package selectable as a file); we
      // spawn its inner Mach-O. Elsewhere the picked path IS the binary.
      const bin = mesenLaunchBinary(picked.filePaths[0]!)
      if (!existsSync(bin)) {
        return { ok: false, error: `Mesen binary not found at ${bin}` }
      }
      updateSettings({ mesenPath: bin, emulator: 'mesen' })
      return { ok: true, path: bin }
    }
  )
}
