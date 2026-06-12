// Extract YI assets (graphics, level data, tilemaps, samples, ...) from a
// reference cart into workRoot/assets/yi/. Does the slicing natively in Node
// instead of running asar thousands of times (~1s vs minutes).
//
// Also emits assets/yi/level-map.json: a per-level-ID mapping of which .bin
// file contains the level's object/sprite data and at what offset, plus the
// ROM-internal tables (header bit-widths, standard-object info table) needed
// to parse a level without the cart at runtime.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runAsar } from './asar.ts';
import { snesToPC, vendoredV10SymbolMap } from './engine/symbol-map.ts';
import { buildLevelsCatalog } from './levels-catalog.ts';
import { parseEntranceTable, loadLevelIdSymbols } from './world-map.ts';
import { findOrphanRecords, invalidateLevelMapCache } from './level.ts';
import { writeInstanceIndex } from './instance-index.ts';
import { ROM_VERSIONS, type RomVersion } from './rom-versions.ts';
import { stripCopierHeader } from './rom-header.ts';
import { clearExtractionState, writeExtractionState } from './state.ts';
import { hex, hex0x, hexDollar } from './hex.ts';
import { u24le } from './engine/rom-read.ts';
import type { ExtractResult } from './types.ts';
export type { ExtractResult } from './types.ts';

interface Category {
  pointerSet: number;
  outDir: string;
}
const CATEGORIES: Category[] = [
  { pointerSet:  6, outDir: 'Graphics' },
  { pointerSet: 12, outDir: 'Graphics/SuperFX' },
  { pointerSet: 18, outDir: 'LevelData' },
  { pointerSet: 24, outDir: 'Tilemaps' },
  { pointerSet: 30, outDir: 'GarbageData' },
  { pointerSet: 36, outDir: 'SPC700' },
  { pointerSet: 42, outDir: 'SPC700/Samples/TitleScreen' },
  { pointerSet: 48, outDir: 'SPC700/Samples/Athletic' },
  { pointerSet: 54, outDir: 'SPC700/Samples/Ending' },
  { pointerSet: 60, outDir: 'SPC700/Samples/CaveFortBoss' },
  { pointerSet: 66, outDir: 'SPC700/Samples/BonusCastleBossGrassland' },
  { pointerSet: 72, outDir: 'SPC700/Samples/Bowser' },
  { pointerSet: 78, outDir: 'SPC700/Samples/IntroMapCastleFort' },
  { pointerSet: 84, outDir: 'SPC700/Samples/Global' },
];

/**
 * Cart addresses for the two ROM-internal lookup tables that we still pull
 * from the cart (verified empirically — the resulting JSON matches the
 * framework asm byte-for-byte):
 *
 *   - Header bit-widths    = PC $080B05 (matches `DATA_header_bit_length` in
 *     yi/Banks/Bank10.asm; expected `[5,4,5,5,6,6,6,7,4,5,6,5,5,4,2]`).
 *   - Standard-object info = PC $0904EC (matches `DATA_object_property_table`
 *     in yi/Banks/Bank12.asm; expected first byte 0xFF then `02,01,01,...`).
 *
 * The level pointer table (`Ptrs`) is likewise resolved from the cart at
 * extract time via the vendored V1.0 SymbolMap — see buildLevelMap(). Each
 * entry's label maps 1:1 to a LevelData/.bin filename.
 */
const ROM_TABLES = {
  levelCount: 222,
  // Cart-address constants are resolved via the vendored V1.0 SymbolMap at
  // extract time — see buildLevelMap() — so a future asm patch that shifts
  // these tables only requires updating the vendored map, not this file.
  // Labels: `DATA_header_bit_length` ($10:8B05) and
  // `DATA_object_property_table` ($12:84EC).
};

