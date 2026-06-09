// Runtime level loader: reads a level's .bin file using the level-map.json
// produced at extract time, parses the header (bit-packed), object stream,
// screen-exit list, and sprite stream into a structured form.
//
// This is the stage-1 "blueprint view" parser: it returns symbolic objects
// (id, position, size) and sprites (id, position) without running per-object
// decoder routines or graphics decompression. Later stages will turn the
// symbolic stream into a tile grid (object decoder port from GoldenEgg) and
// then into RGB pixels (LZ2/LZ16 + palette + bitplane unpack).

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LevelMap, LevelMapEntry } from './extract.ts';
import type { RomVersion } from './rom-versions.ts';
import { hex0x } from './hex.ts';
import type {
  LevelData,
  LevelObject,
  LevelSprite,
  ScreenExit
} from './types.ts';
export type {
  LevelData,
  LevelObject,
  LevelSprite,
  ScreenExit,
  ScreenExitMinibattle,
  ScreenExitWarp
} from './types.ts';

/** Level 0x38 ("Kamek's Revenge") is hardcoded in the engine — skip parsing. */
const SPECIAL_LEVELS = new Set<number>([0x38]);

/**
 * Derive the cart's `CurrentWorld == World6` flag from a **translevel** ID.
 *
 * The framework define `LevelsPerWorld = 0x0C` (yi/Constants/Misc.asm:9) and
 * `WorldID_World6 = 0x000A` (yi/Constants/WorldIDs.asm:10). Bank17 computes
 * `world = floor(translevel / LevelsPerWorld) * 2` from CurrentLevelFromMap
 * (the world-map slot), so World 6 is translevels `5 * 12 = 60` (`0x3C`)
 * through `5 * 12 + 11 = 71` (`0x47`).
 *
 * This is a TRANSLEVEL test, NOT a record test — the two are different number
 * spaces (CLAUDE.md "two ID spaces — never conflate"). Feeding a record id
 * here silently mis-selects the tileset: e.g. 6-6 is record `0x32` /
 * translevel `0x41`, and `0x32 < 0x3C` so it read the light tileset instead of
 * the dark-world one. When you only have a record id, use `isWorld6Record`.
 */
export function isWorld6Translevel(translevelId: number): boolean {
  return translevelId >= 0x3c && translevelId <= 0x47;
}

/**
 * The world-map translevel that resolves to `recordId`, or null when none does.
 * Inverts the level-map's `translevelToRecord` (hex-string keys → plain record
 * ints). Sub-rooms + orphan rooms aren't world-map reachable, so they return
 * null.
 */
export function recordToTranslevel(map: LevelMap, recordId: number): number | null {
  for (const [tl, rec] of Object.entries(map.translevelToRecord)) {
    if (rec === recordId) return parseInt(tl, 16);
  }
  return null;
}

/**
 * World-6 (dark BG1 tileset/palette) test for a RECORD id: resolve the record's
 * world-map translevel, then apply `isWorld6Translevel`.
 *
 * **Limitation:** sub-rooms have no world-map translevel → false. At runtime a
 * world-6 level's sub-rooms inherit its world, but this test can't tell which
 * root a sub-room belongs to. For the render path — where the record may be a
 * warp-reached sub-room — use {@link isWorld6RecordDeep}, which walks the warp
 * graph to recover them. This stays the pure translevel test.
 */
export function isWorld6Record(map: LevelMap, recordId: number): boolean {
  const tl = recordToTranslevel(map, recordId);
  return tl != null && isWorld6Translevel(tl);
}

let cachedMap: { workRoot: string; map: LevelMap } | null = null;
let cachedWorld6: { workRoot: string; set: Set<number> } | null = null;

/** Public accessor for the cached level-map. Callers (e.g. the serializer
 *  override path in the render IPC) need `headerBitWidths` +
 *  `standardObjectInfo` to re-encode a mutated LevelData. */
export function loadLevelMapPublic(workRoot: string): LevelMap {
  return loadLevelMap(workRoot);
}

/** Hex-string key for a numeric level id (`67` → `"0x43"`). Level-map and
 *  catalog ids are stored in hex on disc so they match the `DATA_level_XX`
 *  filenames; this is the one place the format is defined. */
export function levelIdHexKey(id: number): string {
  return hex0x(id, 2);
}

