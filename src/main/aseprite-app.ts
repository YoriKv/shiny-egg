// Resolve the user's Aseprite executable for the Graphics panel's "Locate
// Aseprite" button. Mirrors `resolveBizhawkExe` (bizhawk.ts): the saved settings
// path if it still exists, else a common install location (existence-checked),
// else null (the panel shows "Locate Aseprite"). The path is used to open the
// `.aseprite` projects the BG-region exporter writes.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getSettings } from './settings'

/** Common Aseprite install locations per platform (existence-checked). */
function defaultAsepritePaths(): string[] {
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    return [
      join(pf, 'Aseprite', 'Aseprite.exe'),
      join(pf86, 'Aseprite', 'Aseprite.exe'),
      join(pf86, 'Steam', 'steamapps', 'common', 'Aseprite', 'Aseprite.exe')
    ]
  }
  if (process.platform === 'darwin') return ['/Applications/Aseprite.app/Contents/MacOS/aseprite']
  return ['/usr/bin/aseprite', '/usr/local/bin/aseprite']
}

/** The Aseprite executable path, or null if not located. */
export function resolveAsepriteExe(): string | null {
  const saved = getSettings().asepritePath
  if (saved && existsSync(saved)) return saved
  for (const p of defaultAsepritePaths()) if (existsSync(p)) return p
  return null
}

/** Launch Aseprite with `filePath` (detached, so it outlives this process).
 *  No-op returning false if Aseprite isn't located or the file is missing. */
export function openInAseprite(filePath: string): boolean {
  const exe = resolveAsepriteExe()
  if (!exe || !existsSync(filePath)) return false
  try {
    // Detached + unref so Aseprite keeps running after the editor closes.
    spawn(exe, [filePath], { cwd: join(exe, '..'), detached: true, stdio: 'ignore', windowsHide: false }).unref()
    return true
  } catch {
    return false
  }
}
