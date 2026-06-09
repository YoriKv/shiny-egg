// `level-lookup` subcommand — convert between YI's two level-ID spaces.
//
// A **record id** is a level-data record (the `.bin` / warp-dest / editor id;
// the cart Ptrs $17:F7C3 index). A **translevel id** is a world-map slot
// (CurrentLevelFromMap $021A, 0x00–0x47). They collide numerically and are
// NEVER interchangeable (CLAUDE.md "two ID spaces — never conflate"), so by
// default this prints BOTH interpretations of a value; pin one with --rec/--tl.
//
//   pnpm level-lookup -- 0x32          # 0x32 interpreted as a record AND as a translevel
//   pnpm level-lookup -- 0x32 --rec    # only "0x32 is a record id"
//   pnpm level-lookup -- 0x41 --tl     # only "0x41 is a translevel id"
//   pnpm level-lookup -- --list        # dump the whole translevel↔record table
//
// The mapping comes purely from editor-data/yi/level-map.json (always present
// after an extract). Friendly names + world-map entrance coords are best-effort
// — they need the built V1.0 cart + .sym, and are silently skipped if absent.

import {
  loadLevelMapPublic,
  recordToTranslevel,
  isWorld6Translevel,
  isWorld6Record,
  levelMapEntry,
  levelIdHexKey
} from './level.ts';
import { buildLevelsCatalog } from './levels-catalog.ts';
import { loadDevCart, type DevCart } from './engine/dev-cart.ts';
import { hexN as hex, parseHexId, splitArgs } from './engine/cli-util.ts';
import type { SymbolMap } from './engine/symbol-map.ts';
import type { LevelMap } from './extract.ts';

export interface LevelNameIndex {
  byRecord: Map<number, string>;
  byTranslevel: Map<number, string>;
}

/**
 * Build `{recordId → name, translevelId → name}` from the cart name table +
 * static slot shapes. Shared with inspect-level.ts. Reads the font table under
 * `workRoot`, so it throws if the extract is incomplete — callers treat names
 * as best-effort and catch.
 */
export function levelNameIndex(workRoot: string, cart: Buffer, symbols: SymbolMap): LevelNameIndex {
  const map = loadLevelMapPublic(workRoot);
  // buildLevelsCatalog and the persisted level-map both key translevelToRecord
  // by hex string ("0x41"), so the on-disc map feeds straight in.
  const catalog = buildLevelsCatalog(workRoot, cart, symbols, map.translevelToRecord);
  const byRecord = new Map<number, string>();
  const byTranslevel = new Map<number, string>();
  for (const group of catalog.groups) {
    for (const e of group.levels) {
      const label = `${e.name} [${e.world}${e.slot ? ` ${e.slot}` : ''}]`;
      if (e.translevelId != null) byTranslevel.set(e.translevelId, label);
      if (e.recordId != null) byRecord.set(e.recordId, label);
    }
  }
  return { byRecord, byTranslevel };
}

/**
 * Read a translevel's world-map entrance record (data id + spawn cell) from the
 * cart, mirroring extract.ts's DATA_level_entrance_indexes → DATA_map_level_entrances walk + sentinels.
 * Returns null for slots with no main-world entrance (bonus/intro).
 */
function readEntrance(
  cart: Buffer,
  symbols: SymbolMap,
  translevelId: number
): { dataId: number; entX: number; entY: number } | null {
  const idxPC = symbols.tryPc('YI_LevelDataPtrsAndEntranceData_DATA_level_entrance_indexes');
  const recPC = symbols.tryPc('YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances');
  const midPC = symbols.tryPc('YI_LevelDataPtrsAndEntranceData_DATA_map_level_midway_entrances');
  if (idxPC == null || recPC == null) return null;
  const entOff = cart[idxPC + translevelId * 2] | (cart[idxPC + translevelId * 2 + 1] << 8);
  const recSize = midPC != null ? midPC - recPC : Number.POSITIVE_INFINITY;
  if ((entOff === 0 && translevelId !== 0) || entOff >= recSize) return null;
  return { dataId: cart[recPC + entOff], entX: cart[recPC + entOff + 1], entY: cart[recPC + entOff + 2] };
}

