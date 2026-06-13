// Level-data byte-budget computation over the shared pools (pool-map.ts), made
// free-region + migration aware (research/notes-level-data-byte-budget.md): each view
// takes a LayoutContext (the active migrated / de-coupled sets) and runs
// `planLayout`, so a migrated-out level leaves its home pool (reclaimed) and lands
// in a free region.
//
//   • computeLevelBudget — the LIVE per-level report shown while editing (edited
//     blobs use freshly serialized sizes; bank-mates use on-disk sizes). Drives
//     the warn-on-save / block-on-build blockers, plus `relocatedTo`/`canRelocate`.
//   • computePoolOverview / computeFreeRegionsOverview — the Banks-panel pools +
//     "Free space" sections.
//   • checkAllPools — the pre-build gate: any residual `planLayout` violation (a
//     pool still over after migration, or a region over capacity) refuses the
//     build with an actionable message.
//
// `loadPoolMap` reads the build `.sym` (blob addresses) + base `.bin` sizes and
// caches by (sym path, mtime, version). The disk-size lookup is injected by the
// app layer (it knows the active project's overlay dir).

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  FreeRegionOverviewEntry,
  PoolBudgetEntry,
  PoolBudgetReport,
  PoolOverviewEntry,
  RomVersion
} from './types.ts';
import {
  biasedPointers,
  buildPoolMap,
  levelHex,
  migratable,
  poolLevels,
  type LevelPool,
  type PoolMap
} from './pool-map.ts';
import { planLayout } from './relocate.ts';
import { hex0x } from './hex.ts';

/** Migration/de-couple context the budget views apply (default: none). */
export interface LayoutContext {
  migrated?: ReadonlySet<number>;
  decoupled?: ReadonlySet<number>;
  /** New-slot records (`$DA`/`$DB`) with imported data — their blobs claim
   *  free-region capacity, so every budget view must plan them like the build. */
  newSlots?: ReadonlySet<number>;
  /** Records REMOVED from the game — their owned blobs leave their pools
   *  (the boundary reclaim frees the bytes), mirroring the build layout. */
  removed?: ReadonlySet<number>;
}

const EMPTY: ReadonlySet<number> = new Set();
/** Resolve a LayoutContext to concrete sets (shared empty when absent). */
function ctxSets(ctx?: LayoutContext): {
  migrated: ReadonlySet<number>;
  decoupled: ReadonlySet<number>;
  newSlots: ReadonlySet<number>;
  removed: ReadonlySet<number>;
} {
  return {
    migrated: ctx?.migrated ?? EMPTY,
    decoupled: ctx?.decoupled ?? EMPTY,
    newSlots: ctx?.newSlots ?? EMPTY,
    removed: ctx?.removed ?? EMPTY
  };
}

/** Union of the sets whose `Ptrs:` rows no longer reference a raw slice —
 *  the `freedRawRows` argument `migratable` wants (0x7D migrated or removed
 *  releases its hold on DATA_level_A5_obj / DATA_level_17_spr). */
function freedRawRows(
  migrated: ReadonlySet<number>,
  removed: ReadonlySet<number>
): ReadonlySet<number> {
  return new Set([...migrated, ...removed]);
}

// ── Pool-map cache ──────────────────────────────────────────────────────────

let cache: { key: string; map: PoolMap } | null = null;

export interface LoadPoolMapOptions {
  romVersion: RomVersion;
  /** Path to the build `.sym` (provides blob addresses for membership). */
  symPath: string;
  /** Directory holding the base `.bin` blobs (frameworkWorkRoot/assets/yi/LevelData). */
  baseBinDir: string;
}

/** Load (and cache) the pool map. Returns null if the `.sym` is missing or the
 *  ROM version has no boundary table — callers then skip the gate (the asar
 *  assert stays the backstop). */
export function loadPoolMap(opts: LoadPoolMapOptions): PoolMap | null {
  let mtime: number;
  try {
    mtime = fs.statSync(opts.symPath).mtimeMs;
  } catch {
    return null;
  }
  const key = `${opts.romVersion}|${opts.symPath}|${mtime}`;
  if (cache?.key === key) return cache.map;
  try {
    const symText = fs.readFileSync(opts.symPath, 'utf8');
    const map = buildPoolMap(opts.romVersion, symText, (file) =>
      binSize(path.join(opts.baseBinDir, file))
    );
    cache = { key, map };
    return map;
  } catch {
    return null;
  }
}

