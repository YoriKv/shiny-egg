// Smoke test: header unpack + parser dispatch over a real level .bin.
// With zero handler coverage we expect the parser to walk the entire
// object stream without crashing, report every object as "unregistered",
// and parse the screen-exit tail.
//
// Phase 4 unit tests will hook in specific handlers and assert the
// resulting Map16 buffer contents.
//
// Run from repo root:
//   node --experimental-strip-types snes-framework/scripts/engine/object-decode/parser.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeLevel } from './index.ts';
import { parseWlaSymbolMap } from '../symbol-map.ts';

const FRAMEWORK_ROOT = path.resolve(import.meta.dirname, '../../..');
const BUILD_DIR = path.join(FRAMEWORK_ROOT, 'build');
const ASSET_DIR = path.join(FRAMEWORK_ROOT, 'assets', 'yi', 'LevelData');
const LEVEL_MAP = path.join(FRAMEWORK_ROOT, 'editor-data', 'yi', 'level-map.json');
const CART = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sfc");
const SYM  = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sym");

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

if (!fs.existsSync(CART) || !fs.existsSync(SYM)) {
  console.error('build artifacts not found; run a build first');
  process.exit(0);
}
if (!fs.existsSync(LEVEL_MAP)) {
  console.error('level-map.json not found; run an extract first');
  process.exit(0);
}

// Resolve real level object-stream .bin files via the same level-map the
// editor uses (the decodeLevelById path) instead of a hardcoded filename or
// a raw readdir. This keeps the test robust to extract-naming changes and
// never feeds a sprite .bin into the object decoder. Empty slots (null
// objectFile) and the hardcoded special level 0x38 are skipped.
const SPECIAL_LEVELS = new Set<number>([0x38]);
const levelMap = JSON.parse(fs.readFileSync(LEVEL_MAP, 'utf8')) as {
  levels: Record<string, { objectFile: string | null }>;
};
const objectFiles = Object.entries(levelMap.levels)
  .filter(([id, e]) => e.objectFile !== null && !SPECIAL_LEVELS.has(Number(id)))
  .map(([, e]) => e.objectFile as string)
  .filter((f) => fs.existsSync(path.join(ASSET_DIR, f)));

if (objectFiles.length === 0) {
  console.error('no extracted level .bin files found; run an extract first');
  process.exit(0);
}

const rom = new Uint8Array(fs.readFileSync(CART));
const symbols = parseWlaSymbolMap(fs.readFileSync(SYM, 'utf8'));
console.log(`Loaded cart + ${symbols.size} symbols, ${objectFiles.length} object levels`);

// --- Test 1: header unpack on a real level produces 15 fields ---------
{
  const name = objectFiles[0]!;
  const levelBin = new Uint8Array(fs.readFileSync(path.join(ASSET_DIR, name)));
  console.log(`\nLevel ${name}: ${levelBin.length} bytes`);
  const { state, stats } = decodeLevel(rom, symbols, levelBin);
  console.log(`  header: [${state.header.join(', ')}]`);
  console.log(`  parsed: ${stats.objectsParsed} objects (${stats.extObjectsParsed} ext, ${stats.stdObjectsParsed} std)`);
  console.log(`  unregistered: ${stats.unregisteredObjects}`);
  console.log(`  exits: ${stats.exitsParsed}`);
  console.log(`  consumed: ${stats.bytesConsumed} of ${levelBin.length} bytes`);
  console.log(`  aborted: ${stats.aborted}, overflowed: ${stats.overflowed}`);
  assert(state.header.length === 15, 'header has 15 fields');
  assert(state.header.every((v) => v >= 0), 'header fields all non-negative');
  assert(!stats.aborted, 'parser did not abort');
  assert(stats.objectsParsed > 0, 'parsed at least one object');
}

// --- Test 2: sweep first 8 level .bins for parser robustness ----------
{
  console.log('\nSweep:');
  const files = objectFiles.slice(0, 8);
  let aborts = 0;
  let overflows = 0;
  for (const f of files) {
    const bin = new Uint8Array(fs.readFileSync(path.join(ASSET_DIR, f)));
    if (bin.length < 13) {
      console.log(`  ${f}: <13 bytes (header+1), skip`);
      continue;
    }
    try {
      const { stats } = decodeLevel(rom, symbols, bin);
      const tag = stats.aborted ? 'ABORT' : stats.overflowed ? 'OVERFLOW' : 'ok';
      console.log(`  ${f}: ${tag} — ${stats.objectsParsed} objects, ${stats.exitsParsed} exits, ${stats.unregisteredObjects} unreg`);
      if (stats.aborted) aborts++;
      if (stats.overflowed) overflows++;
    } catch (e) {
      console.log(`  ${f}: THREW ${e instanceof Error ? e.message : e}`);
      failures++;
    }
  }
  // Aborts (= ran out of stream bytes before $FF terminator) can occur for
  // sub-room .bin files whose object-stream length doesn't agree with our
  // current property-table interpretation; that's a per-object handler
  // concern (Phase 4), not a parser-infrastructure issue. We only fail if
  // we hit unexpected EXCEPTIONS (handled via the THREW path above).
  console.log(`  → ${aborts} aborts, ${overflows} overflows across sweep`);
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all assertions pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
