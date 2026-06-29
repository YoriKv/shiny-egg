// Unit test: graphics ⇄ PNG round-trip + PNG decoder robustness.
// Run: node --experimental-strip-types snes-framework/scripts/engine/gfx-png.test.ts

import * as zlib from 'node:zlib';
import { decodePng, encodePng, type ImageData } from './png.ts';
import { gfxToImage, imageToGfx, lz16Layout, lz2Layout } from './gfx-png.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
const eqBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
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

// Round-trip through the real PNG codec (encode → decode).
function viaPng(img: ImageData): ImageData {
  return decodePng(encodePng(img));
}

console.log('=== lz16 round-trip (tiles → image → PNG → image → tiles) ===');
{
  const rng = lcg(0xc0de);
  for (const rc of [1, 2, 3, 4]) {
    const tiles = Uint8Array.from({ length: rc * 512 }, () => rng() & 0xff);
    const layout = lz16Layout(rc);
    const img = gfxToImage(tiles, layout, distinctPalette(16, 255));
    assert(img.width === 16 * 8 + 2 + 8, `rc=${rc} width = grid + gap + swatch`);
    const back = imageToGfx(viaPng(img), layout);
    assert(eqBytes(back, tiles), `rc=${rc} exact round-trip through PNG`);
  }
}

console.log('\n=== index 0 transparent stays index 0 ===');
{
  const rng = lcg(0x7);
  const tiles = Uint8Array.from({ length: 2 * 512 }, () => rng() & 0xff);
  const layout = lz16Layout(2);
  const img = gfxToImage(tiles, layout, distinctPalette(16, 0)); // index 0 transparent
  const back = imageToGfx(viaPng(img), layout);
  assert(eqBytes(back, tiles), 'transparent-index-0 round-trip exact');
}

console.log('\n=== off-palette pixel → index 0 ===');
{
  const layout = lz16Layout(1);
  const tiles = new Uint8Array(512); // all index 0
  const pal = distinctPalette(16, 255);
  const img = gfxToImage(tiles, layout, pal);
  // Paint pixel (0,0) an off-palette color.
  img.rgba[0] = 1; img.rgba[1] = 2; img.rgba[2] = 3; img.rgba[3] = 255;
  const back = imageToGfx(img, layout);
  const idxOut = new Uint8Array(64);
  // decode tile 0 pixel (0,0): all-zero tile bytes → index 0 everywhere.
  assert(back.every((v) => v === 0), 'off-palette pixel mapped to index 0 (tile stays all-0)');
}

console.log('\n=== 2bpp round-trip ===');
{
  const rng = lcg(0x2b);
  const byteLen = 16 * 4 * 16; // 64 tiles × 16B
  const tiles = Uint8Array.from({ length: byteLen }, () => rng() & 0xff);
  const layout = lz2Layout(byteLen, 2);
  const img = gfxToImage(tiles, layout, distinctPalette(4, 255));
  const back = imageToGfx(viaPng(img), layout);
  assert(eqBytes(back, tiles), '2bpp exact round-trip');
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

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
