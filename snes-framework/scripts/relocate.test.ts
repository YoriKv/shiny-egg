// Validation for the level-data layout transform (relocate.ts) + the
// FreeRegion/migratable model (pool-map.ts).
//
// Two halves:
//   • Pure text splices on synthetic asm — deleteIncbin / insertBeforeFreeBytes /
//     appendRegionBlobs / repointPtr / signed rewriteFreeBytesText. No artifacts.
//   • planLayout + applyLevelDataLayout against the REAL pool map (build `.sym` +
//     base `.bin`s) — migration reclaim, de-couple home placement, determinism,
//     and the byte-identity invariant (empty sets ⇒ banks reconcile to base).
//
// Run: node --experimental-strip-types snes-framework/scripts/relocate.test.ts

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPoolMap, carvePatchPool, migratable, patchPoolGeometry, poolLevels, shiftRegionHead, PATCH_POOL_MAX_BYTES } from './pool-map.ts';
import type { LevelPool, PoolMap } from './pool-map.ts';
import {
  deleteIncbin,
  insertBeforeFreeBytes,
  appendRegionBlobs,
  repointPtr,
  repointPtrRowOccurrence,
  reservePatchPool,
  shiftRegionStart,
  planLayout,
  applyLevelDataLayout
} from './relocate.ts';
import { rewriteFreeBytesText } from './boundary-move.ts';
import { computePoolOverview, computeFreeRegionsOverview, checkAllPools, computeLevelBudget, planAutoMigration } from './level-budget.ts';
import { outputSfcName } from './rom-versions.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yiRoot = path.join(frameworkRoot, 'yi');
const baseBinDir = path.join(frameworkRoot, 'assets', 'yi', 'LevelData');
const symPath = path.join(frameworkRoot, 'build', outputSfcName('YI_U1').replace(/\.sfc$/i, '.sym'));

let failures = 0;
const check = (cond: boolean, msg: string): void => {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
};

// ── pure splices (no artifacts) ──────────────────────────────────────────────

{
  const bank =
    'DATA_level_38_obj:\n\tincbin "LevelData/DATA_level_38_obj.bin"\n\n' +
    'DATA_level_39_obj:\n\tincbin "LevelData/DATA_level_39_obj.bin"\n';
  const out = deleteIncbin(bank, 'DATA_level_38_obj');
  check(
    out === 'DATA_level_39_obj:\n\tincbin "LevelData/DATA_level_39_obj.bin"\n',
    `deleteIncbin should remove just the 38 block, got:\n${out}`
  );
  check(!out.includes('DATA_level_38_obj'), 'deleteIncbin should drop the label');
  let threw = false;
  try { deleteIncbin(bank, 'DATA_level_FF_obj'); } catch { threw = true; }
  check(threw, 'deleteIncbin should throw on a missing label');
}

{
  const bank =
    'DATA_level_19_obj:\n\tincbin "LevelData/DATA_level_19_obj.bin"\n\n' +
    '\t%FREE_BYTES($14FFA5, 91, $FF)\t\t; V1.0 tail\n';
  const out = insertBeforeFreeBytes(bank, 0x14ffa5, 91, [
    { label: 'DATA_level_19_spr', file: 'DATA_level_19_spr.bin', bytes: 2 }
  ]);
  check(
    /DATA_level_19_spr:\n\tincbin "LevelData\/DATA_level_19_spr.bin"\n\n\t%FREE_BYTES\(\$14FFA5, 91, \$FF\)/.test(out),
    `insertBeforeFreeBytes should place the spr block right before the macro, got:\n${out}`
  );
}

{
  const region = { id: 'FreeRegion51', bankFile: 'Banks/Bank51.asm', boundary: 0x515348, capacityBytes: 44216 };
  const bank = '\t%FREE_BYTES($515348, 44216, $FF)\t\t\t; V1.0: ~44 KB free tail\n';
  const out = appendRegionBlobs(bank, region, [
    { label: 'DATA_level_7D_obj', file: 'DATA_level_7D_obj.bin', bytes: 366 }
  ]);
  check(out.includes('\t%InsertMacroAtXPosition($515348)\n'), 'appendRegionBlobs should org to the region start');
  check(out.includes('DATA_level_7D_obj:\n\tincbin "LevelData/DATA_level_7D_obj.bin"'), 'appendRegionBlobs should emit the blob');
  check(out.includes('%FREE_BYTES($5154B6, 43850, $FF)'), `appendRegionBlobs should advance boundary + shrink fill, got:\n${out}`);
  check(out.includes('; V1.0: ~44 KB free tail'), 'appendRegionBlobs should preserve the trailing comment');
}

{
  // Patch-pool geometry: 8 KB carved off FreeRegion51's tail, addressed two ways.
  const region = { id: 'FreeRegion51', bankFile: 'Banks/Bank51.asm', boundary: 0x515348, capacityBytes: 44216 };
  const geo = patchPoolGeometry(region, PATCH_POOL_MAX_BYTES);
  check(geo.poolBytes === 0x2000, 'pool is 8 KB');
  check(geo.migrationCapacity === 44216 - 0x2000, `migration capacity shrinks by the pool, got ${geo.migrationCapacity}`);
  check(geo.fillBoundarySnes === 0x51e000, `SuperFX fill boundary, got $${geo.fillBoundarySnes.toString(16)}`);
  check(geo.loromStart === 0x23e000, `LoROM pool start, got $${geo.loromStart.toString(16)}`);
  check(geo.loromEnd === 0x240000, `LoROM pool end = start + bytes, got $${geo.loromEnd.toString(16)}`);

  // reservePatchPool splits the region's %FREE_BYTES into shrunk-migration + pool.
  const bank = '\t%FREE_BYTES($515348, 44216, $FF)\t\t\t; V1.0: ~44 KB free tail\n';
  const carved = reservePatchPool(bank, region, PATCH_POOL_MAX_BYTES);
  check(carved.includes('%FREE_BYTES($515348, 36024, $FF)'), `carve shrinks migration region, got:\n${carved}`);
  check(carved.includes('%FREE_BYTES($51E000, 8192, $FF)'), `carve reserves the pool, got:\n${carved}`);
  check(carved.includes('; V1.0: ~44 KB free tail'), 'carve preserves the trailing comment');
  // The migration boundary is unchanged, so a later appendRegionBlobs (driven off
  // the SHRUNK region) matches the first line and leaves the pool reservation intact.
  const shrunk = { ...region, capacityBytes: geo.migrationCapacity };
  const appended = appendRegionBlobs(carved, shrunk, [
    { label: 'DATA_level_7D_obj', file: 'DATA_level_7D_obj.bin', bytes: 366 }
  ]);
  check(appended.includes('\t%InsertMacroAtXPosition($515348)\n'), 'append after carve orgs to the region start');
  check(appended.includes('%FREE_BYTES($5154B6, 35658, $FF)'), `append after carve advances+shrinks the migration fill, got:\n${appended}`);
  check(appended.includes('%FREE_BYTES($51E000, 8192, $FF)'), 'append after carve leaves the pool reservation untouched');
  let threw = false;
  try { reservePatchPool('\t; no free bytes here\n', region, PATCH_POOL_MAX_BYTES); } catch { threw = true; }
  check(threw, 'reservePatchPool throws when the region macro is missing');
}

