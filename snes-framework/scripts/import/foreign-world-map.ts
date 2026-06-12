// Read the world-map ENTRANCE RECORD tables out of a FOREIGN (modified) cart —
// the import counterpart to scripts/world-map.ts's asm parse. The world-map
// editor mutates exactly two record tables (the main entrance + the midway/
// checkpoint table) in DATATABLE_YI_LevelDataPtrsAndEntranceData.asm; this reads
// the same two tables straight from a built cart's bytes so the importer can diff
// a hack's spawns / level-remaps / progression / checkpoints against base and
// apply the changes back through saveWorldMapResource. See plan-rom-import.md §10.
//
// SCOPE (matches the editor's): the entrance RECORD tables only. The translevel→
// record INDEX tables (DATA_level_entrance_indexes / …_midway_…) are NOT read —
// the editor can't edit them, so there's no overlay target to import them into.
//
// Addressing follows the same "assume in place, gated by baseDerived" rule the
// palette / level-name import uses: read at the vanilla V1.0 symbol address. The
// caller only invokes this when the cart validated as V1.0-derived (engine
// constants + level pointer table resolve), which means its bank-$17 tables sit
// where vanilla keeps them.

import type { SymbolMap } from '../engine/symbol-map.ts';
import type { WorldMapEntrance, WorldMapMidwayEntrance } from '../types.ts';

/** Vanilla symbols for the two editable record tables (vendoredV10SymbolMap). */
const MAIN_ENTRANCES_SYMBOL = 'YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances';
const MIDWAY_ENTRANCES_SYMBOL = 'YI_LevelDataPtrsAndEntranceData_DATA_map_level_midway_entrances';
/** The translevel→record-offset INDEX tables (editable since RI4). */
const MAIN_INDEXES_SYMBOL = 'YI_LevelDataPtrsAndEntranceData_DATA_level_entrance_indexes';
const MIDWAY_INDEXES_SYMBOL = 'YI_LevelDataPtrsAndEntranceData_DATA_level_midway_entrance_indexes';

/** Bytes per record in both tables (`db a,b,c,d` / `dw lohi,lohi` = 4 bytes). */
const RECORD_BYTES = 4;

export interface ForeignWorldMap {
  /** Main entrance records (length `mainCount`, index-stamped to match the model). */
  entrances: WorldMapEntrance[];
  /** Midway/checkpoint records (length `midwayCount`). */
  midway: WorldMapMidwayEntrance[];
  /** Raw words of the two INDEX tables (translevel → record byte-offset),
   *  lengths `mainIndexCount` / `midwayIndexCount`. Empty when not requested. */
  entranceIndexWords: number[];
  midwayIndexWords: number[];
  /** False when a table's symbol isn't in the map (older `.sym`) — caller skips. */
  resolved: boolean;
}

/**
 * Read `mainCount` main-entrance + `midwayCount` midway records from `cart` at the
 * vanilla table addresses. Counts come from the base asm model (records are
 * fixed-size and the editor never adds/removes rows, so base and foreign have the
 * same count). Byte layout in both tables is `levelDataId, spawnX, spawnY, X`:
 *   - MAIN  (`db levelDataId, entX, entY, progTarget`) → bytes [id, x, y, prog].
 *   - MIDWAY(`dw (entX<<8)|id, (state<<8)|entY`) → little-endian bytes
 *     [id, x, y, state] — identical field order, hence one read shape.
 */
