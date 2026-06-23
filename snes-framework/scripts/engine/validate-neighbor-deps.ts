// Validation harness for the sprite neighbour-dependency error checker.
//
// Shipped levels are correct by construction, so the editor's resolver must
// report ZERO false `missing` over them: every placed sprite whose metadata
// carries a neighbour-dependency must resolve as `met` against the real level
// data. Any `missing` here is a bug in the checker, the metadata, or a too-
// strict spatial rule — not a real designer mistake — and must be fixed before
// the always-on error indicator can be trusted.
//
//   node snes-framework/scripts/engine/validate-neighbor-deps.ts          # summary
//   node snes-framework/scripts/engine/validate-neighbor-deps.ts --verbose
//
// Exits 1 on any false error (so it doubles as a regression gate, like
// sweep-levels). Engine-side, no native deps — runs from WSL against the built
// V1.0 ROM. Reuses the exact resolver the editor overlay uses
// (src/renderer/src/lib/sprite-neighbor-deps.ts) so the two judge identically.

import fs from 'node:fs';
import path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, loadLevelMapPublic } from '../level.ts';
import { decodeLevelById } from './object-decode/index.ts';
import { resolveCellGrid, GRID_COLS, GRID_ROWS } from './cell-grid.ts';
import { loadCollisionTable } from './collision.ts';
import { resolveDep } from '../../../src/renderer/src/lib/sprite-neighbor-deps.ts';
import { hex0x } from '../hex.ts';
import type { NeighborContext, PlacedSprite } from '../../../src/renderer/src/lib/sprite-neighbor-deps.ts';
import type { SpriteNeighborDep } from '../../../src/renderer/src/data/obj-metadata.ts';

const VERBOSE = process.argv.includes('--verbose');
const METADATA = path.join(FRAMEWORK_ROOT, '../src/renderer/src/data/obj-metadata.json');

const meta = JSON.parse(fs.readFileSync(METADATA, 'utf8'));
function spriteKey(num: number): string {
  return hex0x(num, 3);
}
function depsFor(num: number): SpriteNeighborDep[] {
  return meta.sprites[spriteKey(num)]?.neighborDeps ?? [];
}
function spriteName(num: number): string {
  return meta.sprites[spriteKey(num)]?.name ?? '?';
}
const hex = (n: number, w = 2) => hex0x(n, w);

const { rom, symbols } = loadDevCart();
// Class-F (pipe-spawner) matches a cell's page collision secondary-tag; build
// the page→tag lookup once from the static cart collision table.
const collisionTable = loadCollisionTable(rom, symbols);
const collisionTagOfPage = (page: number): number | undefined => collisionTable[page]?.tag;
const map = loadLevelMapPublic(FRAMEWORK_ROOT);
const ids = Object.entries(map.levels)
  .filter(([, e]) => (e as { objectFile?: string }).objectFile)
  .map(([k]) => Number(k))
  .filter((id) => Number.isFinite(id))
  .sort((a, b) => a - b);

// Warp-reachable group sprite nums per record (forward BFS over screen-exit
// warps) — the `carried` deps' fallback, mirroring the editor hook's
// carriedGroupNums. Pre-load every backed level once; memoize per record.
const allLevels = new Map<number, ReturnType<typeof loadLevel>>();
for (const id of ids) {
  try {
    const l = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: id });
    if (!l.empty && !l.special) allLevels.set(id, l);
  } catch {
    /* unloadable slot */
  }
}
const groupCache = new Map<number, Set<number>>();
function carriedGroupNums(root: number): Set<number> {
  const hit = groupCache.get(root);
  if (hit) return hit;
  const nums = new Set<number>();
  const visited = new Set<number>();
  const queue = [root];
  for (let depth = 0; depth <= 8 && queue.length > 0; depth++) {
    for (const id of queue.splice(0)) {
      if (visited.has(id)) continue;
      visited.add(id);
      const l = allLevels.get(id);
      if (!l) continue;
      for (const s of l.sprites) nums.add(s.num);
      for (const e of l.exits) {
        if (e.variant === 'warp') queue.push(e.destLevelRecordId);
      }
    }
  }
  groupCache.set(root, nums);
  return nums;
}

interface Finding {
  level: number;
  sprite: PlacedSprite;
  dep: SpriteNeighborDep;
  cell?: { cx: number; cy: number };
}
const findings: Finding[] = [];
const byClass = new Map<string, { met: number; missing: number; info: number }>();
let levelsWithDeps = 0;
let placementsChecked = 0;

