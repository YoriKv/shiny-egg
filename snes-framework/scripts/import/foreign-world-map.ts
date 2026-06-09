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

/** Bytes per record in both tables (`db a,b,c,d` / `dw lohi,lohi` = 4 bytes). */
const RECORD_BYTES = 4;

export interface ForeignWorldMap {
  /** Main entrance records (length `mainCount`, index-stamped to match the model). */
  entrances: WorldMapEntrance[];
  /** Midway/checkpoint records (length `midwayCount`). */
  midway: WorldMapMidwayEntrance[];
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
  midwayCount: number
): ForeignWorldMap {
  const mainPc = sym.tryPc(MAIN_ENTRANCES_SYMBOL);
  const midPc = sym.tryPc(MIDWAY_ENTRANCES_SYMBOL);
  if (mainPc === undefined || midPc === undefined) {
    return { entrances: [], midway: [], resolved: false };
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

  return { entrances, midway, resolved: true };
}
