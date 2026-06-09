// Live level-data pool budget report. Each per-level obj/spr blob lives in a
// shared bank "pool" closed by a `%FREE_BYTES(boundary, fill)` whose
// `assert pc() <= boundary` is the build-time size gate. This prints, per pool,
// the boundary, where the base data ends, the capacity (Σ base blob sizes), the
// movable headroom (the `$FF` fill a boundary-move can absorb), and the
// effective growth limit.
//
//   node snes-framework/scripts/pool-report.ts
//
// Reuses the canonical pool model in pool-map.ts / level-budget.ts (boundaries,
// movable-headroom rules) rather than re-deriving them — this is just the
// reporting view that complements level-budget's per-level editor budget.
// Targets the built V1.0 ROM (engine-side, no native deps — works from WSL).

import * as path from 'node:path';
import { devCartPaths, FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import { loadLevelMapPublic } from './level.ts';
import { loadPoolMap } from './level-budget.ts';
import { poolLevels } from './pool-map.ts';
import { hexDollar as hex } from './hex.ts';

const romVersion = loadLevelMapPublic(FRAMEWORK_ROOT).romVersion;
const map = loadPoolMap({
  romVersion,
  symPath: devCartPaths(FRAMEWORK_ROOT).symPath,
  baseBinDir: path.join(FRAMEWORK_ROOT, 'assets', 'yi', 'LevelData')
});

if (!map) {
  console.error(
    `No pool map for ${romVersion} — missing build .sym, or no boundary table for this ROM version.\n` +
      `Run a V1.0 build first.`
  );
  process.exit(2);
}

console.log(`${map.pools.length} pools (${romVersion})\n`);
for (const pool of map.pools) {
  const baseEnd = Math.max(...pool.blobs.map((b) => b.snesAddr + b.baseBytes));
  const limit = pool.capacityBytes + pool.headroomBytes;
  const levels = poolLevels(pool);
  console.log(
    `${pool.id.padEnd(9)} boundary=${hex(pool.tail.boundary)} baseEnd=${hex(baseEnd)}  ` +
      `capacity=${pool.capacityBytes}  headroom=${pool.headroomBytes}${pool.tail.movable ? ' (movable)' : ' (fixed)'}  ` +
      `limit=${limit}  | ${pool.blobs.length} blobs, ${levels.length} levels`
  );
  console.log(`   levels: ${levels.map((l) => '0x' + l).join(' ')}`);
}
