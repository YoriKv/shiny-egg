// Build a YI ROM by orchestrating asar through the framework's multi-phase
// assembly. Assets are looked up via --include ../assets/yi relative to
// asar's cwd (workRoot/yi). Run extractAssets() first to populate them.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { commonYIDefines, runAsar } from './asar.ts';
import { ROM_VERSIONS, outputSfcName } from './rom-versions.ts';
import { readExtractionState } from './state.ts';
import type { BuildResult } from './types.ts';
export type { BuildResult } from './types.ts';

const ASSEMBLE_FILE = '../global/AssembleFile.asm';

const SAMPLE_BANKS = [
  'AthleticSampleBank',
  'EndingSampleBank',
  'CaveFortBossSampleBank',
  'BonusCastleBossGrasslandSampleBank',
  'BowserSampleBank',
  'IntroMapCastleFortSampleBank',
  'GlobalSampleBank',
];

const INTERMEDIATE_BINS = [
  'SuperFX/SuperFXCode_YI.bin',
  'SPC700/SPC700_Engine_YI.bin',
  ...SAMPLE_BANKS.map((b) => `SPC700/${b}.bin`),
];

export interface BuildOptions {
  /** Writable framework root — must contain yi/, global/, asar.exe. */
  workRoot: string;
  /** Absolute path to asar.exe (typically workRoot/asar.exe). */
  asarBin: string;
  /** Optional per-project overlay root (mirrors workRoot). Its `assets/yi`
   *  include paths are prepended so asar finds project-edited .bin files before
   *  the pristine base copies (data-only fast path; asm edits need step 3). */
  overlayRoot?: string;
  /** Where to write the built `.sfc` + `.sym`. Defaults to `workRoot/build`.
   *  The build-tree merge passes a separate dir so the materialized tree's
   *  output lands where render/BizHawk read it. */
  outputDir?: string;
  /** Extra asar args (flat `--define NAME=VALUE` pairs) passed to every phase.
   *  Used to inject engine-label addresses (resolved from the build symbols) so
   *  post-assembly asm patches can reference `!CODE_xxxxxx` even though that
   *  phase has no labels in scope. See src/main/patches.ts asmSymbolDefines. */
  extraDefines?: string[];
  onProgress?: (msg: string) => void;
}