/** Look up a level-map entry by numeric id, tolerant of both hex-string keys
 *  (current) and decimal-string keys (older extracts). */
export function levelMapEntry(
  levels: Record<string, LevelMapEntry>,
  id: number
): LevelMapEntry | undefined {
  return levels[levelIdHexKey(id)] ?? levels[String(id)];
}

function loadLevelMap(workRoot: string): LevelMap {
  if (cachedMap && cachedMap.workRoot === workRoot) return cachedMap.map;
  const p = path.join(workRoot, 'editor-data', 'yi', 'level-map.json');
  if (!fs.existsSync(p)) {
    throw new Error(
      'level-map.json not found — extract assets first (Workshop → ROM → Extract).'
    );
  }
  const map = JSON.parse(fs.readFileSync(p, 'utf8')) as LevelMap;
  cachedMap = { workRoot, map };
  return map;
}

/** Invalidate the in-process map cache (called after a fresh extract). */
export function invalidateLevelMapCache(): void {
  cachedMap = null;
  cachedWorld6 = null;
}

/**
 * Every record that renders with World-6 dark/Bowser BG1 visuals: the world-6
 * world-map levels PLUS every sub-room reachable from one through the warp-exit
 * graph.
 *
 * Why the graph walk: at runtime `CurrentWorld` (`$0218`) is derived from the
 * world-map slot the player entered (`CurrentLevelFromMap`) and is NOT
 * recomputed on an intra-level warp, so every room visited while playing a
 * world-6 level draws with world-6 BG1 — even though a sub-room has no world-map
 * translevel of its own. {@link isWorld6Record} (a translevel test) alone
 * therefore wrongly returns false for those sub-rooms, e.g. 6-6 "The Deep,
 * Underground Maze" is record `0x32` / translevel `0x41`, but its maze interior
 * is sub-room `0x69` (no translevel) — so the editor rendered it with the light
 * tileset. This recovers them by seeding the world-6 roots and following warps.
 *
 * Traversal stops at any warp destination that has its OWN world-map translevel:
 * that's a real level carrying its own world identity, so it must not inherit
 * (mirrors the renderer's sub-level-discovery prune, and keeps the walk from
 * leaking into other worlds). Assumes a sub-room is never shared between a
 * world-6 and a non-world-6 level — true in YI.
 *
 * Computed against the BASE cart (no overlay): warp-graph topology is a property
 * of the shipped game, not something a project's overlay edits re-color. Cached
 * per workRoot; cleared by `invalidateLevelMapCache`.
 */
