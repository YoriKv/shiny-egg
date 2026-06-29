// LZ16 (LC_LZ16, Lunar Compress FORMAT=15) ENCODER — the canonical inverse of
// `lz16.ts`. This is the *exact* parse the cart's graphics were packed with, so
// `decode(cartBlob)` → `encodeLz16` reproduces the original compressed bytes
// byte-for-byte (verified against every shipped LZ16 entry). That byte-identity
// is the point: re-encoding an unedited blob yields the original bytes, so the
// build stays byte-identical and edited blobs are the only ones that change.
//
// # The format (mirrors `lz16.ts`; see `docs/lz16-model.md`)
//
// 4bpp tile graphics, 128-pixel rows, decoded right-to-left into a rolling row
// buffer; the previous row is pre-copied so a row can be coded as a delta.
//
//   Header: 28 bits = 7 predictor colors (`pred[0..6]`), 4 bits each LSB-first.
//   Then a continuous LSB-first bit stream of per-row encodings.
//
// Each row is encoded BOTH ways and the shorter is kept:
//   - rowMode 0 (RLE): `write_bit(0)`, then per run right-to-left:
//       number(count) + predictor(run color) — a 3-bit index into pred[0..6],
//       or index 7 + a raw 4-bit color (escape) when not cached.
//   - rowMode 1 (delta vs the row above): `write_bit(1)`, then per run, compare
//       this row's run at the cursor with the previous row's run and emit one of
//       four ops (2-bit mode after the count):
//         mode 1 (flag 2): color changed → number(count)+mode+predictor(color)
//         mode 2 (flag 1): same color, run grew  → number(grow)+mode  (+ a
//                          boundary "carry" written into the prev-row buffer)
//         mode 3 (flag 3): same color, run shrank → number(shrink)+mode (+carry)
//         mode 0 (flag 0): run unchanged → number(#consecutive-unchanged)+mode
//       The boundary carry mutates the working previous-row buffer exactly as the
//       decoder's bridge/jump ops do, keeping encoder and decoder in lockstep.
//
// # Predictor selection (`makePalet`)
//
// The 7 cached colors are NOT the most-frequent pixels — they are the colors
// ranked by how often they appear as a *mode-1 color-change* across the delta
// encoding of the whole blob (simulated with the same boundary mutation). This
// is what makes the header bytes match the cart; a raw-frequency choice does not.
//
// `number(v)` is the Elias-gamma-flavour unary count (see `lz16.ts`): for the
// top set bit at position K, emit (1, bit_i) for i<K then a 0.

const ROW_PIXELS = 128;
const TILES_PER_ROW = 16;
const BYTES_PER_TILE = 32;
const BYTES_PER_TILE_ROW = TILES_PER_ROW * BYTES_PER_TILE; // 512

/** Inverse of `lz16.ts`'s final transpose: SNES 4bpp tile bytes → row-major
 *  128-wide pixel rows (one nibble per pixel). */
function tilesToPixels(tiles: Uint8Array, off: number, rowCount: number): Uint8Array {
  const totalTiles = TILES_PER_ROW * rowCount;
  const pixels = new Uint8Array(ROW_PIXELS * rowCount * 8);
  for (let tileIdx = 0; tileIdx < totalTiles; tileIdx++) {
    const tileCol = tileIdx & 0xf;
    const tileRow = tileIdx >> 4;
    for (let rowInTile = 0; rowInTile < 8; rowInTile++) {
      const dBase = off + tileIdx * BYTES_PER_TILE + rowInTile * 2;
      const sBase = tileCol * 8 + (rowInTile + tileRow * 8) * ROW_PIXELS;
      const b0 = tiles[dBase]!;
      const b1 = tiles[dBase + 1]!;
      const b2 = tiles[dBase + 16]!;
      const b3 = tiles[dBase + 17]!;
      for (let k = 0; k < 8; k++) {
        const shift = 7 - k;
        pixels[sBase + k] =
          ((b0 >> shift) & 1) |
          (((b1 >> shift) & 1) << 1) |
          (((b2 >> shift) & 1) << 2) |
          (((b3 >> shift) & 1) << 3);
      }
    }
  }
  return pixels;
}

/** Length of the constant-color run ending at `x` (walking left). */
function runCount(line: Uint8Array, x: number): number {
  const color = line[x]!;
  let count = 1;
  for (let i = x - 1; i >= 0 && line[i] === color; i--) count++;
  return count;
}

