// Unit test: LZ16 encoder round-trips through the LZ16 decoder.
// Run: node --experimental-strip-types snes-framework/scripts/engine/decompress/lz16-encode.test.ts
//
// `lz16(encodeLz16(tiles), rowCount) === tiles` is the gate. The decoder is
// byte-exact vs `decomp.exe FORMAT=15` and the SuperFX cart (187/187 entries),
// so this proves our encoder produces format-valid streams. The cart-decoder
// cross-check on real blobs lives in `encode-verify.ts`.

import { lz16 } from './lz16.ts';
import { encodeLz16 } from './lz16-encode.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

const BYTES_PER_TILE_ROW = 512;

function roundTrip(tiles: Uint8Array, rowCount: number, label: string): void {
  const enc = encodeLz16(tiles, rowCount);
  const want = rowCount * BYTES_PER_TILE_ROW;
  const dest = new Uint8Array(want);
  let ok = true;
  let detail = '';
  try {
    const r = lz16(enc, 0, dest, 0, rowCount);
    if (r.destEnd !== want) {
      ok = false;
      detail = `decoded length ${r.destEnd} != ${want}`;
    } else {
      for (let i = 0; i < want; i++) {
        if (dest[i] !== tiles[i]) {
          ok = false;
          detail = `byte ${i}: got 0x${dest[i]!.toString(16)}, want 0x${tiles[i]!.toString(16)}`;
          break;
        }
      }
    }
  } catch (e) {
    ok = false;
    detail = String(e);
  }
  const ratio = ((enc.length / want) * 100).toFixed(0);
  assert(ok, `${label} (${want}B → ${enc.length}B, ${ratio}%)${ok ? '' : ' — ' + detail}`);
}

// Forward transpose (row-major 4-bit pixels → SNES 4bpp tile bytes), so a test
// can craft a specific pixel layout — e.g. partial row-to-row coherence that
// drives the rowMode=1 delta path.
function pixelsToTiles(pixels: Uint8Array, rowCount: number): Uint8Array {
  const totalTiles = 16 * rowCount;
  const out = new Uint8Array(totalTiles * 32);
  for (let t = 0; t < totalTiles; t++) {
    const tileCol = t & 0xf;
    const tileRow = t >> 4;
    for (let r = 0; r < 8; r++) {
      const dBase = t * 32 + r * 2;
      const sBase = tileCol * 8 + (r + tileRow * 8) * 128;
      for (let k = 0; k < 8; k++) {
        const px = pixels[sBase + k]!;
        const sh = 7 - k;
        out[dBase + 0]! |= (px & 1) << sh;
        out[dBase + 1]! |= ((px >> 1) & 1) << sh;
        out[dBase + 16]! |= ((px >> 2) & 1) << sh;
        out[dBase + 17]! |= ((px >> 3) & 1) << sh;
      }
    }
  }
  return out;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
}

console.log('=== LZ16 encode/decode round-trip ===');

// Uniform tiles (one color everywhere) — single 128-px run per row.
roundTrip(new Uint8Array(512).fill(0x00), 1, 'all-zero, 1 tile-row');
roundTrip(new Uint8Array(512).fill(0xff), 1, 'all-0xFF (color 15 everywhere)');
roundTrip(new Uint8Array(4 * 512).fill(0x00), 4, 'all-zero, 4 tile-rows');

// > 7 distinct colors forces the index-7 escape path.
{
  const rng = lcg(0xbeef);
  // 4bpp: each byte holds two pixels, all 16 colors appear.
  roundTrip(Uint8Array.from({ length: 2 * 512 }, () => rng() & 0xff), 2, 'random nibbles, 2 tile-rows');
}

// Exactly 8 distinct colors (7 cached + 1 escaped).
{
  const buf = new Uint8Array(512);
  for (let i = 0; i < buf.length; i++) buf[i] = ((i & 7) << 4) | ((i + 1) & 7);
  roundTrip(buf, 1, '8-color gradient');
}

// Horizontal bands (long single-color runs → best-case RLE).
{
  const tiles = new Uint8Array(2 * 512);
  // Build via the pixel domain then pack to tiles by encoding+decoding is
  // circular; instead just fill tile bytes with a structured but legal pattern.
  for (let i = 0; i < tiles.length; i++) tiles[i] = i % 17 === 0 ? 0x11 : 0x00;
  roundTrip(tiles, 2, 'sparse structured');
}

// Several rowCounts, structured noise.
for (const rc of [1, 2, 3, 4, 8]) {
  const rng = lcg(0x100 + rc);
  const tiles = Uint8Array.from({ length: rc * 512 }, (_, i) =>
    i % 3 === 0 ? rng() & 0xff : 0x00
  );
  roundTrip(tiles, rc, `structured noise, ${rc} tile-row(s)`);
}

// Partial row-to-row coherence — drives the rowMode=1 delta path (skip unchanged
// runs, mode-1 fill the changed ones). Each row mostly repeats the one above with
// a few edited runs.
{
  const rng = lcg(0xfeed);
  for (const rc of [2, 4]) {
    const pixelRows = rc * 8;
    const pixels = new Uint8Array(pixelRows * 128);
    // Row 0: blocky pattern (8-wide runs).
    for (let x = 0; x < 128; x++) pixels[x] = (x >> 3) & 0xf;
    for (let row = 1; row < pixelRows; row++) {
      pixels.copyWithin(row * 128, (row - 1) * 128, row * 128); // start = row above
      const edits = rng() % 4; // change a few runs
      for (let e = 0; e < edits; e++) {
        const blk = rng() % 16; // which 8-wide block
        const col = rng() & 0xf;
        for (let k = 0; k < 8; k++) pixels[row * 128 + blk * 8 + k] = col;
      }
    }
    roundTrip(pixelsToTiles(pixels, rc), rc, `partial coherence, ${rc} tile-row(s)`);
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
