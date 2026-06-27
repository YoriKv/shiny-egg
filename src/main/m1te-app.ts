// Launch the bundled M1TE editor (our fork of nesdoug/M1TE2) on an exported `.M1`
// graphics session — the "auto-open after export" for the BG2/BG3 M1TE2 export.
// M1TE is a Windows .NET executable shipped read-only under resources/snes-framework/
// on BOTH platforms (electron-builder shared extraResources): run natively on Windows,
// or through `wine` on Linux/macOS. Mirrors aseprite-app.ts's `openInAseprite`.
//
// M1TE's CLI (Program.cs): `M1TE.exe <path.M1> -bg <view>` — the first non-flag arg is
// the session to open; `-bg 2` / `-bg 3` open straight to that BG layer's view.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { frameworkSourceRoot } from './framework-paths'

/** The bundled M1TE.exe — a read-only resource (NOT the writable work root: M1TE is
 *  only launched, never edited or chmod'd the way asar is). */
export function m1teExePath(): string {
  return join(frameworkSourceRoot(), 'M1TE.exe')
}

/**
 * Launch M1TE on `m1Path`, opened straight to BG layer `bg` (2 or 3) when given.
 * Detached + unref'd so it outlives the editor. On non-Windows the .exe runs under
 * `wine` (which must be on PATH; it translates the Unix path argument). Returns false
 * when the exe or file is missing; a failed spawn (e.g. `wine` not installed) is
 * swallowed via the async 'error' handler so it never crashes the main process.
 */
export function openInM1te(m1Path: string, bg?: 1 | 2 | 3): boolean {
  const exe = m1teExePath()
  if (!existsSync(exe) || !existsSync(m1Path)) return false
  const m1teArgs = [m1Path, ...(bg ? ['-bg', String(bg)] : [])]
  // Windows: run the .exe directly. Elsewhere: through Wine.
  const [cmd, args] = process.platform === 'win32' ? [exe, m1teArgs] : ['wine', [exe, ...m1teArgs]]
  try {
    const child = spawn(cmd, args, { cwd: join(exe, '..'), detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', (err) => console.error('openInM1te: spawn failed:', err.message)) // e.g. wine not on PATH
    child.unref()
    return true
  } catch (e) {
    console.error('openInM1te:', e instanceof Error ? e.message : String(e))
    return false
  }
}
