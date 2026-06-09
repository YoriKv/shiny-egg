// Level-data pool membership, capacity, and movable headroom.
//
// Each per-level object/sprite stream is incbin'd as `DATA_level_XX_{obj,spr}`
// into a fixed bank "pool" closed by a `%FREE_BYTES(boundary, fillSize, $FF)`
// macro whose `assert pc() <= boundary` is the build-time size gate. The blobs
// in a pool are contiguous, so the pool's cursor at the macro = poolStart +
// Σ(blob sizes). In the V1.0 base, the data ends exactly at every boundary, so
// `capacity = Σ(base blob sizes)`.
//
// **Movable headroom.** The `fillSize` bytes of `$FF` after the boundary are
// end-of-bank (or fixed-structure-preceding) slack. Because the pointer tables
// reference blobs by LABEL (asar resolves addresses at assembly time), a pool
// can actually grow into that slack if we rewrite its `%FREE_BYTES(B, N)` to
// `%FREE_BYTES(B+G, N-G)` at build time (move the boundary forward by the growth
// G, shrink the fill so the tail still ends at the same fixed point). Everything
// downstream stays byte-identical. So a pool whose blobs immediately precede its
// `%FREE_BYTES` AND whose fill is followed by bank-end / a fixed org is
// `movable`, with `headroomBytes = fillSize`. Non-movable pools (interleaved
// sentinels/data, or shared with the name-string region) keep 0 headroom.
//
// See research/notes-level-size-overflow.md (task #14) for the measured numbers.

import type { RomVersion } from './types.ts';
import { hex } from './hex.ts';

/** One obj/spr stream blob in a pool. */
export interface PoolBlob {
  /** Level id, uppercase hex without prefix (e.g. `"B2"`). */
  level: string;
  kind: 'obj' | 'spr';
  /** asar label, e.g. `DATA_level_B2_spr`. */
  label: string;
  /** Backing file name (label + `.bin`), matching `level-map` objectFile/spriteFile. */
  file: string;
  /** 24-bit SNES address from the `.sym`. */
  snesAddr: number;
  /** Base (pristine cart) size in bytes. */
  baseBytes: number;
}

/** The `%FREE_BYTES` tail that closes a pool — drives the build-time rewrite. */
export interface PoolTail {
  /** Bank `.asm` path relative to the `yi/` work root, e.g. `Banks/Bank4C.asm`. */
  bankFile: string;
  /** SNES address of the boundary (the `%FREE_BYTES` first arg). */
  boundary: number;
  /** `$FF` fill count (the second arg) = bytes of slack after the boundary. */
  fillSize: number;
  /** Whether the boundary can move FORWARD to absorb growth (the fill is spare
   *  end-of-bank/pre-fixed slack — see header). */
  movable: boolean;
  /** Whether a migration-OUT is safe — a *reclaim* (boundary pulls BACK, fill
   *  GROWS). True for every movable pool, AND for fully label-resolved non-movable
   *  pools whose blobs immediately precede their `%FREE_BYTES` so the fill can grow
   *  to absorb the reclaim (Bank15: forward growth would consume the seed-contest
   *  sentinel, but a reclaim just enlarges the `$FF` fill and re-resolves the
   *  labels). Drives `migratable`; the reclaim move only ever fires on shrink. */
  reclaimable: boolean;
}

/** A set of blobs sharing one `%FREE_BYTES` boundary. */
export interface LevelPool {
  /** Display + stable id: `Bank4C`, or `Bank15#1` / `Bank15#2` for multi-pool banks. */
  id: string;
  /** Bank number (e.g. 0x4c). */
  bank: number;
  /** Max total bytes at the fixed boundary (Σ base blob sizes). */
  capacityBytes: number;
  /** Extra bytes the pool may grow by if the boundary is moved at build time
   *  (= `tail.fillSize` when movable, else 0). The effective limit is
   *  `capacityBytes + headroomBytes`. */
  headroomBytes: number;
  /** The closing `%FREE_BYTES`. */
  tail: PoolTail;
  blobs: PoolBlob[];
}

