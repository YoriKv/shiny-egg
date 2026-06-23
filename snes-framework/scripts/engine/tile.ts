// SNES tile decoders. Convert packed bitplane tile data (as it lives in VRAM
// after `load_level_gfx` decompression) into per-pixel palette indices.
//
// # SNES PPU tile formats (standard, not YI-specific)
//
// A tile is always 8×8 pixels. Bytes-per-tile depends on bit depth:
//
//   2bpp:  16 bytes
//   4bpp:  32 bytes
//   8bpp:  64 bytes  — not used by YI's BG layers
//
// Which layer is which depth is set by the PPU BG MODE, not fixed per layer —
// derive it from the scene's BGMODE (see scene-regs.ts `bgLayerBpp`), never
// hardcode. In BG Mode 1 (the 218 standard levels) BG1/BG2 are 4bpp and BG3 is
// 2bpp; in BG Mode 0 (level mode $0A / level $6B) ALL backgrounds are 2bpp —
// so BG1 is 2bpp there, and decoding it as 4bpp scrambles every tile.
//
// Within a tile, bytes are organised as **interleaved bitplane pairs per
// pixel row**:
//
//   4bpp tile (32 bytes):
//     byte 0  = bitplane 0, row 0    (msb = col 0, lsb = col 7)
//     byte 1  = bitplane 1, row 0
//     byte 2  = bitplane 0, row 1
//     byte 3  = bitplane 1, row 1
//     ...
//     byte 14 = bitplane 0, row 7
//     byte 15 = bitplane 1, row 7
//     byte 16 = bitplane 2, row 0
//     byte 17 = bitplane 3, row 0
//     ...
//     byte 30 = bitplane 2, row 7
//     byte 31 = bitplane 3, row 7
//
//   2bpp tile (16 bytes):
//     byte 0  = bitplane 0, row 0
//     byte 1  = bitplane 1, row 0
//     ...
//     byte 14 = bitplane 0, row 6  ← wait, 2bpp doesn't have rows 4-7 in
//     byte 15 = bitplane 1, row 7    half-format. Standard is full 8 rows.
//
// (The 2bpp layout is actually the first 16 bytes of a 4bpp tile — exactly
// bp0+bp1 interleaved per row, 8 rows.)
//
// A pixel's palette index is reassembled per column by taking one bit from
// each bitplane:
//
//   bit = 0x80 >> col
//   idx = ((bp0 & bit) ? 1 : 0)
//       | ((bp1 & bit) ? 2 : 0)
//       | ((bp2 & bit) ? 4 : 0)        // 4bpp only
//       | ((bp3 & bit) ? 8 : 0)        // 4bpp only
//
// Tile flipping comes from Map16's per-sub-tile word
// (`vhopppccCCCCCCCC` — V=v-flip, H=h-flip, p=priority, ppp=palette row,
// C=tile-index). The decoder accepts flip flags directly; the caller pulls
// them from the Map16 sub-tile word.

/** Size in bytes of one 8×8 tile at each depth. */
export const TILE_BYTES_4BPP = 32;
export const TILE_BYTES_2BPP = 16;

/** Pixels per tile (8×8 always). */
export const TILE_PIXELS = 64;

/**
 * Decode a single 4bpp 8×8 tile into 64 palette indices (0..15) written to
 * `out[outOff..outOff+63]` in row-major order (row 0 col 0 .. row 0 col 7,
 * row 1 col 0 .. etc).
 *
 * `hflip` and `vflip` reverse the column / row order of the output (i.e.,
 * the resulting pixels look horizontally / vertically mirrored). The flag
 * convention matches the Map16 sub-tile word bits.
 *
 * Throws if `vram` doesn't have 32 bytes available at `vramOff` or `out`
 * doesn't have 64 slots at `outOff`.
 */
