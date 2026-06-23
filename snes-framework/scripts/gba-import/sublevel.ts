// Read one SMA3 (U) sublevel out of a GBA cart and transcode it into a shiny-egg
// `LevelData`. The GBA and SNES level-data formats share a lineage (SMA3 is a
// port of YI), so the conversion is small + byte-level. It mirrors Advynia's
// GBA→SNES `export_ylt` (AdvFile/YILevelTool.py), verified field-by-field:
//
//   header  : 15 bit-fields; only [7] (8→7 bits) and [8] (5→4 bits) shrink.
//   objects : BYTE-IDENTICAL encoding (same ids, X/Y nibble interleave, length
//             table) — copied verbatim. Only Advynia's custom obj 0x65 is dropped.
//   exits   : GBA entrance is 6 bytes, SNES 4 (truncate). Bandit minigame dest +
//             entrance-type 0xF6..0xFF → −0x18.
//   sprites : GBA 4 bytes (ID9+y7+x8+extID8), SNES 3 (drop extID). GBA camera
//             sprites 0x1BA..0x1C3 are dropped; command sprites ≥0x1C4 → −0xA.
//
// The strategy is "synthesize the SNES byte streams, then decode them with the
// real loader": we never re-implement the width sign-fold / bg1-tileset quirk —
// `decodeLevelStreams` does, on bytes that are already in SNES layout.
//
// Full pipeline + conversion table + parity findings: research/notes-gba-import.md

import type { LevelData, RomVersion } from '../types.ts';
import { decodeLevelStreams } from '../level.ts';
import { serializeHeader } from '../serialize-level.ts';
import {
  GBA_HEADER_BIT_WIDTHS,
  gbaAddrToOffset,
  resolveGbaTables,
  sublevelMainOffset,
  sublevelSpriteOffset,
  type GbaTables
} from './gba-cart.ts';

// ── GBA→SNES conversion constants (from Advynia AdvFile/YILevelTool.py) ──────
/** Bandit minigame sublevel ids differ by this offset: GBA 0xF6..0xFF ⇄ SNES
 *  0xDE..0xE7. Applied to an exit's dest id and entrance-type byte. */
const BANDIT_GBA_LO = 0xf6;
const BANDIT_GBA_HI = 0xff;
const BANDIT_OFFSET = 0x18;
/** GBA-only camera sprites — no SNES equivalent, dropped. */
const CAMERA_SPR_LO = 0x1ba;
const CAMERA_SPR_HI = 0x1c3;
/** GBA "command" sprites sit 0xA above their SNES ids. */
const COMMAND_SPR_GBA_LO = 0x1c4;
const COMMAND_SPR_OFFSET = 0xa;

export interface ImportWarning {
  kind: 'header-truncated' | 'camera-sprite-dropped' | 'sprite-extid-dropped' | 'custom-object-dropped';
  detail: string;
}

export interface GbaImportResult {
  level: LevelData;
  warnings: ImportWarning[];
  /** Counts for the import report / diagnostics. */
  stats: {
    objects: number;
    exits: number;
    sprites: number;
    spritesDropped: number;
    objectsDropped: number;
  };
}

export interface GbaToLevelDataOptions {
  cart: Buffer;
  /** GBA sublevel id to read. */
  sublevelId: number;
  /** SNES record id to stamp on the produced LevelData (the overwrite target). */
  targetRecordId: number;
  romVersion: RomVersion;
  /** SNES header bit widths (from the loaded level-map). */
  snesHeaderBitWidths: number[];
  /** SNES 256-byte standard-object property table (from the loaded level-map). */
  snesStandardObjectInfo: number[];
  /** Pre-resolved GBA pointer tables (resolve once, reuse across sublevels). */
  tables?: GbaTables;
}

/** Read `n`-bit fields MSB-first from `buf` — the inverse of serializeHeader,
 *  matching the loader's bit reader. */
function unpackBits(buf: Buffer, widths: number[]): number[] {
  const out: number[] = [];
  let bitPos = 0;
  for (const width of widths) {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = buf[(bitPos + i) >> 3] ?? 0;
      const bit = 7 - ((bitPos + i) & 7);
      v = (v << 1) | ((byte >> bit) & 1);
    }
    out.push(v);
    bitPos += width;
  }
  return out;
}