/** A genuinely-unused `$FF` ROM tail repurposed as a relocation destination for
 *  migrated level-data blobs (research/notes-rom-free-space.md). Unlike a
 *  LevelPool (a level's fixed native home), a free region is spare capacity the
 *  editor allocates into first-fit, with variable membership. */
export interface FreeRegion {
  /** Stable id, e.g. `FreeRegion51`. */
  id: string;
  /** Bank `.asm` path relative to `yi/`, e.g. `Banks/Bank51.asm`. */
  bankFile: string;
  /** SNES address of the region's `%FREE_BYTES` boundary (its start). */
  boundary: number;
  /** `$FF` fill size = bytes of free space (the `%FREE_BYTES` second arg). */
  capacityBytes: number;
}

/** A level whose sprite pointer is biased (`DATA_<alias>-$02`), borrowing its
 *  `partner` level's trailing `$FFFF` terminator instead of owning a sprite blob
 *  (see research/notes-rom-free-space.md; the de-couple impl is BIASED_POINTERS below). The only
 *  two such rows; de-coupling materializes the level's own spr blob + repoints
 *  the Ptrs row, freeing the partner to migrate. */
export interface BiasedPointer {
  /** Dependent level id (uppercase hex, no prefix, e.g. `"19"`). */
  level: string;
  /** Partner whose `$FFFF` terminator it borrows (e.g. `"51"`). */
  partner: string;
  /** Zero-size alias label the Ptrs row biases off (`DATA_14C6C6`). */
  alias: string;
  /** Bank `.asm` where the alias + partner sprite blob live. */
  bankFile: string;
}

export interface PoolMap {
  romVersion: RomVersion;
  pools: LevelPool[];
  /** blob file name → its pool. */
  poolByFile: Map<string, LevelPool>;
  /** Free regions ($FF tails) usable as relocation targets (YI_U1; else []). */
  freeRegions: FreeRegion[];
}

interface BoundaryDef {
  boundary: number;
  fillSize: number;
  movable: boolean;
  bankFile: string;
  /** Override for `PoolTail.reclaimable` (defaults to `movable`). Set true on a
   *  non-movable pool where migration-out is still safe (Bank15). */
  reclaimable?: boolean;
}

/**
 * V1.0 `%FREE_BYTES` boundaries (SNES address + `$FF` fill size) per bank that
 * holds level-data blobs, from the bank `.asm` `else`/non-U2 branches. A blob
 * belongs to the smallest boundary above it within its bank.
 *
 * `movable` pools can grow into their fill (build-time boundary rewrite, see
 * header). Movable = the level blobs immediately precede this `%FREE_BYTES` and
 * the fill is followed by bank-end or a fixed structure:
 *   • Bank00/10/11/12/14/16/4C — level run → `%FREE_BYTES` → `%BANK_END`
 *     (Bank00's fill is followed by the fixed `UNK_00FFA0` table — still fixed).
 * NOT movable:
 *   • Bank15 — a labeled 1-byte sentinel (`DATA_15FCEA`, a null-pointer target)
 *     and a non-level blob (`DATA_15FCBEEnd`) sit between its two pools; moving the
 *     boundary would shift the sentinel.
 *   • Bank51 — level blobs share the bank with the level-name-string region
 *     (its own asm-region budget); growth would entangle the two.
 * (V1.1 relocates blobs + uses `%InsertGarbageData` tails — add a `YI_U2` row
 * when that path is parameterised.)
 */
