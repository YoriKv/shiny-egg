// Unit test: YY-CHR export sidecars + padding — pins the byte layouts the
// decompiled YY-CHR.NET source defines (.pal R5G5B5 order + bit-15 mask, .col
// header/stride addressing, bank padding, extension→format naming).
// Run: node snes-framework/scripts/engine/gfx-yychr.test.ts

import {
  yychrBankBytes,
  padToYychrBank,
  stripYychrPad,
  rgbToBgr15,
  buildPalFromRgbRows,
  buildPalFromCgram,
  buildColSidecar,
  chunkyToPlanar,
  planarToChunky,
  glyphs1bppToBitmap,
  bitmapToGlyphs1bpp,
  bitmap1bppToTiles,
  tiles1bppToBitmap,
  yychrSheetName,
  yychrPalName,
  yychrColName,
  yychrAdfName,
  buildIdentityAdf
} from './gfx-yychr.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
const eqBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

console.log('=== bank sizes + padding ===');
{
  assert(yychrBankBytes(1) === 2048, '1bpp bank = 2048');
  assert(yychrBankBytes(2) === 4096, '2bpp bank = 4096');
  assert(yychrBankBytes(4) === 8192, '4bpp bank = 8192');
  assert(yychrBankBytes(8) === 16384, '8bpp bank = 16384');

  const small = Uint8Array.from({ length: 0x1600 }, (_, i) => (i * 7) & 0xff);
  const padded = padToYychrBank(small, 4);
  assert(padded.length === 8192, 'sub-bank 4bpp file pads to one bank');
  assert(padded.length % 2048 === 0, 'padded size defeats the %2048 copier-header autodetect');
  assert(eqBytes(padded.subarray(0, small.length), small), 'padding preserves the blob bytes');
  assert(padded.subarray(small.length).every((b) => b === 0), 'padding is zeros');

  const aligned = new Uint8Array(4096);
  assert(padToYychrBank(aligned, 2) === aligned, 'already-aligned file returned as-is');
  const oneAndABit = new Uint8Array(8193);
  assert(padToYychrBank(oneAndABit, 4).length === 16384, 'over one bank pads to the next bank');
}

console.log('\n=== stripYychrPad (import truncation) ===');
{
  const padded = new Uint8Array(8192);
  padded.set([1, 2, 3], 0);
  const clean = stripYychrPad(padded, 0x1600);
  assert(clean.bytes.length === 0x1600, 'truncates to the true blob length');
  assert(!clean.padEdited, 'zero padding → padEdited false');
  padded[0x1601] = 0x40; // paint in the pad
  const dirty = stripYychrPad(padded, 0x1600);
  assert(dirty.padEdited, 'nonzero byte in the pad → padEdited true');
  assert(dirty.bytes.length === 0x1600, 'pad bytes still dropped');
}

console.log('\n=== rgbToBgr15 (YY-CHR R5G5B5 == SNES CGRAM) ===');
{
  assert(rgbToBgr15(0xff0000) === 0x001f, 'red → R bits 0-4');
  assert(rgbToBgr15(0x00ff00) === 0x03e0, 'green → G bits 5-9');
  assert(rgbToBgr15(0x0000ff) === 0x7c00, 'blue → B bits 10-14');
  assert(rgbToBgr15(0xffffff) === 0x7fff, 'white — bit 15 clear');
}

console.log('\n=== buildPalFromRgbRows (.pal groups match .col ColorNum stride) ===');
{
  // 2bpp: each sub-palette = one 4-color group.
  const pal2 = buildPalFromRgbRows([[0xff0000, 0x00ff00], [0x0000ff]], 4);
  assert(pal2.length === 512, '.pal is always 512 bytes (auto-detects as R5G5B5)');
  assert((pal2[0]! | (pal2[1]! << 8)) === 0x001f, 'sub 0 color 0 at slot 0');
  assert((pal2[2]! | (pal2[3]! << 8)) === 0x03e0, 'sub 0 color 1 at slot 1');
  assert((pal2[8]! | (pal2[9]! << 8)) === 0x7c00, 'sub 1 starts at slot 4 (2bpp group stride)');
  // 4bpp: each sub-palette = one 16-color group.
  const pal4 = buildPalFromRgbRows([[0x111111], [0x0000ff]], 16);
  assert((pal4[32]! | (pal4[33]! << 8)) === 0x7c00, 'sub 1 starts at slot 16 (4bpp group stride)');
}

