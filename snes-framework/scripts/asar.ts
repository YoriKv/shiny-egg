// Wrapper around the asar assembler (asar.exe on Windows, asar on Linux/macOS).
// Surfaces non-zero exits as exceptions.

import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import type { RomVersion } from './rom-versions.ts';

// Platform binary name. We ship both upstream builds (snes-framework/asar.exe +
// snes-framework/asar, LGPL) and pick by platform — there is no WSL interop on a
// real Linux box / CI runner, so a .exe simply can't execute there.
export function asarBinName(): string {
  return process.platform === 'win32' ? 'asar.exe' : 'asar';
}

export interface RunAsarOptions {
  asarBin: string;
  args: string[];
  cwd: string;
}

export function runAsar({ asarBin, args, cwd }: RunAsarOptions): void {
  // Ensure the binary is executable on POSIX. The exec bit can be lost when the
  // template is copied from read-only AppImage resources into userData (fs.cp
  // doesn't always preserve it), or on a fresh clone where git didn't restore
  // it. This is the single chokepoint for every extract/build phase, so chmod
  // here rather than at each call site. No-op cost on Windows (skipped).
  if (process.platform !== 'win32') {
    try { chmodSync(asarBin, 0o755); } catch { /* best-effort */ }
  }
  // windowsHide passes CREATE_NO_WINDOW so the packaged (console-less GUI) main
  // process doesn't flash a fresh cmd window for every asar phase. With
  // stdio:'inherit' the child still inherits the parent's console handles when
  // one exists (dev terminal), so build output is preserved there.
  const result = spawnSync(asarBin, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`asar exited with status ${result.status}`);
  }
}

/**
 * Common --define and --include flags applied to every YI build phase.
 *
 * --include paths are kept relative to asar's cwd (workRoot/yi) so they match
 * the layout the framework was authored against. Callers must therefore set
 * cwd to <workRoot>/yi when invoking asar.
 *
 * Two include paths because asar resolves incbin paths relative to the file
 * containing the directive, then falls back to include paths:
 *   - ../assets/yi          for incbin "LevelData/x.bin" from Routine_Macros_YI.asm
 *   - ../assets/yi/SPC700   for incbin "Samples/x/y.brr" from SPC700/*.asm
 */
export function commonYIDefines(romID: RomVersion): string[] {
  return [
    '--define', 'MainFolder=yi',
    '--define', 'GameID=YI',
    '--define', `ROMID=${romID}`,
    '--include', '../assets/yi',
    '--include', '../assets/yi/SPC700',
  ];
}
