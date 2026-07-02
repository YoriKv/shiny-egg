// LZ16 (LC_LZ16, Lunar Compress FORMAT=15) — bit-stream + predictor codec
// used by YI's SuperFX for compressed graphics flagged with bit 15 of the
// vramDest field. ~187 of YI's compressed graphics blobs use this format
// (animated and sprite tilesets).
//
// # References (in order of authority):
//
// 1. **`Lunar Compress.dll` LunarDecompress FORMAT=15** — reference by FuSoYa
//    (lc200/decomp.exe). The inner decoder lives at `FUN_00408cb4` in the
//    decompiled DLL; this port is a structural transcription of that
//    function's algorithm (independently re-implemented in TS — we read
//    the algorithm from decompiled output, then wrote our own version).
// 2. **YI SuperFX `lz16_decompress`** at `$0A:8000`
//    (`yi/SuperFX/Banks/Bank0A.asm:85`, docs/mchip.md §3.2 + §5 + §6.3) —
//    cart-side implementation, same format. Used as cross-check.
//
// The earlier `scripts/gfx/decompress.ts:lz16` was a GoldenEgg-port that
// diverges from `decomp.exe` on the first byte; do not consult it as a
// reference.
//
// # Pixel pipeline
//
// The decoder emits `rowCount` × 8 pixel-rows, each 128 pixels wide
// (4bpp, so values 0..15). Right-to-left cursor in a 128-byte rolling
// buffer; that buffer is also the eventual row contents (no separate
// "predictor history" + "output" duality — they're the same memory).
//
// After all rows decoded, the row-major pixel buffer is transposed into
// standard SNES 4bpp tile layout:
//   - 16 8×8 tiles per tile-row, rowCount tile-rows, total 16*rowCount tiles
//   - Each tile: 32 bytes — bytes 0..15 hold rows 0..7 of {bp0,bp1}
//     interleaved (bp0 byte, bp1 byte, ...); bytes 16..31 hold {bp2,bp3}
//     interleaved.
//
// # Bit stream
//
// Header: 4 source bytes pack 8 nibbles. The first 7 nibbles seed
// `pred[0..6]` (4-bit color predictors). The 8th nibble (high nibble of
// the 4th byte) becomes the initial 4 bits of the bit stream (LSB-first).
//
// `pred[7]` is dynamic: refreshed by reading 4 more bits whenever the
// per-run "predictor index" decodes to 7.
//
// # Per-row structure
//
// For each of `rowCount * 8` pixel-rows:
//   1. Read 1 bit `rowMode` (0 ⇒ uniform mode-1 row, 1 ⇒ varied row).
//   2. If row > 0, copy previous row into this row's slot (current row
//      starts as a duplicate; subsequent ops are differential edits).
//   3. Cursor := 127. Loop while cursor stays in [0, 127]:
//      a. Read a unary `count` (1..128, encoding below).
//      b. Read mode (forced 1 if rowMode=0; else `readBits(2)`).
//      c. Apply one of 4 mode ops.
//
// ## Unary count encoding
//
// Reads bit pairs `(A, B)`:
//   - `A=1, B=v`  → bit `v` at the current position, then advance.
//   - `A=0`       → terminator; OR an implicit 1 at the current bit pos.
//
// Examples:
//   `0`         → count = 1
//   `1,0,0`     → count = 2  (no bit set + implicit 1 at pos 1)
//   `1,1,0`     → count = 3
//   `1,0,1,0,0` → count = 4
//   `1,1,1,1,0` → count = 7  (bits 0,1,2 set + implicit 1 at pos 3)
//
// ## Mode ops (cursor C, buffer B, count N)
//
//   mode 0: Skip-runs   — walk cursor left past N runs of equal pixels.
//                         No buffer writes.
//   mode 1: Predictor   — read 3 bits → predIdx ∈ {0..7}; if predIdx==7,
//                         read 4 more bits to refresh pred[7]. Fill
//                         B[C-N+1..C] with pred[predIdx]. C := C - N.
//   mode 2: Bridge      — walk left past the run starting at B[C] to find
//                         the first different pixel; save it; fill
//                         B[C-N+1..C] with the original ref color;
//                         C := C - N; write the saved pixel at B[C].
//   mode 3: Jump-fwd    — walk left past the equal-run; save the boundary
//                         pixel (or 0 if we underflowed); jump C := C + N
//                         (forward); write the saved pixel at B[C].
//
// "Walk left past equal run" means: ref := B[C]; C--; while B[C] == ref
// continue C--. The first iteration always decrements past `ref`.