export function invalidatePoolMapCache(): void {
  cache = null;
}

function binSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

// ── Budget computation ──────────────────────────────────────────────────────

/** Pool total, EXCLUDING any level migrated out to a free region and any blob a
 *  removal freed (its home slot is reclaimed, so it no longer counts) — keeps
 *  the per-level banner in step with `computePoolOverview`. */
function usedBytes(
  pool: LevelPool,
  sizeOf: (file: string) => number,
  migratedHex: ReadonlySet<string>,
  freedFiles: ReadonlySet<string>
): number {
  return pool.blobs.reduce(
    (n, b) => (migratedHex.has(b.level) || freedFiles.has(b.file) ? n : n + sizeOf(b.file)),
    0
  );
}

function makeEntry(
  pool: LevelPool,
  sizeOf: (file: string) => number,
  levelRecordId: number,
  migratedHex: ReadonlySet<string>,
  removedHex: ReadonlySet<string>,
  freedFiles: ReadonlySet<string>,
  /** Bytes of any de-coupled spr blob materialised home in this pool. */
  decoupleHomeBytes: number
): PoolBudgetEntry {
  const used = usedBytes(pool, sizeOf, migratedHex, freedFiles) + decoupleHomeBytes;
  const curHex = levelHex(levelRecordId);
  const otherLevels = poolLevels(pool)
    .filter((l) => l !== curHex && !migratedHex.has(l) && !removedHex.has(l))
    .map((l) => '0x' + l);
  return {
    poolId: pool.id,
    bank: hex0x(pool.bank),
    capacityBytes: pool.capacityBytes,
    headroomBytes: pool.headroomBytes,
    usedBytes: used,
    overBy: used - (pool.capacityBytes + pool.headroomBytes),
    otherLevels,
  };
}

export interface LevelStreamFiles {
  objFile: string | null;
  spriteFile: string | null;
}

export interface LiveStreamSizes {
  objBytes: number;
  spriteBytes: number;
}

/**
 * Live budget for the level currently being edited. Its obj/spr blobs take the
 * freshly serialized `liveSizes`; every other blob in each touched pool takes
 * `diskSizeOf(file)` (overlay-if-saved, base otherwise). A level can touch two
 * pools (Bank15 splits obj vs spr), so up to two entries come back.
 */
export function computeLevelBudget(
  map: PoolMap,
  levelRecordId: number,
  files: LevelStreamFiles,
  liveSizes: LiveStreamSizes,
  diskSizeOf: (file: string) => number,
  ctx?: LayoutContext
): PoolBudgetReport {
  const { migrated, decoupled, newSlots, removed } = ctxSets(ctx);
  const sizeOf = (file: string): number => {
    if (files.objFile && file === files.objFile) return liveSizes.objBytes;
    if (files.spriteFile && file === files.spriteFile) return liveSizes.spriteBytes;
    return diskSizeOf(file);
  };
  const tag = `DATA_level_${levelHex(levelRecordId)}_`;
  const fitsRegion = (extra: ReadonlySet<number>): { regions: string[]; ok: boolean } => {
    const plan = planLayout(map, { migrated: extra, decoupled, newSlots, removed, sizeOf });
    const regions = [...new Set(plan.relocations.filter((r) => r.level === levelRecordId).map((r) => r.regionId))];
    const overflow = plan.violations.some((v) => v.kind === 'region-full' && v.id.startsWith(tag));
    return { regions, ok: !overflow };
  };

  // Already migrated → report the relocation, not a home-pool overflow.
  if (migrated.has(levelRecordId)) {
    const { regions, ok } = fitsRegion(migrated);
    return {
      levelRecordId: hex0x(levelRecordId),
      pools: [],
      over: !ok,
      worstOverBy: 0,
      relocatedTo: regions
    };
  }

  // Migration/de-couple/removal-aware pool totals (mirror computePoolOverview):
  // exclude migrated-out bank-mates + removal-freed blobs, add any de-coupled
  // spr blob placed home.
  const migratedHex = new Set([...migrated].map(levelHex));
  const removedHex = new Set([...removed].map(levelHex));
  const plan = planLayout(map, { migrated, decoupled, newSlots, removed, sizeOf });
  const freedFiles = new Set(plan.removals.map((r) => r.file));
  const decoupleHome = new Map<string, number>();
  for (const d of plan.decouples) {
    decoupleHome.set(d.placedIn, (decoupleHome.get(d.placedIn) ?? 0) + d.bytes);
  }
  const touched: LevelPool[] = [];
  for (const f of [files.objFile, files.spriteFile]) {
    if (!f) continue;
    const pool = map.poolByFile.get(f);
    if (pool && !touched.includes(pool)) touched.push(pool);
  }
  const pools = touched.map((p) =>
    makeEntry(p, sizeOf, levelRecordId, migratedHex, removedHex, freedFiles, decoupleHome.get(p.id) ?? 0)
  );
  const over = pools.some((e) => e.overBy > 0);
  // Offer migration when over a home pool but the level could relocate cleanly.
  const canRelocate =
    over &&
    migratable(map, levelRecordId, decoupled, freedRawRows(migrated, removed)) &&
    fitsRegion(new Set([...migrated, levelRecordId])).ok;
  return {
    levelRecordId: hex0x(levelRecordId),
    pools,
    over,
    worstOverBy: pools.length ? Math.max(...pools.map((e) => e.overBy)) : 0,
    ...(canRelocate ? { canRelocate: true } : {})
  };
}

