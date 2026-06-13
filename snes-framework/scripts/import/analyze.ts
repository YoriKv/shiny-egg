// Analyse a foreign (modified) cart against the base V1.0 cart and produce the
// import report + apply payload. Pure framework-side: takes two cart buffers,
// returns a serializable RomAnalysis (the renderer's report) plus the decoded
// per-record items the app layer applies through saveLevelResource. No project /
// overlay knowledge here (that's src/main/rom-import.ts). See plan-rom-import.md
// §6-7.

import * as crypto from 'node:crypto';
import { u24le } from '../engine/rom-read.ts';
import { decodeLevelStreams } from '../level.ts';
import { serializeLevel } from '../serialize-level.ts';
import type {
  ForeignLevelDiff,
  LevelData,
  LevelImportability,
  LevelStreamCounts,
  RomAnalysis
} from '../types.ts';
import {
  pointsAtValidObjStream,
  pointsAtValidSprStream,
  resolveAnchors,
  vanillaAnchors
} from './anchors.ts';
import { readForeignStreams, type ForeignRecordStreams, type ForeignStreams } from './foreign-cart.ts';
import { diffInventory } from './inventory.ts';
import type { SymbolMap } from '../engine/symbol-map.ts';

/** Engine-driven records pre-blocked from import. EMPTY — record 0x38 (the
 *  gm38 intro-cutscene level) decodes cleanly and now classifies like any
 *  other level (its base header carries a garbage PADDING bit the round-trip
 *  normalizes, so an in-place-edited hack copy may classify raw-only — that's
 *  the analyzer doing its job, not a block). */
const SPECIAL_RECORDS = new Set<number>([]);

/** A changed record's decoded foreign level + raw bytes, for the apply step. */
export interface ForeignImportItem {
  recordId: number;
  /** Decoded foreign level (for saveLevelResource on a 'full' import). */
  level: LevelData;
  /** Raw foreign stream bytes (for the 'raw-only' overlay-copy fallback). */
  objBytes: Buffer | null;
  sprBytes: Buffer | null;
  importability: LevelImportability;
}

export interface AnalyzeResult {
  analysis: RomAnalysis;
  /** One item per CHANGED record that has importable foreign data (aligned with
   *  the 'full'/'raw-only' entries in analysis.levels). */
  items: ForeignImportItem[];
}

function buffersEqual(a: Buffer | null, b: Buffer | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.length === b.length && a.equals(b);
}

function countsFor(level: LevelData, streams: ForeignRecordStreams): LevelStreamCounts {
  return {
    objects: level.objects.length,
    sprites: level.sprites.length,
    exits: level.exits.length,
    objBytes: streams.objBytes?.length ?? 0,
    sprBytes: streams.sprBytes?.length ?? 0
  };
}

function decodeSide(
  recordId: number,
  streams: ForeignRecordStreams,
  src: ForeignStreams
): LevelData | null {
  if (!streams.objBytes && !streams.sprBytes) return null;
  return decodeLevelStreams({
    recordId,
    romVersion: 'YI_U1',
    headerBitWidths: src.headerBitWidths,
    standardObjectInfo: src.standardObjectInfo,
    objectBytes: streams.objBytes,
    spriteBytes: streams.sprBytes
  });
}

/** Compare object streams while IGNORING the level header's unused padding bits.
 *  The 15-field header is 75 bits packed MSB-first into `ceil(75/8)=10` bytes, so
 *  the low 5 bits of the last header byte are never read by the engine. GoldenEgg
 *  leaves garbage there; our serializer zeroes it. That difference is meaningless
 *  (the level is identical), so it must not demote a level to raw-only. */
