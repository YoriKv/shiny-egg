// Higher-level wrapper: turn a level ID into a decoded Map16 buffer by
// looking up the .bin file via the existing `editor-data/yi/level-map.json`
// and feeding the slice into our engine decoder.
//
// This bridges the editor's level-ID-centric world with the engine's
// bytes-in / buffer-out interface.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeLevel } from './index.ts';
import type { SymbolMap } from '../symbol-map.ts';
import type { DecodeState } from './state.ts';
import type { DecodeStats } from './parser.ts';
import { serializeLevel } from '../../serialize-level.ts';
import { levelIdHexKey, loadLevelMapPublic, resolveLevelBinPath } from '../../level.ts';
import { newSlotRows } from '../../pool-map.ts';
import type { LevelData } from '../../types.ts';

interface LevelMapEntry {
  objectFile: string | null;
  spriteFile: string | null;
  spawn?: { x: number; y: number };
}

interface LevelMap {
  romVersion: string;
  levels: Record<string, LevelMapEntry>;
}

export interface DecodeLevelByIdOptions {
  rom: Uint8Array;
  symbols: SymbolMap;
  workRoot: string;
  levelRecordId: number;
  /** Optional per-project overlay root (mirrors workRoot) — a .bin here
   *  shadows the base workRoot copy. */
  overlayRoot?: string;
  /** Captured cart-PRNG sequence (level-rng trace) to replay for exact
   *  random-tile replication. See decodeLevel options. */
  prngReplay?: readonly number[];
  /** Per-caller-site captured PRNG bytes (cart caller PC → sequence). Preferred
   *  replay form. See decodeLevel options / state.ts `prngReplayBySite`. */
  prngReplayBySite?: Record<number, readonly number[]>;
  /** Override the LFSR seed (the editor's "Refresh RNG" action) — re-rolls the
   *  cosmetic random-tile variants. Omit for the default deterministic seed.
   *  See decodeLevel options. */
  prngSeed?: number;
}

export interface DecodeLevelByIdResult {
  state: DecodeState;
  stats: DecodeStats;
  /** Source filename that fed the decoder. */
  source: { objectFile: string };
}

/** Engine-driven special records the decoder returns null for. EMPTY — record
 *  0x38 (the gm38 intro-cutscene level) was verified to decode cleanly; see
 *  level.ts SPECIAL_LEVELS (kept mirrored). */
const SPECIAL_LEVELS = new Set<number>([]);

let cachedMap: { workRoot: string; map: LevelMap } | null = null;

function loadLevelMap(workRoot: string): LevelMap {
  if (cachedMap && cachedMap.workRoot === workRoot) return cachedMap.map;
  const p = path.join(workRoot, 'editor-data', 'yi', 'level-map.json');
  const text = fs.readFileSync(p, 'utf8');
  const map = JSON.parse(text) as LevelMap;
  cachedMap = { workRoot, map };
  return map;
}

/**
 * Decode a level by ID. Returns null for empty / special-case slots.
 *
 * Reads the .bin file fresh on each call so edits to the file are
 * reflected immediately (no caching at this layer; the symbol map +
 * cart are cached upstream by the IPC handler).
 */
export function decodeLevelById(
  opts: DecodeLevelByIdOptions
): DecodeLevelByIdResult | null {
  const map = loadLevelMap(opts.workRoot);
  // level-map.json is keyed by hex level id ("0x00".."0xFF"); tolerate older
  // decimal-keyed extracts as a fallback. A raw `String(id)` produced decimal
  // "0", missed the hex key, and returned null — which the BG1 IPC handler
  // renders as a blank layer.
  const entry =
    map.levels[levelIdHexKey(opts.levelRecordId)] ?? map.levels[String(opts.levelRecordId)];
  if (!entry || entry.objectFile === null) return null;
  if (SPECIAL_LEVELS.has(opts.levelRecordId)) return null;

  // Per-level .bin files are self-contained — the whole file IS the level's
  // object section (header + objects + exits, $FF-terminated). Engine parser
  // stops on the terminator and never reads past. Overlay copy shadows base.
  const levelBytes = new Uint8Array(
    fs.readFileSync(
      resolveLevelBinPath(opts.workRoot, opts.overlayRoot, entry.objectFile)
    )
  );

  const { state, stats } = decodeLevel(opts.rom, opts.symbols, levelBytes, {
    prngReplay: opts.prngReplay,
    prngReplayBySite: opts.prngReplayBySite,
    prngSeed: opts.prngSeed
  });
  return {
    state,
    stats,
    source: { objectFile: entry.objectFile }
  };
}

