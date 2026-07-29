// Unit test: graphics ⇄ INDEXED-PNG round-trip (match by index), the color/nearest
// fallback for a flattened save, + PNG codec robustness (indexed encode, decoder color
// types/filters).
// Run: node --experimental-strip-types snes-framework/scripts/engine/gfx-png.test.ts

import * as zlib from 'node:zlib';
import { decodePng, encodeIndexedPng, encodePng, type ImageData } from './png.ts';
import { gfxToImage, imageToGfx, lz16Layout, lz2Layout, rgbaToRgbInts, type GfxImageLayout } from './gfx-png.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
const eqBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
import { decode4bppTile, encode4bppTile, encode2bppTile } from './tile.ts';
const decode4bppTileForTest = (bytes: Uint8Array, out: Uint8Array): void => decode4bppTile(bytes, 0, false, false, out, 0);
const encode4bppTileForTest = (idx: Uint8Array, out: Uint8Array): void => encode4bppTile(idx, 0, out, 0);
const encode2bppTileForTest = (idx: Uint8Array, out: Uint8Array, off: number): void => encode2bppTile(idx, 0, out, off);
function lcg(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0));
}

// A distinct N-color palette (no duplicate colors → exact round-trip).
function distinctPalette(n: number, alpha0: number): Uint8Array {
  const p = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    p[i * 4] = (i * 17) & 0xff;
    p[i * 4 + 1] = (i * 53 + 7) & 0xff;
    p[i * 4 + 2] = (i * 97 + 31) & 0xff;
    p[i * 4 + 3] = i === 0 ? alpha0 : 255;
  }
  return p;
}

// Round-trip through the real PNG codec (indexed encode → decode), i.e. exactly what
// an artist opens and re-saves from an indexed editor.
function viaPng(img: ReturnType<typeof gfxToImage>): ImageData {
  return decodePng(encodeIndexedPng(img));
}
// The same image FLATTENED to truecolor — what a tool that drops indexing writes. The
// import then has to match by color (exact, else nearest).
function viaFlatPng(img: ImageData): ImageData {
  return decodePng(encodePng({ rgba: img.rgba, width: img.width, height: img.height }));
}

console.log('=== lz16 round-trip (tiles → image → PNG → image → tiles) ===');
{
  const rng = lcg(0xc0de);
  for (const rc of [1, 2, 3, 4]) {
    const tiles = Uint8Array.from({ length: rc * 512 }, () => rng() & 0xff);
    const layout = lz16Layout(rc);
    const pal = distinctPalette(16, 255);
    const img = gfxToImage(tiles, layout, pal);
    assert(img.width === 16 * 8, `rc=${rc} width = bare tile grid (no swatch)`);
    assert(img.palette.length === 16, `rc=${rc} PNG carries the 16-color palette`);
    const back = imageToGfx(viaPng(img), layout);
    assert(eqBytes(back, tiles), `rc=${rc} exact round-trip through the indexed PNG (by index)`);
    const flat = imageToGfx(viaFlatPng(img), layout, { palette: rgbaToRgbInts(pal) });
    assert(eqBytes(flat, tiles), `rc=${rc} exact round-trip through a FLATTENED PNG (by color)`);
  }
}

console.log('\n=== index 0 transparent stays index 0 ===');
{
  const rng = lcg(0x7);
  const tiles = Uint8Array.from({ length: 2 * 512 }, () => rng() & 0xff);
  const layout = lz16Layout(2);
  const pal = distinctPalette(16, 0); // index 0 transparent
  const img = gfxToImage(tiles, layout, pal);
  const back = imageToGfx(viaPng(img), layout);
  assert(eqBytes(back, tiles), 'transparent-index-0 round-trip exact (by index, via tRNS)');
  const flat = imageToGfx(viaFlatPng(img), layout, { palette: rgbaToRgbInts(pal), index0Transparent: true });
  assert(eqBytes(flat, tiles), 'transparent-index-0 round-trip exact (flattened, by color)');
}