for (const id of ids) {
  const level = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: id });
  if (level.empty || level.special) continue;

  const relevant = level.sprites.filter((s) => depsFor(s.num).length > 0);
  if (!relevant.length) continue;

  const decoded = decodeLevelById({ rom, symbols, workRoot: FRAMEWORK_ROOT, levelRecordId: id });
  if (!decoded) continue;
  const grid = resolveCellGrid(decoded.state.levelDataBuffer, decoded.state.screenPageMap);
  const exitScreens = new Set(level.exits.map((e) => e.screenIndex));
  const ctx: NeighborContext = {
    sprites: level.sprites.map((s) => ({ num: s.num, x: s.x, y: s.y })),
    map16At: (cx, cy) =>
      cx < 0 || cy < 0 || cx >= GRID_COLS || cy >= GRID_ROWS ? undefined : grid[cy * GRID_COLS + cx],
    hasExitForScreen: (s) => exitScreens.has(s),
    collisionTagOfPage,
    carriedGroupNums: carriedGroupNums(id),
  };

  levelsWithDeps++;
  for (const s of relevant) {
    const sprite: PlacedSprite = { num: s.num, x: s.x, y: s.y };
    for (const dep of depsFor(s.num)) {
      placementsChecked++;
      const r = resolveDep(sprite, dep, ctx);
      const tally = byClass.get(dep.cls) ?? { met: 0, missing: 0, info: 0 };
      if (r.status === 'met') tally.met++;
      else if (dep.enforce) {
        tally.missing++; // a real false error — shipped data resolved 'missing'
        findings.push({ level: id, sprite, dep, cell: r.targetCell });
      } else {
        tally.info++; // info-only dep (not per-record verifiable); not an error
      }
      byClass.set(dep.cls, tally);
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`levels with deps: ${levelsWithDeps}, placements checked: ${placementsChecked}`);
console.log('by class (met / error-missing / info-only):');
const CLASSES = ['rail-follower', 'ice-snap', 'tile-read', 'sprite-pair', 'screen-exit', 'tile-behavior'];
for (const cls of CLASSES) {
  const t = byClass.get(cls);
  if (t) console.log(`  ${cls}: ${t.met} met / ${t.missing} error / ${t.info} info-only`);
}

// Info-only relationships (never an enforce error) escape the zero-false-error
// gate below, so pin every class's positive `met` count instead — a drift means
// a matcher/metadata change altered behaviour. Derivations (the 2026-06-10
// neighbour-dependency audit — docs/sprite-neighbor-dependencies.md):
//   rail-follower: 104 flatbed/spiral rail placements + 3 rotating-platform-
//      on-rail ($2A/$58/$7B) = 107 (the 37 off-rail rotating placements are
//      info).
//   ice-snap: 16 ice-block snaps (12 shyguy + 2 bumpty + 2 flower, $26/$5D).
//   tile-read: 3 slime + 21 icicle + 28 boo-bomb + 1 cork + 1 wall-lakitu-gen
//      + 0 falling-rock + 68 grinders adjacent to a tree (checked row scan,
//      pages $99/$9A; the other 80 roam — info) + 16 chomp `note` annotations
//      (14 single $0A6 + 2 flock $0A7; the $0A8 falling body is spawn-only,
//      0 placements) = 138.
//   sprite-pair: 30 prior (cloud/switch/doors-with-key-in-record) + 22
//      mouser→hole + 9 slugger-with-rock + 5 carried-Key-in-warp-group
//      (forward BFS fallback; lvls $3C/$63/$AA/$C1×2) = 66. The 28 info
//      misses include the doors whose keys spawn from CONTAINERS (winged
//      clouds etc.) — why `carried` can never be enforced.
//   screen-exit: 144 warp-screen rows + 7 frog-pirate notes = 151.
//   tile-behavior: 57 pipe spawners (47 on $79F1 + 10 on page-$7D tag) + 5
//      piranha pipe-centring + 15 dirt-digger note placements = 77.
const EXPECTED_MET: Record<string, number> = {
  'rail-follower': 107,
  'ice-snap': 16,
  'tile-read': 138,
  'sprite-pair': 66,
  'screen-exit': 151,
  'tile-behavior': 77,
};
let pinFailed = false;
for (const [cls, expected] of Object.entries(EXPECTED_MET)) {
  const met = byClass.get(cls)?.met ?? 0;
  if (met !== expected) {
    console.log(`\n✗ Class ${cls}: expected ${expected} shipped placements to resolve met, got ${met}.`);
    pinFailed = true;
  }
}
if (pinFailed) process.exit(1);
console.log('✓ per-class met counts match the pinned audit values.');

if (findings.length) {
  console.log(`\n✗ ${findings.length} FALSE ERROR(S) — shipped placements that resolved 'missing':`);
  for (const f of findings) {
    const at = f.cell ? ` probe-cell (${f.cell.cx},${f.cell.cy})` : '';
    console.log(
      `  level ${hex(f.level)}  sprite ${hex(f.sprite.num, 3)} ${spriteName(f.sprite.num)}` +
        ` @ cell (${f.sprite.x},${f.sprite.y})  [${f.dep.cls}/${f.dep.spatial}] -> ${f.dep.targetName}${at}`
    );
  }
  if (!VERBOSE) console.log('\n(grouping above is one line per failing placement)');
  process.exit(1);
} else {
  console.log('\n✓ zero false errors — every shipped neighbour-dependency placement resolves met.');
}
