// Validation for the shared-pool byte-budget model (pool-map.ts + level-budget.ts).
//
// Core invariant: the pristine V1.0 build sits EXACTLY at every pool's capacity
// (base data ends at each `%FREE_BYTES` boundary), so with all blobs at base
// size, `checkAllPools` returns ZERO violations and every obj/spr pool has
// `capacity == Σ(base blob sizes)`. Movable pools then tolerate growth up to
// their fill size (boundary move); a byte past that overruns the pool. This
// pins down membership, capacity, headroom, and the boundary-move rewrite.
//
// Run: node --experimental-strip-types snes-framework/scripts/pool-budget.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPoolMap, poolLevels } from './pool-map.ts';
import { checkAllPools, computeLevelBudget, computePoolOverview } from './level-budget.ts';
import { computeBoundaryMoves, rewriteFreeBytesText } from './boundary-move.ts';
import { outputSfcName } from './rom-versions.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseBinDir = path.join(frameworkRoot, 'assets', 'yi', 'LevelData');
const symPath = path.join(frameworkRoot, 'build', outputSfcName('YI_U1').replace(/\.sfc$/i, '.sym'));

if (!fs.existsSync(symPath) || !fs.existsSync(baseBinDir)) {
  console.error(`pool-budget.test: missing ${fs.existsSync(symPath) ? baseBinDir : symPath}. Extract + build first.`);
  process.exit(2);
}

const baseSizeOf = (file: string): number => {
  try {
    return fs.statSync(path.join(baseBinDir, file)).size;
  } catch {
    return 0;
  }
};

const map = buildPoolMap('YI_U1', fs.readFileSync(symPath, 'utf8'), baseSizeOf);

let failures = 0;
const check = (cond: boolean, msg: string): void => {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
};

// 1. Expected pool count (9 obj/spr pools + Bank51's name-string pool = 10).
check(map.pools.length === 10, `expected 10 pools, got ${map.pools.length}`);

// 2. capacity == Σ(base blob sizes) for every pool, by construction.
for (const p of map.pools) {
  const sum = p.blobs.reduce((n, b) => n + b.baseBytes, 0);
  check(p.capacityBytes === sum, `${p.id}: capacity ${p.capacityBytes} != Σbase ${sum}`);
}

// 3. Base build → zero violations (every pool exactly at capacity).
const baseViolations = checkAllPools(map, baseSizeOf);
check(
  baseViolations.length === 0,
  `base build should have 0 pool violations, got ${baseViolations.length}: ` +
    baseViolations.map((v) => `${v.poolId} +${v.overBy}`).join(', ')
);

// 4. Movable headroom: Bank4C is movable with a 329-byte fill. Growth up to the
//    fill is allowed (boundary move); a byte past it is a violation.
const bank4c = map.pools.find((p) => p.id === 'Bank4C')!;
check(bank4c.headroomBytes === 329, `Bank4C headroom should be 329, got ${bank4c.headroomBytes}`);
const probe = bank4c.blobs[0];
const bumpBy = (file: string, n: number): ((f: string) => number) => (f: string) =>
  baseSizeOf(f) + (f === file ? n : 0);

// +329 (= fill) → fits, no violation, and a boundary move of growth 329.
check(checkAllPools(map, bumpBy(probe.file, 329)).length === 0, 'Bank4C +329 should fit (no violation)');
const movesAtFill = computeBoundaryMoves(map, bumpBy(probe.file, 329));
check(movesAtFill.length === 1, `+329 should yield 1 boundary move, got ${movesAtFill.length}`);
check(
  movesAtFill[0]?.boundary === 0x4cfeb7 && movesAtFill[0]?.growth === 329,
  `move should be Bank4C boundary $4CFEB7 growth 329, got ${JSON.stringify(movesAtFill[0])}`
);

// +330 (> fill) → 1 violation over by 1, and NO move (overflow can't be absorbed).
const over = checkAllPools(map, bumpBy(probe.file, 330));
check(over.length === 1 && over[0]?.overBy === 1 && over[0]?.poolId === 'Bank4C', `+330 should over-run Bank4C by 1, got ${JSON.stringify(over)}`);
check(computeBoundaryMoves(map, bumpBy(probe.file, 330)).length === 0, '+330 should yield no boundary move (over headroom)');

// 5. computeLevelBudget for a Bank4C level: base → not over; +5 fits headroom; +334 over by 5.
const lvl = 0x01; // DATA_level_01_{obj,spr} in Bank4C
const files = { objFile: 'DATA_level_01_obj.bin', spriteFile: 'DATA_level_01_spr.bin' };
const baseObj = baseSizeOf(files.objFile);
const baseSpr = baseSizeOf(files.spriteFile);
const atBase = computeLevelBudget(map, lvl, files, { objBytes: baseObj, spriteBytes: baseSpr }, baseSizeOf);
check(!atBase.over && atBase.worstOverBy <= 0, `level 0x01 at base should not be over (worst=${atBase.worstOverBy})`);
check(atBase.pools.length === 1, `level 0x01 should touch 1 pool, got ${atBase.pools.length}`);
check(atBase.pools[0]?.otherLevels.length === 7, `Bank4C should list 7 other levels, got ${atBase.pools[0]?.otherLevels.length}`);