const POOL_BOUNDARIES: Partial<Record<RomVersion, BoundaryDef[]>> = {
  YI_U1: [
    { boundary: 0x00bff6, fillSize: 10, movable: false, bankFile: 'Banks/Bank00.asm' },
    { boundary: 0x00f7a7, fillSize: 2041, movable: true, bankFile: 'Banks/Bank00.asm' },
    { boundary: 0x00ffa5, fillSize: 11, movable: false, bankFile: 'Banks/Bank00.asm' },
    { boundary: 0x10ffa3, fillSize: 93, movable: true, bankFile: 'Banks/Bank10.asm' },
    { boundary: 0x11fd87, fillSize: 633, movable: true, bankFile: 'Banks/Bank11.asm' },
    { boundary: 0x12ff9e, fillSize: 98, movable: true, bankFile: 'Banks/Bank12.asm' },
    { boundary: 0x14ffa5, fillSize: 91, movable: true, bankFile: 'Banks/Bank14.asm' },
    // Bank15: non-movable (its fills are load-bearing — the seed-contest object
    // sentinel / sprite data), but reclaimable (a migration-out just grows the
    // $FF fill; everything's label-resolved). See `migratable` + `PoolTail`.
    { boundary: 0x15fcea, fillSize: 1, movable: false, reclaimable: true, bankFile: 'Banks/Bank15.asm' },
    { boundary: 0x15ffd5, fillSize: 43, movable: false, reclaimable: true, bankFile: 'Banks/Bank15.asm' },
    { boundary: 0x16fff8, fillSize: 8, movable: true, bankFile: 'Banks/Bank16.asm' },
    { boundary: 0x4cfeb7, fillSize: 329, movable: true, bankFile: 'Banks/Bank4C.asm' },
    { boundary: 0x515348, fillSize: 44216, movable: false, bankFile: 'Banks/Bank51.asm' },
  ],
};

/**
 * V1.0 free regions — the two large SuperFX-HiROM `$FF` bank tails (~63.7 KB).
 * Each is the bank-closing `%FREE_BYTES`, after a GSU code block, after that
 * bank's level data; CPU-reachable by the same map the loader uses for any
 * `dl LABEL`. V1.1 fills both with `%InsertGarbageData` (not free), so YI_U1-only
 * like POOL_BOUNDARIES. NB FreeRegion51 shares Bank51's closing `%FREE_BYTES`
 * with that bank's (non-movable) home pool — distinct regions, one macro; only a
 * free-region append ever rewrites it.
 *
 * **Why ONLY these two — don't naively add more** (full inventory:
 * research/notes-rom-free-space.md):
 *   • The V1.0 LoROM bank tails (Bank0F, Bank01, …) are a home pool's own
 *     growth slack — using one as a relocation target competes with its home
 *     level's grow-into-fill budget (the movable POOL_BOUNDARIES above).
 *   • Bank0F's 6 KB tail is V1.1-reserved: V1.1 relocates the `Ptrs:` table into
 *     it, so claiming it in V1.0 forecloses a clean future V1.1 unification.
 *   • Non-`$FF` space ($00 padding inside GSU banks, computed-jump/dispatch
 *     tables) is "reuse not-actually-free space" — clobbering risk, not worth it.
 * That leaves these two big SuperFX-HiROM `$FF` tails as the only clean targets.
 *
 * **Caveat:** only FreeRegion51 (`$51`) is exercised by a shipped relocated
 * level. FreeRegion50 (`$50`) is the same SuperFX-HiROM loader map but UNPROVEN
 * — boot-test a level relocated there before relying on it.
 */
const FREE_REGIONS: Partial<Record<RomVersion, FreeRegion[]>> = {
  YI_U1: [
    { id: 'FreeRegion51', bankFile: 'Banks/Bank51.asm', boundary: 0x515348, capacityBytes: 44216 },
    { id: 'FreeRegion50', bankFile: 'Banks/Bank50.asm', boundary: 0x50b3fa, capacityBytes: 19462 },
  ],
};

