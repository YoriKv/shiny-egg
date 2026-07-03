// Managed BizHawk subprocess for the editor's render harness.
//
// Spawns EmuHawk once, kept alive across requests. The shared protocol engine
// (server / framing / queue / public methods) lives in
// emulator/supervisor-base.ts; this file provides only the BizHawk-specific
// bits: locating EmuHawk, the spawn command line, and the harness path. The wire
// protocol is implemented in bizhawk-harness/shinyegg.lua (see that file).
//
// Path policy: the user picks EmuHawk via the "Locate BizHawk" button (persisted
// in settings as `bizhawkPath`). In dev, `../bizhawk/EmuHawk.exe` next to the
// project root is used automatically if present (devBizhawkPath) — the mirror of
// the dev reference-cart convenience — so neither the button nor a per-user save
// is needed during development.

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { devBizhawkPath } from './framework-paths'
import { getSettings, updateSettings } from './settings'
import { EmulatorSupervisorBase, type EmulatorSpawnPlan } from './emulator/supervisor-base'

/**
 * Resolve the EmuHawk executable path: the saved location first (if it still
 * exists), then the dev-only `../bizhawk/EmuHawk.exe` fallback, else null when
 * BizHawk hasn't been located yet. The renderer reads this (via
 * `emulator:getState`) to decide whether to show Launch / Test Level or the
 * "Locate BizHawk" button.
 *
 * Self-healing: if a path was saved but the file is gone (BizHawk moved or
 * uninstalled), the stale path is forgotten here so the toolbar reverts to
 * "Locate BizHawk" and the user can re-point it — the "isn't found at the
 * stored location" half of the error recovery.
 */
export function resolveBizhawkExe(): string | null {
  const saved = getSettings().bizhawkPath
  if (saved) {
    if (existsSync(saved)) return saved
    updateSettings({ bizhawkPath: undefined }) // stale — forget so re-location is offered
  }
  return devBizhawkPath() // dev-only, existence-checked; null in packaged builds
}

// Harness Lua lives at the repo root in <repo>/bizhawk-harness/shinyegg.lua (kept
// out of snes-framework/ so that folder stays asm-only). In dev, __dirname after
// build is <repo>/out/main — walk up two. In packaged builds, it ships via
// electron-builder extraResources at <resourcesPath>/bizhawk-harness/shinyegg.lua.
function harnessLuaPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bizhawk-harness', 'shinyegg.lua')
  }
  return resolve(__dirname, '..', '..', 'bizhawk-harness', 'shinyegg.lua')
}

class BizHawkSupervisor extends EmulatorSupervisorBase {
  protected readonly label = 'BizHawk'

  protected resolveExe(): string | null {
    return resolveBizhawkExe()
  }

  protected forgetPathIfSaved(exe: string): void {
    // The "fails to launch" half of the recovery: forget the saved path IF it's
    // the exe we just tried to launch, so the toolbar reverts to "Locate
    // BizHawk". No-op when the dev fallback (not a saved path) was the one that
    // failed — there's nothing to clear.
    if (getSettings().bizhawkPath === exe) updateSettings({ bizhawkPath: undefined })
  }

  protected harnessScriptPath(): string {
    return harnessLuaPath()
  }

  protected buildSpawnPlan(exe: string, port: number, cart: string, harness: string): EmulatorSpawnPlan {
    // On Linux/macOS `exe` is BizHawk's EmuHawk.sh launcher (shebang script that
    // bootstraps the .NET runtime); direct spawn works as long as it's
    // executable, and these args are identical across platforms.
    return {
      args: [`--socket_ip=127.0.0.1`, `--socket_port=${port}`, `--lua=${harness}`, cart],
      cwd: join(exe, '..')
    }
  }
}

let supervisor: BizHawkSupervisor | null = null

export function getBizHawk(): BizHawkSupervisor {
  if (!supervisor) supervisor = new BizHawkSupervisor()
  return supervisor
}

export type { BizHawkSupervisor }
