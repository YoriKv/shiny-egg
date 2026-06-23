// GBA cart reader for Super Mario Advance 3 (the GBA port of Yoshi's Island).
// Low-level identity + pointer plumbing only; the level transcode lives in
// sublevel.ts. This is the GBA-side analog of import/foreign-cart.ts (which reads
// a foreign SNES cart): the two games share a level-data lineage, so once the
// streams are sliced + format-converted they decode through the SAME
// `decodeLevelStreams` loader (see sublevel.ts).
//
// GBA ROM pointers are 4-byte little-endian ABSOLUTE addresses in the
// 0x08000000 cart-mapped space; file offset = addr - 0x08000000. Table locations
// are themselves stored behind a pointer in code (so a moved/edited cart still
// resolves), with the vanilla SMA3 (U) address as the fallback. Addresses +
// CRC32 are from the Advynia editor's SMA3 (U) pointer map (AdvGame/SMA3).

import { crc32 } from 'node:zlib';

/** GBA cart-mapped address space base. file offset = addr - GBA_BASE. */
export const GBA_BASE = 0x08000000;

/** Vanilla SMA3 (U) CRC32 + game code — the only version whose pointers below
 *  are valid. (J)=A3AJ and (E)=A3AP have different layouts and are rejected. */
export const SMA3_USA_CRC32 = 0x40a48276;
export const SMA3_USA_GAME_CODE = 'A3AE';

/** Pointer-to-pointer-table locations (in code) + their vanilla destinations,
 *  for SMA3 (U). We follow the in-code pointer when it lands in-cart, else use
 *  the vanilla address — so an Advynia-relocated cart still resolves. */
const TABLE_REFS = {
  /** sublevel main-data pointer table (header + objects + exits per sublevel). */
  sublevelMain: { ref: 0x0802c9d8, vanilla: 0x081ef1a4 },
  /** sublevel sprite-data pointer table. */
  sublevelSprite: { ref: 0x0802c9e0, vanilla: 0x081ef57c },
  /** object length-property table (low 2 bits = width/height byte presence;
   *  bits 0x3C on entry 0x65 flag Advynia's 7-byte custom object). */
  objLengthProp: { ref: 0x0801735c, vanilla: 0x081c19d8 }
} as const;

/** GBA header bit-field widths (15 fields, MSB-first). Differs from SNES only at
 *  field [7] (8 vs 7) and [8] (5 vs 4) — see sublevel.ts for the repack. */
export const GBA_HEADER_BIT_WIDTHS = [5, 4, 5, 5, 6, 6, 6, 8, 5, 5, 6, 5, 5, 4, 2];

/** Highest GBA sublevel id holding ordinary level data (0xF6..0xFF are the
 *  Bandit minigame rooms, remapped on the SNES side — see sublevel.ts). */
export const GBA_MAX_SUBLEVEL_ID = 0xf5;

export interface GbaCartId {
  ok: boolean;
  gameCode: string;
  title: string;
  crc32: number;
  /** Present when ok=false: why the cart was rejected. */
  reason?: string;
}

/** Validate that `cart` is a vanilla SMA3 (U) image (the version our pointer map
 *  targets). Checks the GBA header game code + the whole-ROM CRC32. */
export function identifyGbaCart(cart: Buffer): GbaCartId {
  const gameCode = cart.length >= 0xb0 ? cart.toString('ascii', 0xac, 0xb0) : '';
  const title = cart.length >= 0xac ? cart.toString('ascii', 0xa0, 0xac).replace(/\0+$/, '') : '';
  const sum = crc32(cart) >>> 0;
  if (gameCode !== SMA3_USA_GAME_CODE) {
    const region = gameCode === 'A3AJ' ? ' (looks like the (J) ROM)'
      : gameCode === 'A3AP' ? ' (looks like the (E) ROM)' : '';
    return { ok: false, gameCode, title, crc32: sum,
      reason: `Not SMA3 (U): game code "${gameCode}"${region}. Only the USA ROM is supported.` };
  }
  if (sum !== SMA3_USA_CRC32) {
    return { ok: false, gameCode, title, crc32: sum,
      reason: `SMA3 (U) game code but CRC32 0x${sum.toString(16)} != expected 0x${SMA3_USA_CRC32.toString(16)} (modified ROM).` };
  }
  return { ok: true, gameCode, title, crc32: sum };
}

/** Convert a GBA cart-mapped address to a file offset, validating range. */
export function gbaAddrToOffset(cart: Buffer, addr: number): number {
  const off = addr - GBA_BASE;
  if (off < 0 || off >= cart.length) {
    throw new Error(`GBA address 0x${addr.toString(16)} is out of cart range (size 0x${cart.length.toString(16)}).`);
  }
  return off;
}

/** Read a 4-byte little-endian GBA pointer at a file offset. */
export function readGbaPointer(cart: Buffer, fileOffset: number): number {
  return cart.readUInt32LE(fileOffset);
}

/** Resolve a pointer table's file offset: follow the in-code pointer when it
 *  lands in-cart, else fall back to the vanilla destination. */
function resolveTableOffset(cart: Buffer, ref: number, vanilla: number): number {
  const followed = readGbaPointer(cart, gbaAddrToOffset(cart, ref));
  const addr = followed >= GBA_BASE && followed < GBA_BASE + cart.length ? followed : vanilla;
  return gbaAddrToOffset(cart, addr);
}

export interface GbaTables {
  /** file offset of the sublevel main-data pointer table. */
  mainPtrs: number;
  /** file offset of the sublevel sprite-data pointer table. */
  spritePtrs: number;
  /** 256-entry object length-property table (raw bytes; low 2 bits used). */
  objLengthProp: Buffer;
}

/** Resolve all per-sublevel pointer tables for a SMA3 (U) cart, once. */
export function resolveGbaTables(cart: Buffer): GbaTables {
  const objOff = resolveTableOffset(cart, TABLE_REFS.objLengthProp.ref, TABLE_REFS.objLengthProp.vanilla);
  return {
    mainPtrs: resolveTableOffset(cart, TABLE_REFS.sublevelMain.ref, TABLE_REFS.sublevelMain.vanilla),
    spritePtrs: resolveTableOffset(cart, TABLE_REFS.sublevelSprite.ref, TABLE_REFS.sublevelSprite.vanilla),
    objLengthProp: cart.subarray(objOff, objOff + 0x100)
  };
}

/** File offset of sublevel `id`'s main / sprite stream, via the pointer tables.
 *  Returns null when the pointer is zero/out-of-range (no data for that side). */
export function sublevelMainOffset(cart: Buffer, tables: GbaTables, id: number): number | null {
  return streamOffset(cart, tables.mainPtrs, id);
}
export function sublevelSpriteOffset(cart: Buffer, tables: GbaTables, id: number): number | null {
  return streamOffset(cart, tables.spritePtrs, id);
}

function streamOffset(cart: Buffer, tableOffset: number, id: number): number | null {
  const entry = tableOffset + id * 4;
  if (entry + 4 > cart.length) return null;
  const ptr = readGbaPointer(cart, entry);
  if (ptr < GBA_BASE || ptr >= GBA_BASE + cart.length) return null;
  return ptr - GBA_BASE;
}
