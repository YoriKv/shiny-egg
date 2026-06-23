// Aseprite tilemap codec round-trip pin (aseprite.ts) — cart-independent.
// Encode a synthetic indexed tilemap, decode (flatten) it, and verify the RGBA is
// reproduced exactly: per-cell tile pixels via the palette, H/V flips honoured,
// the empty tile (id 0) and the transparent index rendered transparent.
//
// This is the invariant the BG region import relies on: flatten(encode(x)) is a
// pixel-exact inverse, so the existing base-aware slicers consume it unchanged.
//
// Run: node snes-framework/scripts/engine/aseprite.test.ts

import { encodeAseprite, decodeAsepriteRegion, type AsepriteCell } from './aseprite.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

const TW = 8, TH = 8;
const TRANSPARENT = 200;

// Distinct opaque palette colours (entry i is reproducible from its index).
const palette = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  palette[i] = (((0xff) << 24) | (((i * 7) & 0xff) << 16) | (((i * 13) & 0xff) << 8) | ((i * 3) & 0xff)) >>> 0;
}

// Three tileset tiles: 0 = empty, 1 = constant-ish, 2 = positional (incl. an index
// 0 pixel — opaque here since TRANSPARENT≠0 — and a TRANSPARENT pixel).
const empty = new Uint8Array(TW * TH);
const tileA = new Uint8Array(TW * TH);
const tileB = new Uint8Array(TW * TH);
for (let y = 0; y < TH; y++) {
  for (let x = 0; x < TW; x++) {
    tileA[y * TW + x] = ((x + y) % 7) + 1;       // 1..7
    tileB[y * TW + x] = (y * TW + x) % 190;      // 0..189 (incl. 0)
  }
}
tileB[3] = TRANSPARENT; // a transparent pixel inside an otherwise-opaque tile
const tiles = [empty, tileA, tileB];

// 2×2 grid exercising empty / plain / hflip / vflip.
const cells: AsepriteCell[] = [
  { tile: 0 },                          // (0,0) empty
  { tile: 1 },                          // (1,0) A
  { tile: 2, hflip: true },             // (0,1) B mirrored x
  { tile: 1, vflip: true }              // (1,1) A mirrored y
];

const bytes = encodeAseprite({
  tileW: TW, tileH: TH, tilesAcross: 2, tilesDown: 2,
  tiles, cells, palette, transparentIndex: TRANSPARENT, layerName: 'T', tilesetName: 'ts'
});
assert(bytes.length > 128 + 16, `encoded ${bytes.length} bytes`);

const dec = decodeAsepriteRegion(bytes);
assert(dec.width === 16 && dec.height === 16, `decoded dims ${dec.width}×${dec.height}`);
const got = new Uint32Array(dec.rgba.buffer, dec.rgba.byteOffset, dec.width * dec.height);

// Build the expected RGBA the same way the renderer would.
const expected = new Uint32Array(16 * 16);
const blit = (tx: number, ty: number, c: AsepriteCell): void => {
  if (c.tile === 0) return; // empty → transparent (left 0)
  const tile = tiles[c.tile]!;
  for (let py = 0; py < TH; py++) {
    for (let px = 0; px < TW; px++) {
      const sx = c.hflip ? TW - 1 - px : px;
      const sy = c.vflip ? TH - 1 - py : py;
      const idx = tile[sy * TW + sx]!;
      if (idx === TRANSPARENT) continue;
      expected[(ty * TH + py) * 16 + (tx * TW + px)] = palette[idx]!;
    }
  }
};
blit(0, 0, cells[0]!); blit(1, 0, cells[1]!); blit(0, 1, cells[2]!); blit(1, 1, cells[3]!);

let exact = true;
for (let i = 0; i < expected.length; i++) if (got[i] !== expected[i]) { exact = false; break; }
assert(exact, 'flatten reproduces the expected RGBA exactly (tiles, flips, empty, transparent)');

// Spot checks the eye can follow.
assert(got[0] === 0, 'empty cell (0,0) top-left is transparent');
assert(got[8] === palette[tileA[0]!], 'cell (1,0) top-left = tileA[0]');
// (0,1) is tileB mirrored in x → its row-0 col-0 source is tileB[7].
assert(got[8 * 16] === (tileB[7] === TRANSPARENT ? 0 : palette[tileB[7]!]), 'cell (0,1) hflip maps col0→col7');

// Old palette chunk (0x0004) read path. Aseprite writes 0x0004 (not 0x2019) for
// some palettes on save, so import must read it — verified against real Aseprite,
// pinned here cart-free by rewriting our 0x2019 as an equivalent 0x0004.
function rewritePaletteAsOld(file: Uint8Array): Uint8Array {
  const b = Buffer.from(file);
  let p = 128 + 16, palStart = -1, palSize = -1;
  const nchunks = b.readUInt32LE(128 + 12);
  for (let i = 0; i < nchunks; i++) {
    const size = b.readUInt32LE(p);
    if (b.readUInt16LE(p + 4) === 0x2019) { palStart = p; palSize = size; break; }
    p += size;
  }
  if (palStart < 0) throw new Error('no 0x2019 to rewrite');
  const data = Buffer.alloc(2 + 2 + 256 * 3); // WORD packets=1, BYTE skip=0, BYTE count=0(=256), RGB×256
  data.writeUInt16LE(1, 0);
  for (let i = 0; i < 256; i++) {
    const v = palette[i] ?? 0, o = 4 + i * 3;
    data[o] = v & 0xff; data[o + 1] = (v >>> 8) & 0xff; data[o + 2] = (v >>> 16) & 0xff;
  }
  const head = Buffer.alloc(6);
  head.writeUInt32LE(data.length + 6, 0); head.writeUInt16LE(0x0004, 4);
  const chunk = Buffer.concat([head, data]);
  const out = Buffer.concat([b.subarray(0, palStart), chunk, b.subarray(palStart + palSize)]);
  out.writeUInt32LE(out.length, 0);                                    // file size
  out.writeUInt32LE(b.readUInt32LE(128) + (chunk.length - palSize), 128); // frame bytes
  return new Uint8Array(out);
}
const decOld = decodeAsepriteRegion(rewritePaletteAsOld(bytes));
const gotOld = new Uint32Array(decOld.rgba.buffer, decOld.rgba.byteOffset, decOld.width * decOld.height);
let oldExact = decOld.width === 16 && decOld.height === 16;
for (let i = 0; oldExact && i < expected.length; i++) if (gotOld[i] !== expected[i]) oldExact = false;
assert(oldExact, 'decodes an equivalent 0x0004 (old FLI_COLOR) palette chunk identically');

console.log(`\n${failures === 0 ? '✓ all aseprite codec pins pass' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