function objBytesEqualIgnoringHeaderPad(a: Buffer, b: Buffer, widths: number[]): boolean {
  if (a.length !== b.length) return false;
  const totalBits = widths.reduce((x, y) => x + y, 0);
  const headerBytes = Math.ceil(totalBits / 8);
  const usedInLast = totalBits - (headerBytes - 1) * 8; // 1..8 used bits in the last header byte
  const padByte = headerBytes - 1;
  const mask = usedInLast >= 8 ? 0xff : (0xff << (8 - usedInLast)) & 0xff;
  for (let i = 0; i < a.length; i++) {
    if (i === padByte) {
      if ((a[i] & mask) !== (b[i] & mask)) return false;
    } else if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** True when decode→serialize reproduces the foreign bytes (so the level is fully
 *  importable as editable data, not just raw bytes), ignoring the header's unused
 *  padding bits. Only compares the sides that exist in the foreign stream. */
function roundTrips(level: LevelData, streams: ForeignRecordStreams, src: ForeignStreams): boolean {
  // No header (no object stream) → not a serializable level. Caller classifies
  // these as blocked; guard so a stray call can't throw in serializeHeader.
  if (level.header.length === 0) return false;
  const s = serializeLevel({
    level,
    headerBitWidths: src.headerBitWidths,
    standardObjectInfo: src.standardObjectInfo
  });
  const objOk =
    streams.objBytes === null ||
    objBytesEqualIgnoringHeaderPad(streams.objBytes, s.objectBytes, src.headerBitWidths);
  const sprOk = streams.sprBytes === null || buffersEqual(streams.sprBytes, s.spriteBytes);
  return objOk && sprOk;
}

export interface AnalyzeOptions {
  /** Full base-build symbol map (main + superfx merged) — refines the diff
   *  inventory's leftover attribution. Optional; coarse bands without it. */
  symbols?: SymbolMap;
}

/**
 * Diff a foreign cart against the base V1.0 cart. Returns the report (anchors +
 * per-changed-record diff + the detect-only diff inventory) and the apply
 * payload. When the level-data pointer table can't be re-anchored, returns an
 * empty level set with `levelPtrsResolved: false` so the UI can explain why.
 */
export function analyzeForeignRom(
  foreignCart: Buffer,
  baseCart: Buffer,
  opts: AnalyzeOptions = {}
): AnalyzeResult {
  const foreignMd5 = crypto.createHash('md5').update(foreignCart).digest('hex');
  const { anchors, resolved, baseDerived } = resolveAnchors(foreignCart, baseCart);

  if (!resolved) {
    return {
      analysis: { foreignMd5, baseDerived, anchors, levelPtrsResolved: false, levels: [] },
      items: []
    };
  }

  const vanilla = vanillaAnchors();
  const foreign = readForeignStreams(foreignCart, resolved);
  const base = readForeignStreams(baseCart, vanilla);

  const levels: ForeignLevelDiff[] = [];
  const items: ForeignImportItem[] = [];

  const recordIds = [...new Set([...foreign.records.keys(), ...base.records.keys()])].sort(
    (a, b) => a - b
  );

  for (const recordId of recordIds) {
    const f = foreign.records.get(recordId) ?? { objBytes: null, sprBytes: null };
    const b = base.records.get(recordId) ?? { objBytes: null, sprBytes: null };
    const objChanged = !buffersEqual(f.objBytes, b.objBytes);
    const sprChanged = !buffersEqual(f.sprBytes, b.sprBytes);
    if (!objChanged && !sprChanged) continue;

    const baseLevel = decodeSide(recordId, b, base);
    const baseCounts = baseLevel ? countsFor(baseLevel, b) : null;

    // A record is importable only if its foreign streams are WELL-FORMED: the
    // object stream (header + objects + exits) and the sprite stream must BOTH
    // terminate cleanly within sane bounds. GoldenEgg's free-space allocator
    // reuses the data regions of record slots its world no longer uses, so an
    // ABANDONED slot's stale pointer reads clobbered bytes that over-read past any
    // real terminator (impossible object / sprite / exit counts). Those fail
    // well-formedness and are blocked, not decoded as a fake "full" level.
    //
    // We deliberately do NOT treat "pointer unchanged from vanilla" as abandoned:
    // GoldenEgg can re-allocate an edited level back into its own just-freed
    // region, keeping the pointer, so a same-pointer changed stream is frequently
    // a genuine in-place edit.
    const fObj = u24le(foreignCart, resolved.levelPtrsPc + recordId * 6);
    const fSpr = u24le(foreignCart, resolved.levelPtrsPc + recordId * 6 + 3);
    const bObj = u24le(baseCart, vanilla.levelPtrsPc + recordId * 6);
    const bSpr = u24le(baseCart, vanilla.levelPtrsPc + recordId * 6 + 3);
    // Repointed streams = the hack relocated this record's data (GoldenEgg saves
    // into its free space). A same-pointer changed stream is an in-place edit.
    const relocated = fObj !== bObj || fSpr !== bSpr;
    const foreignEmpty = !f.objBytes && !f.sprBytes;
    const wellFormed =
      pointsAtValidObjStream(foreignCart, fObj, foreign.standardObjectInfo) &&
      pointsAtValidSprStream(foreignCart, fSpr);

    let importability: LevelImportability;
    let blockedReason: string | undefined;
    let foreignLevel: LevelData | null = null;
    if (SPECIAL_RECORDS.has(recordId)) {
      importability = 'blocked';
      blockedReason = 'Engine-driven intro-cutscene level (record 0x38) — cannot be imported.';
    } else if (foreignEmpty) {
      importability = 'blocked';
      blockedReason = 'Level emptied/removed in source — not imported.';
    } else if (!wellFormed) {
      importability = 'blocked';
      blockedReason =
        'Source level data is clobbered or out of range — the hack abandoned this ' +
        'record slot and reused its space; not a real level to import.';
    } else {
      foreignLevel = decodeSide(recordId, f, foreign);
      importability = foreignLevel && roundTrips(foreignLevel, f, foreign) ? 'full' : 'raw-only';
    }
    const foreignCounts = foreignLevel ? countsFor(foreignLevel, f) : null;

    levels.push({
      recordId,
      objChanged,
      sprChanged,
      importability,
      ...(blockedReason ? { blockedReason } : {}),
      relocated,
      base: baseCounts,
      foreign: foreignCounts
    });

    if (foreignLevel && importability !== 'blocked') {
      items.push({
        recordId,
        level: foreignLevel,
        objBytes: f.objBytes,
        sprBytes: f.sprBytes,
        importability
      });
    }
  }

  // Detect-only diff inventory: classify EVERY differing byte, with the level
  // stream spans (both sides) claimed first so they read as "level data".
  const levelExtents: Array<[number, number]> = [];
  for (const src of [foreign, base]) {
    for (const rec of src.records.values()) {
      if (rec.objBytes && rec.objStartPc !== undefined) {
        levelExtents.push([rec.objStartPc, rec.objStartPc + rec.objBytes.length]);
      }
      if (rec.sprBytes && rec.sprStartPc !== undefined) {
        levelExtents.push([rec.sprStartPc, rec.sprStartPc + rec.sprBytes.length]);
      }
    }
  }
  const inventory = diffInventory(foreignCart, baseCart, {
    levelExtents,
    ...(opts.symbols ? { symbols: opts.symbols } : {})
  });

  return {
    analysis: { foreignMd5, baseDerived, anchors, levelPtrsResolved: true, levels, inventory },
    items
  };
}
