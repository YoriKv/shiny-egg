// Build-time level-data layout transform — the unified pass behind free-region
// migration + biased-pointer de-coupling (research/notes-rom-free-space.md).
//
// It generalises the boundary move (boundary-move.ts) into one reconcile-from-base
// pass per bank that composes four edit kinds, all addressed by asar LABEL so the
// runtime never changes:
//   • DELETE a migrated blob's `incbin` from its home bank (consolidating reclaim).
//   • SHIFT the home pool's `%FREE_BYTES` boundary by the SIGNED net growth
//     (reclaim pulls it back; a grown neighbour pushes it forward).
//   • APPEND a relocated blob into a free region (`%FREE_BYTES` tail), preceded by
//     an explicit org so the first blob lands at the region start.
//   • REPOINT a de-coupled level's biased `Ptrs:` sprite row from `DATA_alias-$02`
//     to its now-materialised `DATA_level_XX_spr` label (the only Ptrs edit).
//
// All splices read a CLEAN source (overlay-if-present else base — preserving an
// overlay asm edit like Bank51's string region) and write the build tree, so the
// pass is idempotent: empty migration+decouple sets ⇒ every bank reconciles to its
// clean source ⇒ a no-edit V1.0 build stays byte-identical to the reference cart.

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FreeRegion, PoolMap } from './pool-map.ts';
import {
  biasedPointers,
  carvePatchPool,
  levelHex,
  newSlotRows,
  patchPoolGeometry,
  repointMigrations,
  PATCH_POOL_REGION_ID,
} from './pool-map.ts';
import { rewriteFreeBytesText, snes6, type BoundaryMove } from './boundary-move.ts';

/** The Ptrs/entrance data table — the only file de-couple repoints touch. */
export const DATATABLE = 'Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One blob to emit (label + backing `.bin` + current size). */
export interface BlobInsert {
  label: string;
  file: string;
  bytes: number;
}

// ── pure text splices ───────────────────────────────────────────────────────

/** A blob block as it appears in a bank: `LABEL:\n\tincbin "LevelData/FILE"`. */
function incbinBlock(b: BlobInsert): string {
  return `${b.label}:\n\tincbin "LevelData/${b.file}"`;
}

/**
 * Remove a level blob's `LABEL:\n\tincbin "…"` block (and a single trailing blank
 * line, if present). Throws if the label isn't found (fail loud — a silent miss
 * would leave a stale incbin that overflows the bank).
 */
export function deleteIncbin(text: string, label: string): string {
  const re = new RegExp(
    `^${escapeRe(label)}:[^\\n]*\\n[ \\t]*incbin[^\\n]*\\n(\\n)?`,
    'm'
  );
  if (!re.test(text)) {
    throw new Error(`relocate: incbin block for ${label} not found.`);
  }
  return text.replace(re, '');
}

/**
 * Insert blob blocks immediately before a pool's closing `%FREE_BYTES($B, N, $FF)`
 * line (no org needed — the pool's data already ends at B, so the inserted blobs
 * extend the run and the move's boundary rewrite re-anchors the tail). Throws if
 * the macro isn't found.
 */
export function insertBeforeFreeBytes(
  text: string,
  boundary: number,
  fillSize: number,
  blobs: BlobInsert[]
): string {
  if (blobs.length === 0) return text;
  const re = new RegExp(
    `^([ \\t]*%FREE_BYTES\\(\\$${snes6(boundary)},\\s*${fillSize},\\s*\\$FF\\))`,
    'm'
  );
  if (!re.test(text)) {
    throw new Error(
      `relocate: %FREE_BYTES($${snes6(boundary)}, ${fillSize}, $FF) not found for home insert.`
    );
  }
  const block = blobs.map(incbinBlock).join('\n\n');
  return text.replace(re, `${block}\n\n$1`);
}