export function readForeignWorldMap(
  cart: Buffer,
  sym: SymbolMap,
  mainCount: number,
  midwayCount: number,
  /** Index-table word counts (from the asm model's raw arrays); 0 = skip. */
  mainIndexCount = 0,
  midwayIndexCount = 0
): ForeignWorldMap {
  const mainPc = sym.tryPc(MAIN_ENTRANCES_SYMBOL);
  const midPc = sym.tryPc(MIDWAY_ENTRANCES_SYMBOL);
  if (mainPc === undefined || midPc === undefined) {
    return { entrances: [], midway: [], entranceIndexWords: [], midwayIndexWords: [], resolved: false };
  }

  const entrances: WorldMapEntrance[] = [];
  for (let i = 0; i < mainCount; i++) {
    const o = mainPc + i * RECORD_BYTES;
    entrances.push({
      index: i,
      levelDataId: cart[o] ?? 0,
      spawnX: cart[o + 1] ?? 0,
      spawnY: cart[o + 2] ?? 0,
      progTarget: cart[o + 3] ?? 0
    });
  }

  const midway: WorldMapMidwayEntrance[] = [];
  for (let i = 0; i < midwayCount; i++) {
    const o = midPc + i * RECORD_BYTES;
    midway.push({
      index: i,
      levelDataId: cart[o] ?? 0,
      spawnX: cart[o + 1] ?? 0,
      spawnY: cart[o + 2] ?? 0,
      entranceState: cart[o + 3] ?? 0
    });
  }

  const readWords = (symbol: string, count: number): number[] => {
    if (count <= 0) return [];
    const pc = sym.tryPc(symbol);
    if (pc === undefined) return [];
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(cart.readUInt16LE(pc + i * 2));
    return out;
  };

  return {
    entrances,
    midway,
    entranceIndexWords: readWords(MAIN_INDEXES_SYMBOL, mainIndexCount),
    midwayIndexWords: readWords(MIDWAY_INDEXES_SYMBOL, midwayIndexCount),
    resolved: true
  };
}

/** Uniform fill values hacks write into DISABLED index slots ($00FF per
 *  GoldenEgg's convention, $FFFF/$0000 as generic padding) — not real offsets,
 *  but deliberate, so they don't mark a table as clobbered. */
const INDEX_FILL_WORDS = new Set([0x00ff, 0xffff]);

export interface IndexMergeResult {
  remapped: number;
  skipped: number;
  /** The foreign table is repurposed/clobbered (mostly random invalid words) —
   *  nothing was imported, not even its valid-looking entries. */
  clobbered: boolean;
}

/**
 * Merge a foreign cart's INDEX-table words (translevel → record byte-offset)
 * onto the editable model's raw array. Three gates, learned from real hacks
 * (Flutter):
 *   • per-word: a word imports only if it addresses a record our fixed-size
 *     table actually has (4-byte aligned, in range) — uniform fill words
 *     ($00FF disabled-slot convention, $FFFF) are deliberate but
 *     unrepresentable, so they're skipped without penalty;
 *   • whole-table: when most CHANGED words are random invalid garbage, the
 *     hack repurposed the table's bytes (e.g. Flutter's custom respawn system
 *     stores data over the midway index) — import NOTHING from it, since even
 *     its in-range words (like `$0000` "no checkpoint") are part of the
 *     clobber and would corrupt real slots.
 * Mutates `modelWords` in place (the editable asm model array).
 */
export function mergeForeignIndexWords(
  modelWords: number[] | undefined,
  foreignWords: number[],
  baseWords: number[],
  recordCount: number
): IndexMergeResult {
  if (!modelWords || foreignWords.length !== modelWords.length) {
    return { remapped: 0, skipped: 0, clobbered: false };
  }
  const isValid = (w: number): boolean => w % 4 === 0 && w / 4 < recordCount;

  let changed = 0;
  let garbage = 0;
  for (let i = 0; i < foreignWords.length; i++) {
    const f = foreignWords[i];
    if (f === baseWords[i]) continue;
    changed++;
    if (!isValid(f) && !INDEX_FILL_WORDS.has(f)) garbage++;
  }
  if (changed > 0 && garbage / changed > 0.5) {
    return { remapped: 0, skipped: changed, clobbered: true };
  }

  let remapped = 0;
  let skipped = 0;
  for (let i = 0; i < foreignWords.length; i++) {
    const f = foreignWords[i];
    if (f === baseWords[i]) continue;
    if (!isValid(f)) {
      skipped++;
      continue;
    }
    modelWords[i] = f;
    remapped++;
  }
  return { remapped, skipped, clobbered: false };
}