export function decode4bppTile(
  vram: Uint8Array,
  vramOff: number,
  hflip: boolean,
  vflip: boolean,
  out: Uint8Array,
  outOff: number
): void {
  if (vramOff + TILE_BYTES_4BPP > vram.length) {
    throw new RangeError(
      `decode4bppTile: vram out of range (off=${vramOff}, need 32, have ${vram.length})`
    );
  }
  if (outOff + TILE_PIXELS > out.length) {
    throw new RangeError(
      `decode4bppTile: out out of range (off=${outOff}, need 64, have ${out.length})`
    );
  }

  for (let row = 0; row < 8; row++) {
    const srcRow = vflip ? 7 - row : row;
    const bp0 = vram[vramOff + srcRow * 2 + 0];
    const bp1 = vram[vramOff + srcRow * 2 + 1];
    const bp2 = vram[vramOff + 16 + srcRow * 2 + 0];
    const bp3 = vram[vramOff + 16 + srcRow * 2 + 1];
    const rowBase = outOff + row * 8;
    for (let col = 0; col < 8; col++) {
      // Without H-flip, col 0 is MSB (bit 7). With H-flip, col 0 is LSB.
      const bit = hflip ? 1 << col : 0x80 >> col;
      const idx =
        ((bp0 & bit) ? 1 : 0) |
        ((bp1 & bit) ? 2 : 0) |
        ((bp2 & bit) ? 4 : 0) |
        ((bp3 & bit) ? 8 : 0);
      out[rowBase + col] = idx;
    }
  }
}

/**
 * Decode a single 2bpp 8×8 tile into 64 palette indices (0..3) written to
 * `out[outOff..outOff+63]` in row-major order.
 *
 * Same flip convention as `decode4bppTile`.
 *
 * Throws on out-of-range buffers.
 */
export function decode2bppTile(
  vram: Uint8Array,
  vramOff: number,
  hflip: boolean,
  vflip: boolean,
  out: Uint8Array,
  outOff: number
): void {
  if (vramOff + TILE_BYTES_2BPP > vram.length) {
    throw new RangeError(
      `decode2bppTile: vram out of range (off=${vramOff}, need 16, have ${vram.length})`
    );
  }
  if (outOff + TILE_PIXELS > out.length) {
    throw new RangeError(
      `decode2bppTile: out out of range (off=${outOff}, need 64, have ${out.length})`
    );
  }

  for (let row = 0; row < 8; row++) {
    const srcRow = vflip ? 7 - row : row;
    const bp0 = vram[vramOff + srcRow * 2 + 0];
    const bp1 = vram[vramOff + srcRow * 2 + 1];
    const rowBase = outOff + row * 8;
    for (let col = 0; col < 8; col++) {
      const bit = hflip ? 1 << col : 0x80 >> col;
      const idx = ((bp0 & bit) ? 1 : 0) | ((bp1 & bit) ? 2 : 0);
      out[rowBase + col] = idx;
    }
  }
}

/**
 * Encode 64 palette indices (0..15, row-major at `idx[idxOff..idxOff+63]`) into
 * a single 4bpp 8×8 SNES tile (32 bytes at `out[outOff..outOff+31]`). The exact
 * inverse of `decode4bppTile` with no flip — `decode4bppTile(encode4bppTile(x)) == x`.
 */
export function encode4bppTile(
  idx: Uint8Array,
  idxOff: number,
  out: Uint8Array,
  outOff: number
): void {
  for (let row = 0; row < 8; row++) {
    let bp0 = 0, bp1 = 0, bp2 = 0, bp3 = 0;
    const rowBase = idxOff + row * 8;
    for (let col = 0; col < 8; col++) {
      const v = idx[rowBase + col]!;
      const bit = 0x80 >> col;
      if (v & 1) bp0 |= bit;
      if (v & 2) bp1 |= bit;
      if (v & 4) bp2 |= bit;
      if (v & 8) bp3 |= bit;
    }
    out[outOff + row * 2 + 0] = bp0;
    out[outOff + row * 2 + 1] = bp1;
    out[outOff + 16 + row * 2 + 0] = bp2;
    out[outOff + 16 + row * 2 + 1] = bp3;
  }
}

/** Encode 64 palette indices (0..3) into a 2bpp 8×8 SNES tile (16 bytes). The
 *  inverse of `decode2bppTile` with no flip. */
export function encode2bppTile(
  idx: Uint8Array,
  idxOff: number,
  out: Uint8Array,
  outOff: number
): void {
  for (let row = 0; row < 8; row++) {
    let bp0 = 0, bp1 = 0;
    const rowBase = idxOff + row * 8;
    for (let col = 0; col < 8; col++) {
      const v = idx[rowBase + col]!;
      const bit = 0x80 >> col;
      if (v & 1) bp0 |= bit;
      if (v & 2) bp1 |= bit;
    }
    out[outOff + row * 2 + 0] = bp0;
    out[outOff + row * 2 + 1] = bp1;
  }
}