{
  // String spill: a grown Bank51 message-text region claims FreeRegion51's HEAD.
  // The region is claimed from both ends (head = text, tail = patch pool) and the
  // three splices must compose in the build's order: shift → carve → append.
  const region = { id: 'FreeRegion51', bankFile: 'Banks/Bank51.asm', boundary: 0x515348, capacityBytes: 44216 };
  const bank = '\t%FREE_BYTES($515348, 44216, $FF)\t\t\t; V1.0: ~44 KB free tail\n';
  const SPILL = 700;

  const shiftedText = shiftRegionStart(bank, region, SPILL);
  check(
    shiftedText.includes('%FREE_BYTES($515604, 43516, $FF)'),
    `shiftRegionStart moves the boundary + shrinks the fill, got:\n${shiftedText}`
  );
  check(shiftedText.includes('; V1.0: ~44 KB free tail'), 'shiftRegionStart preserves the trailing comment');
  check(shiftRegionStart(bank, region, 0) === bank, 'zero spill is a no-op (byte-exact base)');

  // The map shrinks the same way, so planLayout/appends see the real room left.
  const map = { romVersion: 'YI_U1', pools: [], poolByFile: new Map(), freeRegions: [region] } as unknown as PoolMap;
  const shiftedMap = shiftRegionHead(map, SPILL);
  const sr = shiftedMap.freeRegions[0]!;
  check(sr.boundary === 0x515348 + SPILL, `shiftRegionHead advances the boundary, got $${sr.boundary.toString(16)}`);
  check(sr.capacityBytes === 44216 - SPILL, `shiftRegionHead shrinks capacity, got ${sr.capacityBytes}`);
  check(shiftRegionHead(map, 0).freeRegions[0]!.boundary === 0x515348, 'zero spill leaves the map alone');

  // Head + tail claims are independent: the pool still lands at the region's END.
  const geoAfterShift = patchPoolGeometry(sr, PATCH_POOL_MAX_BYTES);
  check(
    geoAfterShift.fillBoundarySnes === 0x51e000 && geoAfterShift.loromStart === 0x23e000,
    'the patch pool keeps its addresses when the head shifts (both measure the fixed end)'
  );
  const carved = reservePatchPool(shiftedText, sr, PATCH_POOL_MAX_BYTES);
  check(carved.includes('%FREE_BYTES($515604, 35324, $FF)'), `carve after shift, got:\n${carved}`);
  check(carved.includes('%FREE_BYTES($51E000, 8192, $FF)'), 'carve after shift still reserves the pool at the end');
  const appended = appendRegionBlobs(
    carved,
    { ...sr, capacityBytes: geoAfterShift.migrationCapacity },
    [{ label: 'DATA_level_7D_obj', file: 'DATA_level_7D_obj.bin', bytes: 366 }]
  );
  check(appended.includes('\t%InsertMacroAtXPosition($515604)\n'), 'append after shift orgs past the spilled text');
  check(appended.includes('%FREE_BYTES($515772, 34958, $FF)'), `append after shift+carve, got:\n${appended}`);

  let over = false;
  try { shiftRegionStart(bank, region, 44217); } catch { over = true; }
  check(over, 'shiftRegionStart throws when the spill exceeds the region (fail loud, not a negative fill)');
}

{
  // carvePatchPool: shrinks ONLY the host region by the reserved bytes, untouched
  // otherwise; 0 ⇒ identity. This is what keeps the pre-build budget gate and the
  // build in lockstep on free-region capacity.
  const region51 = { id: 'FreeRegion51', bankFile: 'Banks/Bank51.asm', boundary: 0x515348, capacityBytes: 44216 };
  const region50 = { id: 'FreeRegion50', bankFile: 'Banks/Bank50.asm', boundary: 0x50b3fa, capacityBytes: 19462 };
  const map: PoolMap = { romVersion: 'YI_U1', pools: [], poolByFile: new Map(), freeRegions: [region51, region50] };
  const carved = carvePatchPool(map, 0x2000);
  const h = carved.freeRegions.find((r) => r.id === 'FreeRegion51')!;
  const o = carved.freeRegions.find((r) => r.id === 'FreeRegion50')!;
  check(h.capacityBytes === 44216 - 0x2000, `carve shrinks the host region, got ${h.capacityBytes}`);
  check(o.capacityBytes === 19462, 'carve leaves other regions untouched');
  check(carvePatchPool(map, 0).freeRegions[0].capacityBytes === 44216, 'patchPoolBytes=0 ⇒ no carve (identity)');
}

{
  // Regression for the patch-pool gate-parity bug: a migrated blob that FITS the
  // full free region but NOT after the carve must surface as a region-full
  // violation — exactly what the pre-build gate now sees (so it blocks) instead of
  // letting the build's carved layout strand the blob and asar crash.
  const c5 = { level: 'C5', kind: 'obj' as const, label: 'DATA_level_C5_obj', file: 'DATA_level_C5_obj.bin', snesAddr: 0x10f000, baseBytes: 100 };
  const pool: LevelPool = {
    id: 'Bank10', bank: 0x10, capacityBytes: 100, headroomBytes: 0,
    tail: { bankFile: 'Banks/Bank10.asm', boundary: 0x10ffa3, fillSize: 0, movable: true, reclaimable: true },
    blobs: [c5]
  };
  const region51 = { id: 'FreeRegion51', bankFile: 'Banks/Bank51.asm', boundary: 0x515348, capacityBytes: 4000 };
  const map: PoolMap = { romVersion: 'YI_U1', pools: [pool], poolByFile: new Map([[c5.file, pool]]), freeRegions: [region51] };
  const sizeOf = (f: string): number => (f === c5.file ? 3500 : 0);
  const opts = { migrated: new Set([0xc5]), decoupled: new Set<number>(), sizeOf };

  const full = planLayout(map, opts);
  check(full.violations.length === 0, 'at full capacity the migrated blob fits (no violation)');
  check(full.relocations.length === 1, 'at full capacity the blob is placed');

  const carvedPlan = planLayout(carvePatchPool(map, 1000), opts);
  check(
    carvedPlan.violations.some((v) => v.kind === 'region-full'),
    'after a 1 KB carve (3000 < 3500) the same blob no longer fits → region-full'
  );
}

