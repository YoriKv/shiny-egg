// Real-data smoke test: exportLevelGfxPngs against the dev cart. Catches palette
// byte-order / layout / rowCount / truncation bugs the synthetic gfx-png test
// can't. For every exported gfx file: the PNG is INDEXED, decodes at the bare
// tile-grid size, and the round-trip (PNG → tile bytes) is BYTE-EXACT vs the base
// blob — by index, so even a palette with duplicate colors round-trips exactly.
//
// Run: node --experimental-strip-types snes-framework/scripts/engine/gfx-png-export.test.ts

import { loadDevCart } from './dev-cart.ts';
import { exportLevelGfxPngs } from './render-gfx-files.ts';
import { decodePng } from './png.ts';
import { imageToGfx, lz16Layout, lz2Layout, type GfxImageLayout } from './gfx-png.ts';
import { lz2, lz16 } from './decompress/index.ts';
import { snesToPC } from './symbol-map.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } };

const { rom, symbols } = loadDevCart();
// A plain level header (gfx + palette). Exact tilesets don't matter — any real
// scene exercises the enumeration, palettes, and both lz formats.
const header = {
  bg1Tileset: 1, bg2Tileset: 0, bg3Tileset: 0, spriteTileset: 0, animationTileset: 0,
  isWorld6: false, levelMode: 0,
  bgColor: 0, bg1Palette: 0, bg2Palette: 0, bg3Palette: 0, spritePalette: 0, yoshiColor: 0
};

const entries = exportLevelGfxPngs(rom, symbols, header as Parameters<typeof exportLevelGfxPngs>[2]);
console.log(`exported ${entries.length} gfx files`);
assert(entries.length > 0, 'produced at least one gfx PNG');

const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
let exact = 0;
for (const e of entries) {
  const layout: GfxImageLayout = e.format === 'lz16' ? lz16Layout(e.rowCount!) : lz2Layout(e.sizeBytes, e.bpp);
  let img;
  try { img = decodePng(Buffer.from(e.png)); } catch (err) { assert(false, `0x${e.addr.toString(16)}: decode threw ${err}`); continue; }
  assert(img.width === layout.tilesWide * 8, `0x${e.addr.toString(16)}: PNG width = bare tile grid (no swatch)`);
  assert(img.indices !== undefined, `0x${e.addr.toString(16)}: PNG is color-indexed (palette in the file)`);

  const base = new Uint8Array(e.sizeBytes);
  const srcPC = snesToPC(e.addr);
  if (e.format === 'lz16') lz16(rom, srcPC, base, 0, e.rowCount!);
  else lz2(rom, srcPC, base, 0);

  // Base-aware import: an UNEDITED file must round-trip BYTE-EXACT even when its
  // palette has duplicate colors (this is what keeps the build byte-identical).
  // BG2/BG3 decode each tile against its own palette row (per-tile fidelity).
  const round = imageToGfx(img, layout, {
    base,
    index0Transparent: e.index0Transparent,
    palette: e.palette,
    subPalettes: e.perTilePalette?.subPalettes,
    tileSub: e.perTilePalette ? (t: number): number => e.perTilePalette!.tileSub[t] ?? 0 : undefined
  }).subarray(0, e.sizeBytes);
  if (eq(round, base)) exact++;
  else assert(false, `0x${e.addr.toString(16)} (${e.format}): base-aware unedited round-trip not byte-exact`);
}
console.log(`  base-aware unedited round-trips: ${exact}/${entries.length} byte-exact`);
assert(exact === entries.length, 'every unedited file round-trips byte-exact (base-aware)');

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
