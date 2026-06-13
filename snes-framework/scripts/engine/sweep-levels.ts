// Decode every backed level's object stream through the full decoder and report
// aborts / overflows / parse failures. The "did my object-decode change break
// any level?" health check — run it after editing anything under
// engine/object-decode/ (handlers, parser, templates, header).
//
//   node snes-framework/scripts/engine/sweep-levels.ts            # problems only
//   node snes-framework/scripts/engine/sweep-levels.ts --verbose  # every level
//
// Exit code is 1 if any level aborted / overflowed / threw, 0 if all clean — so
// it doubles as a pre-commit gate. Runs against the built V1.0 ROM (engine-side,
// no native deps — works from WSL). Complements render-snapshot's per-output
// hashing: this surfaces *parse* health across the whole catalog at once.

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevelMapPublic } from '../level.ts';
import { decodeLevelById } from './object-decode/index.ts';
import { hex0x } from '../hex.ts';

const verbose = process.argv.includes('--verbose');

const { rom, symbols } = loadDevCart();
const map = loadLevelMapPublic(FRAMEWORK_ROOT);

const ids = Object.entries(map.levels)
  .filter(([, e]) => e.objectFile)
  .map(([k]) => Number(k)) // level-map keys are hex strings ("0x32"); Number() parses them
  .filter((id) => Number.isFinite(id))
  .sort((a, b) => a - b);

const hex = (n: number) => hex0x(n, 2);

let aborts = 0;
let overflows = 0;
let threw = 0;
let decoded = 0;

// Records whose object decode is KNOWN-partial in the cart itself: 0x38 (the
// gm38 intro-cutscene backdrop, played by map slot 0x0A) aborts mid-stream
// under the mirrored gm0C stamping rules — the shipping cart is like that and
// the cutscene engine draws over it in-game. Reported as info, not a problem.
const KNOWN_PARTIAL = new Set<number>([0x38]);

for (const id of ids) {
  let result;
  try {
    result = decodeLevelById({ rom, symbols, workRoot: FRAMEWORK_ROOT, levelRecordId: id });
  } catch (e) {
    console.log(`  ${hex(id)} ${map.levels[hex(id)]?.objectFile ?? ''}: THREW ${e instanceof Error ? e.message : e}`);
    threw++;
    continue;
  }
  if (!result) continue; // empty / special slot
  decoded++;
  const { stats, source } = result;
  const partial = stats.aborted || stats.overflowed;
  if (partial && KNOWN_PARTIAL.has(id)) {
    console.log(
      `  ${hex(id)} ${source.objectFile}: known-partial (cart ships it this way) — ` +
        `${stats.objectsParsed} obj, ${stats.bytesConsumed} bytes`
    );
  } else if (partial) {
    if (stats.aborted) aborts++;
    if (stats.overflowed) overflows++;
    console.log(
      `  ${hex(id)} ${source.objectFile}: ${stats.aborted ? 'ABORT ' : ''}${stats.overflowed ? 'OVERFLOW ' : ''}` +
        `— ${stats.objectsParsed} obj (std ${stats.stdObjectsParsed} / ext ${stats.extObjectsParsed}), ` +
        `${stats.unregisteredObjects} unreg, ${stats.exitsParsed} exits, ${stats.bytesConsumed} bytes`
    );
  } else if (verbose) {
    console.log(
      `  ${hex(id)} ${source.objectFile}: OK — ${stats.objectsParsed} obj (std ${stats.stdObjectsParsed} / ext ${stats.extObjectsParsed}), ` +
        `${stats.unregisteredObjects} unreg, ${stats.exitsParsed} exits`
    );
  }
}

const problems = aborts + overflows + threw;
console.log(
  `\nSwept ${decoded} levels → ${aborts} aborts, ${overflows} overflows, ${threw} threw` +
    (problems === 0 ? '  ✓ all clean' : '')
);
process.exit(problems === 0 ? 0 : 1);