{
  const dt = '\tdl DATA_level_19_obj,DATA_14C6C6-$02    ; $19 3-8 Naval Piranha\'s Castle\n';
  const out = repointPtr(dt, 'DATA_14C6C6-$02', 'DATA_level_19_spr');
  check(out.includes('dl DATA_level_19_obj,DATA_level_19_spr'), `repointPtr should swap the biased expr, got: ${out.trim()}`);
  check(out.includes('; $19 3-8 Naval Piranha\'s Castle'), 'repointPtr should preserve the comment');
}

{
  // Signed (negative) growth — boundary pulls back, fill grows (reclaim).
  const sample = '\t%FREE_BYTES($16FFF8, 8, $FF)\t; tail';
  const out = rewriteFreeBytesText(sample, {
    bankFile: 'Banks/Bank16.asm', poolId: 'Bank16', boundary: 0x16fff8, fillSize: 8, growth: -225
  });
  check(out.includes('%FREE_BYTES($16FF17, 233, $FF)'), `signed rewrite should reclaim, got: ${out.trim()}`);
}

// ── planner + apply against real artifacts ───────────────────────────────────

if (!fs.existsSync(symPath) || !fs.existsSync(baseBinDir)) {
  console.error(`relocate.test: missing ${fs.existsSync(symPath) ? baseBinDir : symPath}. Extract + build first.`);
  console.error('  (pure-splice checks above still ran.)');
  process.exit(failures > 0 ? 1 : 2);
}

const baseSizeOf = (file: string): number => {
  try { return fs.statSync(path.join(baseBinDir, file)).size; } catch { return 0; }
};
const map = buildPoolMap('YI_U1', fs.readFileSync(symPath, 'utf8'), baseSizeOf);

// FreeRegion model.
check(map.freeRegions.length === 2, `expected 2 free regions, got ${map.freeRegions.length}`);
check(map.freeRegions[0]?.id === 'FreeRegion51' && map.freeRegions[0]?.capacityBytes === 44216, 'FreeRegion51 capacity');
check(map.freeRegions[1]?.id === 'FreeRegion50' && map.freeRegions[1]?.capacityBytes === 19462, 'FreeRegion50 capacity');

// migratable predicate.
const none: ReadonlySet<number> = new Set();
check(migratable(map, 0x01, none), '0x01 (Bank4C, clean) should be migratable');
check(migratable(map, 0x7d, none), '0x7D should be migratable via the obj repoint path');
check(!migratable(map, 0x38, none), '0x38 (hardcoded) should NOT be migratable');
check(!migratable(map, 0x51, none), '0x51 (aliased-into partner) should NOT be migratable while 0x19 is coupled');
check(migratable(map, 0x51, new Set([0x19])), '0x51 should become migratable once 0x19 is de-coupled');
check(migratable(map, 0x19, none), '0x19 (clean obj) should be migratable (obj moves, biased spr stays)');

// Migration of a clean Bank4C level → relocation + deletion + reclaim move.
const obj01 = baseSizeOf('DATA_level_01_obj.bin');
const spr01 = baseSizeOf('DATA_level_01_spr.bin');
const planA = planLayout(map, { migrated: new Set([0x01]), decoupled: new Set(), sizeOf: baseSizeOf });
check(planA.relocations.length === 2, `migrate 0x01 should relocate 2 blobs, got ${planA.relocations.length}`);
check(planA.relocations.every((r) => r.regionId === 'FreeRegion51'), 'both 0x01 blobs should first-fit FreeRegion51');
check(planA.deletions.length === 2 && planA.deletions.every((d) => d.bankFile === 'Banks/Bank4C.asm'), 'both should delete from Bank4C');
const mv4c = planA.moves.find((m) => m.poolId === 'Bank4C');
check(!!mv4c && mv4c.growth === -(obj01 + spr01), `Bank4C should reclaim ${obj01 + spr01} bytes (growth ${mv4c?.growth})`);
check(planA.violations.length === 0, `migrate 0x01 should have no violations, got ${planA.violations.length}`);
check(planA.regionAppends.length === 1 && planA.regionAppends[0].blobs.length === 2, 'one FreeRegion51 append with 2 blobs');

// Determinism: same input → identical plan.
const planA2 = planLayout(map, { migrated: new Set([0x01]), decoupled: new Set(), sizeOf: baseSizeOf });
check(JSON.stringify(planA.moves) === JSON.stringify(planA2.moves), 'planLayout should be deterministic (moves)');
check(JSON.stringify(planA.relocations) === JSON.stringify(planA2.relocations), 'planLayout should be deterministic (relocations)');

// De-couple 0x19 → materialise spr home in Bank14, repoint, +2 move.
const planD = planLayout(map, { migrated: new Set(), decoupled: new Set([0x19]), sizeOf: baseSizeOf });
check(planD.decouples.length === 1 && planD.decouples[0].placedIn === 'Bank14', `0x19 spr should land home in Bank14, got ${planD.decouples[0]?.placedIn}`);
check(planD.repoints.length === 1 && planD.repoints[0].oldExpr === 'DATA_14C6C6-$02' && planD.repoints[0].newLabel === 'DATA_level_19_spr', 'repoint 0x19 biased → DATA_level_19_spr');
const mv14 = planD.moves.find((m) => m.poolId === 'Bank14');
const spr19 = baseSizeOf('DATA_level_19_spr.bin');
check(!!mv14 && mv14.growth === spr19, `Bank14 should grow by ${spr19} for the de-coupled spr (got ${mv14?.growth})`);
check(planD.homeInserts.length === 1 && planD.homeInserts[0].bankFile === 'Banks/Bank14.asm', 'one Bank14 home insert');

// Migrate 0x7D → obj via REPOINT (self-contained copy in a region, shared
// original NOT deleted), spr via normal relocation.
const obj7d = baseSizeOf('DATA_level_7D_obj.bin');
const planR = planLayout(map, { migrated: new Set([0x7d]), decoupled: new Set(), sizeOf: baseSizeOf });
const objReloc = planR.relocations.find((r) => r.level === 0x7d && r.kind === 'obj');
check(!!objReloc && objReloc.label === 'DATA_level_7D_obj' && objReloc.bytes === obj7d, `0x7D obj should relocate as DATA_level_7D_obj (${obj7d}B), got ${JSON.stringify(objReloc)}`);
check(planR.repoints.some((p) => p.oldExpr === 'DATA_169D23' && p.newLabel === 'DATA_level_7D_obj'), '0x7D should repoint DATA_169D23 → DATA_level_7D_obj');
check(!planR.deletions.some((d) => d.label === 'DATA_169D23'), '0x7D must NOT delete the shared DATA_169D23 original');
check(planR.deletions.some((d) => d.label === 'DATA_level_7D_spr' && d.bankFile === 'Banks/Bank16.asm'), '0x7D spr should migrate normally (deleted from Bank16)');
check(planR.violations.length === 0, `migrate 0x7D should have no violations, got ${JSON.stringify(planR.violations)}`);