// --- bit emitters (append to a number[] sink, LSB-first within the final byte
//     packing; multi-bit fields written in the canonical order) ---
const emitBit = (o: number[], b: number): void => {
  o.push(b ? 1 : 0);
};
// Unary count: top set bit at K → (1, bit_i) for i in 0..K-1, then 0.
const emitNumber = (o: number[], num: number): void => {
  let bitFlag = 0x8000;
  let bitCount = 15;
  while ((num & bitFlag) === 0) {
    bitFlag >>= 1;
    bitCount--;
  }
  bitFlag = 1;
  while (bitCount > 0) {
    emitBit(o, 1);
    emitBit(o, num & bitFlag);
    bitFlag <<= 1;
    bitCount--;
  }
  emitBit(o, 0);
};
const emitPalet = (o: number[], p: number): void => {
  emitBit(o, p & 4);
  emitBit(o, p & 2);
  emitBit(o, p & 1);
};
const emitColor = (o: number[], c: number): void => {
  emitBit(o, c & 8);
  emitBit(o, c & 4);
  emitBit(o, c & 2);
  emitBit(o, c & 1);
};
const emitFlag = (o: number[], f: number): void => {
  emitBit(o, f & 1);
  emitBit(o, f & 2);
};
const emitPaletColor = (o: number[], c: number): void => {
  emitBit(o, c & 1);
  emitBit(o, c & 2);
  emitBit(o, c & 4);
  emitBit(o, c & 8);
};
/** Emit a run color: 3-bit index into pred[0..6], else index 7 + raw color. */
const emitColorCoded = (o: number[], color: number, palet: Uint8Array): void => {
  let idx = 7;
  for (let i = 0; i < 7; i++) if (color === palet[i]) { idx = i; break; }
  emitPalet(o, idx);
  if (idx === 7) emitColor(o, color);
};

/** rowMode 0 — plain RLE of the row. */
function asLine0(line: Uint8Array, palet: Uint8Array): number[] {
  const o: number[] = [];
  emitBit(o, 0);
  for (let x = 127; x >= 0; ) {
    const count = runCount(line, x);
    emitNumber(o, count);
    emitColorCoded(o, line[x]!, palet);
    x -= count;
  }
  return o;
}

/** rowMode 1 — delta vs `oldLine` (which is mutated in lockstep with the
 *  decoder's bridge/jump boundary writes; pass a disposable copy). */
function asLine1(nowLine: Uint8Array, oldLine: Uint8Array, f: number, palet: Uint8Array): number[] {
  const o: number[] = [];
  if (f) emitBit(o, 1);
  for (let x = 127; x >= 0; ) {
    let nowColor = nowLine[x]!;
    let nowCnt = runCount(nowLine, x);
    let oldColor = oldLine[x]!;
    let oldCnt = runCount(oldLine, x);

    if (nowColor !== oldColor) {
      // mode 1 — color change.
      emitNumber(o, nowCnt);
      emitFlag(o, 2);
      emitColorCoded(o, nowColor, palet);
      x -= nowCnt;
      continue;
    }
    if (nowCnt !== oldCnt) {
      const n = nowCnt - oldCnt;
      if (n > 0) {
        // mode 2 — run grew; carry the boundary color into the prev buffer.
        emitNumber(o, n);
        emitFlag(o, 1);
        const i = x - nowCnt;
        if (i >= 0) oldLine[i] = oldLine[x - oldCnt]!;
      } else {
        // mode 3 — run shrank.
        emitNumber(o, -n);
        emitFlag(o, 3);
        const i = x - oldCnt;
        oldLine[x - nowCnt] = i >= 0 ? oldLine[i]! : 0;
      }
      x -= nowCnt;
      continue;
    }
    // mode 0 — count consecutive unchanged runs.
    let n = 0;
    while (nowColor === oldColor && nowCnt === oldCnt) {
      n++;
      x -= nowCnt;
      if (x < 0) break;
      nowColor = nowLine[x]!;
      nowCnt = runCount(nowLine, x);
      oldColor = oldLine[x]!;
      oldCnt = runCount(oldLine, x);
    }
    emitNumber(o, n);
    emitFlag(o, 0);
  }
  return o;
}

/** Choose the 7 predictor colors: rank by mode-1 color-change frequency across
 *  the delta encoding of the blob (the boundary mutation is replayed so the
 *  counts match what `asLine1` will actually emit). Returns all 16 colors
 *  sorted descending; the first 7 are the predictors. */