/**
 * Cross-pool overview for the informational "Banks" panel: every level-data pool
 * with its capacity/headroom/used/free totals and a per-level byte breakdown.
 * `sizeOf` returns each blob's current size (live-overlaid for the edited level,
 * on-disk otherwise) — the same size lens `computeLevelBudget`/`checkAllPools`
 * use, so the figures agree with the editor's per-level budget. Pure: the
 * disk-reading + live-size wiring lives in the app layer.
 */
export function computePoolOverview(
  map: PoolMap,
  sizeOf: (file: string) => number,
  ctx?: LayoutContext
): PoolOverviewEntry[] {
  const { migrated, decoupled, removed } = ctxSets(ctx);
  const migratedHex = new Set([...migrated].map(levelHex));
  const biasedSet = new Set(biasedPointers(map.romVersion).map((b) => b.level));
  const plan = planLayout(map, { migrated, decoupled, removed, sizeOf });
  const freedFiles = new Set(plan.removals.map((r) => r.file));
  const freed = freedRawRows(migrated, removed);
  return map.pools.map((pool) => {
    // Migrated levels leave the pool (consolidating reclaim hands their room
    // back), as do a removed level's freed blobs; a de-couple placed home adds
    // its materialised spr blob. A removed level with residual bytes (a kept
    // raw slice / borrowed terminator / non-reclaimable pool) still shows, with
    // `removed: true` so the panel can label the residue.
    const byLevel = new Map<string, number>();
    for (const b of pool.blobs) {
      if (migratedHex.has(b.level) || freedFiles.has(b.file)) continue;
      byLevel.set(b.level, (byLevel.get(b.level) ?? 0) + sizeOf(b.file));
    }
    for (const d of plan.decouples) {
      if (d.placedIn !== pool.id) continue;
      const lh = levelHex(d.level);
      byLevel.set(lh, (byLevel.get(lh) ?? 0) + d.bytes);
    }
    const used = [...byLevel.values()].reduce((n, v) => n + v, 0);
    const limit = pool.capacityBytes + pool.headroomBytes;
    const levels = [...byLevel.entries()]
      .map(([level, bytes]) => {
        const rid = parseInt(level, 16);
        return {
          levelRecordId: '0x' + level,
          bytes,
          migratable: migratable(map, rid, decoupled, freed),
          decouplable: biasedSet.has(level),
          decoupled: decoupled.has(rid),
          // Only reachable by a level that ALSO appears in `levels` despite being
          // migrated — i.e. the de-coupled-spr-placed-home residual row.
          ...(migrated.has(rid) ? { migrated: true } : {}),
          ...(removed.has(rid) ? { removed: true } : {})
        };
      })
      .sort((a, b) => b.bytes - a.bytes);
    // Removal-freed bytes per level in THIS pool (informational: what the
    // remove handed back).
    const removedBytes = new Map<string, number>();
    for (const r of plan.removals) {
      if (r.poolId !== pool.id) continue;
      const lh = levelHex(r.level);
      removedBytes.set(lh, (removedBytes.get(lh) ?? 0) + r.bytes);
    }
    const removedOut = [...removedBytes.entries()].map(([level, bytes]) => ({
      levelRecordId: '0x' + level,
      bytes
    }));
    // Migrated-out levels: keep their byte size visible (the bytes this level's
    // blobs in THIS pool would re-occupy if migrated back) so the user can weigh a
    // move-back against the pool's free space — even though they no longer count
    // toward `used`.
    const migratedBytes = new Map<string, number>()
    for (const b of pool.blobs) {
      if (!migratedHex.has(b.level)) continue
      migratedBytes.set(b.level, (migratedBytes.get(b.level) ?? 0) + sizeOf(b.file))
    }
    const migratedOut = [...migratedBytes.entries()].map(([level, bytes]) => ({
      levelRecordId: '0x' + level,
      regionId: plan.relocations.find((r) => levelHex(r.level) === level)?.regionId ?? '',
      bytes,
      // A migrated biased level has no resident row, so its de-couple toggle
      // rides the migrated-out row instead.
      ...(biasedSet.has(level)
        ? { decouplable: true, decoupled: decoupled.has(parseInt(level, 16)) }
        : {})
    }));
    return {
      poolId: pool.id,
      bank: hex0x(pool.bank),
      movable: pool.tail.movable,
      reclaimable: pool.tail.reclaimable,
      capacityBytes: pool.capacityBytes,
      headroomBytes: pool.headroomBytes,
      limitBytes: limit,
      usedBytes: used,
      freeBytes: limit - used,
      levels,
      ...(migratedOut.length ? { migratedOut } : {}),
      ...(removedOut.length ? { removedOut } : {})
    };
  });
}