// Bank15: non-movable (load-bearing fills) but RECLAIMABLE — its levels are
// migratable, and migrating one emits a reclaim (negative-growth) boundary move.
const bank15 = map.pools.find((p) => p.bank === 0x15)!;
check(!bank15.tail.movable && bank15.tail.reclaimable, 'Bank15 pools should be non-movable but reclaimable');
check(migratable(map, 0x07, none), '0x07 (Bank15) should be migratable via the reclaim path');
const obj07 = baseSizeOf('DATA_level_07_obj.bin');
const spr07 = baseSizeOf('DATA_level_07_spr.bin');
const plan15 = planLayout(map, { migrated: new Set([0x07]), decoupled: new Set(), sizeOf: baseSizeOf });
check(plan15.violations.length === 0, `migrate 0x07 (Bank15) should have no violations, got ${JSON.stringify(plan15.violations)}`);
check(plan15.relocations.length === 2, `0x07 should relocate 2 blobs, got ${plan15.relocations.length}`);
const reclaim15 = plan15.moves.filter((m) => m.bankFile === 'Banks/Bank15.asm').reduce((n, m) => n + m.growth, 0);
check(reclaim15 === -(obj07 + spr07), `Bank15 should reclaim ${obj07 + spr07} bytes (move growth ${reclaim15})`);
check(plan15.moves.filter((m) => m.bankFile === 'Banks/Bank15.asm').every((m) => m.growth < 0), 'Bank15 moves should all be reclaims (negative growth)');

// Budget views: free-region overview + migration-aware pool overview.
const regsBase = computeFreeRegionsOverview(map, baseSizeOf);
check(regsBase.length === 2 && regsBase.every((r) => r.usedBytes === 0 && r.freeBytes === r.capacityBytes), 'base free regions are empty');

const poolsMig = computePoolOverview(map, baseSizeOf, { migrated: new Set([0x01]) });
const ov4c = poolsMig.find((p) => p.poolId === 'Bank4C')!;
check(!ov4c.levels.some((l) => l.levelRecordId === '0x01'), 'migrated 0x01 should leave the Bank4C level list');
check(ov4c.freeBytes === 329 + obj01 + spr01, `Bank4C free should rise by ${obj01 + spr01} after reclaim (got ${ov4c.freeBytes})`);
check(
  ov4c.migratedOut?.some(
    (m) => m.levelRecordId === '0x01' && m.regionId === 'FreeRegion51' && m.bytes === obj01 + spr01
  ) ?? false,
  `Bank4C should mark 0x01 migrated → FreeRegion51 with its ${obj01 + spr01} B still visible`
);

const regsMig = computeFreeRegionsOverview(map, baseSizeOf, { migrated: new Set([0x01]) });
const r51 = regsMig.find((r) => r.id === 'FreeRegion51')!;
check(r51.usedBytes === obj01 + spr01, `FreeRegion51 used should be ${obj01 + spr01} (got ${r51.usedBytes})`);
check(r51.levels.some((l) => l.levelRecordId === '0x01'), 'FreeRegion51 should list 0x01');

// Gate: base → no violations; a Bank4C blob over headroom → 1 pool-over.
check(checkAllPools(map, baseSizeOf).length === 0, 'checkAllPools base → 0 violations');
const bump = (f: string): number => baseSizeOf(f) + (f === 'DATA_level_01_obj.bin' ? 330 : 0);
const viol = checkAllPools(map, bump);
check(viol.length === 1 && viol[0].poolId === 'Bank4C' && viol[0].overBy === 1, `Bank4C +330 → 1 pool-over by 1, got ${JSON.stringify(viol)}`);
// …but migrating 0x01 out clears it (its bytes go to a free region).
check(checkAllPools(map, bump, { migrated: new Set([0x01]) }).length === 0, 'migrating 0x01 should clear the Bank4C overflow');

// computeLevelBudget (the per-level banner) must EXCLUDE a migrated-out bank-mate,
// so it agrees with the Banks panel (regression: it summed all pool blobs).
const yHex = poolLevels(map.pools.find((p) => p.id === 'Bank4C')!).find((l) => l !== '01')!;
const y = parseInt(yHex, 16);
const yFiles = { objFile: `DATA_level_${yHex}_obj.bin`, spriteFile: `DATA_level_${yHex}_spr.bin` };
const yLive = { objBytes: baseSizeOf(yFiles.objFile), spriteBytes: baseSizeOf(yFiles.spriteFile) };
const usedNoMig = computeLevelBudget(map, y, yFiles, yLive, baseSizeOf).pools.find((p) => p.poolId === 'Bank4C')!;
const usedMig = computeLevelBudget(map, y, yFiles, yLive, baseSizeOf, { migrated: new Set([0x01]) }).pools.find((p) => p.poolId === 'Bank4C')!;
check(usedMig.usedBytes === usedNoMig.usedBytes - (obj01 + spr01), `Bank4C used in 0x${yHex}'s report should drop by ${obj01 + spr01} when 0x01 migrates (no-mig ${usedNoMig.usedBytes}, mig ${usedMig.usedBytes})`);
check(!usedMig.otherLevels.includes('0x01'), 'migrated 0x01 should leave the report\'s otherLevels list');

// Occurrence-targeted row repoint (the two identical sentinel rows).
{
  const t =
    '\tdl DATA_15FCEA,DATA_15FFD5    ; $DA seed contest A\n' +
    '\tdl DATA_15FCEA,DATA_15FFD5    ; $DB seed contest B\n';
  const o1 = repointPtrRowOccurrence(t, 'DATA_15FCEA,DATA_15FFD5', 1, 'DATA_level_DB_obj,DATA_level_DB_spr');
  check(o1.includes('DATA_15FCEA,DATA_15FFD5    ; $DA'), 'occurrence 1: the $DA row stays sentinel');
  check(o1.includes('DATA_level_DB_obj,DATA_level_DB_spr    ; $DB'), 'occurrence 1: the $DB row repoints');
  const o0 = repointPtrRowOccurrence(t, 'DATA_15FCEA,DATA_15FFD5', 0, 'X,Y');
  check(o0.startsWith('\tdl X,Y'), 'occurrence 0: the $DA row repoints');
  let threw = false;
  try { repointPtrRowOccurrence(t, 'DATA_15FCEA,DATA_15FFD5', 2, 'X,Y'); } catch { threw = true; }
  check(threw, 'occurrence past the end should throw');
}