export interface LevelMapEntry {
  /** Per-level .bin filename relative to assets/yi/LevelData/; null = empty slot.
   *  Each file is self-contained — the bytes go from the start of this level's
   *  object/sprite stream through its terminator. The loader reads the whole
   *  file from byte 0; there is no offset. */
  objectFile: string | null;
  spriteFile: string | null;
  /**
   * World-map entry point — cell coordinates Yoshi spawns at when entering
   * this level from the world map. Absent for levels not reachable directly
   * from the world map (sub-rooms, intro-only levels, etc.).
   */
  spawn?: { x: number; y: number };
}

export interface LevelMap {
  romVersion: RomVersion;
  romVersionLabel: string;
  /** Bit widths used to unpack the 15-byte level header (MSB-first). */
  headerBitWidths: number[];
  /** 256 bytes; (objectInfo[num] & 3) controls width/height presence per object record. */
  standardObjectInfo: number[];
  /** Per-level-ID lookup. Keys are decimal **data-record** indices (= what
   *  the cart's pointer table at $17:F7C3 is indexed by). Bin filenames
   *  encode the same record index. Warp-exit `destLevelRecordId` values address
   *  this map directly. */
  levels: Record<string, LevelMapEntry>;
  /** Translevel ID (world-map slot, 0..71) → data-record index (Ptrs offset).
   *  Resolved at extract time by walking gm$0C's indirection chain
   *  (DATA_level_entrance_indexes → DATA_map_level_entrances). Entries with no main-world entrance
   *  (bonus games, mini-games, intro-only slots) map to `null` — those
   *  IDs aren't reachable from the world-map and have no canonical record. */
  translevelToRecord: Record<string, number | null>;
}

export interface ExtractOptions {
  workRoot: string;
  asarBin: string;
  romVersion: RomVersion;
  referenceCartPath: string;
  onProgress?: (msg: string) => void;
}

function buildTempSfc(opts: ExtractOptions): string {
  const scriptDir = path.join(opts.workRoot, 'yi', 'AsarScripts');
  const tempSfc = path.join(scriptDir, 'TEMP.sfc');
  if (fs.existsSync(tempSfc)) fs.rmSync(tempSfc);
  const bit = ROM_VERSIONS[opts.romVersion].bit;
  runAsar({
    asarBin: opts.asarBin,
    cwd: scriptDir,
    args: [
      '--fix-checksum=off',
      '--no-title-check',
      '--define', `ROMVer=${hexDollar(bit, 4)}`,
      'AssetPointersAndFiles.asm',
      'TEMP.sfc',
    ],
  });
  return tempSfc;
}

/**
 * SNES cart range covered by one extracted LevelData/.bin. Captured during
 * extraction so we can map arithmetic-offset Ptrs entries (e.g. `LABEL-$02`)
 * back to (filename, interior_offset).
 */
interface LevelBinSlice {
  filename: string;
  startSnes: number;
  /** exclusive end */
  endSnes: number;
}


/**
 * Spawn cells (`{x,y}` in 16-px units) keyed by the level-data id Yoshi spawns
 * INTO, parsed from `DATA_map_level_entrances` (record byte +0 = level id, +1/+2
 * = spawn cell). Shares the world-map entrance codec (the editor's single source
 * of truth — see world-map.ts), so extract and the editor read one parser.
 *
 * Note the key is not always the "named" level a user picks from the world map —
 * some translevels deposit Yoshi in an intro sub-room (e.g. level $9B for Visit
 * Koopa And Para-Koopa). Multiple records sharing a level id keep the last
 * (highest-index) record, matching the prior behaviour.
 */
function parseEntrancesFromAsm(workRoot: string): Map<number, { x: number; y: number }> {
  const asmPath = path.join(workRoot, 'yi', 'Routines', 'DATATABLE_YI_LevelDataPtrsAndEntranceData.asm');
  const model = parseEntranceTable(fs.readFileSync(asmPath, 'utf8'), loadLevelIdSymbols(workRoot));
  const out = new Map<number, { x: number; y: number }>();
  for (const e of model.entrances) out.set(e.levelDataId, { x: e.spawnX, y: e.spawnY });
  return out;
}