import type { DecompResult } from './types.ts';

const ROW_PIXELS = 128;
const TILES_PER_ROW = 16;
const BYTES_PER_TILE = 32;

/**
 * Decompress an LZ16 stream from `src[srcOff..]` into `dest[destOff..]`.
 *
 * `rowCount` is the number of 8×8 tile-rows in the output (matches
 * Lunar Compress's `Format2` parameter). Output size = `rowCount * 512`
 * bytes (16 tiles × 32 bytes/tile per tile-row).
 *
 * Throws on malformed input (e.g. impossible counts at the cursor).
 */
export function lz16(
  src: Uint8Array,
  srcOff: number,
  dest: Uint8Array,
  destOff: number,
  rowCount: number
): DecompResult {
  if (rowCount === 0) return { srcEnd: srcOff, destEnd: destOff };

  const totalPixelRows = rowCount * 8;
  const pixels = new Uint8Array(ROW_PIXELS * totalPixelRows);

  // --- bit stream state (LSB-first within each byte) ---
  let s = srcOff;
  let bitBuf = 0;
  let bitCount = 0;

  const readBit = (): number => {
    if (bitCount === 0) {
      bitBuf = src[s++];
      bitCount = 8;
    }
    const bit = bitBuf & 1;
    bitBuf >>>= 1;
    bitCount--;
    return bit;
  };

  // MSB-first multi-bit reader (matches FUN_00408c8c).
  const readBitsMsb = (n: number): number => {
    let r = 0;
    for (let i = 0; i < n; i++) r = (r << 1) | readBit();
    return r;
  };

  // --- header: 7 predictor nibbles + 4 priming bits ---
  if (srcOff + 4 > src.length) {
    throw new Error('lz16: source too short for 4-byte header');
  }
  const pred = new Uint8Array(8); // pred[7] is refreshed dynamically
  let header =
    (src[s] | (src[s + 1] << 8) | (src[s + 2] << 16) | (src[s + 3] << 24)) >>>
    0;
  s += 4;
  for (let i = 0; i < 7; i++) {
    pred[i] = header & 0xf;
    header = header >>> 4;
  }
  bitBuf = header & 0xf;
  bitCount = 4;

  // --- per-row loop ---
  let aborted = false;

  for (let row = 0; row < totalPixelRows; row++) {
    const base = row * ROW_PIXELS;
    if (row > 0) {
      // Duplicate previous row; subsequent ops differentially edit it.
      pixels.copyWithin(base, base - ROW_PIXELS, base);
    }
    const rowMode = readBit();
    let cursor = ROW_PIXELS - 1; // 127

    while (cursor >= 0 && cursor < ROW_PIXELS) {
      // ---- unary count read ----
      let count = 0;
      let bitMask = 1;
      let countTerminated = false;
      while (true) {
        // Cursor underflow detected at the TOP of this loop → row done.
        if (cursor < 0 || cursor >= ROW_PIXELS) break;
        const a = readBit();
        if (a === 0) {
          countTerminated = true;
          break;
        }
        const b = readBit();
        if (b !== 0) count |= bitMask;
        bitMask <<= 1;
        if (bitMask > ROW_PIXELS) {
          aborted = true;
          break;
        }
      }
      if (aborted) break;
      if (!countTerminated) break; // cursor exited via the top check
      count |= bitMask;

      // ---- mode dispatch ----
      const mode = rowMode === 0 ? 1 : readBitsMsb(2);

      if (mode === 1) {
        // Predictor write: 3-bit index; index 7 refreshes pred[7].
        const predIdx = readBitsMsb(3);
        if (predIdx === 7) pred[7] = readBitsMsb(4);
        if (cursor + 1 < count) {
          aborted = true;
          break;
        }
        const fillVal = pred[predIdx];
        const fillStart = base + (cursor - count) + 1;
        for (let i = 0; i < count; i++) pixels[fillStart + i] = fillVal;
        cursor -= count;
      } else if (mode === 0) {
        // Skip-runs: walk left past `count` equal-pixel runs. No writes.
        for (let i = 0; i < count; i++) {
          if (cursor < 0 || cursor >= ROW_PIXELS) {
            aborted = true;
            break;
          }
          const ref = pixels[base + cursor];
          cursor--;
          while (
            cursor >= 0 &&
            cursor < ROW_PIXELS &&
            pixels[base + cursor] === ref
          ) {
            cursor--;
          }
        }
        if (aborted) break;
      } else if (mode === 2) {
        // Bridge: find boundary pixel; fill backward with ref; restore boundary.
        const ref = pixels[base + cursor];
        cursor--;
        while (
          cursor >= 0 &&
          cursor < ROW_PIXELS &&
          pixels[base + cursor] === ref
        ) {
          cursor--;
        }
        if (cursor < 0 || cursor >= ROW_PIXELS || cursor + 1 < count) {
          aborted = true;
          break;
        }
        const saved = pixels[base + cursor];
        const fillStart = base + (cursor - count) + 1;
        for (let i = 0; i < count; i++) pixels[fillStart + i] = ref;
        cursor -= count;
        if (cursor >= 0 && cursor < ROW_PIXELS) {
          pixels[base + cursor] = saved;
        }
      } else {
        // mode 3 — Jump forward: find boundary, jump cursor right, write boundary.
        const ref = pixels[base + cursor];
        cursor--;
        while (
          cursor >= 0 &&
          cursor < ROW_PIXELS &&
          pixels[base + cursor] === ref
        ) {
          cursor--;
        }
        const saved =
          cursor >= 0 && cursor < ROW_PIXELS ? pixels[base + cursor] : 0;
        cursor = cursor + count;
        if (cursor < 0 || cursor >= ROW_PIXELS) {
          aborted = true;
          break;
        }
        pixels[base + cursor] = saved;
      }
    }

    if (aborted) break;
  }

  if (aborted) {
    throw new Error(
      `lz16: decode failed (src offset ${s}, rowCount ${rowCount})`
    );
  }

  // --- transpose row-major pixels → SNES 4bpp tile layout ---
  const totalTiles = TILES_PER_ROW * rowCount;
  const outSize = totalTiles * BYTES_PER_TILE;
  for (let i = 0; i < outSize; i++) dest[destOff + i] = 0;

  for (let tileIdx = 0; tileIdx < totalTiles; tileIdx++) {
    const tileCol = tileIdx & 0xf;
    const tileRow = tileIdx >> 4;
    for (let rowInTile = 0; rowInTile < 8; rowInTile++) {
      const dBase = destOff + tileIdx * BYTES_PER_TILE + rowInTile * 2;
      const sBase = tileCol * 8 + (rowInTile + tileRow * 8) * ROW_PIXELS;
      for (let k = 0; k < 8; k++) {
        const px = pixels[sBase + k];
        const shift = 7 - k;
        dest[dBase + 0] |= (px & 1) << shift;
        dest[dBase + 1] |= ((px >> 1) & 1) << shift;
        dest[dBase + 16] |= ((px >> 2) & 1) << shift;
        dest[dBase + 17] |= ((px >> 3) & 1) << shift;
      }
    }
  }

  return { srcEnd: s, destEnd: destOff + outSize };
}

/** Probe the row count of an lz16 stream whose exact compressed byte length is
 *  known (an extracted blob — the cart pointer table defines the range): decode
 *  consumption is strictly monotonic in `rowCount`, so at most one row count
 *  consumes the stream exactly. Returns null when none fits (not lz16 data).
 *  Shared by the YY-CHR whole-cart export and the ROM importer's unsized-lz16
 *  sweep; expected values for all 187 cart blobs are pinned against the
 *  ycompress size table in `scripts/import/gfx-lz16.test.ts`. */
export function probeLz16RowCount(blob: Uint8Array, maxRows = 64): number | null {
  for (let r = 1; r <= maxRows; r++) {
    try {
      const out = new Uint8Array(r * 512);
      const res = lz16(blob, 0, out, 0, r);
      if (res.srcEnd === blob.length) return r;
      if (res.srcEnd > blob.length) return null;
    } catch {
      return null;
    }
  }
  return null;
}
