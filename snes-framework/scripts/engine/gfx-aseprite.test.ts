// gfx-aseprite round-trip pin (gfx-aseprite.ts) — cart-free. A synthetic gfx file
// (tiles + CGRAM) exports as an indexed tileset `.aseprite`; the flatten reproduces
// the rendered tile grid byte-exact, the slice round-trips to 0 edits, and a 1-px
// edit isolates to one tile. Exercises both transparency modes (opaque + index-0).
//
// Run: node snes-framework/scripts/engine/gfx-aseprite.test.ts

import { gfxFileAseprite, diffGfxFileAseprite } from './gfx-aseprite.ts';
import { decodeAsepriteRegion } from './aseprite.ts';
import { encode4bppTile, decode4bppTile } from './tile.ts';
import { buildPaletteRow } from './color.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

// Synthetic CGRAM: 256 distinct BGR-15 colors.
const cgram = new Uint8Array(512);
for (let i = 0; i < 256; i++) {
  const c15 = ((i * 7) & 0x7fff); // spread across the 15-bit space
  cgram[i * 2] = c15 & 0xff;
  cgram[i * 2 + 1] = (c15 >>> 8) & 0xff;
}

// Build a 4bpp tile blob: 40 tiles, each with a recognisable index pattern. The
// faithful sheet colors every tile in ONE render row (here row 4).
const TILES = 40;
const ROW = 4;
const tileData = new Uint8Array(TILES * 32);
const idx = new Uint8Array(64);
for (let t = 0; t < TILES; t++) {
  for (let i = 0; i < 64; i++) idx[i] = (t + i) % 16; // 0..15 incl. index 0
  encode4bppTile(idx, 0, tileData, t * 32);
}

for (const index0Transparent of [false, true]) {
  const tag = index0Transparent ? 'transp0' : 'opaque0';
  const ase = gfxFileAseprite({ cgram, bpp: 4, tileData, paletteRowPerTile: () => ROW, index0Transparent });
  const dec = decodeAsepriteRegion(ase);
  assert(dec.width === 16 * 8, `[${tag}] grid is 16 tiles wide (${dec.width}px)`);

  // Expected flatten: every tile colored in ROW (index 0 → transparent when
  // index0Transparent, else opaque). Tiles laid out 16-wide.
  const pal = buildPaletteRow(cgram, ROW, index0Transparent, 'expand', 16);
  const exp = new Uint32Array(dec.width * dec.height);
  const didx = new Uint8Array(64);
  for (let t = 0; t < TILES; t++) {
    decode4bppTile(tileData, t * 32, false, false, didx, 0);
    const cx = (t % 16) * 8, cy = Math.floor(t / 16) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const li = didx[y * 8 + x]!;
      if (index0Transparent && li === 0) continue; // transparent
      exp[(cy + y) * dec.width + cx + x] = pal[li]!;
    }
  }
  const got = new Uint32Array(dec.rgba.buffer, dec.rgba.byteOffset, dec.width * dec.height);
  let exact = true;
  for (let i = 0; exact && i < exp.length; i++) if (got[i] !== exp[i]) exact = false;
  assert(exact, `[${tag}] flatten reproduces the tile grid byte-exact`);

  // Slice uses the .aseprite's OWN palette (no cart context). Unedited → 0 edits.
  const clean = diffGfxFileAseprite({ palette: dec.palette, bpp: 4, baseTileData: tileData, flatten: dec.rgba, width: dec.width });
  assert(clean.length === 0, `[${tag}] unedited round-trips to 0 tile edits`);

  // A 1-px edit on tile 5 → that one tile changes.
  const edited = dec.rgba.slice();
  const eu32 = new Uint32Array(edited.buffer, edited.byteOffset, dec.width * dec.height);
  const cx = (5 % 16) * 8, cy = Math.floor(5 / 16) * 8;
  const cur = eu32[cy * dec.width + cx]!;
  for (let i = 1; i < 16; i++) if (pal[i] !== cur) { eu32[cy * dec.width + cx] = pal[i]!; break; }
  const d = diffGfxFileAseprite({ palette: dec.palette, bpp: 4, baseTileData: tileData, flatten: edited, width: dec.width });
  assert(d.length === 1 && d[0]!.tileIndex === 5 && d[0]!.bytes.length === 32,
    `[${tag}] 1-px edit isolates to tile 5 (32 B)`);
}

console.log(`\n${failures === 0 ? '✓ all gfx-aseprite pins pass' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
