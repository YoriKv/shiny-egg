// Wrapper around asar.exe. Surfaces non-zero exits as exceptions.

import { spawnSync } from 'node:child_process';
import type { RomVersion } from './rom-versions.ts';

export interface RunAsarOptions {
  asarBin: string;
  args: string[];
  cwd: string;
}

export function runAsar({ asarBin, args, cwd }: RunAsarOptions): void {
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