export function buildRom(opts: BuildOptions): BuildResult {
  const { workRoot, asarBin, onProgress } = opts;
  const state = readExtractionState(workRoot);
  if (!state) {
    throw new Error('No extracted assets found. Run extractAssets first.');
  }
  const romVersion = state.romVersion;
  const yiCwd = path.join(workRoot, 'yi');
  const outputName = outputSfcName(romVersion);
  const symName = outputName.replace(/\.sfc$/, '.sym');
  const superfxSymName = outputName.replace(/\.sfc$/, '-superfx.sym');
  const finalDir = opts.outputDir ?? path.join(workRoot, 'build');

  // ── Atomic build ────────────────────────────────────────────────────────
  // asar assembles the ROM *in place* across 6 passes (and would delete the
  // previous good ROM up front), so a mid-build failure used to leave a 2 MB
  // header-only skeleton + a stale `.sym` — which the editor's render path reads
  // for graphics, poisoning lz2/lz16 decode (see notes-level-size-overflow.md).
  // Instead, assemble everything into a temp subdir of the output dir (same
  // filesystem → atomic `rename`), then promote the three artifacts only after
  // every phase succeeds. A failed/aborted build leaves the last-good ROM + syms
  // untouched, so render + BizHawk keep working.
  fs.mkdirSync(finalDir, { recursive: true });
  const tmpDir = path.join(finalDir, '.build-tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const outputAbs = path.join(tmpDir, outputName);
  const outputRel = path.relative(yiCwd, outputAbs);
  const superfxSymAbs = path.join(tmpDir, superfxSymName);
  const superfxSymRel = path.relative(yiCwd, superfxSymAbs);
  const symbolsAbs = path.join(tmpDir, symName);

  try {
    // Prepend the project overlay's include paths so asar's include search finds
    // project-edited .bin files before the base copies (first match wins). Data-
    // only fast path; asm edits will need the full build-tree merge (plan step 3).
    const overlayIncludes: string[] = [];
    if (opts.overlayRoot) {
      const overlayAssets = path.join(opts.overlayRoot, 'assets', 'yi');
      overlayIncludes.push(
        '--include', path.relative(yiCwd, path.join(overlayAssets, 'SPC700')),
        '--include', path.relative(yiCwd, overlayAssets)
      );
    }
    const defines = [...overlayIncludes, ...commonYIDefines(romVersion), ...(opts.extraDefines ?? [])];
    // 4 startup phases + N sample banks + main + patches + finalize + cleanup.
    // We skip the framework's phase-6 firmware-filename step entirely because
    // YI uses the SuperFX (bare silicon, no microcode blob) — the upstream
    // hook would always resolve to "NULL" anyway.
    const totalSteps = 4 + SAMPLE_BANKS.length + 4;
    let step = 0;
    const log = (label: string): void => onProgress?.(`[${++step}/${totalSteps}] ${label}`);
    const asarCall = (args: string[]): void => runAsar({ asarBin, args, cwd: yiCwd });

    // Phase 0: initialize ROM (header, vectors, ROM map skeleton)
    log('Initialize ROM');
    asarCall(['--fix-checksum=on', ...defines, '--define', 'FileType=0', ASSEMBLE_FILE, outputRel]);

    // Phase 5: SuperFX code → SuperFX/SuperFXCode_YI.bin
    // Emit a sidecar `-superfx.sym` alongside the .sfc so codegraph picks up
    // SuperFX-side labels (FXCODE_*, lz16_decompress, etc.) — otherwise the
    // call graph synthesises them from CODE_AABBCC templates and drifts when
    // patches shift bytes.
    log('Assemble SuperFX code');
    asarCall([
      '--no-title-check', ...defines,
      '--symbols=wla', `--symbols-path=${superfxSymRel}`,
      '--define', 'FileType=5',
      '--define', 'PathToFile=SuperFX/SuperFXCode_YI.asm',
      ASSEMBLE_FILE, 'SuperFX/SuperFXCode_YI.bin',
    ]);

    // Phase 4: SPC700 engine
    log('Assemble SPC700 engine');
    asarCall([
      '--no-title-check', ...defines,
      '--define', 'FileType=4',
      '--define', 'PathToFile=SPC700/SPC700_Engine_YI.asm',
      ASSEMBLE_FILE, 'SPC700/SPC700_Engine_YI.bin',
    ]);

    // Phase 4: 7 sample banks
    for (const bank of SAMPLE_BANKS) {
      log(`Assemble SPC700 ${bank}`);
      asarCall([
        '--no-title-check', ...defines,
        '--define', 'FileType=4',
        '--define', `PathToFile=SPC700/${bank}.asm`,
        ASSEMBLE_FILE, `SPC700/${bank}.bin`,
      ]);
    }

    // Phase 1: main SNES code (uses the SuperFX/SPC700 .bins via incbin).
    // --symbols=wla emits a `<rom>.sym` file alongside the ROM so the editor
    // can resolve table addresses (scene_palette_layout, bg1_palette_ptrs,
    // etc.) by label name. Survives asm patches that shift cart layout —
    // see snes-framework/scripts/engine/symbol-map.ts for the consumer.
    log('Assemble main SNES');
    asarCall([
      ...defines,
      '--define', 'FileType=1',
      '--symbols=wla',
      ASSEMBLE_FILE, outputRel,
    ]);

    // Phase 2: patches / late hooks
    log('Apply patches');
    asarCall([...defines, '--define', 'FileType=2', ASSEMBLE_FILE, outputRel]);

    // Phase 3: finalize (header writeback, no checksum fix)
    log('Finalize ROM');
    asarCall(['--fix-checksum=off', ...defines, '--define', 'FileType=3', ASSEMBLE_FILE, outputRel]);

    // Cleanup intermediates
    log('Cleanup intermediate .bin files');
    for (const f of INTERMEDIATE_BINS) {
      const p = path.join(yiCwd, f);
      if (fs.existsSync(p)) fs.rmSync(p);
    }

    // Promote: atomically replace the previous artifacts now that every phase
    // succeeded. `rename` within one filesystem is atomic and (on both POSIX and
    // Windows) replaces the destination, so the good ROM is only ever swapped for
    // a complete one. Node is single-threaded, so render/IPC can't interleave
    // between the three renames. ROM last — its syms are in place first.
    const finalSfc = path.join(finalDir, outputName);
    const finalSym = path.join(finalDir, symName);
    const finalSuperfxSym = path.join(finalDir, superfxSymName);
    if (fs.existsSync(symbolsAbs)) fs.renameSync(symbolsAbs, finalSym);
    if (fs.existsSync(superfxSymAbs)) fs.renameSync(superfxSymAbs, finalSuperfxSym);
    fs.renameSync(outputAbs, finalSfc);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    return {
      outputPath: finalSfc,
      romLabel: ROM_VERSIONS[romVersion].label,
      romVersion,
      symbolsPath: finalSym,
      superfxSymbolsPath: finalSuperfxSym,
    };
  } catch (err) {
    // Failed/aborted build → discard the temp tree; the previous good ROM stays.
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
}