export interface DecodeLevelFromLevelDataOptions {
  rom: Uint8Array;
  symbols: SymbolMap;
  workRoot: string;
  levelData: LevelData;
  /** Object drag cell-highlight: record provenance for the objects at these
   *  indices in `levelData.objects` (= their decode stream indices). One for a
   *  single drag; the whole group for a multi-select drag. */
  provenanceTargets?: number[];
  /** Per-caller-site captured PRNG bytes (cart caller PC → sequence) to replay,
   *  reproducing a specific live entry's random-tile variants. See decodeLevel. */
  prngReplayBySite?: Record<number, readonly number[]>;
  /** Override the LFSR seed (the editor's "Refresh RNG" action) — re-rolls the
   *  cosmetic random-tile variants. Omit for the default deterministic seed.
   *  See decodeLevel options. */
  prngSeed?: number;
}

/**
 * Override path: decode a level from a (possibly edited) `LevelData` instead
 * of reading the source `.bin`. Serializes the LevelData using the cached
 * level-map metadata (header bit widths + per-object property table) and
 * feeds the bytes through the same decoder used on the disk path.
 *
 * Returns null for empty / special slots (matches `decodeLevelById`).
 */
export function decodeLevelFromLevelData(
  opts: DecodeLevelFromLevelDataOptions
): DecodeLevelByIdResult | null {
  if (opts.levelData.empty || opts.levelData.special) return null;
  const map = loadLevelMapPublic(opts.workRoot);
  let entry =
    map.levels[levelIdHexKey(opts.levelData.recordId)] ??
    map.levels[String(opts.levelData.recordId)];
  // New-slot records (the `Ptrs:` sentinel rows 0xDA/0xDB) have no
  // extract-derived map entry — they exist only as project-overlay `.bin`s until
  // a build places them. Synthesize the conventional entry so they RENDER,
  // mirroring resources.ts `effectiveLevelMapEntry` / loadLevel's synthesis.
  // Load + save already do this; the render decode must too, else a new-slot
  // level loads and edits but shows nothing on the canvas.
  if (
    (!entry || entry.objectFile === null) &&
    newSlotRows(map.romVersion).some((r) => r.recordId === opts.levelData.recordId)
  ) {
    const hex = opts.levelData.recordId.toString(16).toUpperCase().padStart(2, '0');
    entry = { objectFile: `DATA_level_${hex}_obj.bin`, spriteFile: `DATA_level_${hex}_spr.bin` };
  }
  if (!entry || entry.objectFile === null) return null;
  const { objectBytes } = serializeLevel({
    level: opts.levelData,
    headerBitWidths: map.headerBitWidths,
    standardObjectInfo: map.standardObjectInfo
  });
  // `decodeLevel` expects a Uint8Array starting at the object section
  // (header + objects + exits, $FF-terminated). Our serializer emits
  // exactly that shape.
  const bytes = new Uint8Array(
    objectBytes.buffer, objectBytes.byteOffset, objectBytes.byteLength
  );
  const { state, stats } = decodeLevel(opts.rom, opts.symbols, bytes, {
    provenanceTargets: opts.provenanceTargets,
    prngReplayBySite: opts.prngReplayBySite,
    prngSeed: opts.prngSeed
  });
  return {
    state,
    stats,
    source: { objectFile: entry.objectFile }
  };
}
