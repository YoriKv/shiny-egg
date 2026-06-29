// M1TE2 ".M1" codec round-trip pin (m1te2.ts) — cart-free.
//
//   1. encode → parse reproduces every field byte-exact (palette, all 3 maps at stride 64,
//      both CHR blocks, mapWidth, mapHeight, tileSize).
//   2. The fixed v2 byte layout: 74000 total, "M1" magic + documented header counts
//      (version 2, mapWidth at off 9), and each section at its documented offset.
//   3. Palette high-byte bit15 is forced to 0 on encode.
//   4. parse rejects a wrong size + bad magic.
//   5. Legacy v1 (55568 B) still PARSES: lifted to width 32, its 32×32 maps placed at cols
//      0..31, CHR read from the older v1 offsets.
//
// Run: node snes-framework/scripts/engine/m1te2.test.ts

import {
  encodeM1te2, parseM1te2, M1TE2_SIZE, M1TE2_SIZE_V1,
  MAP_STRIDE, MAP_WORDS, OFF_PALETTE, OFF_MAPS, OFF_CHR4, OFF_CHR2, type M1te2Doc
} from './m1te2.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

// A deterministic doc with distinct content in every section (64-wide × 40-tall active map,
// but the arrays are the full 64×64 stride so the round-trip pins every cell).
function makeDoc(): M1te2Doc {
  const palette = new Uint8Array(256);
  // Odd bytes are color high bytes; keep bit15 clear so the round-trip is exact (encode
  // intentionally masks it — that's pinned separately below).
  for (let i = 0; i < 256; i++) palette[i] = (i * 7 + 3) & (i & 1 ? 0x7f : 0xff);
  const maps = [0, 1, 2].map((m) => {
    const arr = new Uint16Array(MAP_WORDS);
    for (let i = 0; i < MAP_WORDS; i++) arr[i] = (m * 0x1000 + i) & 0xffff;
    return arr;
  }) as [Uint16Array, Uint16Array, Uint16Array];
  const chr4bpp = new Uint8Array(32768);
  for (let i = 0; i < chr4bpp.length; i++) chr4bpp[i] = (i * 5 + 1) & 0xff;
  const chr2bpp = new Uint8Array(16384);
  for (let i = 0; i < chr2bpp.length; i++) chr2bpp[i] = (i * 11 + 2) & 0xff;
  return { mapWidth: 64, mapHeight: 40, tileSize: 16, palette, maps, chr4bpp, chr2bpp };
}

console.log('m1te2 codec');

const doc = makeDoc();
const bytes = encodeM1te2(doc);

// 2. Size + header.
assert(bytes.length === M1TE2_SIZE && M1TE2_SIZE === 74000, 'blob is exactly 74000 bytes (v2)');
assert(bytes[0] === 0x4d && bytes[1] === 0x31, 'magic "M1"');
assert(bytes[2] === 2 && bytes[3] === 1 && bytes[4] === 3 && bytes[5] === 4 && bytes[6] === 4,
  'header counts {ver 2, pal 1, maps 3, 4bpp 4, 2bpp 4}');
assert(bytes[7] === 40 && bytes[8] === 1 && bytes[9] === 64, 'mapHeight 40 + tileSize 16 (flag 1) + mapWidth 64');

// Section offsets carry the right first bytes.
assert(bytes[OFF_PALETTE] === doc.palette[0], 'palette at its offset');
assert(bytes[OFF_MAPS] === (doc.maps[0][0]! & 0xff), 'tilemaps at their offset');
assert(bytes[OFF_CHR4] === doc.chr4bpp[0], '4bpp CHR at its offset');
assert(bytes[OFF_CHR2] === doc.chr2bpp[0], '2bpp CHR at its offset');
assert(OFF_MAPS === 272 && OFF_CHR4 === 24848 && OFF_CHR2 === 57616, 'v2 section offsets are the documented values');

// 3. Palette high bytes have bit15 cleared.
const pal = makeDoc().palette.slice();
pal[1] = 0xff; // would set bit15
const hiClear = encodeM1te2({ ...doc, palette: pal })[OFF_PALETTE + 1];
assert(hiClear === 0x7f, 'palette high byte masks bit15 (0xff → 0x7f)');

// 1. Round-trip.
const back = parseM1te2(bytes);
const eq = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
assert(back.mapWidth === 64 && back.mapHeight === 40 && back.tileSize === 16, 'mapWidth + mapHeight + tileSize round-trip');
assert(eq(back.palette, doc.palette), 'palette round-trips byte-exact');
assert(eq(back.maps[0], doc.maps[0]) && eq(back.maps[1], doc.maps[1]) && eq(back.maps[2], doc.maps[2]),
  'all 3 tilemaps round-trip byte-exact (stride 64)');
assert(eq(back.chr4bpp, doc.chr4bpp), '4bpp CHR round-trips byte-exact');
assert(eq(back.chr2bpp, doc.chr2bpp), '2bpp CHR round-trips byte-exact');

// 4. Rejections.
let threwSize = false;
try { parseM1te2(new Uint8Array(100)); } catch { threwSize = true; }
assert(threwSize, 'parse rejects a wrong-size file');
let threwMagic = false;
const badMagic = bytes.slice();
badMagic[0] = 0;
try { parseM1te2(badMagic); } catch { threwMagic = true; }
assert(threwMagic, 'parse rejects bad magic');

// 5. Legacy v1 (55568 B) still parses — lifted to width 32.
{
  const V1_OFF_CHR4 = 6416, V1_OFF_CHR2 = 39184; // the legacy section offsets (parse-only)
  const v1 = new Uint8Array(M1TE2_SIZE_V1);
  v1[0] = 0x4d; v1[1] = 0x31; v1[2] = 1; v1[3] = 1; v1[4] = 3; v1[5] = 4; v1[6] = 4;
  v1[7] = 30; // mapHeight (≤32)
  v1[8] = 0;  // tileSize 8
  // map 0: cell (0,0) word 0xBEEF, cell (1,0) word 0x1234, cell (0,1) word 0x5678.
  const put = (off: number, w: number): void => { v1[off] = w & 0xff; v1[off + 1] = (w >> 8) & 0xff; };
  put(OFF_MAPS + 0 * 2, 0xbeef);  // (x0,y0)
  put(OFF_MAPS + 1 * 2, 0x1234);  // (x1,y0)
  put(OFF_MAPS + 32 * 2, 0x5678); // (x0,y1) — v1 stride is 32
  v1[V1_OFF_CHR4] = 0xa5;
  v1[V1_OFF_CHR2] = 0x3c;
  const d = parseM1te2(v1);
  assert(d.mapWidth === 32 && d.mapHeight === 30 && d.tileSize === 8, 'v1 parses as width 32, its mapHeight, tileSize 8');
  assert(d.maps[0]!.length === MAP_WORDS, 'v1 maps are lifted to the 64×64-stride model');
  assert(d.maps[0]![0] === 0xbeef && d.maps[0]![1] === 0x1234 && d.maps[0]![MAP_STRIDE] === 0x5678,
    'v1 32×32 cells land at cols 0..31 of the stride-64 grid ((1,0)→idx 1, (0,1)→idx 64)');
  assert(d.chr4bpp[0] === 0xa5 && d.chr2bpp[0] === 0x3c, 'v1 CHR read from the legacy offsets');
}

console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