/**
 * Append blobs into a free region: replace its lone `%FREE_BYTES($A, F, $FF)` line
 * with an explicit `%InsertMacroAtXPosition($A)` (org to region start, robust if
 * the preceding GSU code doesn't end exactly at A) + the blob blocks + a shrunken
 * `%FREE_BYTES($A+ΣS, F−ΣS, $FF)`. With zero blobs it would be a no-op, but callers
 * skip empty regions. The trailing comment is preserved. Throws if not found.
 *
 * Why this is byte-safe. `%FREE_BYTES(A,F,$FF)`'s first line *is*
 * `%InsertMacroAtXPosition(A)`, which is effectively `assert pc() <= A` then
 * `org A` — so the region is anchored by `org`, NOT by the accumulated size of
 * the code before it. That makes the substitution byte-identical to the original
 * macro when the region is empty: explicit `org A` + emitted blobs (ΣS bytes) +
 * `$FF` fill shrunk to F−ΣS lands the tail at the same A+F it had before — the
 * first ΣS bytes that were `$FF` simply become the blobs, nothing downstream moves.
 * The same `org`-anchoring is why pulling the boundary BACK on a reclaim
 * (negative/signed growth in boundary-move.ts) is self-anchoring and safe — the
 * surviving blobs re-resolve against the unmoved region start, not a running cursor.
 */
export function appendRegionBlobs(
  text: string,
  region: FreeRegion,
  blobs: BlobInsert[]
): string {
  if (blobs.length === 0) return text;
  const re = new RegExp(
    `^([ \\t]*)%FREE_BYTES\\(\\$${snes6(region.boundary)},\\s*${region.capacityBytes},\\s*\\$FF\\)(.*)$`,
    'm'
  );
  const m = re.exec(text);
  if (!m) {
    throw new Error(
      `relocate: free-region %FREE_BYTES($${snes6(region.boundary)}, ${region.capacityBytes}, $FF) not found in ${region.bankFile}.`
    );
  }
  const indent = m[1];
  const trailing = m[2];
  const used = blobs.reduce((n, b) => n + b.bytes, 0);
  const newBoundary = snes6(region.boundary + used);
  const newFill = region.capacityBytes - used;
  const block = blobs.map(incbinBlock).join('\n\n');
  return text.replace(
    re,
    `${indent}%InsertMacroAtXPosition($${snes6(region.boundary)})\n` +
      `${block}\n` +
      `${indent}%FREE_BYTES($${newBoundary}, ${newFill}, $FF)${trailing}`
  );
}

/**
 * Reserve the asm-patch pool at a free region's tail. Splits the region's lone
 * `%FREE_BYTES($A, F, $FF)` into a shrunk migration region `%FREE_BYTES($A, F−P,
 * $FF)` followed by the patch-pool reservation `%FREE_BYTES($A+(F−P), P, $FF)`
 * (both `$FF`-filled in the main assembly phase; patch routines later `org` LoROM
 * addresses over the pool's `$FF`). The migration region's BOUNDARY is unchanged
 * (only its capacity shrinks), so a subsequent `appendRegionBlobs` — driven off
 * the same shrunk-capacity `FreeRegion` — matches the first line. Must run BEFORE
 * `appendRegionBlobs`. Throws if the region's `%FREE_BYTES` isn't found.
 */
export function reservePatchPool(
  text: string,
  region: FreeRegion,
  poolBytes: number
): string {
  const geo = patchPoolGeometry(region, poolBytes);
  const re = new RegExp(
    `^([ \\t]*)%FREE_BYTES\\(\\$${snes6(region.boundary)},\\s*${region.capacityBytes},\\s*\\$FF\\)(.*)$`,
    'm'
  );
  const m = re.exec(text);
  if (!m) {
    throw new Error(
      `reservePatchPool: %FREE_BYTES($${snes6(region.boundary)}, ${region.capacityBytes}, $FF) not found in ${region.bankFile}.`
    );
  }
  const indent = m[1];
  const trailing = m[2];
  return text.replace(
    re,
    `${indent}%FREE_BYTES($${snes6(region.boundary)}, ${geo.migrationCapacity}, $FF)\n` +
      `${indent}%FREE_BYTES($${snes6(geo.fillBoundarySnes)}, ${geo.poolBytes}, $FF) ; asm-patch pool (reserved; see Custom/Asar_Patches_YI.asm)${trailing}`
  );
}

/**
 * Repoint a biased `Ptrs:` row: replace the `DATA_<alias>-$02` expression with the
 * materialised `DATA_level_XX_spr` label, leaving the obj pointer + comment intact.
 * Throws if the biased expression isn't found.
 */
export function repointPtr(text: string, oldExpr: string, newLabel: string): string {
  // `\b` so `DATA_169D23` doesn't also match `DATA_169D23End`, etc.
  const re = new RegExp(escapeRe(oldExpr) + '\\b');
  if (!re.test(text)) {
    throw new Error(`relocate: Ptrs expression "${oldExpr}" not found for repoint.`);
  }
  return text.replace(re, newLabel);
}