function recordForTranslevel(map: LevelMap, translevelId: number): number | null {
  return (
    map.translevelToRecord[levelIdHexKey(translevelId)] ??
    map.translevelToRecord[String(translevelId)] ??
    null
  );
}

function printAsRecord(value: number, map: LevelMap, names: LevelNameIndex | null): void {
  const entry = levelMapEntry(map.levels, value);
  const tl = recordToTranslevel(map, value);
  const name = names?.byRecord.get(value);
  console.log(`${hex(value)} as a RECORD id:`);
  if (name) console.log(`  name:       ${name}`);
  console.log(`  backed:     ${entry?.objectFile ? `yes (${entry.objectFile})` : 'no'}`);
  console.log(`  translevel: ${tl == null ? 'none — sub-room or orphan room' : hex(tl)}`);
  console.log(`  world 6:    ${isWorld6Record(map, value) ? 'yes' : 'no'}`);
}

function printAsTranslevel(
  value: number,
  map: LevelMap,
  names: LevelNameIndex | null,
  dev: DevCart | null
): void {
  console.log(`${hex(value)} as a TRANSLEVEL id:`);
  if (value > 0x47) {
    console.log('  out of translevel range (valid 0x00–0x47).');
    return;
  }
  const rec = recordForTranslevel(map, value);
  const name = names?.byTranslevel.get(value);
  if (name) console.log(`  name:       ${name}`);
  console.log(`  record:     ${rec == null ? 'none — bonus / intro slot (no data record)' : hex(rec)}`);
  console.log(`  world 6:    ${isWorld6Translevel(value) ? 'yes' : 'no'}`);
  if (dev) {
    const ent = readEntrance(dev.cart, dev.symbols, value);
    if (ent) console.log(`  entrance:   dataId ${hex(ent.dataId)}, spawn cell (${ent.entX}, ${ent.entY})`);
  }
}

function printTable(map: LevelMap, names: LevelNameIndex | null): void {
  console.log('translevel  record  name');
  for (let tl = 0; tl <= 0x47; tl++) {
    const rec = recordForTranslevel(map, tl);
    const name = names?.byTranslevel.get(tl) ?? '';
    console.log(`  ${hex(tl)}        ${rec == null ? ' —  ' : hex(rec)}   ${name}`);
  }
}

export function runLevelLookupCli(workRoot: string, args: string[]): void {
  const { flags, positionals } = splitArgs(args);
  const map = loadLevelMapPublic(workRoot); // throws a friendly error if not extracted yet

  let dev: DevCart | null = null;
  try {
    dev = loadDevCart();
  } catch {
    /* names + entrance are best-effort — the mapping below needs only level-map.json */
  }
  let names: LevelNameIndex | null = null;
  if (dev) {
    try {
      names = levelNameIndex(workRoot, dev.cart, dev.symbols);
    } catch {
      /* font table / catalog unavailable — skip names */
    }
  }

  if (flags.has('--list')) {
    printTable(map, names);
    return;
  }
  if (positionals.length === 0) {
    console.error('Usage:');
    console.error('  pnpm level-lookup -- <value>        # interpret value as BOTH a record and a translevel');
    console.error('  pnpm level-lookup -- <value> --rec  # only "value is a record id"');
    console.error('  pnpm level-lookup -- <value> --tl   # only "value is a translevel id"');
    console.error('  pnpm level-lookup -- --list         # dump the whole translevel↔record table');
    process.exit(2);
  }

  const value = parseHexId(positionals[0]);
  const onlyRec = flags.has('--rec') && !flags.has('--tl');
  const onlyTl = flags.has('--tl') && !flags.has('--rec');

  if (!onlyTl) printAsRecord(value, map, names);
  if (!onlyRec) {
    if (!onlyTl) console.log('');
    printAsTranslevel(value, map, names, dev);
  }
}