// New-slot planning: blobs place into free regions, the sentinel row repoints,
// nothing is deleted, and a 0-byte obj (nothing imported) is skipped.
{
  const newSizeOf = (f: string): number =>
    f === 'DATA_level_DA_obj.bin' ? 500 : f === 'DATA_level_DA_spr.bin' ? 80 : baseSizeOf(f);
  const planN = planLayout(map, { migrated: new Set(), decoupled: new Set(), newSlots: new Set([0xda]), sizeOf: newSizeOf });
  check(planN.relocations.length === 2 && planN.relocations.every((r) => r.regionId === 'FreeRegion51'), 'new-slot 0xDA places obj+spr in FreeRegion51');
  check(planN.deletions.length === 0, 'new-slot placement deletes nothing');
  check(
    planN.rowRepoints.length === 1 &&
      planN.rowRepoints[0].occurrence === 0 &&
      planN.rowRepoints[0].replacement === 'DATA_level_DA_obj,DATA_level_DA_spr',
    `new-slot 0xDA repoints its row (got ${JSON.stringify(planN.rowRepoints)})`
  );
  // spr missing on disk → row keeps the sprite sentinel.
  const objOnly = (f: string): number => (f === 'DATA_level_DB_obj.bin' ? 300 : baseSizeOf(f));
  const planO = planLayout(map, { migrated: new Set(), decoupled: new Set(), newSlots: new Set([0xdb]), sizeOf: objOnly });
  check(
    planO.rowRepoints.length === 1 &&
      planO.rowRepoints[0].occurrence === 1 &&
      planO.rowRepoints[0].replacement === 'DATA_level_DB_obj,DATA_15FFD5',
    `obj-only new slot keeps the spr sentinel (got ${JSON.stringify(planO.rowRepoints)})`
  );
  // no data on disk at all → slot skipped entirely.
  const planZ = planLayout(map, { migrated: new Set(), decoupled: new Set(), newSlots: new Set([0xda]), sizeOf: baseSizeOf });
  check(planZ.relocations.length === 0 && planZ.rowRepoints.length === 0, 'a new slot with no overlay bytes is skipped');
}

// ── vanilla-level removal planning ───────────────────────────────────────────
const SENTINEL = 'DATA_15FCEA,DATA_15FFD5';
{
  // Clean Bank4C level: both blobs delete (optional), the pool reclaims, the
  // row repoints to the sentinels, and nothing relocates.
  const plan = planLayout(map, { migrated: new Set(), decoupled: new Set(), removed: new Set([0x01]), sizeOf: baseSizeOf });
  check(plan.removals.length === 2 && plan.removals.every((r) => r.poolId === 'Bank4C'), `remove 0x01 frees both Bank4C blobs, got ${JSON.stringify(plan.removals)}`);
  check(plan.deletions.length === 2 && plan.deletions.every((d) => d.optional === true && d.bankFile === 'Banks/Bank4C.asm'), 'removal deletions are optional + in Bank4C');
  check(plan.relocations.length === 0 && plan.regionAppends.length === 0, 'removal places nothing in free regions');
  check(
    plan.removalRepoints.length === 1 &&
      plan.removalRepoints[0].oldExpr === 'DATA_level_01_obj,DATA_level_01_spr' &&
      plan.removalRepoints[0].replacement === SENTINEL,
    `remove 0x01 repoints its row at the sentinels, got ${JSON.stringify(plan.removalRepoints)}`
  );
  const mv = plan.moves.find((m) => m.poolId === 'Bank4C');
  check(!!mv && mv.growth === -(obj01 + spr01), `remove 0x01 reclaims ${obj01 + spr01} B from Bank4C (got ${mv?.growth})`);
  check(plan.violations.length === 0, 'removal alone can never violate a budget');
}

{
  // Borrowed-terminator guard: removing 0x51 while 0x19 is kept+coupled must
  // keep 0x51's spr blob (0x19's biased pointer reads its tail terminator).
  const spr51 = baseSizeOf('DATA_level_51_spr.bin');
  const planKept = planLayout(map, { migrated: new Set(), decoupled: new Set(), removed: new Set([0x51]), sizeOf: baseSizeOf });
  check(!planKept.deletions.some((d) => d.label === 'DATA_level_51_spr'), 'remove 0x51 (0x19 coupled) must keep DATA_level_51_spr');
  check(planKept.deletions.some((d) => d.label === 'DATA_level_51_obj'), 'remove 0x51 still frees its obj blob');
  // …but once 0x19 is removed too (or de-coupled), the spr blob frees as well.
  const planBoth = planLayout(map, { migrated: new Set(), decoupled: new Set(), removed: new Set([0x19, 0x51]), sizeOf: baseSizeOf });
  check(planBoth.deletions.some((d) => d.label === 'DATA_level_51_spr'), 'remove 0x19+0x51 frees the spr blob too');
  check(
    planBoth.removalRepoints.some((r) => r.oldExpr === 'DATA_level_19_obj,DATA_14C6C6-$02' && r.replacement === SENTINEL),
    '0x19 removal repoints its BIASED row expression'
  );
  const planDec = planLayout(map, { migrated: new Set(), decoupled: new Set([0x19]), removed: new Set([0x51]), sizeOf: baseSizeOf });
  check(planDec.deletions.some((d) => d.label === 'DATA_level_51_spr'), 'remove 0x51 with 0x19 de-coupled frees the spr blob');
  check(spr51 > 0, 'sanity: 0x51 spr blob exists');
}

{
  // Absorbed-overlap guard: 0x7D's true obj stream spills into DATA_level_A5_obj
  // + DATA_level_17_spr, so removing 0xA5 (or 0x17) while 0x7D is kept must keep
  // those bytes in place.
  const planA5 = planLayout(map, { migrated: new Set(), decoupled: new Set(), removed: new Set([0xa5]), sizeOf: baseSizeOf });
  check(!planA5.deletions.some((d) => d.label === 'DATA_level_A5_obj'), 'remove 0xA5 (0x7D kept) must keep DATA_level_A5_obj');
  check(planA5.deletions.some((d) => d.label === 'DATA_level_A5_spr'), 'remove 0xA5 still frees its spr blob');
  const planBoth = planLayout(map, { migrated: new Set(), decoupled: new Set(), removed: new Set([0x7d, 0xa5]), sizeOf: baseSizeOf });
  check(planBoth.deletions.some((d) => d.label === 'DATA_level_A5_obj'), 'remove 0x7D+0xA5 frees the absorbed obj blob');
  check(
    planBoth.removalRepoints.some((r) => r.oldExpr === 'DATA_169D23,DATA_level_7D_spr' && r.replacement === SENTINEL),
    '0x7D removal repoints its RAW-label row expression'
  );
  check(!planBoth.deletions.some((d) => d.label === 'DATA_169D23'), '0x7D removal never deletes the shared raw slice');
  const planMig = planLayout(map, { migrated: new Set([0x7d]), decoupled: new Set(), removed: new Set([0xa5]), sizeOf: baseSizeOf });
  check(planMig.deletions.some((d) => d.label === 'DATA_level_A5_obj'), 'remove 0xA5 with 0x7D migrated frees the absorbed obj blob');

  // The same dependency now gates MIGRATION too (regression: migrating 0xA5/0x17
  // under a kept 0x7D would corrupt its runtime stream).
  check(!migratable(map, 0xa5, none), '0xA5 must NOT be migratable while 0x7D points at its raw slice');
  check(!migratable(map, 0x17, none), '0x17 must NOT be migratable while 0x7D points at its raw slice');
  check(migratable(map, 0xa5, none, new Set([0x7d])), '0xA5 becomes migratable once 0x7D is migrated/removed');
}