/**
 * Repoint the Nth occurrence of a (non-unique) `Ptrs:` row expression — the
 * new-slot rows `$DA`/`$DB` share the identical sentinel text
 * `DATA_15FCEA,DATA_15FFD5`, so a plain first-match replace would always hit
 * `$DA`. Occurrences are counted in file order (== record order in the table).
 * Throws when fewer than `occurrence + 1` occurrences exist (fail loud — a
 * silent miss would boot the sentinel instead of the new level).
 */
export function repointPtrRowOccurrence(
  text: string,
  rowExpr: string,
  occurrence: number,
  replacement: string
): string {
  const re = new RegExp(escapeRe(rowExpr) + '\\b', 'g');
  let n = 0;
  let replaced = false;
  const out = text.replace(re, (m) => {
    if (n++ === occurrence) {
      replaced = true;
      return replacement;
    }
    return m;
  });
  if (!replaced) {
    throw new Error(
      `relocate: occurrence ${occurrence} of Ptrs row "${rowExpr}" not found (saw ${n}).`
    );
  }
  return out;
}

// ── planning ────────────────────────────────────────────────────────────────

export interface PlacedRelocation {
  level: number;
  kind: 'obj' | 'spr';
  file: string;
  label: string;
  bytes: number;
  /** Free region the blob lands in. */
  regionId: string;
  /** Home bank the blob's incbin is deleted from. */
  homeBankFile: string;
}

export interface DecouplePlacement {
  level: number;
  label: string;
  file: string;
  bytes: number;
  /** Pool id (home) or free-region id the materialised spr blob lands in. */
  placedIn: string;
}

export interface LayoutViolation {
  kind: 'region-full' | 'pool-over';
  /** Region/pool id, or blob label for a region-full. */
  id: string;
  /** Bytes that didn't fit. */
  bytes: number;
}

/** A home-bank insert of de-coupled blobs before a movable pool's `%FREE_BYTES`. */
interface HomeInsert {
  bankFile: string;
  boundary: number;
  fillSize: number;
  blobs: BlobInsert[];
}

interface RegionAppend {
  region: FreeRegion;
  blobs: BlobInsert[];
}

export interface LayoutPlan {
  relocations: PlacedRelocation[];
  decouples: DecouplePlacement[];
  moves: BoundaryMove[];
  /** Per-bank, per-region edit instructions the apply pass replays. */
  deletions: { bankFile: string; label: string }[];
  homeInserts: HomeInsert[];
  regionAppends: RegionAppend[];
  repoints: { oldExpr: string; newLabel: string }[];
  /** Occurrence-targeted `Ptrs:` row repoints (the new-slot sentinel rows —
   *  their text is identical across rows, so `repoints` can't address them). */
  rowRepoints: { rowExpr: string; occurrence: number; replacement: string }[];
  violations: LayoutViolation[];
}

export interface LayoutOptions {
  /** Level record ids migrated into free regions. */
  migrated: ReadonlySet<number>;
  /** Level record ids de-coupled (materialise own spr + repoint). */
  decoupled: ReadonlySet<number>;
  /** New-slot record ids (`$DA`/`$DB`) given real data: their overlay blobs are
   *  placed in free regions and their sentinel `Ptrs:` row is repointed. A slot
   *  whose obj blob has no bytes on disk is skipped (nothing to boot). */
  newSlots?: ReadonlySet<number>;
  /** Current size of a blob `.bin` (overlay-if-saved, base otherwise). */
  sizeOf: (file: string) => number;
  /** Bytes to reserve at FreeRegion51's tail for the asm-patch pool (0 = none).
   *  Set when the project has enabled asm patches, so migration's capacity is
   *  shrunk to match the carve and never first-fits into the patch slice. */
  patchPoolBytes?: number;
}

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

/**
 * Pure placement + boundary-move planner. Deterministic (sorted level ids, stable
 * region order) so the same input always yields the same plan → no build churn.
 */