/**
 * Walk the object stream + exit list starting at cart PC and return the byte
 * extent (= the PC immediately after the exit-list terminator). Mirrors the
 * cart's main object loop (Bank10 `CODE_108BAF`) byte-for-byte for accounting
 * purposes. Used to compute the size of each level's per-level object .bin.
 */
export function findObjStreamEndPC(
  cart: Buffer,
  startPC: number,
  headerBitWidths: number[],
  standardObjectInfo: number[]
): number {
  // Header: bit-packed, round up to byte boundary.
  let bitPos = 0;
  for (const w of headerBitWidths) bitPos += w;
  const headerBytes = Math.ceil(bitPos / 8);
  let p = startPC + headerBytes;

  // Safety upper bound — no legitimate object stream + exits comes close to
  // a full 32KB bank, but we cap to avoid runaway parses when fed garbage.
  const limit = Math.min(cart.length, startPC + 0x4000);

  // Object stream: each record is num + locH + locL + maybe-w + maybe-h.
  // Terminator is num == $FF.
  while (p < limit) {
    const num = cart[p];
    if (num === 0xff) {
      p += 1;
      break;
    }
    p += 3; // num + locH + locL
    if (num === 0x00) {
      p += 1; // extended-object exnum
    } else {
      const flag = standardObjectInfo[num]! & 3;
      if (flag !== 1) p += 1; // width byte
      if (flag !== 0) p += 1; // height byte
    }
  }

  // Exit list: 5-byte records (screen, dest_level, dest_X, dest_Y, entry),
  // terminator is a leading $FF byte.
  while (p < limit) {
    const b = cart[p];
    if (b === 0xff) {
      p += 1;
      break;
    }
    p += 5;
  }
  return p;
}

/** Walk the sprite stream starting at cart PC and return the byte extent (=
 *  the PC after the $FFFF terminator). 3-byte records, 16-bit terminator. */
export function findSprStreamEndPC(cart: Buffer, startPC: number): number {
  const limit = Math.min(cart.length, startPC + 0x1000);
  let p = startPC;
  while (p + 2 <= limit) {
    const word = cart[p] | (cart[p + 1] << 8);
    if (word === 0xffff) {
      p += 2;
      break;
    }
    p += 3;
  }
  return p;
}

/** Hex-uppercase 2-digit ID string (e.g. `02`, `3C`). Matches the convention
 *  used in cart asm comments and engineering docs. */
function levelIdHex(id: number): string {
  return hex(id, 2);
}

/**
 * Remove `DATA_XXXXXX.bin` files from `levelDataDir` that aren't referenced
 * by any `incbin` directive in any `Bank*.asm` file. AssetPointersAndFiles.asm
 * still requests extraction of every original label-based slot for upstream
 * compatibility, but after the Phase-2 per-level rename the cart build only
 * consumes 438 of the resulting files. The other ~435 are orphans on disk.
 * Returns the count of files deleted.
 */
function sweepOldStyleOrphans(banksDir: string, levelDataDir: string): number {
  const referenced = new Set<string>();
  const incbinRe = /incbin\s+"LevelData\/([^"]+\.bin)"/g;
  for (const f of fs.readdirSync(banksDir)) {
    if (!/^Bank[0-9A-Fa-f]+\.asm$/.test(f)) continue;
    const text = fs.readFileSync(path.join(banksDir, f), 'utf8');
    for (const m of text.matchAll(incbinRe)) referenced.add(m[1]);
  }
  const oldStyleRe = /^DATA_[0-9A-Fa-f]{6}\.bin$/;
  let deleted = 0;
  for (const f of fs.readdirSync(levelDataDir)) {
    if (!oldStyleRe.test(f)) continue;        // only sweep old-style names
    if (referenced.has(f)) continue;           // build still uses it; keep
    fs.unlinkSync(path.join(levelDataDir, f));
    deleted++;
  }
  return deleted;
}