/**
 * Free-region overview for the Banks panel's "Free space" section: each region
 * with its capacity/used/free and the levels relocated (or de-coupled) into it.
 */
export function computeFreeRegionsOverview(
  map: PoolMap,
  sizeOf: (file: string) => number,
  ctx?: LayoutContext
): FreeRegionOverviewEntry[] {
  const plan = planLayout(map, { ...ctxSets(ctx), sizeOf });
  return map.freeRegions.map((region) => {
    const byLevel = new Map<string, number>();
    for (const r of plan.relocations) {
      if (r.regionId !== region.id) continue;
      const lh = levelHex(r.level);
      byLevel.set(lh, (byLevel.get(lh) ?? 0) + r.bytes);
    }
    for (const d of plan.decouples) {
      if (d.placedIn !== region.id) continue;
      const lh = levelHex(d.level);
      byLevel.set(lh, (byLevel.get(lh) ?? 0) + d.bytes);
    }
    const used = [...byLevel.values()].reduce((n, v) => n + v, 0);
    const levels = [...byLevel.entries()]
      .map(([level, bytes]) => ({ levelRecordId: '0x' + level, bytes }))
      .sort((a, b) => b.bytes - a.bytes);
    return {
      id: region.id,
      bank: hex0x((region.boundary >>> 16) & 0xff),
      capacityBytes: region.capacityBytes,
      usedBytes: used,
      freeBytes: region.capacityBytes - used,
      levels
    };
  });
}

export interface PoolViolation {
  poolId: string;
  bank: string;
  /** Effective limit = base capacity + movable headroom. */
  limitBytes: number;
  usedBytes: number;
  overBy: number;
  /** All level ids (hex) sharing the pool — where the user can free space. */
  levels: string[];
}

/**
 * Pre-build gate: every pool's on-disk total vs its effective limit (base
 * capacity + movable headroom). Any positive `overBy` means the build would trip
 * the asar boundary assert even after the boundary move. `diskSizeOf` returns
 * each blob's current size (overlay-if-saved, base otherwise).
 */