export function planLayout(map: PoolMap, opts: LayoutOptions): LayoutPlan {
  const migratedHex = new Set([...opts.migrated].map(levelHex));
  const regions = map.freeRegions;
  const regionFree = new Map(regions.map((r) => [r.id, r.capacityBytes]));
  const regionInserts = new Map<string, BlobInsert[]>();
  const poolInserts = new Map<string, BlobInsert[]>();

  const relocations: PlacedRelocation[] = [];
  const decouples: DecouplePlacement[] = [];
  const deletions: { bankFile: string; label: string }[] = [];
  const repoints: { oldExpr: string; newLabel: string }[] = [];
  const rowRepoints: { rowExpr: string; occurrence: number; replacement: string }[] = [];
  const violations: LayoutViolation[] = [];

  /** First-fit a blob into a free region (stable order); null if none fits. */
  const place = (blob: BlobInsert): string | null => {
    for (const r of regions) {
      if ((regionFree.get(r.id) ?? 0) >= blob.bytes) {
        regionFree.set(r.id, (regionFree.get(r.id) ?? 0) - blob.bytes);
        pushTo(regionInserts, r.id, blob);
        return r.id;
      }
    }
    return null;
  };

  // 1. Migration: relocate each migrated level's blobs into free regions.
  //    (obj before spr, level id ascending.) A tracked blob is moved out of its
  //    home bank (delete + reclaim). A blob whose Ptrs pointer is a raw/overlapping
  //    label (no tracked DATA_level_XX) is handled by a REPOINT migration:
  //    materialise a self-contained copy in a region + repoint the row, leaving
  //    the (possibly shared) original bytes in place.
  const repointTable = repointMigrations(map.romVersion);
  for (const level of [...opts.migrated].sort((a, b) => a - b)) {
    const hex = levelHex(level);
    for (const kind of ['obj', 'spr'] as const) {
      const file = `DATA_level_${hex}_${kind}.bin`;
      const pool = map.poolByFile.get(file);
      if (pool) {
        const blob: BlobInsert = { label: `DATA_level_${hex}_${kind}`, file, bytes: opts.sizeOf(file) };
        const regionId = place(blob);
        if (!regionId) {
          violations.push({ kind: 'region-full', id: blob.label, bytes: blob.bytes });
          continue;
        }
        relocations.push({ level, kind, file, label: blob.label, bytes: blob.bytes, regionId, homeBankFile: pool.tail.bankFile });
        deletions.push({ bankFile: pool.tail.bankFile, label: blob.label });
        continue;
      }
      const rep = repointTable.find((r) => r.level === hex && r.kind === kind);
      if (!rep) continue; // no tracked blob and no repoint rule → nothing to move
      const blob: BlobInsert = { label: rep.newLabel, file: rep.fullFile, bytes: opts.sizeOf(rep.fullFile) };
      const regionId = place(blob);
      if (!regionId) {
        violations.push({ kind: 'region-full', id: blob.label, bytes: blob.bytes });
        continue;
      }
      relocations.push({ level, kind, file: rep.fullFile, label: rep.newLabel, bytes: blob.bytes, regionId, homeBankFile: rep.homeBankFile });
      repoints.push({ oldExpr: rep.oldExpr, newLabel: rep.newLabel });
    }
  }

  // 1.5. New slots: place each flagged sentinel row's overlay blobs into free
  //      regions + repoint that row (occurrence-targeted — the rows' text is
  //      identical). No deletion/reclaim: the slot never owned pool bytes; the
  //      1-byte sentinels stay (other rows/engine paths still reference them).
  //      Skipped when the obj blob has no bytes on disk (nothing imported yet).
  const slotRows = newSlotRows(map.romVersion);
  for (const recordId of [...(opts.newSlots ?? [])].sort((a, b) => a - b)) {
    const row = slotRows.find((r) => r.recordId === recordId);
    if (!row) continue; // not a known sentinel slot → ignore (defensive)
    const objBlob: BlobInsert = {
      label: `DATA_level_${row.level}_obj`,
      file: `DATA_level_${row.level}_obj.bin`,
      bytes: opts.sizeOf(`DATA_level_${row.level}_obj.bin`),
    };
    if (objBlob.bytes === 0) continue;
    const sprBytes = opts.sizeOf(`DATA_level_${row.level}_spr.bin`);
    const sprBlob: BlobInsert | null =
      sprBytes > 0
        ? { label: `DATA_level_${row.level}_spr`, file: `DATA_level_${row.level}_spr.bin`, bytes: sprBytes }
        : null;

    const objRegion = place(objBlob);
    if (!objRegion) {
      violations.push({ kind: 'region-full', id: objBlob.label, bytes: objBlob.bytes });
      continue;
    }
    relocations.push({ level: recordId, kind: 'obj', file: objBlob.file, label: objBlob.label, bytes: objBlob.bytes, regionId: objRegion, homeBankFile: '' });
    let sprLabel = row.sprSentinel;
    if (sprBlob) {
      const sprRegion = place(sprBlob);
      if (!sprRegion) {
        violations.push({ kind: 'region-full', id: sprBlob.label, bytes: sprBlob.bytes });
        continue;
      }
      relocations.push({ level: recordId, kind: 'spr', file: sprBlob.file, label: sprBlob.label, bytes: sprBlob.bytes, regionId: sprRegion, homeBankFile: '' });
      sprLabel = sprBlob.label;
    }
    rowRepoints.push({
      rowExpr: row.rowExpr,
      occurrence: row.occurrence,
      replacement: `${objBlob.label},${sprLabel}`,
    });
  }

  // 2. Per movable/reclaimable pool, the signed growth over POST-migration
  //    membership (negative = a reclaim from a migrated-out blob).
  const poolGrowth = new Map<string, number>();
  for (const pool of map.pools) {
    if (!pool.tail.movable && !pool.tail.reclaimable) continue;
    const used = pool.blobs
      .filter((b) => !migratedHex.has(b.level))
      .reduce((n, b) => n + opts.sizeOf(b.file), 0);
    poolGrowth.set(pool.id, used - pool.capacityBytes);
  }

  // 3. De-couple: materialise each biased level's own spr blob, home-first.
  const biased = biasedPointers(map.romVersion);
  for (const level of [...opts.decoupled].sort((a, b) => a - b)) {
    const hex = levelHex(level);
    const b = biased.find((x) => x.level === hex);
    if (!b) continue; // not a known biased level → ignore (defensive)
    const file = `DATA_level_${hex}_spr.bin`;
    const blob: BlobInsert = { label: `DATA_level_${hex}_spr`, file, bytes: opts.sizeOf(file) };
    const objPool = map.poolByFile.get(`DATA_level_${hex}_obj.bin`);

    let placedIn: string | null = null;
    if (objPool && objPool.tail.movable) {
      const cur = poolGrowth.get(objPool.id) ?? 0;
      if (cur + blob.bytes <= objPool.tail.fillSize) {
        poolGrowth.set(objPool.id, cur + blob.bytes);
        pushTo(poolInserts, objPool.id, blob);
        placedIn = objPool.id;
      }
    }
    if (!placedIn) placedIn = place(blob); // home full → free-region fallback
    if (!placedIn) {
      violations.push({ kind: 'region-full', id: blob.label, bytes: blob.bytes });
      continue;
    }
    decouples.push({ level, label: blob.label, file, bytes: blob.bytes, placedIn });
    repoints.push({ oldExpr: `${b.alias}-$02`, newLabel: blob.label });
  }

  // 4. Emit moves + over-budget violations from the final per-pool growth.
  const moves: BoundaryMove[] = [];
  for (const pool of map.pools) {
    if (!pool.tail.movable && !pool.tail.reclaimable) continue;
    const g = poolGrowth.get(pool.id) ?? 0;
    if (g > 0) {
      // Forward growth: only a MOVABLE pool can absorb it (grow into spare fill).
      // A reclaimable-only pool's fill is load-bearing (Bank15) — any growth
      // overflows (it should already be blocked upstream, since headroom is 0).
      if (!pool.tail.movable || g > pool.tail.fillSize) {
        violations.push({ kind: 'pool-over', id: pool.id, bytes: pool.tail.movable ? g - pool.tail.fillSize : g });
        continue;
      }
    }
    if (g !== 0) {
      // g < 0 (reclaim) for a reclaimable-only pool; g ≠ 0 for a movable one.
      moves.push({ bankFile: pool.tail.bankFile, poolId: pool.id, boundary: pool.tail.boundary, fillSize: pool.tail.fillSize, growth: g });
    }
  }

  const homeInserts: HomeInsert[] = [];
  for (const pool of map.pools) {
    const blobs = poolInserts.get(pool.id);
    if (blobs?.length) {
      homeInserts.push({ bankFile: pool.tail.bankFile, boundary: pool.tail.boundary, fillSize: pool.tail.fillSize, blobs });
    }
  }
  const regionAppends: RegionAppend[] = [];
  for (const region of regions) {
    const blobs = regionInserts.get(region.id);
    if (blobs?.length) regionAppends.push({ region, blobs });
  }

  return { relocations, decouples, moves, deletions, homeInserts, regionAppends, repoints, rowRepoints, violations };
}