/** Walk the GBA object stream and re-emit it as a SNES object stream (no
 *  terminator; the caller appends 0xFF). The object encoding is shared, BUT the
 *  width/height length-property table diverges at a few high ids (e.g. GBA
 *  0xF7..0xFD are width-only where SNES expects both) — so a byte-for-byte copy
 *  would desync the SNES decoder. We instead reconcile each record's byte layout
 *  to the SNES table: keep the width/height byte where both agree, supply a
 *  default (0x00 → in-game length 1) where SNES needs a byte GBA didn't store.
 *  Advynia's 7-byte custom obj 0x65 is dropped (no SNES equivalent). */
function readObjects(
  cart: Buffer,
  start: number,
  gbaLengthProp: Buffer,
  snesObjectInfo: number[],
  warnings: ImportWarning[]
): { bytes: Buffer; next: number; dropped: number } {
  // A 7-byte custom obj 0x65 is flagged by bits 0x3C of its length-prop entry.
  const obj65Custom = ((gbaLengthProp[0x65] ?? 0) & 0x3c) !== 0;
  const out: number[] = [];
  let p = start;
  let dropped = 0;
  while (p < cart.length) {
    const num = cart[p];
    if (num === 0xff) {
      p += 1;
      break;
    }
    const locH = cart[p + 1];
    const locL = cart[p + 2];
    p += 3; // num + locH + locL
    if (num === 0x00) {
      out.push(num, locH, locL, cart[p++]); // extended object: 1-byte subtype, no w/h
      continue;
    }
    const gflag = (gbaLengthProp[num] ?? 0) & 3;
    const gWidth = gflag !== 1 ? cart[p++] : undefined;
    const gHeight = gflag !== 0 ? cart[p++] : undefined;
    if (num === 0x65 && obj65Custom) {
      p += 2; // 2-byte custom extID
      dropped++;
      warnings.push({ kind: 'custom-object-dropped', detail: `custom object 0x65 dropped` });
      continue;
    }
    // Re-emit per the SNES length-property table.
    const sflag = snesObjectInfo[num] & 3;
    out.push(num, locH, locL);
    if (sflag !== 1) out.push(gWidth ?? 0x00);
    if (sflag !== 0) out.push(gHeight ?? 0x00);
    if ((sflag !== 1) !== (gflag !== 1) || (sflag !== 0) !== (gflag !== 0)) {
      warnings.push({ kind: 'header-truncated', detail: `object 0x${num.toString(16)} width/height layout differs GBA↔SNES (reconciled)` });
    }
  }
  return { bytes: Buffer.from(out), next: p, dropped };
}

/** Walk the GBA exit stream (1 screen byte + 6-byte entrance per record) and
 *  emit the SNES exit stream (1 screen byte + 4-byte entrance), with the Bandit
 *  minigame id offset applied. Includes the trailing 0xFF terminator. */
function readExits(cart: Buffer, start: number): { bytes: Buffer; next: number; count: number } {
  const out: number[] = [];
  let p = start;
  let count = 0;
  while (p < cart.length) {
    const screen = cart[p];
    if (screen === 0xff) {
      p += 1;
      break;
    }
    p += 1;
    let dest = cart[p]; // entrance byte 0 = dest sublevel id
    const x = cart[p + 1];
    const y = cart[p + 2];
    let anim = cart[p + 3]; // entrance byte 3 = entrance-type
    p += 6; // skip the full 6-byte GBA entrance
    if (dest >= BANDIT_GBA_LO && dest <= BANDIT_GBA_HI) dest -= BANDIT_OFFSET;
    if (anim >= BANDIT_GBA_LO && anim <= BANDIT_GBA_HI) anim -= BANDIT_OFFSET;
    out.push(screen, dest, x, y, anim);
    count++;
  }
  out.push(0xff);
  return { bytes: Buffer.from(out), next: p, count };
}

/** Walk the GBA sprite stream (4-byte records, 0xFFFFFFFF terminator) and emit
 *  the SNES sprite stream (3-byte records, 0xFFFF terminator), dropping camera
 *  sprites + extID and remapping command sprites. */
