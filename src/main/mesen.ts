// Managed Mesen subprocess for the editor's render harness — the cross-platform
// (incl. macOS) twin of the BizHawk backend. BizHawk has no macOS build, so
// Mesen is the way to run Launch / Test Level on a Mac.
//
// The shared protocol engine lives in emulator/supervisor-base.ts. This file
// supplies only Mesen's specifics: locating the binary, the launch command line,
// and how the harness learns the editor's TCP port. The wire protocol is
// identical to BizHawk's and is implemented in mesen-harness/shinyegg.lua.
//
// Two things differ from BizHawk at the process level:
//
//  1. Enabling the Lua socket. Mesen sandboxes io/os + network access by
//     default. Rather than mutate the user's settings.json, we set the two gate
//     flags IN MEMORY via Mesen's command-line config switches
//     (`--Debug.ScriptWindow.AllowIoOsAccess=true` etc.) and pass
//     `--doNotSaveSettings` so those forced values never persist to disk. The
//     user's Mesen config is left untouched.
//  2. Handing the harness our port. BizHawk's comm socket dials in via
//     `--socket_ip`/`--socket_port`; Mesen's LuaSocket connects out, so we pass
//     the port through the `SHINY_EGG_PORT` environment variable, which the
//     harness reads with `os.getenv` (os access is enabled by the switch above).

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { devMesenPath } from './framework-paths'
import { getSettings, updateSettings } from './settings'
import { EmulatorSupervisorBase, type EmulatorSpawnPlan } from './emulator/supervisor-base'

/**
 * Resolve the Mesen executable path: the saved location first (if it still
 * exists), then the dev-only `../mesen/<Mesen>` fallback, else null when Mesen
 * hasn't been located yet. The Mesen twin of resolveBizhawkExe — same
 * self-healing (a saved-but-gone path is forgotten so the toolbar reverts to
 * "Locate Mesen").
 *
 * `mesenPath` is stored already resolved to the spawnable binary (on macOS the
 * `.app` bundle's inner Mach-O — see mesenLaunchBinary at locate time), so this
 * mirrors the BizHawk logic exactly.
 */
export function resolveMesenExe(): string | null {
  const saved = getSettings().mesenPath
  if (saved) {
    if (existsSync(saved)) return saved
    updateSettings({ mesenPath: undefined }) // stale — forget so re-location is offered
  }
  return devMesenPath() // dev-only, existence-checked; null in packaged builds
}

// Harness Lua lives at the repo root in <repo>/mesen-harness/shinyegg.lua (the
// Mesen sibling of bizhawk-harness/). In dev, __dirname after build is
// <repo>/out/main — walk up two. In packaged builds it ships via
// electron-builder extraResources at <resourcesPath>/mesen-harness/shinyegg.lua.
function harnessLuaPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'mesen-harness', 'shinyegg.lua')
  }
  return resolve(__dirname, '..', '..', 'mesen-harness', 'shinyegg.lua')
}

class MesenSupervisor extends EmulatorSupervisorBase {
  protected readonly label = 'Mesen'

  protected resolveExe(): string | null {
    return resolveMesenExe()
  }

  protected forgetPathIfSaved(exe: string): void {
    if (getSettings().mesenPath === exe) updateSettings({ mesenPath: undefined })
  }

  protected harnessScriptPath(): string {
    return harnessLuaPath()
  }

  // Mesen is single-instance by a fixed global mutex: if another Mesen window is
  // already open, our launch forwards its command line to that instance and
  // exits 0 without ever loading our ROM/harness (so it never connects). The
  // config switch that would disable this (`Preferences.SingleInstance`) is
  // parsed too late — after the instance check — to help. So turn the otherwise
  // cryptic 30 s connect-timeout into an actionable message.
  protected earlyExitMessage(code: number | null): string {
    if (code === 0) {
      return (
        'Mesen exited immediately without connecting — usually another Mesen ' +
        'window is already open (a second launch forwards to it and quits). ' +
        'Close the other Mesen and try again.'
      )
    }
    return super.earlyExitMessage(code)
  }

  protected buildSpawnPlan(exe: string, port: number, cart: string, harness: string): EmulatorSpawnPlan {
    return {
      // Mesen loads any `.lua` on the command line into an auto-running script
      // window (AutoStartScriptOnLoad defaults true), so a normal windowed launch
      // boots the ROM AND runs our harness — no headless/testrunner needed (the
      // user plays the level in the window).
      args: [
        cart,
        harness,
        // Enable the Lua socket in memory only (see file header).
        '--doNotSaveSettings',
        '--Debug.ScriptWindow.AllowIoOsAccess=true',
        '--Debug.ScriptWindow.AllowNetworkAccess=true',
        // Skip the tutorial script the fresh Script window would otherwise load.
        '--Debug.ScriptWindow.ScriptStartupBehavior=ShowBlankWindow'
      ],
      cwd: dirname(exe),
      // The harness reads these to connect its LuaSocket client back to us.
      env: { SHINY_EGG_HOST: '127.0.0.1', SHINY_EGG_PORT: String(port) }
    }
  }
}

let supervisor: MesenSupervisor | null = null

export function getMesen(): MesenSupervisor {
  if (!supervisor) supervisor = new MesenSupervisor()
  return supervisor
}

export type { MesenSupervisor }