// ── apply ─────────────────────────────────────────────────────────────────--

/** Banks reconciled every build (so a stale edit is always cleared): every
 *  movable OR reclaimable pool bank, every free-region bank, and the Ptrs table. */
function reconciledBanks(map: PoolMap): string[] {
  const set = new Set<string>();
  for (const p of map.pools) if (p.tail.movable || p.tail.reclaimable) set.add(p.tail.bankFile);
  for (const r of map.freeRegions) set.add(r.bankFile);
  set.add(DATATABLE);
  return [...set];
}

/**
 * Reconcile every touched bank from its clean source (overlay-if-present else
 * base) and write the build tree. Supersedes `applyBoundaryMoves`: handles the
 * boundary move AND migration deletes/appends AND de-couple inserts/repoints in a
 * single per-bank pass. Returns the plan (for the build log + the editor report).
 */
export function applyLevelDataLayout(
  baseYiRoot: string,
  overlayYiRoot: string | null,
  treeYiRoot: string,
  map: PoolMap,
  opts: LayoutOptions
): LayoutPlan {
  // Asm-patch pool: carve a fixed slice off FreeRegion51's tail and shrink that
  // region's capacity so migration plans + appends respect the reservation. The
  // ORIGINAL region (full capacity) drives the carve splice's regex (reservePatchPool
  // below); the SHRUNK map (carvePatchPool — the SAME helper the budget gate uses,
  // so gate and build agree) drives planLayout + appendRegionBlobs. patchPoolBytes=0
  // ⇒ no carve ⇒ the region reconciles to its clean source ⇒ byte-exact base preserved.
  const poolBytes = opts.patchPoolBytes ?? 0;
  const hostRegion =
    poolBytes > 0 ? map.freeRegions.find((r) => r.id === PATCH_POOL_REGION_ID) ?? null : null;
  const effectiveMap = carvePatchPool(map, poolBytes);

  const plan = planLayout(effectiveMap, opts);

  for (const bankFile of reconciledBanks(effectiveMap)) {
    const overlaid = overlayYiRoot ? path.join(overlayYiRoot, bankFile) : null;
    const src = overlaid && fs.existsSync(overlaid) ? overlaid : path.join(baseYiRoot, bankFile);
    let text = fs.readFileSync(src, 'utf8');

    // Carve FIRST (rewrites the full-capacity %FREE_BYTES into shrunk-migration +
    // pool), so the deletions/appends below act on the shrunk region.
    if (hostRegion && bankFile === hostRegion.bankFile) {
      text = reservePatchPool(text, hostRegion, poolBytes);
    }
    for (const d of plan.deletions) {
      if (d.bankFile === bankFile) text = deleteIncbin(text, d.label);
    }
    for (const hi of plan.homeInserts) {
      if (hi.bankFile === bankFile) text = insertBeforeFreeBytes(text, hi.boundary, hi.fillSize, hi.blobs);
    }
    for (const ra of plan.regionAppends) {
      if (ra.region.bankFile === bankFile) text = appendRegionBlobs(text, ra.region, ra.blobs);
    }
    for (const mv of plan.moves) {
      if (mv.bankFile === bankFile) text = rewriteFreeBytesText(text, mv);
    }
    if (bankFile === DATATABLE) {
      for (const rp of plan.repoints) text = repointPtr(text, rp.oldExpr, rp.newLabel);
      // Row repoints AFTER expression repoints: each consumes one occurrence of
      // the shared sentinel row text, in record order (occurrences are indexed
      // against the ORIGINAL text, so apply descending to keep indices stable).
      for (const rr of [...plan.rowRepoints].sort((a, b) => b.occurrence - a.occurrence)) {
        text = repointPtrRowOccurrence(text, rr.rowExpr, rr.occurrence, rr.replacement);
      }
    }

    const dest = path.join(treeYiRoot, bankFile);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text, 'utf8');
  }

  return plan;
}