console.log('\n=== off-palette pixel → NEAREST palette color, counted in stats ===');
{
  const layout = lz16Layout(1);
  const tiles = new Uint8Array(512); // all index 0
  const palRgba = distinctPalette(16, 255);
  const palette = rgbaToRgbInts(palRgba);
  // A flattened (non-indexed) save is the only way an off-palette color reaches the
  // import — an indexed file can only hold indices.
  const flat = (paint: (img: ImageData) => void): ImageData => {
    const img = viaFlatPng(gfxToImage(tiles, layout, palRgba));
    paint(img);
    return img;
  };
  // Paint pixel (0,0) a near-miss of palette color 5 (each channel off by one).
  const near5 = flat((img) => {
    img.rgba[0] = palRgba[5 * 4]! + 1; img.rgba[1] = palRgba[5 * 4 + 1]! - 1; img.rgba[2] = palRgba[5 * 4 + 2]! + 1; img.rgba[3] = 255;
  });
  const stats = { offPalette: 0 };
  const back = imageToGfx(near5, layout, { palette, stats });
  const idx = new Uint8Array(64);
  decode4bppTileForTest(back, idx);
  assert(idx[0] === 5, 'off-palette pixel resolved to the NEAREST color (index 5)');
  assert(back.subarray(32).every((v) => v === 0), 'no other tile touched');
  assert(stats.offPalette === 1, 'painted off-palette pixel bumps stats.offPalette');

  // Base-aware: unchanged pixels never count; the repainted one still does.
  const statsBase = { offPalette: 0 };
  imageToGfx(near5, layout, { palette, base: tiles, stats: statsBase });
  assert(statsBase.offPalette === 1, 'base-aware: only the repainted off-palette pixel counts');

  // A transparent pixel is an erase to index 0, not off-palette paint.
  const erased = flat((img) => { img.rgba[3] = 0; });
  const statsTransparent = { offPalette: 0 };
  const backErased = imageToGfx(erased, layout, { palette, stats: statsTransparent });
  assert(backErased.every((v) => v === 0), 'erased pixel → index 0');
  assert(statsTransparent.offPalette === 0, 'transparent pixel not counted');

  // An unedited image counts nothing.
  const statsClean = { offPalette: 0 };
  imageToGfx(viaPng(gfxToImage(tiles, layout, palRgba)), layout, { palette, base: tiles, stats: statsClean });
  assert(statsClean.offPalette === 0, 'unedited image counts zero');
}

console.log('\n=== 2bpp round-trip ===');
{
  const rng = lcg(0x2b);
  const byteLen = 16 * 4 * 16; // 64 tiles × 16B
  const tiles = Uint8Array.from({ length: byteLen }, () => rng() & 0xff);
  const layout = lz2Layout(byteLen, 2);
  const pal = distinctPalette(4, 255);
  const img = gfxToImage(tiles, layout, pal);
  assert(img.palette.length === 4, '2bpp PNG carries a 4-color palette (2-bit depth)');
  const back = imageToGfx(viaPng(img), layout);
  assert(eqBytes(back, tiles), '2bpp exact round-trip (by index)');
  assert(eqBytes(imageToGfx(viaFlatPng(img), layout, { palette: rgbaToRgbInts(pal) }), tiles), '2bpp exact round-trip (flattened, by color)');
}

console.log('\n=== duplicate palette colors: the index still decides ===');
{
  // Two palette slots share a color — a color match is ambiguous, an index isn't.
  const layout = lz16Layout(1);
  const palRgba = distinctPalette(16, 255);
  palRgba.copyWithin(9 * 4, 3 * 4, 4 * 4); // color 9 := color 3
  const tiles = new Uint8Array(512);
  const idx = new Uint8Array(64).fill(9); // whole tile 0 painted with the DUPLICATE slot
  encode4bppTileForTest(idx, tiles);
  const img = gfxToImage(tiles, layout, palRgba);
  assert(eqBytes(imageToGfx(viaPng(img), layout), tiles), 'indexed round-trip keeps the duplicate slot (9, not 3)');
  // Flattened, the color is ambiguous → the LOWEST slot wins, but base-awareness keeps
  // an unedited file byte-exact anyway.
  const flatBase = imageToGfx(viaFlatPng(img), layout, { palette: rgbaToRgbInts(palRgba), base: tiles });
  assert(eqBytes(flatBase, tiles), 'flattened + base-aware round-trip is still byte-exact');
}

console.log('\n=== per-tile sub-palettes: index = sub * colorsPerRow + value ===');
{
  // Two 4-color sub-palettes; tile 1 uses sub 1. Its pixels index into the SECOND block.
  const layout: GfxImageLayout = { tilesWide: 2, tilesTall: 1, bpp: 2 };
  const subA = [0x000000, 0x110000, 0x220000, 0x330000];
  const subB = [0x000000, 0x001100, 0x002200, 0x003300];
  const palRgba = new Uint8Array(8 * 4);
  [...subA, ...subB].forEach((c, i) => {
    palRgba[i * 4] = (c >> 16) & 0xff; palRgba[i * 4 + 1] = (c >> 8) & 0xff; palRgba[i * 4 + 2] = c & 0xff; palRgba[i * 4 + 3] = 255;
  });
  const tiles = new Uint8Array(32);
  const t0 = new Uint8Array(64).fill(2), t1 = new Uint8Array(64).fill(3);
  encode2bppTileForTest(t0, tiles, 0);
  encode2bppTileForTest(t1, tiles, 16);
  const tileSub = (t: number): number => t; // tile 0 → sub 0, tile 1 → sub 1
  const img = gfxToImage(tiles, layout, palRgba, { tileSub });
  assert(img.indices[0] === 2 && img.indices[8] === 4 + 3, 'tile 1 pixels index into its own sub-palette block');
  const opts = { subPalettes: [subA, subB], tileSub };
  assert(eqBytes(imageToGfx(viaPng(img), layout, opts), tiles), 'per-tile round-trip by index');
  assert(eqBytes(imageToGfx(viaFlatPng(img), layout, opts), tiles), 'per-tile round-trip by color');
}