export function checkAllPools(
  map: PoolMap,
  diskSizeOf: (file: string) => number,
  ctx?: LayoutContext
): PoolViolation[] {
  const plan = planLayout(map, { ...ctxSets(ctx), sizeOf: diskSizeOf });
  const out: PoolViolation[] = [];
  for (const v of plan.violations) {
    if (v.kind === 'pool-over') {
      const pool = map.pools.find((p) => p.id === v.id);
      if (!pool) continue;
      const limit = pool.capacityBytes + pool.headroomBytes;
      out.push({
        poolId: pool.id,
        bank: hex0x(pool.bank),
        limitBytes: limit,
        usedBytes: limit + v.bytes, // overBy = used − limit
        overBy: v.bytes,
        levels: poolLevels(pool).map((l) => '0x' + l)
      });
    } else {
      // region-full: a blob (v.id is its label) didn't fit any free region.
      out.push({
        poolId: 'free-space',
        bank: '',
        limitBytes: 0,
        usedBytes: v.bytes,
        overBy: v.bytes,
        levels: [v.id]
      });
    }
  }
  return out;
}

// ── Import auto-migration (need-based) ──────────────────────────────────────
// The ROM importer writes imported levels at their HOME pool files; a hack's
// grown levels can overflow those pools. The hack itself relocated its edited
// streams into ITS free space (GoldenEgg repoints EVERY saved level, fit or
// not), so "match the hack" can't mean "migrate everything it moved" — a full
// hack repoints ~185 levels (~227 KB) and our free regions hold ~63 KB. Instead
// this plans the MINIMAL migration that makes the imported sizes fit: only
// candidate levels the hack relocated, only when their home pool actually
// overflows, preferring the picks that cover the overage with the fewest moved
// bytes.

export interface AutoMigrationPlan {
  /** Record ids to ADD to the project's migrated set (sorted ascending). */
  added: number[];
  /** Violations that REMAIN after the added migrations (pool-over with no
   *  eligible candidate left, or free regions full) — surfaced as a warning. */
  violations: PoolViolation[];
}

/**
 * Greedy need-based migration over `candidates` (record ids the hack relocated
 * AND the user imported). Each round re-plans the full layout, then for every
 * over-budget pool migrates ONE candidate: the largest level that still fits
 * inside the overage (covers most without overshooting), else the smallest one
 * above it (minimal overshoot). Replanning between rounds keeps cross-pool
 * effects (a level's obj+spr in different pools) and free-region capacity
 * honest. Deterministic; terminates when nothing is over or no candidate helps.
 */
export function planAutoMigration(
  map: PoolMap,
  sizeOf: (file: string) => number,
  ctx: LayoutContext,
  candidates: ReadonlySet<number>
): AutoMigrationPlan {
  const decoupled = ctx.decoupled ?? new Set<number>();
  const newSlots = ctx.newSlots ?? new Set<number>();
  const removed = ctx.removed ?? new Set<number>();
  const migrated = new Set(ctx.migrated ?? []);
  const added: number[] = [];
  const levelBytes = (id: number): number => {
    const hex = levelHex(id);
    return sizeOf(`DATA_level_${hex}_obj.bin`) + sizeOf(`DATA_level_${hex}_spr.bin`);
  };

  // Bounded by the candidate count: each round migrates ≥1 candidate or stops.
  for (let round = 0; round <= candidates.size; round++) {
    const over = checkAllPools(map, sizeOf, { migrated, decoupled, newSlots, removed }).filter(
      (v) => v.poolId !== 'free-space'
    );
    if (over.length === 0) break;
    let progressed = false;
    for (const v of over) {
      const pool = map.pools.find((p) => p.id === v.poolId);
      if (!pool) continue;
      const ids = poolLevels(pool)
        .map((h) => parseInt(h, 16))
        .filter(
          (id) =>
            candidates.has(id) &&
            !migrated.has(id) &&
            migratable(map, id, decoupled, freedRawRows(migrated, removed))
        );
      if (ids.length === 0) continue;
      const sized = ids.map((id) => ({ id, bytes: levelBytes(id) })).sort((a, b) => a.bytes - b.bytes);
      const fitting = sized.filter((s) => s.bytes <= v.overBy);
      const pick = fitting.length > 0 ? fitting[fitting.length - 1] : sized[0];
      migrated.add(pick.id);
      added.push(pick.id);
      progressed = true;
    }
    if (!progressed) break;
  }

  return {
    added: added.sort((a, b) => a - b),
    violations: checkAllPools(map, sizeOf, { migrated, decoupled, newSlots, removed })
  };
}
