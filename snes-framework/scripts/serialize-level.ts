// LevelData → .bin section bytes. Inverse of `level.ts`'s loader.
//
// Section emitters: header (bit-packed), objects, exits, sprites. The
// object/sprite/exit streams round-trip the loader exactly when the
// LevelData is unmodified — see `serialize-level.test.ts` for the
// no-op oracle that runs against every playable level.
//
// `LevelObject.raw` is NOT consulted; serialization regenerates from
// `{num, exnum, x, y, w, h}` so edited objects come out correctly.

import type {
  LevelData,
  LevelObject,
  LevelSprite,
  ScreenExit
} from './types.ts';

/** Inverse of `decodeXY` in level.ts. Same nibble-interleaved encoding. */
function encodeXY(x: number, y: number): { locH: number; locL: number } {
  return {
    locH: ((y & 0xf0)) | ((x >> 4) & 0x0f),
    locL: ((y & 0x0f) << 4) | (x & 0x0f)
  };
}

/** Inverse of the signed width/height fold in `parseObjects`. Loader does:
 *    w = byte >= 0x80 ? -(0x100 - byte) + 1 : byte + 1
 *  so the byte is `(w - 1) & 0xff`. Same shape for h. */
function encodeSize(value: number): number {
  return (value - 1) & 0xff;
}

/** Bit-pack `header` back using `bitWidths`. MSB-first, matching the
 *  loader's `readBits`. Round up to a byte boundary. Returns the
 *  packed section. */
export function serializeHeader(header: number[], bitWidths: number[]): Buffer {
  if (header.length !== bitWidths.length) {
    throw new Error(
      `header length ${header.length} != bitWidths length ${bitWidths.length}`
    );
  }
  let totalBits = 0;
  for (const w of bitWidths) totalBits += w;
  const totalBytes = (totalBits + 7) >> 3;
  const out = Buffer.alloc(totalBytes);
  let bitPos = 0;
  for (let i = 0; i < header.length; i++) {
    const value = header[i]!;
    const width = bitWidths[i]!;
    for (let bi = 0; bi < width; bi++) {
      // MSB-first: take bit (width-1-bi) of value, write at bitPos.
      const bit = (value >> (width - 1 - bi)) & 1;
      if (bit) {
        const byteIdx = bitPos >> 3;
        const bitIdx = 7 - (bitPos & 7);
        out[byteIdx] = out[byteIdx]! | (1 << bitIdx);
      }
      bitPos++;
    }
  }
  return out;
}

/** Serialize the object stream including the `0xFF` terminator. The
 *  per-record layout is driven by `standardObjectInfo[num] & 3`:
 *    flag != 1 → width byte present
 *    flag != 0 → height byte present
 *  num=0 (extended) has 1-byte `exnum` after the coord pair, no w/h. */
export function serializeObjects(
  objects: LevelObject[],
  standardObjectInfo: number[]
): Buffer {
  const parts: number[] = [];
  for (const o of objects) {
    parts.push(o.num & 0xff);
    const { locH, locL } = encodeXY(o.x, o.y);
    parts.push(locH, locL);
    if (o.num === 0x00) {
      if (o.exnum === undefined) {
        throw new Error(`extended object at index ${o.index} missing exnum`);
      }
      parts.push(o.exnum & 0xff);
    } else {
      const flag = (standardObjectInfo[o.num] ?? 0) & 3;
      if (flag !== 1) parts.push(encodeSize(o.w));
      if (flag !== 0) parts.push(encodeSize(o.h));
    }
  }
  parts.push(0xff);
  return Buffer.from(parts);
}

/** Serialize the exit stream including the `0xFF` terminator. Variant
 *  encoding mirrors the loader: byte 1 in $DE..$E9 → minibattle, else
 *  warp. */
export function serializeExits(exits: ScreenExit[]): Buffer {
  const parts: number[] = [];
  for (const e of exits) {
    parts.push(e.screenIndex & 0xff);
    if (e.variant === 'minibattle') {
      parts.push(
        e.minibattleId & 0xff,
        e.returnX & 0xff,
        e.returnY & 0xff,
        e.returnLevelRecordId & 0xff
      );
    } else {
      parts.push(
        e.destLevelRecordId & 0xff,
        e.destX & 0xff,
        e.destY & 0xff,
        e.entranceType & 0xff
      );
    }
  }
  parts.push(0xff);
  return Buffer.from(parts);
}

/** Serialize the sprite stream including the `0xFFFF` terminator.
 *  num16 = (y << 9) | (num & 0x1FF), little-endian; then x byte. */
export function serializeSprites(sprites: LevelSprite[]): Buffer {
  const parts: number[] = [];
  for (const s of sprites) {
    const num16 = ((s.y & 0x7f) << 9) | (s.num & 0x1ff);
    parts.push(num16 & 0xff, (num16 >> 8) & 0xff, s.x & 0xff);
  }
  parts.push(0xff, 0xff);
  return Buffer.from(parts);
}

export interface SerializedLevel {
  /** Header + objects + exits, concatenated. Replaces the byte range
   *  `[objectOffset, objectOffset + headerBytes + objectBytes + exitBytes)`
   *  in the level's object .bin file. */
  objectBytes: Buffer;
  /** Sprite stream including terminator. Replaces the byte range
   *  `[spriteOffset, spriteOffset + spriteBytes)` in the level's
   *  sprite .bin file. */
  spriteBytes: Buffer;
}

export interface SerializeLevelOptions {
  level: LevelData;
  headerBitWidths: number[];
  standardObjectInfo: number[];
}

export function serializeLevel(opts: SerializeLevelOptions): SerializedLevel {
  const { level, headerBitWidths, standardObjectInfo } = opts;
  if (level.empty || level.special) {
    return { objectBytes: Buffer.alloc(0), spriteBytes: Buffer.alloc(0) };
  }
  const header = serializeHeader(level.header, headerBitWidths);
  const objects = serializeObjects(level.objects, standardObjectInfo);
  const exits = serializeExits(level.exits);
  const sprites = serializeSprites(level.sprites);
  return {
    objectBytes: Buffer.concat([header, objects, exits]),
    spriteBytes: sprites
  };
}