// PATCH STUBS — the post-build binary-patch layer (snes-framework/patches/)
// now places every custom code stub via asar `freecode` (assembled in the
// post-assembly phase, after migration), so there are NO hardcoded code-bank
// `$FF` reserved tails left to keep out of the pool/free-region map. (Former
// reservations, both since migrated to freecode: $03:FEEE — star-timer reducer;
// $04:FF1B — fast-reset death/level-name stubs.)

/** V1.0 biased-sprite-pointer rows (the only two — `$19`/`$CB`). */
const BIASED_POINTERS: Partial<Record<RomVersion, BiasedPointer[]>> = {
  YI_U1: [
    { level: '19', partner: '51', alias: 'DATA_14C6C6', bankFile: 'Banks/Bank14.asm' },
    { level: 'CB', partner: 'C4', alias: 'DATA_16F097', bankFile: 'Banks/Bank16.asm' },
  ],
};

/** A level whose cart `Ptrs:` pointer references a non-`DATA_level_XX` label —
 *  a raw / truncated / overlapping slice — so migrating it can't rely on asar
 *  re-resolving a clean label. Instead we materialise a self-contained
 *  `DATA_level_XX_<kind>` copy in a free region + repoint the row; the original
 *  (possibly shared) bytes stay put. Today: 0x7D's obj ships as DATA_169D23
 *  (225 B) but its real 366-byte stream overlaps the adjacent DATA_169E04 +
 *  DATA_169E75, so the original is never deleted/reclaimed (Bank16.asm:72). */
export interface RepointMigration {
  level: string;        // '7D'
  kind: 'obj' | 'spr';
  /** The `Ptrs:` pointer expression to replace (e.g. `DATA_169D23`). */
  oldExpr: string;
  /** Editor's self-contained full stream `.bin` to emit. */
  fullFile: string;     // 'DATA_level_7D_obj.bin'
  /** Label the materialised copy gets (+ what the row repoints to). */
  newLabel: string;     // 'DATA_level_7D_obj'
  /** Bank holding the original slice (for the migratable check). */
  homeBankFile: string; // 'Banks/Bank16.asm'
}

const REPOINT_MIGRATIONS: Partial<Record<RomVersion, RepointMigration[]>> = {
  YI_U1: [
    {
      level: '7D',
      kind: 'obj',
      oldExpr: 'DATA_169D23',
      fullFile: 'DATA_level_7D_obj.bin',
      newLabel: 'DATA_level_7D_obj',
      homeBankFile: 'Banks/Bank16.asm'
    }
  ],
};

/** Levels excluded from migration for a non-symbolic reason unrelated to biasing:
 *  0x38 engine-hardcoded (Kamek's Revenge); 0xBF/0xD0 share one pointer
 *  (`DATA_11DB2EEnd`). Biased levels + their partners are gated separately via the
 *  de-couple state — see `migratable`. (Uppercase hex, no prefix.) */
const HARDCODED_EXCLUDE = new Set(['38', 'BF', 'D0']);

const LEVEL_BLOB_RE =
  /^([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4})\s+(DATA_level_([0-9A-Fa-f]+)_(obj|spr))\s*$/;

/** Distinct level ids (uppercase hex, no prefix) in a pool, sorted. */
export function poolLevels(pool: LevelPool): string[] {
  return [...new Set(pool.blobs.map((b) => b.level))].sort();
}

/**
 * Build the pool map from a WLA `.sym` file's text + a base-size lookup.
 * `baseBytesOf(file)` returns the pristine-cart byte size of a blob's `.bin`
 * (0 if missing). Pure — the disk-reading wrapper lives in the app layer.
 *
 * Throws if `romVersion` has no boundary table yet (caller treats as "no gate").
 */