export function world6Records(workRoot: string): Set<number> {
  if (cachedWorld6 && cachedWorld6.workRoot === workRoot) return cachedWorld6.set;
  const map = loadLevelMap(workRoot);
  const backed = new Set<number>();
  for (const [k, v] of Object.entries(map.levels)) {
    if (v.objectFile) backed.add(Number(k));
  }
  const hasTranslevel = (rec: number): boolean => recordToTranslevel(map, rec) != null;
  const w6 = new Set<number>();
  const queue: number[] = [];
  for (const [tl, rec] of Object.entries(map.translevelToRecord)) {
    if (rec != null && isWorld6Translevel(parseInt(tl, 16))) {
      w6.add(rec);
      queue.push(rec);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    let data: LevelData;
    try {
      data = loadLevel({ workRoot, levelRecordId: id });
    } catch {
      continue;
    }
    for (const ex of data.exits) {
      if (ex.variant !== 'warp') continue;
      const dest = ex.destLevelRecordId;
      // Only translevel-less sub-rooms inherit world-6; a destination that is
      // itself a world-map level keeps its own world (and isn't traversed).
      if (dest == null || !backed.has(dest) || hasTranslevel(dest) || w6.has(dest)) continue;
      w6.add(dest);
      queue.push(dest);
    }
  }
  cachedWorld6 = { workRoot, set: w6 };
  return w6;
}

/**
 * World-6 (dark BG1 tileset/palette) test for a RECORD id, INCLUDING warp-reached
 * sub-rooms. Use this anywhere the record being rendered may be a sub-room (the
 * whole render path); {@link isWorld6Record} only sees world-map levels. Backed
 * by the cached {@link world6Records} BFS.
 */
export function isWorld6RecordDeep(workRoot: string, recordId: number): boolean {
  return world6Records(workRoot).has(recordId);
}

/**
 * Bit reader: pulls `n` bits from `bytes` starting at `bitOffset`, MSB-first
 * (matches the loader in GE/Level.cs:8555).
 */
function readBits(bytes: Buffer, bitOffset: number, n: number): number {
  let value = 0;
  for (let i = 0; i < n; i++) {
    const byte = bytes[(bitOffset + i) >> 3];
    const bit = 7 - ((bitOffset + i) & 7);
    value = (value << 1) | ((byte >> bit) & 1);
  }
  return value;
}

function decodeXY(locH: number, locL: number): { x: number; y: number } {
  // YI's interleaved-nibble encoding (matches GE/Level.cs:9258/9271 and the
  // engine's actual decode; some wiki notations show this as `XXXXYYYY xxxxyyyy`
  // but that is a labeling shorthand — X actually lives in the LOW nybbles
  // of each byte, Y in the HIGH nybbles):
  //   X = (locL & 0x0F) | ((locH & 0x0F) << 4)
  //   Y = (locL >> 4)   |  (locH & 0xF0)
  return {
    x: (locL & 0x0f) | ((locH & 0x0f) << 4),
    y: ((locL >> 4) & 0x0f) | (locH & 0xf0)
  };
}

function parseHeader(
  bytes: Buffer,
  offset: number,
  bitWidths: number[]
): { header: number[]; bytesConsumed: number } {
  let bitPos = offset * 8;
  const header: number[] = [];
  for (const width of bitWidths) {
    header.push(readBits(bytes, bitPos, width));
    bitPos += width;
  }
  // Round up to the next byte boundary — the object stream starts on a byte.
  const endBit = (bitPos + 7) & ~7;
  return { header, bytesConsumed: endBit / 8 - offset };
}

function parseObjects(
  bytes: Buffer,
  startOffset: number,
  standardObjectInfo: number[],
  /** BG1 tileset (header field 1). The width sign-fold is suppressed when it's
   *  2 — a cart special case (see the width fold below). */
  bg1Tileset: number
): { objects: LevelObject[]; nextOffset: number } {
  const objects: LevelObject[] = [];
  let p = startOffset;
  let index = 0;
  while (p < bytes.length) {
    const num = bytes[p];
    if (num === 0xff) {
      p += 1;
      break;
    }
    const recStart = p;
    let exnum: number | undefined;
    p += 1;
    const locH = bytes[p++];
    const locL = bytes[p++];
    let infoNum = num;
    if (num === 0x00) {
      exnum = bytes[p++];
      infoNum = 0; // extended objects are always 1x1 at the header level
    }
    // Flag = LOW 2 bits of the standard-object-info table byte (matches
    // GE/Level.cs:8597 — `ROM[591084 + num].u8 & 3U`). Some wiki notations
    // describe this as the "first 2 bits"; the engine uses the low bits.
    const flag = standardObjectInfo[infoNum] & 3;
    let w = 1;
    let h = 1;
    if (num !== 0x00) {
      // Width-1 present iff flag != 1
      if (flag !== 1) {
        const wb = bytes[p++];
        // Width sign-fold: a high bit grows the object LEFT (negative width) —
        // but ONLY when BG1 tileset != 2. When BG1 == 2 the cart takes the
        // positive path instead (so 0x9F decodes to +160, not −96). This
        // mirrors the engine decoder (object-decode/parser.ts) + Bank10
        // CODE_108C33; the height fold below has no such exception.
        w = wb >= 0x80 && bg1Tileset !== 2 ? -((0x100 - wb)) + 1 : wb + 1;
      }
      // Height-1 present iff flag != 0
      if (flag !== 0) {
        const hb = bytes[p++];
        // Height sign-fold (no BG1 exception — Bank10 CODE_108C6D).
        h = hb >= 0x80 ? -((0x100 - hb)) + 1 : hb + 1;
      }
    }
    const { x, y } = decodeXY(locH, locL);
    const raw = Array.from(bytes.subarray(recStart, p));
    objects.push({ index: index++, num, exnum, x, y, w, h, raw });
  }
  return { objects, nextOffset: p };
}

function parseExits(
  bytes: Buffer,
  startOffset: number
): { exits: ScreenExit[]; nextOffset: number } {
  const exits: ScreenExit[] = [];
  let p = startOffset;
  while (p < bytes.length) {
    const b = bytes[p];
    if (b === 0xff) {
      p += 1;
      break;
    }
    const screenIndex = bytes[p];
    const byte1 = bytes[p + 1];
    const byte2 = bytes[p + 2];
    const byte3 = bytes[p + 3];
    const byte4 = bytes[p + 4];
    if (byte1 >= 0xde && byte1 <= 0xe9) {
      exits.push({
        variant: 'minibattle',
        screenIndex,
        minibattleId: byte1,
        returnX: byte2,
        returnY: byte3,
        returnLevelRecordId: byte4
      });
    } else {
      exits.push({
        variant: 'warp',
        screenIndex,
        destLevelRecordId: byte1,
        destX: byte2,
        destY: byte3,
        entranceType: byte4
      });
    }
    p += 5;
  }
  return { exits, nextOffset: p };
}

function parseSprites(
  bytes: Buffer,
  startOffset: number
): { sprites: LevelSprite[]; nextOffset: number } {
  const sprites: LevelSprite[] = [];
  let p = startOffset;
  let index = 0;
  while (p + 2 <= bytes.length) {
    const num16 = bytes[p] | (bytes[p + 1] << 8);
    if (num16 === 0xffff) {
      p += 2;
      break;
    }
    // num16: bits 0..8 = sprite num, bits 9..15 = y (per GoldenEgg).
    const num = num16 & 0x1ff;
    const y = (num16 >> 9) & 0x7f;
    const x = bytes[p + 2];
    sprites.push({ index: index++, num, x, y });
    p += 3;
  }
  // Cart-data quirk: at least one level (0x19 in DATA_14C528End.bin) has its
  // sprite section truncated to 1 byte of the 2-byte `0xFFFF` terminator at
  // EOF. Treat a lone trailing `0xFF` as a consumed half-terminator so
  // `diag.spriteBytes` accurately reflects what was on disk.
  if (p < bytes.length && bytes[p] === 0xff) p += 1;
  return { sprites, nextOffset: p };
}

/**
 * Absolute path to a LevelData/.bin, preferring the project's overlay copy
 * when `overlayRoot` is supplied (a per-project edit shadows the pristine
 * base). Shared by the loader and the engine decoder so both see the same
 * bytes. `overlayRoot` mirrors the workRoot tree.
 */
export function resolveLevelBinPath(
  workRoot: string,
  overlayRoot: string | undefined,
  file: string
): string {
  if (overlayRoot) {
    const overlaid = path.join(overlayRoot, 'assets', 'yi', 'LevelData', file);
    if (fs.existsSync(overlaid)) return overlaid;
  }
  return path.join(workRoot, 'assets', 'yi', 'LevelData', file);
}

export interface LoadLevelOptions {
  workRoot: string;
  levelRecordId: number;
  /** Optional per-project overlay root (mirrors workRoot). LevelData/.bin
   *  files present here shadow the base workRoot copies. */
  overlayRoot?: string;
}

export function loadLevel(opts: LoadLevelOptions): LevelData {
  const map = loadLevelMap(opts.workRoot);
  const entry: LevelMapEntry | undefined = levelMapEntry(map.levels, opts.levelRecordId);
  const empty = !entry || (entry.objectFile === null && entry.spriteFile === null);
  const special = SPECIAL_LEVELS.has(opts.levelRecordId);

  if (empty || special) {
    return {
      recordId: opts.levelRecordId,
      romVersion: map.romVersion,
      header: [],
      objects: [],
      exits: [],
      sprites: [],
      empty,
      special,
      diag: { headerBytes: 0, objectBytes: 0, exitBytes: 0, spriteBytes: 0 }
    };
  }

  const objectBytes = entry.objectFile
    ? fs.readFileSync(resolveLevelBinPath(opts.workRoot, opts.overlayRoot, entry.objectFile))
    : null;
  const spriteBytes = entry.spriteFile
    ? fs.readFileSync(resolveLevelBinPath(opts.workRoot, opts.overlayRoot, entry.spriteFile))
    : null;

  return decodeLevelStreams({
    recordId: opts.levelRecordId,
    romVersion: map.romVersion,
    headerBitWidths: map.headerBitWidths,
    standardObjectInfo: map.standardObjectInfo,
    objectBytes,
    spriteBytes,
    ...(entry.spawn ? { spawn: entry.spawn } : {})
  });
}

export interface DecodeLevelStreamsOptions {
  recordId: number;
  romVersion: RomVersion;
  /** Bit widths to unpack the 15-field header (MSB-first). */
  headerBitWidths: number[];
  /** 256-byte standard-object property table (low 2 bits = size encoding). */
  standardObjectInfo: number[];
  /** Raw object stream (header + objects + exit list), or null if none. */
  objectBytes: Buffer | null;
  /** Raw sprite stream, or null if none. */
  spriteBytes: Buffer | null;
  spawn?: { x: number; y: number };
}

/**
 * Decode a level directly from its raw stream bytes — the in-memory core of
 * `loadLevel`, without the file/level-map lookup. Used by the ROM-import path
 * (scripts/import/) to decode a FOREIGN cart's streams, which have no `.bin`
 * on disk: the importer walks the foreign pointer table, slices the stream
 * bytes, and decodes them here using the FOREIGN cart's own header-bit-widths +
 * standard-object table. The decode is format-driven, so it's identical to the
 * normal load once you have the bytes + tables.
 */
export function decodeLevelStreams(o: DecodeLevelStreamsOptions): LevelData {
  let header: number[] = [];
  let objects: LevelObject[] = [];
  let exits: ScreenExit[] = [];
  let headerBytes = 0;
  let objectBytes = 0;
  let exitBytes = 0;
  if (o.objectBytes) {
    const hdr = parseHeader(o.objectBytes, 0, o.headerBitWidths);
    header = hdr.header;
    headerBytes = hdr.bytesConsumed;
    const obj = parseObjects(o.objectBytes, hdr.bytesConsumed, o.standardObjectInfo, header[1] ?? 0);
    objects = obj.objects;
    objectBytes = obj.nextOffset - hdr.bytesConsumed;
    const ex = parseExits(o.objectBytes, obj.nextOffset);
    exits = ex.exits;
    exitBytes = ex.nextOffset - obj.nextOffset;
  }

  let sprites: LevelSprite[] = [];
  let spriteBytes = 0;
  if (o.spriteBytes) {
    const sp = parseSprites(o.spriteBytes, 0);
    sprites = sp.sprites;
    spriteBytes = sp.nextOffset;
  }

  return {
    recordId: o.recordId,
    romVersion: o.romVersion,
    header,
    objects,
    exits,
    sprites,
    empty: false,
    special: false,
    ...(o.spawn ? { spawn: o.spawn } : {}),
    diag: { headerBytes, objectBytes, exitBytes, spriteBytes }
  };
}

/**
 * Records that have level data but are reachable from NEITHER a world-map
 * translevel NOR the warp-exit graph. Sub-rooms ARE warp-reachable (the editor
 * surfaces them in the sub-level dropdown), so the remainder are orphan / unused
 * rooms — e.g. the cut Bank15 rooms. The catalog surfaces them as an "Unused
 * Rooms" group. Reads the on-disk level-map, so callers in the extract path must
 * `invalidateLevelMapCache()` after rewriting it.
 */
export function findOrphanRecords(workRoot: string, overlayRoot?: string): number[] {
  const map = loadLevelMap(workRoot);
  const backed = new Set<number>();
  for (const [k, v] of Object.entries(map.levels)) {
    if ((v as LevelMapEntry).objectFile) backed.add(Number(k));
  }
  // Seed reachability from every world-map record, then BFS the warp graph (a
  // warp exit's destLevelRecordId is a record id; every sub-room is reached this way).
  const reachable = new Set<number>();
  const queue: number[] = [];
  for (const rec of Object.values(map.translevelToRecord)) {
    if (rec != null && !reachable.has(rec)) {
      reachable.add(rec);
      queue.push(rec);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    let data: LevelData;
    try {
      data = loadLevel({ workRoot, levelRecordId: id, overlayRoot });
    } catch {
      continue;
    }
    for (const ex of data.exits) {
      if (ex.variant !== 'warp') continue;
      const dest = ex.destLevelRecordId;
      if (dest != null && backed.has(dest) && !reachable.has(dest)) {
        reachable.add(dest);
        queue.push(dest);
      }
    }
  }
  return [...backed].filter((r) => !reachable.has(r)).sort((a, b) => a - b);
}
