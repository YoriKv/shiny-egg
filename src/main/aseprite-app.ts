// Resolve the user's Aseprite executable for the Graphics panel's "Locate
// Aseprite" button. Mirrors `resolveBizhawkExe` (bizhawk.ts): the saved settings
// path if it still exists, else a common install location (existence-checked),
// else null (the panel shows "Locate Aseprite"). The path is used to PROBE the
// Aseprite version (`asepriteInfo`), which gates the tilemap export (needs
// Aseprite 1.3+).

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getSettings } from './settings'
import type { AsepriteInfo } from '../shared/ipc-types'

const execFileP = promisify(execFile)

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

/** Probe `<exe> --version` → a dotted version string, or null if the call fails or
 *  the output can't be parsed. `--version` prints e.g. `Aseprite 1.3.17` and exits
 *  without opening the GUI. */
async function probeAsepriteVersion(exe: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP(exe, ['--version'], { timeout: 5000, windowsHide: true })
    const m = stdout.match(/(\d+)\.(\d+)\.(\d+)/)
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null
  } catch {
    return null // not runnable / timed out — caller treats unknown as capable
  }
}

/** version ≥ 1.3 (tilemaps). A null version (probe failed) ⇒ true: don't block a
 *  working install over a flaky `--version`; only a POSITIVE pre-1.3 read gates. */
function versionSupportsTilemap(version: string | null): boolean {
  if (!version) return true
  const [major = 0, minor = 0] = version.split('.').map((n) => parseInt(n, 10))
  return major > 1 || (major === 1 && minor >= 3)
}

// Probing spawns a subprocess, so cache the result per resolved exe path — the panel
// re-asks on every mount. Relocating to a different exe re-probes (path changes).
let cachedInfo: AsepriteInfo | null = null

/** The located Aseprite + its probed version, or null if not located. Caches by
 *  path so we spawn `--version` at most once per exe. */
export async function asepriteInfo(): Promise<AsepriteInfo | null> {
  const exe = resolveAsepriteExe()
  if (!exe) { cachedInfo = null; return null }
  if (cachedInfo?.path === exe) return cachedInfo
  const version = await probeAsepriteVersion(exe)
  cachedInfo = { path: exe, version, supportsTilemap: versionSupportsTilemap(version) }
  return cachedInfo
}