function buildLevelMap(
  opts: ExtractOptions,
  cart: Buffer,
  availableLevelBins: Set<string>,
  levelBinSlices: LevelBinSlice[]
): LevelMap {
  // Resolve cart-resident table addresses via the vendored V1.0 SymbolMap
  // (extract runs BEFORE any build, so no `.sym` exists yet).
  const symbols = vendoredV10SymbolMap();
  const headerBitWidthsPC = symbols.pc('DATA_header_bit_length');
  const standardObjectInfoPC = symbols.pc('DATA_object_property_table');
  // Cart pointer-table address. The cart's runtime indexes this with
  // `level_id * 6` to load each level's object + sprite pointer; we read it
  // directly to get the resolved (post-asar) SNES addresses for every level.
  const ptrsPC = symbols.pc('YI_LevelDataPtrsAndEntranceData_Ptrs');

  // Spawns still come from the asm — the world-map entrance table doesn't
  // have a single cart-resident address that maps cleanly to level IDs.
  const spawns = parseEntrancesFromAsm(opts.workRoot);

  // Sentinel SNES addresses — the cart pointer table for level IDs $DA / $DB
  // points obj at `DATA_15FCEA` (a 1-byte `$FF` placeholder) and spr at
  // `DATA_14FFA5End` (an InsertGarbageData macro slot). These aren't real level
  // streams; emitting per-level files for them would just capture garbage
  // bytes. Filter them out by SNES address rather than by label-name because
  // the asm rename may have moved label boundaries.
  const SENTINEL_OBJ_SNES = new Set<number>([0x15fcea]);
  const SENTINEL_SPR_SNES = new Set<number>([0x15ffd5]);
  void availableLevelBins;
  void levelBinSlices;

  // Read the header bit-widths table (zero-terminated). 15 widths expected.
  // Pulled BEFORE the per-level loop so the stream-walker can use them.
  const headerBitWidths: number[] = [];
  for (let i = 0; i < 32; i++) {
    const w = cart[headerBitWidthsPC + i];
    if (w === 0) break;
    headerBitWidths.push(w);
  }

  // Standard object info table — exactly 256 bytes.
  const standardObjectInfo: number[] = [];
  for (let i = 0; i < 256; i++) {
    standardObjectInfo.push(cart[standardObjectInfoPC + i]);
  }

  // Per-level bin extraction. For each of the 222 pointer-table entries, read
  // the resolved SNES address from the cart, walk the stream to find its byte
  // extent, and emit a self-contained `DATA_level_NN_obj/spr.bin`. The JungleRhythm
  // ($19) and $CB-range sprite-pointer-biased-by-2 cases need no special
  // handling — the cart's pointer-table bytes already encode the bias, so we
  // just read those bytes and start the stream walk there.
  const levelDataDir = path.join(opts.workRoot, 'assets', 'yi', 'LevelData');
  const POINTER_COUNT = ROM_TABLES.levelCount;
  const levels: Record<string, LevelMapEntry> = {};

  for (let id = 0; id < POINTER_COUNT; id++) {
    const entryPC = ptrsPC + id * 6;
    const objSnes = u24le(cart, entryPC);
    const sprSnes = u24le(cart, entryPC + 3);

    let objectFile: string | null = null;
    let spriteFile: string | null = null;

    if (objSnes !== 0 && !SENTINEL_OBJ_SNES.has(objSnes)) {
      const start = snesToPC(objSnes);
      const end = findObjStreamEndPC(cart, start, headerBitWidths, standardObjectInfo);
      if (end > start) {
        objectFile = `DATA_level_${levelIdHex(id)}_obj.bin`;
        fs.writeFileSync(path.join(levelDataDir, objectFile), cart.subarray(start, end));
      }
    }

    if (sprSnes !== 0 && !SENTINEL_SPR_SNES.has(sprSnes)) {
      const start = snesToPC(sprSnes);
      const end = findSprStreamEndPC(cart, start);
      if (end > start) {
        spriteFile = `DATA_level_${levelIdHex(id)}_spr.bin`;
        fs.writeFileSync(path.join(levelDataDir, spriteFile), cart.subarray(start, end));
      }
    }

    if (!objectFile && !spriteFile) continue;
    const spawn = spawns.get(id);
    levels[String(id)] = {
      objectFile,
      spriteFile,
      ...(spawn ? { spawn } : {}),
    };
  }

  // Walk gm$0C's indirection chain (Bank01.asm:6077-6080) to map each
  // translevel ID (world-map slot, 0..71) to its data-record index (the
  // value the cart uses to index `Ptrs`). Naive Ptrs[translevel_id*6]
  // gives the wrong data for any non-identity-mapped slot — e.g. world
  // 6-1 ($3C) actually resolves to record $2D, whose bin lives at
  // $11:E8B1, not $16:873E.
  const f3e7PC = symbols.pc('YI_LevelDataPtrsAndEntranceData_DATA_level_entrance_indexes');
  const f471PC = symbols.pc('YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances');
  // The f471 entrance table ends where the next table (midway entrances)
  // begins; an entOff at/beyond that is garbage, not a real entrance.
  const f471Size =
    symbols.pc('YI_LevelDataPtrsAndEntranceData_DATA_map_level_midway_entrances') - f471PC;
  const TRANSLEVEL_COUNT = 72;
  const translevelToRecord: Record<string, number | null> = {};
  for (let id = 0; id < TRANSLEVEL_COUNT; id++) {
    const entOff = cart[f3e7PC + id * 2] | (cart[f3e7PC + id * 2 + 1] << 8);
    // A slot with no main-world entrance → null (it's not entered via gm$0C, so
    // it has no data record). TWO sentinels: entOff == 0 (the cleared "no
    // entrance" marker, for id > 0), and entOff outside the f471 table — an
    // UNCLEARED garbage index left in unused slots. Both occur for the same
    // kinds of slot (bonus games / unused tail slots); most clear to 0, but a
    // few keep stale indices (e.g. World 6's 0x45 "Slot Machine" → 1792, which
    // naively reads record 0x17 and collides with 3-6). ID 0 uses offset 0.
    if ((entOff === 0 && id !== 0) || entOff >= f471Size) {
      translevelToRecord[String(id)] = null;
      continue;
    }
    translevelToRecord[String(id)] = cart[f471PC + entOff];
  }

  return {
    romVersion: opts.romVersion,
    romVersionLabel: ROM_VERSIONS[opts.romVersion].label,
    headerBitWidths,
    standardObjectInfo,
    levels,
    translevelToRecord,
  };
}