function makePalet(pixels: Uint8Array, lineSu: number): Uint8Array {
  const color = new Uint8Array(16);
  for (let n = 0; n < 16; n++) color[n] = n;
  const count = new Int32Array(16);
  const nowLine = new Uint8Array(128);
  const oldLine = new Uint8Array(128);

  for (let y = 0; y < lineSu; y++) {
    oldLine.set(nowLine);
    for (let n = 0; n < 128; n++) nowLine[n] = pixels[(y << 7) | n]!;

    for (let x = 127; x >= 0; ) {
      let nowColor = nowLine[x]!;
      let nowCnt = runCount(nowLine, x);
      let oldColor = oldLine[x]!;
      let oldCnt = runCount(oldLine, x);

      if (nowColor !== oldColor) {
        count[nowColor]++;
        x -= nowCnt;
        continue;
      }
      if (nowCnt !== oldCnt) {
        const n = nowCnt - oldCnt;
        if (n > 0) {
          const i = x - nowCnt;
          if (i >= 0) oldLine[i] = oldLine[x - oldCnt]!;
        } else {
          const i = x - oldCnt;
          oldLine[x - nowCnt] = i >= 0 ? oldLine[i]! : 0;
        }
        x -= nowCnt;
        continue;
      }
      while (nowColor === oldColor && nowCnt === oldCnt) {
        x -= nowCnt;
        if (x < 0) break;
        nowColor = nowLine[x]!;
        nowCnt = runCount(nowLine, x);
        oldColor = oldLine[x]!;
        oldCnt = runCount(oldLine, x);
      }
    }
  }

  // Selection sort, descending by count; ties keep the lower color value.
  for (let y = 0; y < 15; y++)
    for (let x = y + 1; x < 16; x++)
      if (count[color[y]!]! < count[color[x]!]!) {
        const t = color[y]!;
        color[y] = color[x]!;
        color[x] = t;
      }
  return color;
}

/** Alternative predictor ranking: by how many maximal runs each color forms
 *  across the blob. Unlike `makePalet`, this counts the background color (0)
 *  at full weight, which is often the better choice — it's offered as a
 *  candidate and the smaller encoding wins (see `encodeLz16`). */
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

/** Encode the blob with a given predictor palette → bit list (28-bit header +
 *  per-line min(RLE, delta)). */
function encodeBlobBits(pixels: Uint8Array, lineSu: number, palet: Uint8Array): number[] {
  const bits: number[] = [];
  for (let n = 0; n < 7; n++) emitPaletColor(bits, palet[n]!); // 28-bit header
  const nowLine = new Uint8Array(128);
  const oldLine = new Uint8Array(128);
  for (let y = 0; y < lineSu; y++) {
    oldLine.set(nowLine);
    for (let n = 0; n < 128; n++) nowLine[n] = pixels[(y << 7) | n]!;
    const b0 = asLine0(nowLine, palet);
    const b1 = asLine1(nowLine, Uint8Array.from(oldLine), 1, palet); // copy: asLine1 mutates
    const chosen = b0.length <= b1.length ? b0 : b1;
    for (let i = 0; i < chosen.length; i++) bits.push(chosen[i]!);
  }
  return bits;
}

/**
 * Compress `tiles[off .. off + rowCount*512)` (SNES 4bpp tile bytes) into an
 * LZ16 stream. The result, fed to `lz16()` with the same `rowCount`, reproduces
 * those tile bytes exactly.
 *
 * Predictor selection is the main size lever (a cached run color costs 3 bits
 * vs 7 for an escape) and no single ranking is optimal, so we try a few
 * candidate palettes and keep the smallest valid encoding. `makePalet` is the
 * canonical/reference ranking; `paletByRunFreq` favours the background color.
 */
export function encodeLz16(
  tiles: Uint8Array,
  rowCount: number,
  off = 0
): Uint8Array {
  if (rowCount === 0) return new Uint8Array(0);
  if (off + rowCount * BYTES_PER_TILE_ROW > tiles.length) {
    throw new Error(
      `encodeLz16: need ${rowCount * BYTES_PER_TILE_ROW} bytes at off ${off}, ` +
        `have ${tiles.length - off}`
    );
  }

  const pixels = tilesToPixels(tiles, off, rowCount);
  const lineSu = rowCount * 8;

  const candidates = [makePalet(pixels, lineSu), paletByRunFreq(pixels, lineSu)];
  let best: number[] | null = null;
  for (const palet of candidates) {
    const bits = encodeBlobBits(pixels, lineSu, palet);
    if (best === null || bits.length < best.length) best = bits;
  }
  const bits = best!;

  const out = new Uint8Array((bits.length + 7) >> 3);
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3]! |= 1 << (i & 7);
  return out;
}