export function buildPoolMap(
  romVersion: RomVersion,
  symText: string,
  baseBytesOf: (file: string) => number
): PoolMap {
  const defs = POOL_BOUNDARIES[romVersion];
  if (!defs) {
    throw new Error(`No level-data pool boundaries defined for ${romVersion}.`);
  }
  const bankOf = (b: number): number => (b >>> 16) & 0xff;

  // Group blobs by the smallest same-bank boundary above each blob.
  const groups = new Map<number, { def: BoundaryDef; blobs: PoolBlob[] }>();
  for (const raw of symText.split('\n')) {
    const m = LEVEL_BLOB_RE.exec(raw.trim());
    if (!m) continue;
    const bank = parseInt(m[1], 16);
    const snesAddr = (bank << 16) | parseInt(m[2], 16);
    const candidates = defs
      .filter((d) => bankOf(d.boundary) === bank && d.boundary > snesAddr)
      .sort((a, b) => a.boundary - b.boundary);
    if (candidates.length === 0) continue; // bank with no boundary → untracked
    const def = candidates[0];
    const file = `${m[3]}.bin`;
    const blob: PoolBlob = {
      level: m[4].toUpperCase(),
      kind: m[5] as 'obj' | 'spr',
      label: m[3],
      file,
      snesAddr,
      baseBytes: baseBytesOf(file),
    };
    const g = groups.get(def.boundary);
    if (g) g.blobs.push(blob);
    else groups.set(def.boundary, { def, blobs: [blob] });
  }

  // Name pools: `BankNN`, or `BankNN#k` when a bank has more than one pool.
  const byBank = new Map<number, { def: BoundaryDef; blobs: PoolBlob[] }[]>();
  for (const g of groups.values()) {
    const bank = bankOf(g.def.boundary);
    const list = byBank.get(bank) ?? [];
    list.push(g);
    byBank.set(bank, list);
  }
  const pools: LevelPool[] = [];
  const poolByFile = new Map<string, LevelPool>();
  for (const [bank, list] of byBank) {
    list.sort((a, b) => a.def.boundary - b.def.boundary);
    const bankHex = hex(bank, 2);
    list.forEach((g, i) => {
      const id = list.length > 1 ? `Bank${bankHex}#${i + 1}` : `Bank${bankHex}`;
      const capacityBytes = g.blobs.reduce((n, b) => n + b.baseBytes, 0);
      const tail: PoolTail = {
        bankFile: g.def.bankFile,
        boundary: g.def.boundary,
        fillSize: g.def.fillSize,
        movable: g.def.movable,
        reclaimable: g.def.reclaimable ?? g.def.movable,
      };
      const pool: LevelPool = {
        id,
        bank,
        capacityBytes,
        headroomBytes: g.def.movable ? g.def.fillSize : 0,
        tail,
        blobs: g.blobs,
      };
      pools.push(pool);
      for (const b of g.blobs) poolByFile.set(b.file, pool);
    });
  }
  pools.sort((a, b) => a.tail.boundary - b.tail.boundary);
  return { romVersion, pools, poolByFile, freeRegions: FREE_REGIONS[romVersion] ?? [] };
}

// ── asm-patch pool (a reserved tail of FreeRegion51) ─────────────────────────
//
// asm patches place their custom routines with a deterministic bump allocator
// (`%patchcode` in the generated Custom hook) instead of asar `freecode`, which
// on this cart can't be confined to a safe region (see
// research/plan-custom-patches.md). We carve a fixed slice off the END of
// FreeRegion51 and reserve it: migration's first-fit allocator never reaches it
// (its capacity is shrunk to match), and patch routines `org` into it.
//
// The slice is addressed two ways for the same physical bytes:
//   • the Bank51 `%FREE_BYTES` fill that reserves it runs in the SuperFX-HiROM
//     view ($51:xxxx), like the rest of the region;
//   • the patch routines `org` via the LoROM view ($23:xxxx) so the SNES CPU can
//     `JSL` them — asar's `freecode` proves LoROM is the CPU-executable view here
//     (it places code at LoROM bank $10), and $51/$23 are the same file bytes.

