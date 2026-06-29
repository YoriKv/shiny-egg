// Per-tile palette fidelity (BG2 + BG3) on a REAL multi-row level (0x02 — its BG3
// sheet uses several 4-color sub-palettes and its BG2 sheet uses rows 6+7). Pins:
//   1. every BG2/BG3 file's unedited per-tile round-trip is BYTE-EXACT,
//   2. BG3 uses >1 sub-palette AND BG2 uses >1 row (the per-tile path is exercised,
//      i.e. the tilemap walk actually ran — guards the loadBg2/3Tilemap wiring),
//   3. a 1-pixel edit decodes to the right index and changes ONLY that tile,
//      for both a 2bpp (BG3) and a 4bpp (BG2) file.
//
// Run: node snes-framework/scripts/engine/gfx-bgtile-palette.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel } from '../level.ts';
import { exportLevelGfxPngs, type GfxPngEntry } from './render-gfx-files.ts';
import { decodePng } from './png.ts';
import { imageToGfx, lz16Layout, lz2Layout, type GfxImageLayout } from './gfx-png.ts';
import { decode2bppTile, decode4bppTile, encode2bppTile, encode4bppTile } from './tile.ts';
import { lz2, lz16 } from './decompress/index.ts';
import { snesToPC } from './symbol-map.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } else console.log(`  ✓ ${m}`); };
const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

type FidEntry = GfxPngEntry & { perTilePalette: NonNullable<GfxPngEntry['perTilePalette']> };
const layoutOf = (e: GfxPngEntry): GfxImageLayout => e.format === 'lz16' ? lz16Layout(e.rowCount!) : lz2Layout(e.sizeBytes, e.bpp);
const baseOf = (rom: Uint8Array, e: GfxPngEntry): Uint8Array => {
  const out = new Uint8Array(e.sizeBytes);
  if (e.format === 'lz16') lz16(rom, snesToPC(e.addr), out, 0, e.rowCount!); else lz2(rom, snesToPC(e.addr), out, 0);
  return out;
};
const palOf = (e: FidEntry) => (t: number): readonly number[] =>
  e.perTilePalette.subPalettes[e.perTilePalette.tileSub[t] ?? 0] ?? e.perTilePalette.subPalettes[0]!;

const { rom, symbols } = loadDevCart();
const h = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: 0x02 }).header;
const header = {
  bgColor: h[0] ?? 0, bg1Tileset: h[1] ?? 0, bg1Palette: h[2] ?? 0, bg2Tileset: h[3] ?? 0,
  bg2Palette: h[4] ?? 0, bg3Tileset: h[5] ?? 0, bg3Palette: h[6] ?? 0, spriteTileset: h[7] ?? 0,
  spritePalette: h[8] ?? 0, yoshiColor: 0, isWorld6: false,
  levelMode: h[9] ?? 0, animationTileset: h[10] ?? 0, animationPalette: h[11] ?? 0
};

const entries = exportLevelGfxPngs(rom, symbols, header as Parameters<typeof exportLevelGfxPngs>[2]);
const bg3 = entries.filter((e): e is FidEntry => !!e.perTilePalette && e.role.category === 'bg3');
const bg2 = entries.filter((e): e is FidEntry => !!e.perTilePalette && e.role.category === 'bg2');
assert(bg3.length > 0, `level 0x02 exports BG3 file(s) with per-tile palette (${bg3.length})`);
assert(bg2.length > 0, `level 0x02 exports BG2 file(s) with per-tile palette (${bg2.length})`);
assert(bg3.some((e) => new Set(e.perTilePalette.tileSub).size > 1), 'a BG3 file uses >1 sub-palette');
// BG2 multi-row guards the loadBg2Tilemap wiring (a swallowed error → all base row).
assert(bg2.some((e) => new Set(e.perTilePalette.tileSub).size > 1), 'a BG2 file uses >1 palette row (tilemap walk ran)');

// (1) unedited per-tile round-trip byte-exact for every BG2/BG3 file.
let exact = 0;
const all = [...bg3, ...bg2];
for (const e of all) {
  const img = decodePng(Buffer.from(e.png));
  const base = baseOf(rom, e);
  const round = imageToGfx(img, layoutOf(e), { base, index0Transparent: true, tilePalette: palOf(e) }).subarray(0, e.sizeBytes);
  if (eq(round, base)) exact++;
  else assert(false, `${e.role.category} 0x${e.addr.toString(16)} unedited per-tile round-trip byte-exact`);
}
assert(exact === all.length, `all ${all.length} BG2/BG3 files round-trip byte-exact`);

// (3) 1-pixel edit on tile 0: change pixel (0,0) to another color of ITS row →
// that tile's bytes change to the right index, others untouched. Run for a 2bpp
// (BG3) and a 4bpp (BG2) file.
function pixelEditCheck(e: FidEntry, label: string): void {
  const tileBytes = e.bpp === 4 ? 32 : 16;
  const N = e.bpp === 4 ? 16 : 4;
  const decode = e.bpp === 4 ? decode4bppTile : decode2bppTile;
  const encode = e.bpp === 4 ? encode4bppTile : encode2bppTile;
  const base = baseOf(rom, e);
  const pal = e.perTilePalette.subPalettes[e.perTilePalette.tileSub[0] ?? 0]!;
  const idx0 = new Uint8Array(64);
  decode(base, 0, false, false, idx0, 0);
  const bi = idx0[0]!;
  let k = -1;
  for (let cand = 0; cand < N; cand++) {
    if (cand === bi) continue;
    if (pal.filter((c) => c === pal[cand]).length === 1) { k = cand; break; }
  }
  if (k < 0) { console.log(`  (skipped ${label} 1-pixel edit: tile 0 row has no unique alternate color)`); return; }
  const img = decodePng(Buffer.from(e.png));
  const col = pal[k]!;
  img.rgba[0] = (col >> 16) & 0xff; img.rgba[1] = (col >> 8) & 0xff; img.rgba[2] = col & 0xff; img.rgba[3] = k === 0 ? 0 : 255;
  const round = imageToGfx(img, layoutOf(e), { base, index0Transparent: true, tilePalette: palOf(e) }).subarray(0, e.sizeBytes);
  const exp = new Uint8Array(tileBytes);
  const ei = idx0.slice(); ei[0] = k;
  encode(ei, 0, exp, 0);
  assert(eq(round.subarray(0, tileBytes), exp), `${label} 1-pixel edit: tile 0 byte = expected (index ${bi}→${k})`);
  assert(eq(round.subarray(tileBytes), base.subarray(tileBytes)), `${label} 1-pixel edit: every other tile byte-identical`);
}
pixelEditCheck(bg3[0]!, 'BG3 (2bpp)');
pixelEditCheck(bg2.find((e) => new Set(e.perTilePalette.tileSub).size > 1) ?? bg2[0]!, 'BG2 (4bpp)');

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
