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
  buildIdentityAdf,
  renderYychrSheetRgba
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
  // 4bpp: col index = bankBase/16 + charIdx + 256 (ColSetData.cs) — the char index
  // within a 256-char bank window is DENSE; banks stride 512 entries, first 256
  // used. (The pre-2026-07-19 layout wrote 256 + charIdx*2 — every odd char read
  // group 0; in-app symptom: odd tile columns in one solid wrong color.)
  const tileSub4 = Array.from({ length: 512 }, (_, t) => t & 0xff); // two banks
  const col4 = buildColSidecar(tileSub4, 4, 2 * 8192);
  assert(col4.length === 256 + (2 * 8192) / 16, '4bpp col sized to header + paddedBytes/16');
  assert(col4[256] === 0 && col4[256 + 1] === 1, '4bpp: char n at 256 + n (dense within the bank)');
  assert(col4[256 + 255] === 255, '4bpp: last char of bank 0 at 256 + 255');
  assert(col4.subarray(256 + 256, 256 + 512).every((b) => b === 0), '4bpp: upper half of the bank-0 block unused');
  assert(col4[256 + 512] === 0 && col4[256 + 512 + 1] === 1, '4bpp: bank 1 block starts at +512, dense');
  // 2bpp: 16B chars pack contiguously (256-byte bank blocks) — same as before.
  const tileSub2 = Array.from({ length: 256 }, (_, t) => (t + 1) & 0xff);
  const col2 = buildColSidecar(tileSub2, 2, 4096);
  assert(col2[256] === 1 && col2[256 + 255] === 0, '2bpp: char n at 256 + n, one byte each');
  // Padding chars past tileSub read group 0.
  const colPad = buildColSidecar([3], 4, 8192);
  assert(colPad[256] === 3 && colPad[256 + 1] === 0, 'chars past tileSub → group 0');
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

console.log('\n=== renderYychrSheetRgba (thumbnail rasterizer) ===');
{
  // Pixel (x, 0)'s RGBA offset in a row-0 check.
  const px = (r: ReturnType<typeof renderYychrSheetRgba>, x: number): number[] =>
    Array.from(r.rgba.subarray(x * 4, x * 4 + 4));

  // 4bpp planar + .pal: pixel (0,0) idx 5 (planes 0+2), everything else idx 0.
  const sheet4 = new Uint8Array(8192);
  sheet4[0] = 0x80; // plane 0, row 0, bit 7
  sheet4[16] = 0x80; // plane 2, row 0, bit 7
  const pal = new Uint8Array(512);
  pal[10] = 0x1f; // slot 5 = pure red (R bits 0-4)
  const r4 = renderYychrSheetRgba(sheet4, { bpp: 4, sizeBytes: 8192 }, pal);
  assert(r4.width === 128 && r4.height === 128, '4bpp bank renders 128×128 (16 tiles wide)');
  assert(r4.totalTiles === 256 && r4.renderedTiles === 256, 'one 4bpp bank = 256 tiles');
  assert(px(r4, 0).join() === '255,0,0,255', '4bpp pixel (0,0) idx 5 → .pal slot 5 (red, expand-scaled)');
  assert(px(r4, 1).join() === '0,0,0,255', 'idx 0 → .pal slot 0, rendered OPAQUE (as YY-CHR does)');

  // maxTiles cap: geometry shrinks, totalTiles still reports the full sheet.
  const capped = renderYychrSheetRgba(sheet4, { bpp: 4, sizeBytes: 8192, maxTiles: 16 }, pal);
  assert(capped.renderedTiles === 16 && capped.totalTiles === 256, 'maxTiles caps renderedTiles only');
  assert(capped.width === 128 && capped.height === 8, '16 tiles at 16 wide = one 8-px band');

  // A file truncated on disk renders its whole tiles instead of throwing.
  const short = renderYychrSheetRgba(new Uint8Array(32), { bpp: 4, sizeBytes: 64 });
  assert(short.renderedTiles === 1 && short.totalTiles === 2, 'truncated file clamps to whole on-disk tiles');

  // 2bpp + .col: pixel (0,0) idx 3, col group 1 → .pal slot 1*4 + 3 = 7.
  const sheet2 = new Uint8Array(4096);
  sheet2[0] = 0x80;
  sheet2[1] = 0x80;
  const pal2 = new Uint8Array(512);
  pal2[14] = 0xe0; // slot 7 = pure green (G bits 5-9)
  pal2[15] = 0x03;
  const col = buildColSidecar([1], 2, 4096);
  const r2 = renderYychrSheetRgba(sheet2, { bpp: 2, sizeBytes: 4096 }, pal2, col);
  assert(px(r2, 0).join() === '0,255,0,255', '2bpp idx 3 + col group 1 → slot 7 (ColorNum 4 stride)');

  // 4bpp writer↔reader symmetry: an ODD char's col group must round-trip through
  // the sidecar (the exact pairing the pre-2026-07-19 double-stride bug broke —
  // odd chars all read group 0).
  const sheet4odd = new Uint8Array(8192);
  sheet4odd[1 * 32] = 0x80; // char 1, pixel (0,0) → idx 1
  const pal4odd = new Uint8Array(512);
  pal4odd[(2 * 16 + 1) * 2] = 0x1f; // group 2, color 1 = red
  const col4odd = buildColSidecar([0, 2], 4, 8192);
  const r4odd = renderYychrSheetRgba(sheet4odd, { bpp: 4, sizeBytes: 8192 }, pal4odd, col4odd);
  assert(px(r4odd, 8).join() === '255,0,0,255', '4bpp odd char reads its own col group (dense charIdx)');

  // CPC (4BPP GBA): byte 0x21 → pixel 0 = LOW nibble (1), pixel 1 = high (2).
  const cpc = new Uint8Array(8192);
  cpc[0] = 0x21;
  const palCpc = new Uint8Array(512);
  palCpc[2] = 0x1f; // slot 1 = red
  palCpc[4] = 0xe0; // slot 2 = green
  palCpc[5] = 0x03;
  const rc = renderYychrSheetRgba(cpc, { bpp: 4, cpc: true, sizeBytes: 8192 }, palCpc);
  assert(px(rc, 0).join() === '255,0,0,255', 'CPC pixel 0 = LOW nibble');
  assert(px(rc, 1).join() === '0,255,0,255', 'CPC pixel 1 = high nibble');

  // 1bpp, no .pal: bit 7 = leftmost pixel; black/white ramp.
  const one = new Uint8Array(2048);
  one[0] = 0x80;
  const r1 = renderYychrSheetRgba(one, { bpp: 1, sizeBytes: 2048 });
  assert(px(r1, 0).join() === '255,255,255,255', '1bpp set bit → white');
  assert(px(r1, 1).join() === '0,0,0,255', '1bpp clear bit → black');

  // No .pal on a 4bpp sheet → grayscale ramp (idx 15 = white).
  const gray = new Uint8Array(8192);
  gray[0] = 0x80;
  gray[1] = 0x80;
  gray[16] = 0x80;
  gray[17] = 0x80; // idx 15 at (0,0)
  const rg = renderYychrSheetRgba(gray, { bpp: 4, sizeBytes: 8192 });
  assert(px(rg, 0).join() === '255,255,255,255', 'no .pal: idx 15 → white on the grayscale ramp');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll gfx-yychr tests passed.');
