// M1TE2 ".M1" codec round-trip pin (m1te2.ts) — cart-free.
//
//   1. encode → parse reproduces every field byte-exact (palette, all 3 maps, both
//      CHR blocks, mapHeight, tileSize).
//   2. The fixed byte layout: 55568 total, "M1" magic + documented header counts, and
//      each section at its documented offset.
//   3. Palette high-byte bit15 is forced to 0 on encode.
//   4. parse rejects a wrong size + bad magic.
//
// Run: node snes-framework/scripts/engine/m1te2.test.ts

import { encodeM1te2, parseM1te2, M1TE2_SIZE, type M1te2Doc } from './m1te2.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

// A deterministic doc with distinct content in every section.
function makeDoc(): M1te2Doc {
  const palette = new Uint8Array(256);
  // Odd bytes are colour high bytes; keep bit15 clear so the round-trip is exact (encode
  // intentionally masks it — that's pinned separately below).
  for (let i = 0; i < 256; i++) palette[i] = (i * 7 + 3) & (i & 1 ? 0x7f : 0xff);
  const maps = [0, 1, 2].map((m) => {
    const arr = new Uint16Array(1024);
    for (let i = 0; i < 1024; i++) arr[i] = (m * 0x1000 + i) & 0xffff;
    return arr;
  }) as [Uint16Array, Uint16Array, Uint16Array];
  const chr4bpp = new Uint8Array(32768);
  for (let i = 0; i < chr4bpp.length; i++) chr4bpp[i] = (i * 5 + 1) & 0xff;
  const chr2bpp = new Uint8Array(16384);
  for (let i = 0; i < chr2bpp.length; i++) chr2bpp[i] = (i * 11 + 2) & 0xff;
  return { mapHeight: 28, tileSize: 16, palette, maps, chr4bpp, chr2bpp };
}

console.log('m1te2 codec');

const doc = makeDoc();
const bytes = encodeM1te2(doc);

// 2. Size + header.
assert(bytes.length === M1TE2_SIZE && M1TE2_SIZE === 55568, 'blob is exactly 55568 bytes');
assert(bytes[0] === 0x4d && bytes[1] === 0x31, 'magic "M1"');
assert(bytes[2] === 1 && bytes[3] === 1 && bytes[4] === 3 && bytes[5] === 4 && bytes[6] === 4,
  'header counts {ver 1, pal 1, maps 3, 4bpp 4, 2bpp 4}');
assert(bytes[7] === 28 && bytes[8] === 1, 'mapHeight 28 + tileSize 16 (flag 1)');

// Section offsets carry the right first bytes.
assert(bytes[16] === doc.palette[0], 'palette at offset 16');
assert(bytes[272] === (doc.maps[0][0]! & 0xff), 'tilemaps at offset 272');
assert(bytes[6416] === doc.chr4bpp[0], '4bpp CHR at offset 6416');
assert(bytes[39184] === doc.chr2bpp[0], '2bpp CHR at offset 39184');

// 3. Palette high bytes have bit15 cleared.
const pal = makeDoc().palette.slice();
pal[1] = 0xff; // would set bit15
const hiClear = encodeM1te2({ ...doc, palette: pal })[17];
assert(hiClear === 0x7f, 'palette high byte masks bit15 (0xff → 0x7f)');

// 1. Round-trip.
const back = parseM1te2(bytes);
const eq = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
assert(back.mapHeight === 28 && back.tileSize === 16, 'mapHeight + tileSize round-trip');
assert(eq(back.palette, doc.palette), 'palette round-trips byte-exact');
assert(eq(back.maps[0], doc.maps[0]) && eq(back.maps[1], doc.maps[1]) && eq(back.maps[2], doc.maps[2]),
  'all 3 tilemaps round-trip byte-exact');
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

console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
