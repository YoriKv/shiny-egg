// snes-framework/scripts/cli.ts
//
// Dispatcher for the code-search analysis tools (xref / closure). Wired up
// to root pnpm scripts so `pnpm xref` / `pnpm closure` Just Work from the
// shiny-egg repo root.
//
// `workRoot` is derived from this script's own filesystem location (the
// directory containing `scripts/`) rather than `process.cwd()` so the
// commands work regardless of where the user invoked them from.
//
// Usage:
//   pnpm xref -- <label>                   show callers/callees/reads/writes
//   pnpm xref -- --search <regex>          list labels matching a regex
//   pnpm xref -- --readers !RAM_NAME       routines that read a define
//   pnpm xref -- --writers !RAM_NAME       routines that write it
//   pnpm xref -- --stats                   graph summary
//   pnpm closure -- <label> [--depth N]    routine + transitive callees
//   pnpm level-lookup -- <value> [--rec|--tl]        record <-> translevel id conversion
//   pnpm level-lookup -- --list                      dump the translevel<->record table

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRom } from './build.ts';
import { outputSfcName } from './rom-versions.ts';
import { readExtractionState } from './state.ts';
import { runLevelLookupCli } from './level-id.ts';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const workRoot = path.resolve(SCRIPT_DIR, '..'); // snes-framework/
const asarBin = path.join(workRoot, 'asar.exe');

const cmd = process.argv[2];

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function usage(): never {
  console.error('Usage:');
  console.error('  pnpm xref -- <label>                  # callers/callees/reads/writes for one label');
  console.error('  pnpm xref -- --search <regex>         # list labels matching a regex');
  console.error('  pnpm xref -- --readers !RAM_NAME      # routines that read a define');
  console.error('  pnpm xref -- --writers !RAM_NAME      # routines that write it');
  console.error('  pnpm xref -- --rmw !RAM_NAME          # read-modify-write sites');
  console.error('  pnpm xref -- --addr 00:8000           # all labels at one SNES address');
  console.error('  pnpm xref -- --stats                  # graph summary');
  console.error('  pnpm closure -- <label> [--depth N]   # routine + transitive callees');
  console.error('  pnpm level-lookup -- <value> [--rec|--tl]       # record <-> translevel id conversion');
  console.error('  pnpm level-lookup -- --list                     # dump the translevel<->record table');
  process.exit(1);
}

async function main(): Promise<void> {
  // `level-lookup` only needs editor-data/yi/level-map.json (no asar/build/.sym),
  // so dispatch it before the heavier xref/closure prerequisites below.
  if (cmd === 'level-lookup') {
    runLevelLookupCli(workRoot, process.argv.slice(3));
    return;
  }
  if (cmd !== 'xref' && cmd !== 'closure') usage();
  if (!fs.existsSync(asarBin)) fail(`asar.exe not found at ${asarBin}`);

  const state = readExtractionState(workRoot);
  if (!state) fail('no .extraction-state.json — run the editor extract step first');

  const stem = outputSfcName(state.romVersion).replace(/\.sfc$/, '');
  const symPath = path.join(workRoot, 'build', `${stem}.sym`);
  const superfxSymPath = path.join(workRoot, 'build', `${stem}-superfx.sym`);

  // shiny-egg's build always emits both .sym files alongside the .sfc; this
  // block is only here for the first-run case where the user hasn't built
  // yet. The build phase rewrites both .sym files every time, so codegraph's
  // MD5-keyed cache invalidates automatically when the asm/labels change.
  if (!fs.existsSync(symPath) || !fs.existsSync(superfxSymPath)) {
    const missing = !fs.existsSync(symPath) ? symPath : superfxSymPath;
    console.error(`▶ no .sym at ${missing}; running a build to emit symbols`);
    const built = buildRom({
      workRoot, asarBin,
      onProgress: (m) => console.error(m),
    });
    if (!fs.existsSync(built.symbolsPath) || !fs.existsSync(built.superfxSymbolsPath)) {
      fail('build did not emit the expected .sym files');
    }
  }

  // codegraph defaults `workRoot` to `process.cwd()` and scans `yi/` +
  // `global/` relative to it for .asm files. Chdir into the framework so
  // the defaults resolve correctly when pnpm invokes us from the repo root.
  // Stash the original invocation dir first so the target script can resolve
  // user-supplied output paths (e.g. closure's `--out`) against where the
  // user actually ran us, not the framework workRoot we chdir into here.
  process.env.SHINY_EGG_INVOCATION_CWD = process.cwd();
  process.chdir(workRoot);

  // Forward to the target script with argv shape `[node, script, symPath, ...rest]`.
  const rest = process.argv.slice(3);
  process.argv = [process.argv[0]!, process.argv[1]!, symPath, ...rest];
  if (cmd === 'xref') await import('./xref.ts');
  else await import('./closure.ts');
}

await main();