console.log('\n=== buildPalFromCgram (primary row first, bit 15 masked) ===');
{
  const cgram = new Uint8Array(512);
  for (let i = 0; i < 256; i++) {
    cgram[i * 2] = i & 0xff;
    cgram[i * 2 + 1] = 0x80 | (i >> 4); // bit 15 deliberately set — must be masked
  }
  const pal = buildPalFromCgram(cgram, 6);
  // Row 0 of the .pal = CGRAM row 6 (colors 96..111).
  assert(pal[0] === 96 && pal[1] === (96 >> 4), 'primary row (6) copied first');
  assert((pal[1]! & 0x80) === 0, 'bit 15 masked (set = "invalid color" in YY-CHR)');
  // Row 1 of the .pal = CGRAM row 0 (the remaining rows in order, primary skipped).
  assert(pal[32] === 0, 'second .pal row = CGRAM row 0');
  // CGRAM row 7 lands after rows 0..5 → .pal row 7.
  assert(pal[7 * 32] === ((7 * 16) & 0xff), 'CGRAM row 7 stays at .pal row 7 (rows after primary unshifted)');
}

console.log('\n=== buildColSidecar (ColSetData addressing) ===');
{
  // 4bpp: char at file offset B reads col[B/16 + 256] → 512-byte bank stride, 256 used.
  const tileSub4 = Array.from({ length: 512 }, (_, t) => t & 0xff); // two banks
  const col4 = buildColSidecar(tileSub4, 4, 2 * 8192);
  assert(col4.length === 256 + (2 * 8192) / 16, '4bpp col sized to header + paddedBytes/16');
  assert(col4[256] === 0 && col4[256 + 2] === 1, '4bpp: char n at 256 + n*2 (32B tile / 16)');
  assert(col4[256 + 255 * 2] === 255, '4bpp: last char of bank 0');
  assert(col4[256 + 512] === 0 && col4[256 + 512 + 2] === 1, '4bpp: bank 1 block starts at +512');
  assert(col4.subarray(256, 256 + 512).filter((_, i) => i % 2 === 1).every((b) => b === 0), '4bpp: odd 16-byte slots unused');
  // 2bpp: 16B chars pack contiguously (256-byte bank blocks).
  const tileSub2 = Array.from({ length: 256 }, (_, t) => (t + 1) & 0xff);
  const col2 = buildColSidecar(tileSub2, 2, 4096);
  assert(col2[256] === 1 && col2[256 + 255] === 0, '2bpp: char n at 256 + n, one byte each');
  // Padding chars past tileSub read group 0.
  const colPad = buildColSidecar([3], 4, 8192);
  assert(colPad[256] === 3 && colPad[256 + 2] === 0, 'chars past tileSub → group 0');
}

console.log('\n=== chunky ↔ planar (the ycompress type-1 transform) ===');
{
  // Bijective both ways on random data (the property the import round-trip rests on).
  let s = 0x1234;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) & 0xff);
  const chunky = Uint8Array.from({ length: 0x2000 }, rnd); // one 256×32 page, 256 tiles
  const planar = chunkyToPlanar(chunky);
  assert(planar.length === chunky.length, 'size in == size out');
  assert(eqBytes(planarToChunky(planar), chunky), 'chunky → planar → chunky byte-exact');
  const planarRand = Uint8Array.from({ length: 0x2000 }, rnd);
  assert(eqBytes(chunkyToPlanar(planarToChunky(planarRand)), planarRand), 'planar → chunky → planar byte-exact');

  // Spec vectors (ycompress-allgfx.md §3): chunky byte (row 0, x 0) = $21 →
  // low layer v=1 in quadrant 0 tile 0, high layer v=2 in quadrant 2 tile 0.
  const spec = new Uint8Array(0x2000);
  spec[0] = 0x21;
  spec[0x80] = 0x03; // (row 0, x 128) → RIGHT half: quadrant 1 tile 0, low v=3
  const p = chunkyToPlanar(spec);
  const q = (spec.length >> 5) >> 2; // tiles per quadrant
  assert((p[0]! & 0x80) !== 0 && (p[1]! & 0x80) === 0, 'low nibble 1 → quad 0 tile 0 plane 0, pixel (0,0)');
  assert((p[2 * q * 32 + 1]! & 0x80) !== 0 && (p[2 * q * 32]! & 0x80) === 0, 'high nibble 2 → quad 2 tile 0 plane 1');
  assert((p[q * 32]! & 0x80) !== 0 && (p[q * 32 + 1]! & 0x80) !== 0, 'right-half low nibble 3 → quad 1 tile 0 planes 0+1');
}

