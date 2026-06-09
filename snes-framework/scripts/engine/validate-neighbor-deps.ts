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
for (const cls of ['A', 'B1', 'C', 'D', 'E', 'F']) {
  const t = byClass.get(cls);
  if (t) console.log(`  ${cls}: ${t.met} met / ${t.missing} error / ${t.info} info-only`);
}

// Class F (pipe-spawner) is info-only (never an enforce error), so the
// zero-false-error gate below can't guard it. Pin the positive count instead:
// the shipped pipe-spawner placements that resolve `met` (sprite sits on a
// pipe-mouth tile). 57 = 47 on the literal mouth $79F1 + 10 on page-$7D tag.
// A drift here means the collision-tag / tile-literal matcher changed behaviour.
const EXPECTED_F_MET = 57;
const fMet = byClass.get('F')?.met ?? 0;
if (fMet !== EXPECTED_F_MET) {
  console.log(
    `\n✗ Class F pipe-spawner: expected ${EXPECTED_F_MET} shipped spawner placements to resolve met, got ${fMet}.`
  );
  process.exit(1);
}
console.log(`✓ Class F pipe-spawner: ${fMet} shipped spawner placements resolve met (pinned).`);

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