// ── PNG decoder robustness: color types + filters from external editors ─────
const CRC = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Buffer): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const cc = Buffer.alloc(4); cc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, cc]);
}
function buildPng(w: number, h: number, colorType: number, raw: Buffer, plte?: Buffer, depth = 8): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = colorType;
  const chunks = [chunk('IHDR', ihdr)];
  if (plte) chunks.push(chunk('PLTE', plte));
  chunks.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

console.log('\n=== decodePng: truecolor (type 2) with Sub filter ===');
{
  // 4×1 RGB image, scanline filtered with Sub (type 1, bpp=3).
  const px = [10, 20, 30, 40, 55, 70, 100, 110, 120, 5, 5, 5];
  const filt = Buffer.alloc(1 + px.length);
  filt[0] = 1; // Sub
  for (let x = 0; x < px.length; x++) filt[1 + x] = (px[x]! - (x >= 3 ? px[x - 3]! : 0)) & 0xff;
  const img = decodePng(buildPng(4, 1, 2, filt));
  let ok = img.width === 4 && img.height === 1;
  for (let x = 0; x < 4; x++) ok &&= img.rgba[x * 4] === px[x * 3] && img.rgba[x * 4 + 1] === px[x * 3 + 1] && img.rgba[x * 4 + 2] === px[x * 3 + 2] && img.rgba[x * 4 + 3] === 255;
  assert(ok, 'type-2 + Sub filter decodes correctly');
}

console.log('\n=== decodePng: indexed (type 3, 4-bit) with Up filter ===');
{
  // 4×2, 4-bit indexed; PLTE of 3 colors; row1 filtered Up against row0.
  const plte = Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 0]); // idx0 black, idx1 red, idx2 green
  // Each row = 2 bytes (4 px × 4 bit). row0 indices [1,2,0,1] → bytes [0x12,0x01]; row1 [2,1,1,0] → [0x21,0x10].
  const row0 = [0x12, 0x01], row1 = [0x21, 0x10];
  const raw = Buffer.from([0, row0[0]!, row0[1]!, 2, (row1[0]! - row0[0]!) & 0xff, (row1[1]! - row0[1]!) & 0xff]);
  const img = decodePng(buildPng(4, 2, 3, raw, plte, 4));
  // expected pixels (row-major): row0 1,2,0,1 ; row1 2,1,1,0 → RGB from plte.
  const exp = [1, 2, 0, 1, 2, 1, 1, 0];
  let ok = img.width === 4 && img.height === 2;
  for (let i = 0; i < 8; i++) { const c = exp[i]!; ok &&= img.rgba[i * 4] === plte[c * 3] && img.rgba[i * 4 + 1] === plte[c * 3 + 1] && img.rgba[i * 4 + 2] === plte[c * 3 + 2]; }
  assert(ok, 'type-3 4-bit + Up filter decodes correctly');
}

console.log('\n=== encodeIndexedPng: bit depth follows the palette size ===');
{
  const mk = (n: number): Buffer => {
    const palette = new Uint32Array(n).map((_, i) => (0xff000000 | (i * 0x010101)) >>> 0);
    return encodeIndexedPng({ rgba: new Uint8Array(4 * 4 * 4), width: 4, height: 4, indices: new Uint8Array(16), palette });
  };
  const depthOf = (b: Buffer): number => b[8 + 4 + 4 + 8]!; // sig + len + 'IHDR' + IHDR data byte 8
  assert(depthOf(mk(2)) === 1 && depthOf(mk(4)) === 2 && depthOf(mk(16)) === 4 && depthOf(mk(32)) === 8, 'depth = 1/2/4/8 for 2/4/16/32 colors');
  const dec = decodePng(mk(16));
  assert(dec.indices !== undefined && dec.palette !== undefined && dec.palette.length === 16, 'decode returns indices + palette');
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