{
  // Shared-obj rows (0xBF/0xD0, both at DATA_11DC0F): only the spr blob frees;
  // a Bank51-pool level (non-reclaimable home) frees nothing but still repoints.
  const planBF = planLayout(map, { migrated: new Set(), decoupled: new Set(), removed: new Set([0xbf]), sizeOf: baseSizeOf });
  check(planBF.deletions.length === 1 && planBF.deletions[0].label === 'DATA_level_BF_spr', `remove 0xBF frees only its spr blob, got ${JSON.stringify(planBF.deletions)}`);
  check(planBF.removalRepoints[0]?.oldExpr === 'DATA_11DC0F,DATA_level_BF_spr', '0xBF removal targets its shared-obj row expression');
  const plan51 = planLayout(map, { migrated: new Set(), decoupled: new Set(), removed: new Set([0x32]), sizeOf: baseSizeOf });
  check(plan51.deletions.length === 0 && plan51.removals.length === 0, 'a Bank51-pool level frees nothing (non-reclaimable home)');
  check(plan51.removalRepoints.length === 1 && plan51.removalRepoints[0].oldExpr === 'DATA_level_32_obj,DATA_level_32_spr', 'its row still repoints');
}

{
  // Removal wins over the other per-level states, and sentinel slots are ignored.
  const plan = planLayout(map, {
    migrated: new Set([0x01]), decoupled: new Set([0x19]),
    newSlots: new Set([0xda]), removed: new Set([0x01, 0x19, 0xda]),
    sizeOf: (f: string): number => (f.startsWith('DATA_level_DA_') ? 100 : baseSizeOf(f))
  });
  check(plan.relocations.length === 0, 'a removed level is not also migrated/placed');
  check(plan.decouples.length === 0 && plan.repoints.length === 0, 'a removed level is not also de-coupled');
  check(plan.rowRepoints.length === 0, 'a removed sentinel slot id is ignored (no new-slot placement)');
  check(plan.removalRepoints.length === 2, 'only the two real levels are removed');
}

{
  // Budget views under removal: 0x01 leaves the Bank4C list, its bytes free up,
  // and the removedOut entry reports them; a partner-protected removal (0x51,
  // 0x19 coupled) leaves a `removed: true` residual row with the kept spr bytes.
  const ov = computePoolOverview(map, baseSizeOf, { removed: new Set([0x01]) });
  const p4c = ov.find((p) => p.poolId === 'Bank4C')!;
  check(!p4c.levels.some((l) => l.levelRecordId === '0x01'), 'removed 0x01 leaves the Bank4C level list');
  check(p4c.freeBytes === 329 + obj01 + spr01, `Bank4C free rises by the removed bytes (got ${p4c.freeBytes})`);
  check(
    p4c.removedOut?.some((r) => r.levelRecordId === '0x01' && r.bytes === obj01 + spr01) ?? false,
    `Bank4C removedOut should report 0x01's ${obj01 + spr01} freed bytes`
  );
  const spr51 = baseSizeOf('DATA_level_51_spr.bin');
  const ov51 = computePoolOverview(map, baseSizeOf, { removed: new Set([0x51]) });
  const p14 = ov51.find((p) => p.poolId === 'Bank14')!;
  const row51 = p14.levels.find((l) => l.levelRecordId === '0x51');
  check(!!row51 && row51.removed === true && row51.bytes === spr51, `removed 0x51 keeps a residual row with its kept spr bytes (got ${JSON.stringify(row51)})`);
  check(checkAllPools(map, baseSizeOf, { removed: new Set([0x01, 0x51]) }).length === 0, 'removal context never violates the gate');
}

// Empty sets ⇒ no edits at all (byte-identity invariant).
const planE = planLayout(map, { migrated: new Set(), decoupled: new Set(), sizeOf: baseSizeOf });
check(
  planE.moves.length === 0 && planE.deletions.length === 0 && planE.regionAppends.length === 0 &&
    planE.homeInserts.length === 0 && planE.repoints.length === 0 && planE.violations.length === 0 &&
    planE.removals.length === 0 && planE.removalRepoints.length === 0,
  'empty migration+decouple+removal ⇒ zero edits'
);