export function extractAssets(opts: ExtractOptions): ExtractResult {
  const { workRoot, romVersion, referenceCartPath, onProgress } = opts;
  const info = ROM_VERSIONS[romVersion];

  if (!fs.existsSync(referenceCartPath)) {
    throw new Error(`Reference cart not found: ${referenceCartPath}`);
  }

  // Read the cart once and strip an external copier header if present, so the
  // stash and all downstream tooling see unheadered bytes (every cart we process
  // is unheadered; the MD5 below must also be of the stripped bytes). See
  // rom-header.ts.
  const rawCart = fs.readFileSync(referenceCartPath);
  const cart = stripCopierHeader(rawCart);
  const headered = cart.length !== rawCart.length;
  if (headered) {
    onProgress?.(`Stripped a 512-byte copier header (${rawCart.length} → ${cart.length} bytes).`);
  }

  // Stash a stable, unheadered copy of the cart under workRoot/reference/ so
  // downstream tooling (BizHawk render harness, re-extracts) doesn't need the user
  // to re-supply the path. `reference/` is gitignored and never bundled. Write when
  // the source isn't already the stash, OR when we stripped a header from it (so a
  // re-extract from the stash never re-strips).
  const referenceDir = path.join(workRoot, 'reference');
  fs.mkdirSync(referenceDir, { recursive: true });
  const stashedCart = path.join(referenceDir, 'reference.sfc');
  if (path.resolve(referenceCartPath) !== path.resolve(stashedCart) || headered) {
    fs.writeFileSync(stashedCart, cart);
    onProgress?.(`Saved reference cart copy to ${stashedCart}`);
  }

  // Two distinct trees:
  //   assetsRoot     — asar's inputs (only the .bin / .brr / etc. asar knows)
  //   editorDataRoot — editor-derived files (level-map.json, icons, palette…)
  // Keeping them separate means the asar build path can't accidentally see
  // files it doesn't understand, and we can wipe / regenerate editor data
  // without touching the asar inputs.
  const assetsRoot = path.join(workRoot, 'assets', 'yi');
  const editorDataRoot = path.join(workRoot, 'editor-data', 'yi');
  clearExtractionState(workRoot);
  if (fs.existsSync(assetsRoot)) {
    onProgress?.('Removing previous extracted assets...');
    fs.rmSync(assetsRoot, { recursive: true, force: true });
  }
  if (fs.existsSync(editorDataRoot)) {
    fs.rmSync(editorDataRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.mkdirSync(editorDataRoot, { recursive: true });

  onProgress?.(`Building pointer table TEMP.sfc for ${info.label}...`);
  const tempSfcPath = buildTempSfc(opts);
  const temp = fs.readFileSync(tempSfcPath);
  // `cart` (unheadered) was read + stripped above; MD5 the stripped bytes so a
  // headered dump matches the same reference MD5 as its unheadered form.
  const cartMd5 = crypto.createHash('md5').update(cart).digest('hex');

  let extracted = 0;
  let empty = 0;
  const availableLevelBins = new Set<string>();
  const levelBinSlices: LevelBinSlice[] = [];

  for (const cat of CATEGORIES) {
    const categoryTableSNES = u24le(temp, cat.pointerSet);
    const entryCount = u24le(temp, cat.pointerSet + 3);
    const tableBasePC = snesToPC(categoryTableSNES);
    const outBase = path.join(assetsRoot, cat.outDir);
    fs.mkdirSync(outBase, { recursive: true });

    for (let i = 0; i < entryCount; i++) {
      const entryPC = tableBasePC + i * 12;
      const srcStartSnes = u24le(temp, entryPC + 0);
      const srcEndSnes   = u24le(temp, entryPC + 3);
      const fnameStart   = snesToPC(u24le(temp, entryPC + 6));
      const fnameEnd     = snesToPC(u24le(temp, entryPC + 9));
      const fname        = temp.subarray(fnameStart, fnameEnd).toString('ascii');

      let data: Buffer;
      if (srcEndSnes === 0 || srcStartSnes === 0) {
        data = Buffer.alloc(0);
        empty++;
      } else {
        const startPC = snesToPC(srcStartSnes);
        const endPC = snesToPC(srcEndSnes);
        data = cart.subarray(startPC, endPC);
        // Track which LevelData .bin files actually got produced — the asm
        // parser uses this to skip entries whose .bin didn't materialize.
        // Capture the SNES range too, so we can resolve arithmetic-offset
        // Ptrs entries (`LABEL-$N`) back to (file, interior_offset).
        if (cat.outDir === 'LevelData' && data.length > 0) {
          availableLevelBins.add(fname);
          levelBinSlices.push({
            filename: fname,
            startSnes: srcStartSnes,
            endSnes: srcEndSnes
          });
        }
      }
      fs.writeFileSync(path.join(outBase, fname), data);
      extracted++;
    }
  }

  onProgress?.('Building level-map.json...');
  const levelMap = buildLevelMap(opts, cart, availableLevelBins, levelBinSlices);
  // Serialize level ids as hex string keys on disc (must match level.ts
  // `levelIdHexKey` — the project ID convention: hex strings on disc, numbers
  // at runtime). `levelMap` stays decimal-keyed in-memory purely as a build
  // intermediate; the catalog + everything that reads level-map.json use hex.
  const hexKey = (k: string): string => hex0x(parseInt(k, 10), 2);
  const levelMapForDisc = {
    ...levelMap,
    levels: Object.fromEntries(
      Object.entries(levelMap.levels).map(([k, v]) => [hexKey(k), v])
    ),
    translevelToRecord: Object.fromEntries(
      Object.entries(levelMap.translevelToRecord).map(([k, v]) => [hexKey(k), v])
    )
  };
  fs.writeFileSync(
    path.join(editorDataRoot, 'level-map.json'),
    JSON.stringify(levelMapForDisc, null, 2)
  );

  // AssetPointersAndFiles.asm still requests extraction of the original
  // label-based level-data .bins (DATA_XXXXXX.bin), but after the Phase-2
  // asm rewrite the cart build only incbin's the per-level files. The
  // old-style .bins are pure noise — sweep them out so each extract leaves
  // a clean LevelData/. Preserves the 4 still-referenced old labels
  // (DATA_1695D4End, DATA_11DB2EEnd, DATA_level_7F_spr, DATA_level_D2_spr — see their
  // declarations for why each one couldn't be renamed).
  const orphanCount = sweepOldStyleOrphans(
    path.join(workRoot, 'yi', 'Banks'),
    path.join(assetsRoot, 'LevelData')
  );
  if (orphanCount > 0) {
    onProgress?.(`Removed ${orphanCount} orphaned old-style DATA_XXXXXX.bin files.`);
  }

  onProgress?.('Building levels.json (cart-derived catalog)...');
  const catalog = buildLevelsCatalog(
    workRoot,
    cart,
    vendoredV10SymbolMap(),
    levelMapForDisc.translevelToRecord // hex-keyed, as buildLevelsCatalog now expects
  );
  // Append orphan / unused rooms — records with level data reachable from
  // neither a world-map slot nor a warp exit (sub-rooms ARE warp-reachable).
  // Needs the freshly written level-map on disk → drop the loader's cache first.
  invalidateLevelMapCache();
  const orphans = findOrphanRecords(workRoot);
  if (orphans.length > 0) {
    const hexId = (id: number): string => hex0x(id, 2);
    catalog.groups.push({
      label: 'Unused Rooms',
      levels: orphans.map((id) => ({
        recordId: id,
        name: `Room ${hexId(id)}`,
        world: 'Unused Rooms',
        slot: hexId(id)
      }))
    });
    onProgress?.(`  + ${orphans.length} unused/orphan rooms.`);
  }
  // Level IDs serialize as hex strings on disc (`"0x43"`) so every on-disc id
  // matches the `DATA_level_XX` filenames; the IPC reader / renderer parse them
  // back to numbers (the runtime contract is a numeric id).
  const catalogForDisc = {
    ...catalog,
    groups: catalog.groups.map((g) => ({
      ...g,
      levels: g.levels.map((l) => ({
        ...l,
        // null id (bonus / no-data slots) stays null on disc.
        recordId: l.recordId == null ? null : hex0x(l.recordId, 2)
      }))
    }))
  };
  fs.writeFileSync(
    path.join(editorDataRoot, 'levels.json'),
    JSON.stringify(catalogForDisc, null, 2)
  );
  const catalogCount = catalog.groups.reduce((n, g) => n + g.levels.length, 0);
  onProgress?.(`  catalog has ${catalogCount} entries across ${catalog.groups.length} groups.`);

  // Object/sprite instance index for the debug finder (replaces the old
  // hand-committed docs/level-{object,sprite}-index.tsv). Decodes every backed
  // level via loadLevel, so it runs after level-map.json is on disk + its
  // loader cache is fresh (invalidated above before findOrphanRecords).
  onProgress?.('Building instance-index.json (object/sprite finder)...');
  const instanceCount = writeInstanceIndex(workRoot);
  onProgress?.(`  indexed ${instanceCount} object/sprite instances.`);

  fs.rmSync(tempSfcPath);
  writeExtractionState(workRoot, {
    romVersion,
    extractedAt: new Date().toISOString(),
    sourceCart: referenceCartPath,
    sourceCartMd5: cartMd5,
    extractedFiles: extracted,
    emptyFiles: empty,
  });
  onProgress?.(
    `Extracted ${extracted} files (${empty} deliberately empty); ` +
    `mapped ${Object.keys(levelMap.levels).length} levels.`
  );
  return { extracted, empty };
}