console.log('\n=== 1bpp re-tiling (glyph records / flat bitmap → 8×8-tile order) ===');
{
  let s = 0xbeef;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) & 0xff);
  // The message font shape: 256 glyphs × 8×12 (12 B each) → 128×192 sheet bitmap.
  const glyphs = Uint8Array.from({ length: 256 * 12 }, rnd);
  const bitmap = glyphs1bppToBitmap(glyphs, 8, 12, 16);
  assert(bitmap.length === glyphs.length, 'font sheet bitmap is the same byte length (16×16 grid fills whole rows)');
  assert(bitmap[0] === glyphs[0] && bitmap[1] === glyphs[12], 'sheet row 0 = glyph 0 row 0, then glyph 1 row 0');
  assert(eqBytes(bitmapToGlyphs1bpp(bitmap, 8, 12, 16, 256), glyphs), 'glyphs → bitmap → glyphs byte-exact');

  const tiles = bitmap1bppToTiles(bitmap, 128);
  assert(tiles.length === bitmap.length, 'tile order is the same byte length (192 rows = 24 whole bands)');
  assert(tiles[8] === bitmap[1], 'tile 1 row 0 = bitmap byte 1 (next 8-px column)');
  assert(tiles[1] === bitmap[16], 'tile 0 row 1 = bitmap row 1 byte 0');
  assert(eqBytes(tiles1bppToBitmap(tiles, 128), bitmap), 'bitmap → tiles → bitmap byte-exact');

  // The message-box pictures shape: flat 128×512 bitmap (8192 B) → tiles directly.
  const pic = Uint8Array.from({ length: 8192 }, rnd);
  assert(eqBytes(tiles1bppToBitmap(bitmap1bppToTiles(pic, 128), 128), pic), 'flat 128-wide bitmap round-trips through tile order');
}

console.log('\n=== naming (extension drives YY-CHR format auto-select) ===');
{
  assert(yychrSheetName('sprites/f42', 4) === 'sprites/f42.4bpp.sfc', '4bpp → .sfc (4BPP SNES)');
  assert(yychrSheetName('bg3/f10', 2) === 'bg3/f10.2bpp.gb', '2bpp → .gb (2BPP GB = SNES 2bpp)');
  assert(yychrSheetName('advanced/island-fB1', 4, { cpc: true }) === 'advanced/island-fB1.4bpp.gba', 'CPC → .gba (4BPP GBA, byte-identical)');
  assert(yychrSheetName('advanced/boss-fB9', 8) === 'advanced/boss-fB9.8bpp.m7', '8bpp → neutral .m7 (manual pick)');
  assert(yychrSheetName('advanced/font', 1) === 'advanced/font.1bpp', '1bpp → neutral .1bpp (manual pick)');
  for (const n of [yychrSheetName('x', 4), yychrSheetName('x', 2), yychrSheetName('x', 8), yychrSheetName('x', 1)]) {
    assert(!n.endsWith('.bin'), `${n}: never .bin (auto-selects 2BPP MSX in YY-CHR)`);
  }
  assert(yychrPalName('a/b.4bpp.sfc') === 'a/b.4bpp.sfc.pal', 'sidecars use APPENDED naming (auto-load checks it first)');
  assert(yychrColName('a/b.2bpp.gb') === 'a/b.2bpp.gb.col', '.col appended naming');
  assert(yychrAdfName('a/b.2bpp.gb') === 'a/b.2bpp.gb.adf', '.adf appended naming');
}

console.log('\n=== identity .adf (the Col-mode null-ADF crash guard) ===');
{
  const adf = buildIdentityAdf();
  assert(adf.length === 288, 'one 288-byte record (32-byte name + 256-byte pattern)');
  assert(adf[0] === 'l'.charCodeAt(0), 'name at offset 0');
  assert(adf[31] === 0, 'name byte 31 clear ($FF there = blank-char-$FF mode)');
  assert(Array.from({ length: 256 }, (_, i) => adf[32 + i] === i).every(Boolean), 'pattern is the identity remap (display no-op)');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll gfx-yychr tests passed.');