// applyLevelDataLayout integration — write a temp tree and check the real banks.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relocate-test-'));
try {
  // (a) empty sets ⇒ every reconciled bank byte-identical to base.
  applyLevelDataLayout(yiRoot, null, tmp, map, { migrated: new Set(), decoupled: new Set(), sizeOf: baseSizeOf });
  for (const f of ['Banks/Bank4C.asm', 'Banks/Bank51.asm', 'Banks/Bank14.asm']) {
    const a = fs.readFileSync(path.join(yiRoot, f), 'utf8');
    const b = fs.readFileSync(path.join(tmp, f), 'utf8');
    check(a === b, `empty layout: ${f} should be byte-identical to base`);
  }

  // (b) migrate 0x01 ⇒ Bank4C drops its incbins + reclaims; Bank51 gains them.
  applyLevelDataLayout(yiRoot, null, tmp, map, { migrated: new Set([0x01]), decoupled: new Set(), sizeOf: baseSizeOf });
  const b4c = fs.readFileSync(path.join(tmp, 'Banks/Bank4C.asm'), 'utf8');
  check(!b4c.includes('DATA_level_01_obj:'), 'migrated Bank4C should no longer define DATA_level_01_obj');
  check(!b4c.includes('DATA_level_01_spr:'), 'migrated Bank4C should no longer define DATA_level_01_spr');
  const newB = (0x4cfeb7 - (obj01 + spr01)).toString(16).toUpperCase().padStart(6, '0');
  check(b4c.includes(`%FREE_BYTES($${newB}, ${329 + obj01 + spr01}, $FF)`), `Bank4C boundary should pull back by ${obj01 + spr01}`);
  const b51 = fs.readFileSync(path.join(tmp, 'Banks/Bank51.asm'), 'utf8');
  check(b51.includes('%InsertMacroAtXPosition($515348)'), 'migrated Bank51 should org to the region start');
  check(b51.includes('DATA_level_01_obj:\n\tincbin "LevelData/DATA_level_01_obj.bin"'), 'Bank51 should incbin the relocated obj');
  check(b51.includes('DATA_level_01_spr:\n\tincbin "LevelData/DATA_level_01_spr.bin"'), 'Bank51 should incbin the relocated spr');

  // (c) re-applying empty sets restores base (stale edit cleared / idempotent).
  applyLevelDataLayout(yiRoot, null, tmp, map, { migrated: new Set(), decoupled: new Set(), sizeOf: baseSizeOf });
  const b4cRestored = fs.readFileSync(path.join(tmp, 'Banks/Bank4C.asm'), 'utf8');
  check(b4cRestored === fs.readFileSync(path.join(yiRoot, 'Banks/Bank4C.asm'), 'utf8'), 'empty re-apply should restore Bank4C to base');

  // (d) patchPoolBytes=0 ⇒ Bank51 byte-identical to base (no carve when patches off).
  applyLevelDataLayout(yiRoot, null, tmp, map, { migrated: new Set(), decoupled: new Set(), sizeOf: baseSizeOf, patchPoolBytes: 0 });
  check(
    fs.readFileSync(path.join(tmp, 'Banks/Bank51.asm'), 'utf8') === fs.readFileSync(path.join(yiRoot, 'Banks/Bank51.asm'), 'utf8'),
    'patchPoolBytes=0 should leave Bank51 byte-identical to base'
  );

  // (e) patchPoolBytes>0 carves Bank51's region into shrunk-migration + pool, and
  //     a concurrent migration appends into the shrunk region (composes).
  applyLevelDataLayout(yiRoot, null, tmp, map, {
    migrated: new Set([0x01]), decoupled: new Set(), sizeOf: baseSizeOf, patchPoolBytes: PATCH_POOL_MAX_BYTES
  });
  const b51carved = fs.readFileSync(path.join(tmp, 'Banks/Bank51.asm'), 'utf8');
  check(b51carved.includes('%FREE_BYTES($51E000, 8192, $FF)'), 'carved Bank51 should reserve the 8 KB patch pool');
  check(b51carved.includes('%InsertMacroAtXPosition($515348)'), 'carved+migrated Bank51 should still org the migration at the region start');
  check(b51carved.includes('DATA_level_01_obj:\n\tincbin "LevelData/DATA_level_01_obj.bin"'), 'carved Bank51 should still incbin the migrated obj');
  // remaining migration fill ends exactly where the pool begins ($51E000).
  const usedAfter01 = obj01 + spr01;
  const migBoundary = (0x515348 + usedAfter01).toString(16).toUpperCase().padStart(6, '0');
  const migFill = 36024 - usedAfter01;
  check(b51carved.includes(`%FREE_BYTES($${migBoundary}, ${migFill}, $FF)`), `carved migration fill should run up to the pool, got fill ${migFill}`);
  // (f) new-slot apply: the DATATABLE's $DA row repoints (the $DB row keeps its
  //     sentinel), Bank51 gains the new incbins, and an empty re-apply restores.
  const newSizeOf = (f: string): number =>
    f === 'DATA_level_DA_obj.bin' ? 500 : f === 'DATA_level_DA_spr.bin' ? 80 : baseSizeOf(f);
  applyLevelDataLayout(yiRoot, null, tmp, map, {
    migrated: new Set(), decoupled: new Set(), newSlots: new Set([0xda]), sizeOf: newSizeOf
  });
  const dt = fs.readFileSync(path.join(tmp, 'Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm'), 'utf8');
  const daLine = dt.split('\n').find((l) => l.includes('; $DA'));
  const dbLine = dt.split('\n').find((l) => l.includes('; $DB'));
  check(!!daLine && daLine.includes('DATA_level_DA_obj,DATA_level_DA_spr'), `the $DA row should repoint (got: ${daLine})`);
  check(!!dbLine && dbLine.includes('DATA_15FCEA,DATA_15FFD5'), `the $DB row should keep its sentinel (got: ${dbLine})`);
  const b51new = fs.readFileSync(path.join(tmp, 'Banks/Bank51.asm'), 'utf8');
  check(b51new.includes('DATA_level_DA_obj:\n\tincbin "LevelData/DATA_level_DA_obj.bin"'), 'Bank51 should incbin the new obj');
  check(b51new.includes('DATA_level_DA_spr:\n\tincbin "LevelData/DATA_level_DA_spr.bin"'), 'Bank51 should incbin the new spr');
  applyLevelDataLayout(yiRoot, null, tmp, map, { migrated: new Set(), decoupled: new Set(), sizeOf: baseSizeOf });
  check(
    fs.readFileSync(path.join(tmp, 'Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm'), 'utf8') ===
      fs.readFileSync(path.join(yiRoot, 'Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm'), 'utf8'),
    'empty re-apply should restore the DATATABLE to base'
  );

  // (g) removal apply: remove 0x01 WHILE importing new-slot 0xDA — the $01 row
  //     goes sentinel, the bank drops its incbins + reclaims, and the new-slot
  //     occurrence targeting is unaffected by the freshly-added sentinel text
  //     (removal repoints run last).
  const newSizeOf2 = (f: string): number =>
    f === 'DATA_level_DA_obj.bin' ? 500 : f === 'DATA_level_DA_spr.bin' ? 80 : baseSizeOf(f);
  applyLevelDataLayout(yiRoot, null, tmp, map, {
    migrated: new Set(), decoupled: new Set(), newSlots: new Set([0xda]), removed: new Set([0x01]), sizeOf: newSizeOf2
  });
  const dtR = fs.readFileSync(path.join(tmp, 'Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm'), 'utf8');
  const row01 = dtR.split('\n').find((l) => l.includes('; $01 '));
  const rowDA = dtR.split('\n').find((l) => l.includes('; $DA'));
  const rowDB = dtR.split('\n').find((l) => l.includes('; $DB'));
  check(!!row01 && row01.includes('dl DATA_15FCEA,DATA_15FFD5') && row01.includes('Watch Out Below'), `removed $01 row should point at the sentinels with its comment intact (got: ${row01})`);
  check(!!rowDA && rowDA.includes('DATA_level_DA_obj,DATA_level_DA_spr'), `the $DA new-slot row still repoints correctly (got: ${rowDA})`);
  check(!!rowDB && rowDB.includes('DATA_15FCEA,DATA_15FFD5'), `the $DB row keeps its sentinel (got: ${rowDB})`);
  const b4cR = fs.readFileSync(path.join(tmp, 'Banks/Bank4C.asm'), 'utf8');
  check(!b4cR.includes('DATA_level_01_obj:') && !b4cR.includes('DATA_level_01_spr:'), 'removed Bank4C should drop both 0x01 incbins');
  const remB = (0x4cfeb7 - (obj01 + spr01)).toString(16).toUpperCase().padStart(6, '0');
  check(b4cR.includes(`%FREE_BYTES($${remB}, ${329 + obj01 + spr01}, $FF)`), 'removed Bank4C boundary should pull back by the freed bytes');

  // (h2) string spill: a grown Bank51 message region pushes the free region's
  //      head, and a concurrent migration + patch pool still compose around it
  //      (text at the front, migrated blobs after it, pool at the fixed end).
  const SPILL = 700;
  applyLevelDataLayout(yiRoot, null, tmp, map, {
    migrated: new Set([0x01]),
    decoupled: new Set(),
    sizeOf: baseSizeOf,
    patchPoolBytes: PATCH_POOL_MAX_BYTES,
    stringSpillBytes: SPILL
  });
  const b51spill = fs.readFileSync(path.join(tmp, 'Banks/Bank51.asm'), 'utf8');
  const spillStart = (0x515348 + SPILL).toString(16).toUpperCase().padStart(6, '0');
  check(
    b51spill.includes(`%InsertMacroAtXPosition($${spillStart})`),
    `spilled Bank51 should org migration past the grown text, got:\n${b51spill.slice(-400)}`
  );
  check(b51spill.includes('%FREE_BYTES($51E000, 8192, $FF)'), 'spill + carve still reserves the pool at the fixed end');
  const spillFill = 36024 - SPILL - (obj01 + spr01);
  const spillBoundary = (0x515348 + SPILL + obj01 + spr01).toString(16).toUpperCase().padStart(6, '0');
  check(
    b51spill.includes(`%FREE_BYTES($${spillBoundary}, ${spillFill}, $FF)`),
    `spill should come off the migration fill, want $${spillBoundary}/${spillFill}`
  );
  // Spill=0 restores base exactly — the byte-identity invariant is unaffected.
  applyLevelDataLayout(yiRoot, null, tmp, map, {
    migrated: new Set(), decoupled: new Set(), sizeOf: baseSizeOf, stringSpillBytes: 0
  });
  check(
    fs.readFileSync(path.join(tmp, 'Banks/Bank51.asm'), 'utf8') ===
      fs.readFileSync(path.join(yiRoot, 'Banks/Bank51.asm'), 'utf8'),
    'stringSpillBytes=0 should leave Bank51 byte-identical to base'
  );

  // (h) empty re-apply clears the removal (idempotent reconcile-from-base).
  applyLevelDataLayout(yiRoot, null, tmp, map, { migrated: new Set(), decoupled: new Set(), sizeOf: baseSizeOf });
  check(
    fs.readFileSync(path.join(tmp, 'Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm'), 'utf8') ===
      fs.readFileSync(path.join(yiRoot, 'Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm'), 'utf8') &&
      fs.readFileSync(path.join(tmp, 'Banks/Bank4C.asm'), 'utf8') ===
        fs.readFileSync(path.join(yiRoot, 'Banks/Bank4C.asm'), 'utf8'),
    'empty re-apply should clear the removal from the DATATABLE + Bank4C'
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── import auto-migration (need-based planner, synthetic pool) ───────────────
{
  // Three same-shape levels in one pool; A1's obj grew by 700 so the pool is
  // 700 over. Of the candidates the planner migrates the cheapest set that
  // fits and leaves the rest at home; with no candidates the violation stays.
  const mkBlob = (lv: string, kind: 'obj' | 'spr', addr: number, bytes: number) => ({
    level: lv, kind, label: `DATA_level_${lv}_${kind}`, file: `DATA_level_${lv}_${kind}.bin`,
    snesAddr: addr, baseBytes: bytes
  });
  const blobs = [
    mkBlob('A0', 'obj', 0x10e000, 1000), mkBlob('A0', 'spr', 0x10e400, 100),
    mkBlob('A1', 'obj', 0x10e800, 1000), mkBlob('A1', 'spr', 0x10ec00, 100),
    mkBlob('A2', 'obj', 0x10f000, 1000), mkBlob('A2', 'spr', 0x10f400, 100)
  ];
  const pool: LevelPool = {
    id: 'Bank10', bank: 0x10, capacityBytes: 3300, headroomBytes: 0,
    tail: { bankFile: 'Banks/Bank10.asm', boundary: 0x10ffa3, fillSize: 0, movable: true, reclaimable: true },
    blobs
  };
  const region51 = { id: 'FreeRegion51', bankFile: 'Banks/Bank51.asm', boundary: 0x515348, capacityBytes: 4000 };
  const synth: PoolMap = {
    romVersion: 'YI_U1', pools: [pool],
    poolByFile: new Map(blobs.map((b) => [b.file, pool])), freeRegions: [region51]
  };
  const sizeOf = (f: string): number => {
    if (f === 'DATA_level_A1_obj.bin') return 1700;
    const b = blobs.find((x) => x.file === f);
    return b ? b.baseBytes : 0;
  };

  // Overage is 700; no level footprint (1100/1800) fits inside it, so the
  // SMALLEST candidate above it migrates — one level, no residuals.
  const all = planAutoMigration(synth, sizeOf, { migrated: new Set(), decoupled: new Set() }, new Set([0xa0, 0xa1, 0xa2]));
  check(all.added.length === 1, `one migration suffices (got ${all.added.length})`);
  check(all.added[0] === 0xa0, `the smallest covering candidate migrates (got ${all.added.map((i) => i.toString(16)).join(',')})`);
  check(all.violations.length === 0, 'no residual violations after auto-migration');

  // Only the grown level as candidate: it migrates itself.
  const grown = planAutoMigration(synth, sizeOf, { migrated: new Set(), decoupled: new Set() }, new Set([0xa1]));
  check(grown.added.length === 1 && grown.added[0] === 0xa1, 'grown-level candidate migrates itself');
  check(grown.violations.length === 0, 'pool fits after migrating the grown level');

  // No candidates: nothing migrates, the violation is surfaced.
  const none = planAutoMigration(synth, sizeOf, { migrated: new Set(), decoupled: new Set() }, new Set());
  check(none.added.length === 0, 'no candidates ⇒ nothing migrated');
  check(none.violations.some((v) => v.poolId === 'Bank10'), 'residual pool-over violation reported');
}

if (failures > 0) {
  console.error(`\nrelocate.test: ${failures} failure(s).`);
  process.exit(1);
}
console.log(`relocate.test: OK — splices + planner + apply over ${map.pools.length} pools, ${map.freeRegions.length} free regions.`);
