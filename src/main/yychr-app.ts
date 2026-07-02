// Resolve the user's YY-CHR executable for the Graphics panel's "Locate YY-CHR"
// button + launch it on an exported sheet. Mirrors aseprite-app.ts / m1te-app.ts.
// YY-CHR.NET is a portable .NET Framework WinForms app (no installer, no standard
// install dir), so resolution is settings-only — no common-location probe. On
// non-Windows it runs through `wine` (like the bundled M1TE), which must be on PATH.
//
// YY-CHR's CLI (MainForm.cs:448): `yychr.exe <file>` opens the file at launch, and
// the extension auto-selects the graphics format — which is why the export names
// sheets `.4bpp.sfc` / `.2bpp.gb` / `.4bpp.gba` (see gfx-yychr.ts). One file per
// instance; there is no folder/session concept.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getSettings } from './settings'

/** The YY-CHR executable path, or null if not located (settings-only — portable app). */
export function resolveYychrExe(): string | null {
  const saved = getSettings().yychrPath
  return saved && existsSync(saved) ? saved : null
}

/** Launch YY-CHR on `filePath` (detached, so it outlives this process). Returns
 *  false when YY-CHR isn't located or the file is missing; a failed spawn (e.g.
 *  `wine` not installed) is swallowed via the async 'error' handler. */
export function openInYychr(filePath: string): boolean {
  const exe = resolveYychrExe()
  if (!exe || !existsSync(filePath)) return false
  const [cmd, args] = process.platform === 'win32' ? [exe, [filePath]] : ['wine', [exe, filePath]]
  try {
    const child = spawn(cmd, args, { cwd: join(exe, '..'), detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', (err) => console.error('openInYychr: spawn failed:', err.message)) // e.g. wine not on PATH
    child.unref()
    return true
  } catch (e) {
    console.error('openInYychr:', e instanceof Error ? e.message : String(e))
    return false
  }
}