/** Smallest selectable asm-patch pool (256 B = 0.25 KB). Enough for the bundled
 *  patches (~150 B); also the byte granularity of the configurable size, so the
 *  KB value snaps to 0.25 increments and always maps to a whole-byte reservation. */
export const PATCH_POOL_MIN_BYTES = 0x100;

/** Default bytes reserved at FreeRegion51's tail for the asm-patch pool (1 KB).
 *  The bundled patches need ~150 B, so 1 KB is ample while leaving the maximum
 *  free-region room for level-data migration. Per-project configurable from
 *  PATCH_POOL_MIN_BYTES up to PATCH_POOL_MAX_BYTES via the Patches panel. */
export const PATCH_POOL_DEFAULT_BYTES = 0x400;

/** Upper bound on the configurable asm-patch pool (8 KB). The carved slice must
 *  stay within one LoROM bank for `patchPoolGeometry`'s mapping to hold, and
 *  FreeRegion51's 8 KB tail does (it sits in LoROM bank $23). */
export const PATCH_POOL_MAX_BYTES = 0x2000;

/** The free region whose tail hosts the asm-patch pool. */
export const PATCH_POOL_REGION_ID = 'FreeRegion51';

/** Addresses + sizes for the asm-patch pool carved off a host `FreeRegion`'s tail. */
export interface PatchPoolGeometry {
  /** Bytes reserved for patches. */
  poolBytes: number;
  /** SuperFX-view SNES addr of the pool start — the second `%FREE_BYTES` boundary
   *  that fills the slice with `$FF` during the main assembly phase. */
  fillBoundarySnes: number;
  /** Host region's capacity AFTER the carve (= region.capacityBytes − poolBytes),
   *  what migration plans/appends against (boundary unchanged). */
  migrationCapacity: number;
  /** LoROM-view SNES addr of the pool's first byte — `%patchcode`'s `org` target
   *  and the bump cursor's start (CPU-executable). */
  loromStart: number;
  /** LoROM-view SNES addr one past the pool's last byte — the overflow-assert
   *  bound. asar's LoROM `pc()` advances linearly, so this is `loromStart + poolBytes`. */
  loromEnd: number;
}

/**
 * Compute the patch-pool slice carved off the END of a host free region.
 * Pure arithmetic over the region's SuperFX-HiROM boundary; verified against the
 * framework's `norom`+offset-macro mapper (a routine `org`'d at `loromStart` lands
 * at the same file byte the `$51:xxxx` fill reserves). Assumes a `$40–$5F` region
 * whose tail stays within one LoROM bank (true for FreeRegion51's 8 KB tail in
 * bank $23); larger slices that cross a LoROM bank boundary aren't supported.
 */
export function patchPoolGeometry(
  region: FreeRegion,
  poolBytes: number = PATCH_POOL_DEFAULT_BYTES
): PatchPoolGeometry {
  const fileRegionStart = region.boundary & 0x1fffff; // SuperFX HiROM → file offset
  const fileEnd = fileRegionStart + region.capacityBytes;
  const fileStart = fileEnd - poolBytes;
  const sfxBank = 0x40 + (fileStart >>> 16);
  const fillBoundarySnes = (sfxBank << 16) | (fileStart & 0xffff);
  const loromBank = fileStart >>> 15; // each LoROM bank maps 0x8000 file bytes
  const loromStart = (loromBank << 16) | ((fileStart & 0x7fff) | 0x8000);
  return {
    poolBytes,
    fillBoundarySnes,
    migrationCapacity: region.capacityBytes - poolBytes,
    loromStart,
    loromEnd: loromStart + poolBytes,
  };
}