const within = computeLevelBudget(map, lvl, files, { objBytes: baseObj + 5, spriteBytes: baseSpr }, baseSizeOf);
check(!within.over, `level 0x01 +5 should fit the 329-byte headroom (over=${within.over})`);
const grown = computeLevelBudget(map, lvl, files, { objBytes: baseObj + 334, spriteBytes: baseSpr }, baseSizeOf);
check(grown.over && grown.worstOverBy === 5, `level 0x01 +334 should be over by 5 (got ${grown.worstOverBy})`);

// 5b. Boundary-move rewrite preserves the line + trailing comment.
const sample = '\t%FREE_BYTES($4CFEB7, 329, $FF)\t\t; V1.0: 329-byte $FF tail';
const rewritten = rewriteFreeBytesText(sample, {
  bankFile: 'Banks/Bank4C.asm', poolId: 'Bank4C', boundary: 0x4cfeb7, fillSize: 329, growth: 5,
});
check(rewritten.includes('%FREE_BYTES($4CFEBC, 324, $FF)'), `rewrite should move boundary+shrink fill, got: ${rewritten.trim()}`);
check(rewritten.includes('; V1.0:'), 'rewrite should preserve the trailing comment');

// 5c. Bank15 is non-movable (0 headroom): it can't grow in place — only redistribute
//     within the pool or migrate a level out (it's reclaimable; see relocate.test).
check(map.pools.filter((p) => p.bank === 0x15).every((p) => p.headroomBytes === 0), 'Bank15 pools should be non-movable');

// 6. Bank15 split: at least one level has its obj and spr in different pools.
const splitLevels = new Set<string>();
const bank15Pools = map.pools.filter((p) => p.bank === 0x15);
if (bank15Pools.length === 2) {
  const inA = new Set(bank15Pools[0].blobs.map((b) => b.level));
  const inB = new Set(bank15Pools[1].blobs.map((b) => b.level));
  for (const l of inA) if (inB.has(l)) splitLevels.add(l);
}
check(bank15Pools.length === 2, `Bank15 should have 2 pools, got ${bank15Pools.length}`);
check(splitLevels.size > 0, `expected ≥1 Bank15 level split across both pools, got ${splitLevels.size}`);

// 7. computePoolOverview (the "Banks" panel model): one entry per pool, and at
//    base every pool sits exactly at capacity → used == capacity, free ==
//    headroom. Per-pool the Σ level bytes equals usedBytes, and Bank4C lists its
//    8 levels (level 0x01 + the 7 others).
const overview = computePoolOverview(map, baseSizeOf);
check(overview.length === map.pools.length, `overview should have ${map.pools.length} pools, got ${overview.length}`);
for (const e of overview) {
  check(e.usedBytes === e.capacityBytes, `${e.poolId}: base used ${e.usedBytes} != capacity ${e.capacityBytes}`);
  check(e.freeBytes === e.headroomBytes, `${e.poolId}: base free ${e.freeBytes} != headroom ${e.headroomBytes}`);
  check(e.limitBytes === e.capacityBytes + e.headroomBytes, `${e.poolId}: limit != capacity + headroom`);
  const sum = e.levels.reduce((n, l) => n + l.bytes, 0);
  check(sum === e.usedBytes, `${e.poolId}: Σ level bytes ${sum} != usedBytes ${e.usedBytes}`);
}
const ovBank4c = overview.find((e) => e.poolId === 'Bank4C')!;
check(ovBank4c.levels.length === 8, `Bank4C overview should list 8 levels, got ${ovBank4c.levels.length}`);
check(ovBank4c.freeBytes === 329, `Bank4C overview base free should be 329 (headroom), got ${ovBank4c.freeBytes}`);
// Levels are sorted descending by byte size.
check(
  ovBank4c.levels.every((l, i, a) => i === 0 || a[i - 1].bytes >= l.bytes),
  'Bank4C overview levels should be sorted descending by bytes'
);

if (failures > 0) {
  console.error(`\npool-budget.test: ${failures} failure(s).`);
  process.exit(1);
}
console.log(
  `pool-budget.test: OK — ${map.pools.length} pools, ` +
    `${map.pools.reduce((n, p) => n + poolLevels(p).length, 0)} level-slots, ` +
    `${splitLevels.size} Bank15 split levels, base build exactly at capacity.`
);
