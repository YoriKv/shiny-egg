// LZ16 (LC_LZ16, Lunar Compress FORMAT=15) ENCODER — the *improved* parse.
//
// Same bit format and the same per-row encoder as `lz16-encode.ts` — the only
// thing it changes is which predictor palette the blob is encoded against. The
// 7 cached colors are the format's main size lever (a cached run color costs 3
// bits, an escape 7), and `make_palet`'s ranking is not always the best one, so
// this tries several candidates and keeps the smallest result.
//
// That extra choice is exactly why it can't be the default: for 10 of the cart's
// 187 blobs a candidate wins that `ascgx` would never have picked, and the blob
// stops being byte-identical to the one the ROM shipped. Used for graphics that
// are already edited (see `encodeGfxBlob`), where there is no cart blob left to
// match and the smaller stream is pure headroom.
//
// # There is almost nothing left to win here — don't go looking
//
// Unlike LZ2, this format is saturated. Measured over the cart's 187 blobs
// (184,237 B as shipped):
//
//   ascgx / `encodeLz16`   184,237 B    0.00%
//   recomp.exe             184,041 B   −0.11%   — ties this file on 185 of 187,
//                                                 never beats it
//   this file              183,994 B   −0.13%
//   provably optimal       183,958 B   −0.15%   — exhaustive, see below
//
// The predictor set is the ONLY lever. Everything else is forced: each row's run
// structure (both modes) is a property of the pixels alone, the per-row
// min(RLE, delta) choice is independent per row so taking the smaller is already
// optimal, and `pred[7]` is a pure escape (index 7 always reads its 4-bit color,
// so it can never be referenced cheaply). Order inside the set is free too — an
// index costs 3 bits whichever slot it lands in. That leaves C(16,7) = 11,440
// candidate sets, few enough to search exhaustively, and doing so buys **36
// bytes across the whole cart** over the two rankings below. Hence two
// heuristics rather than a search: the search is real work for 0.02%.

import {
  encodeLz16FromPalettes,
  lz16Pixels,
  makePalet,
} from './lz16-encode.ts';

/** Alternative predictor ranking: by how many maximal runs each color forms
 *  across the blob. Unlike `makePalet`, this counts the background color (0)
 *  at full weight, which is often the better choice. */
function paletByRunFreq(pixels: Uint8Array, lineSu: number): Uint8Array {
  const count = new Int32Array(16);
  for (let y = 0; y < lineSu; y++) {
    const base = y * 128;
    for (let x = 0; x < 128; ) {
      const c = pixels[base + x]!;
      let len = 1;
      while (x + len < 128 && pixels[base + x + len] === c) len++;
      count[c]++;
      x += len;
    }
  }
  const color = new Uint8Array(16);
  for (let n = 0; n < 16; n++) color[n] = n;
  for (let y = 0; y < 15; y++)
    for (let x = y + 1; x < 16; x++)
      if (count[color[y]!]! < count[color[x]!]!) {
        const t = color[y]!;
        color[y] = color[x]!;
        color[x] = t;
      }
  return color;
}

/**
 * Compress `tiles[off .. off + rowCount*512)` into an LZ16 stream, choosing the
 * smaller of two predictor palettes.
 *
 * Decodes back to `tiles` exactly, like `encodeLz16` — it is simply not
 * guaranteed to be the *cart's* bytes when handed cart data.
 */
export function encodeLz16Improved(
  tiles: Uint8Array,
  rowCount: number,
  off = 0
): Uint8Array {
  if (rowCount === 0) return new Uint8Array(0);
  const { pixels, lineSu } = lz16Pixels(tiles, rowCount, off);
  return encodeLz16FromPalettes(pixels, lineSu, [
    makePalet(pixels, lineSu),
    paletByRunFreq(pixels, lineSu),
  ]);
}