/**
 * Return a copy of the pool map with the asm-patch host region's capacity shrunk
 * by the reserved patch slice (carved off FreeRegion51's tail). With this the
 * migration planner + the budget gate allocate only into the room that actually
 * remains for level data — so the pre-build gate and the build (which reserves the
 * same slice) agree on free-region capacity. `patchPoolBytes <= 0` (no asm
 * patches enabled) ⇒ the map is returned unchanged. Used by BOTH the build layout
 * pass (relocate.ts) and every budget view (level-budget.ts via the app layer).
 */
export function carvePatchPool(map: PoolMap, patchPoolBytes: number): PoolMap {
  if (patchPoolBytes <= 0) return map;
  const host = map.freeRegions.find((r) => r.id === PATCH_POOL_REGION_ID);
  if (!host) return map;
  const migrationCapacity = patchPoolGeometry(host, patchPoolBytes).migrationCapacity;
  return {
    ...map,
    freeRegions: map.freeRegions.map((r) =>
      r.id === host.id ? { ...r, capacityBytes: migrationCapacity } : r
    ),
  };
}

/** A level record id as 2 uppercase hex digits (no prefix), matching
 *  `PoolBlob.level`. */
export const levelHex = (n: number): string => hex(n, 2);

/** Biased-sprite-pointer rows for a ROM version (`[]` if none). */
export function biasedPointers(romVersion: RomVersion): BiasedPointer[] {
  return BIASED_POINTERS[romVersion] ?? [];
}

/** Repoint-migration rows for a ROM version (`[]` if none). */
export function repointMigrations(romVersion: RomVersion): RepointMigration[] {
  return REPOINT_MIGRATIONS[romVersion] ?? [];
}

/**
 * Whether a level may be migrated into a free region. Requires a CLEAN, tracked
 * `DATA_level_XX_obj` blob in a MOVABLE home pool (so the consolidating reclaim
 * can shift the bank safely); a tracked spr blob, if any, must also be movable.
 * Excluded:
 *   • engine-hardcoded / shared-pointer levels (`HARDCODED_EXCLUDE`) — never;
 *   • a partner whose terminator a biased level borrows (`$51`/`$C4`) — only once
 *     that dependent is de-coupled (the *aliased-into* exclusion lifts);
 *   • levels whose obj ships under a raw label (e.g. 0x7D's truncated
 *     `DATA_169D23`) — not tracked here, so not migratable until the repoint path.
 * A biased dependent (`$19`/`$CB`) IS migratable: only its clean obj moves; the
 * biased spr is left in place (untouched by an obj relocation). `decoupled` = the
 * numeric level ids the user has de-coupled.
 */
export function migratable(
  map: PoolMap,
  levelRecordId: number,
  decoupled: ReadonlySet<number>
): boolean {
  const hex = levelHex(levelRecordId);
  if (HARDCODED_EXCLUDE.has(hex)) return false;
  const biased = BIASED_POINTERS[map.romVersion] ?? [];
  const partnerOf = biased.find((b) => b.partner === hex);
  if (partnerOf && !decoupled.has(parseInt(partnerOf.level, 16))) return false;
  // Migration is a reclaim (boundary pulls back), so the gate is `reclaimable`,
  // not `movable` — a tracked spr blob, if any, must sit in a reclaimable pool.
  const sprPool = map.poolByFile.get(`DATA_level_${hex}_spr.bin`);
  if (sprPool && !sprPool.tail.reclaimable) return false;
  // Obj: a clean tracked blob in a reclaimable pool, OR a repoint migration whose
  // home bank has a reclaimable pool (0x7D's truncated/overlapping DATA_169D23 →
  // a self-contained DATA_level_7D_obj copy + Ptrs repoint).
  const objPool = map.poolByFile.get(`DATA_level_${hex}_obj.bin`);
  if (objPool) return objPool.tail.reclaimable;
  const rep = (REPOINT_MIGRATIONS[map.romVersion] ?? []).find((r) => r.level === hex && r.kind === 'obj');
  if (rep) return map.pools.some((p) => p.tail.bankFile === rep.homeBankFile && p.tail.reclaimable);
  return false;
}