function readSprites(
  cart: Buffer,
  start: number,
  warnings: ImportWarning[]
): { bytes: Buffer; count: number; dropped: number } {
  const out: number[] = [];
  let p = start;
  let count = 0;
  let dropped = 0;
  while (p + 4 <= cart.length) {
    const b0 = cart[p];
    const b1 = cart[p + 1];
    const b2 = cart[p + 2];
    const b3 = cart[p + 3];
    if (b0 === 0xff && b1 === 0xff && b2 === 0xff && b3 === 0xff) {
      p += 4;
      break;
    }
    p += 4;
    let id = b0 | ((b1 & 1) << 8);
    const y = (b1 >> 1) & 0x7f;
    const x = b2;
    const ext = b3;
    if (id >= CAMERA_SPR_LO && id <= CAMERA_SPR_HI) {
      dropped++;
      warnings.push({ kind: 'camera-sprite-dropped', detail: `GBA camera sprite 0x${id.toString(16)} dropped` });
      continue;
    }
    if (id >= COMMAND_SPR_GBA_LO) id -= COMMAND_SPR_OFFSET;
    if (ext !== 0) {
      warnings.push({ kind: 'sprite-extid-dropped', detail: `sprite 0x${id.toString(16)} extID 0x${ext.toString(16)} dropped` });
    }
    out.push(id & 0xff, ((y & 0x7f) << 1) | ((id >> 8) & 1), x & 0xff);
    count++;
  }
  out.push(0xff, 0xff);
  return { bytes: Buffer.from(out), count, dropped };
}

/** Repack the GBA-unpacked 15-field header into SNES-width bytes, warning (and
 *  clamping via the bit-packer) when a value won't fit the narrower SNES field. */
function repackHeader(gbaHeader: number[], snesWidths: number[], warnings: ImportWarning[]): Buffer {
  for (let i = 0; i < snesWidths.length; i++) {
    const max = (1 << snesWidths[i]) - 1;
    if (gbaHeader[i] > max) {
      warnings.push({
        kind: 'header-truncated',
        detail: `header field [${i}] value 0x${gbaHeader[i].toString(16)} exceeds SNES ${snesWidths[i]}-bit field (clamped)`
      });
    }
  }
  return serializeHeader(gbaHeader, snesWidths);
}

/**
 * Read GBA sublevel `sublevelId` and transcode it into a shiny-egg `LevelData`
 * stamped with `targetRecordId`. Throws if the sublevel has no main stream.
 */
export function gbaSublevelToLevelData(opts: GbaToLevelDataOptions): GbaImportResult {
  const { cart, sublevelId, targetRecordId, romVersion, snesHeaderBitWidths, snesStandardObjectInfo } = opts;
  const tables = opts.tables ?? resolveGbaTables(cart);
  const warnings: ImportWarning[] = [];

  const mainOff = sublevelMainOffset(cart, tables, sublevelId);
  if (mainOff === null) {
    throw new Error(`GBA sublevel 0x${sublevelId.toString(16)} has no main-data pointer.`);
  }

  // header (10 bytes) → 15 fields with GBA widths → repack with SNES widths.
  const gbaHeader = unpackBits(cart.subarray(mainOff, mainOff + 10), GBA_HEADER_BIT_WIDTHS);
  const snesHeader = repackHeader(gbaHeader, snesHeaderBitWidths, warnings);

  const obj = readObjects(cart, mainOff + 10, tables.objLengthProp, snesStandardObjectInfo, warnings);
  const ex = readExits(cart, obj.next);
  const objectBytes = Buffer.concat([snesHeader, obj.bytes, Buffer.from([0xff]), ex.bytes]);

  const spriteOff = sublevelSpriteOffset(cart, tables, sublevelId);
  const spr = spriteOff === null
    ? { bytes: Buffer.from([0xff, 0xff]), count: 0, dropped: 0 }
    : readSprites(cart, spriteOff, warnings);

  const level = decodeLevelStreams({
    recordId: targetRecordId,
    romVersion,
    headerBitWidths: snesHeaderBitWidths,
    standardObjectInfo: snesStandardObjectInfo,
    objectBytes,
    spriteBytes: spr.bytes
  });

  return {
    level,
    warnings,
    stats: {
      objects: level.objects.length,
      exits: ex.count,
      sprites: spr.count,
      spritesDropped: spr.dropped,
      objectsDropped: obj.dropped
    }
  };
}
