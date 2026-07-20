// Real-data test: the YY-CHR export pieces against the dev cart. Pins that
// `collectLevelGfxInfo` (the PNG-free walk the whole-cart YY-CHR export uses)
// agrees with the pinned `exportLevelGfxPngs` walk on every file's identity /
// depth / size / per-tile palette assignment, and that the pad → strip round-trip
// is byte-exact on real (non-bank-multiple) blob sizes with real sidecars built.
// Skips cleanly when the V1.0 build artifacts are absent.
//
// Run: node snes-framework/scripts/engine/gfx-yychr-cart.test.ts

import { loadDevCart, type DevCart } from './dev-cart.ts';
import { exportLevelGfxPngs, collectLevelGfxInfo } from './render-gfx-files.ts';
import { padToYychrBank, stripYychrPad, buildPalFromRgbRows, buildPalFromCgram, buildColSidecar, chunkyToPlanar, planarToChunky, yychrBankBytes } from './gfx-yychr.ts';
import { lz2, lz16 } from './decompress/index.ts';
import { snesToPC } from './symbol-map.ts';

let cart: DevCart;
try {
  cart = loadDevCart();
} catch (e) {
  console.log(`SKIP: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  process.exit(0);
}
const { rom, symbols } = cart;

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } };
const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

// The same plain header the gfx-png-export test uses — any real scene exercises
// the enumeration, palettes, and both lz formats.
const header = {
  bg1Tileset: 1, bg2Tileset: 0, bg3Tileset: 0, spriteTileset: 0, animationTileset: 0,
  isWorld6: false, levelMode: 0,
  bgColor: 0, bg1Palette: 0, bg2Palette: 0, bg3Palette: 0, spritePalette: 0, yoshiColor: 0
} as Parameters<typeof collectLevelGfxInfo>[2];

console.log('=== collectLevelGfxInfo agrees with exportLevelGfxPngs ===');
const pngEntries = exportLevelGfxPngs(rom, symbols, header);
const { entries, cgram } = collectLevelGfxInfo(rom, symbols, header);
assert(entries.length === pngEntries.length, `same file count (${entries.length} vs ${pngEntries.length})`);
for (const p of pngEntries) {
  const c = entries.find((e) => e.format === p.format && e.fileId === p.fileId);
  if (!c) { assert(false, `${p.format}/0x${p.fileId.toString(16)}: missing from collect`); continue; }
  assert(c.bpp === p.bpp, `${p.format}/0x${p.fileId.toString(16)}: bpp ${c.bpp} == ${p.bpp}`);
  assert(c.sizeBytes === p.sizeBytes, `${p.format}/0x${p.fileId.toString(16)}: sizeBytes match`);
  assert(c.rowCount === p.rowCount, `${p.format}/0x${p.fileId.toString(16)}: rowCount match`);
  assert(!!c.perTile === !!p.perTilePalette, `${p.format}/0x${p.fileId.toString(16)}: perTile presence match`);
  if (c.perTile && p.perTilePalette) {
    assert(
      c.perTile.tileSub.length === p.perTilePalette.tileSub.length &&
        c.perTile.tileSub.every((v, i) => v === p.perTilePalette!.tileSub[i]),
      `${p.format}/0x${p.fileId.toString(16)}: tileSub assignment matches`
    );
    assert(
      JSON.stringify(c.perTile.subPalettesRgb) === JSON.stringify(p.perTilePalette.subPalettes),
      `${p.format}/0x${p.fileId.toString(16)}: sub-palette colors match`
    );
  }
}
console.log(`  ${entries.length} files cross-checked`);

console.log('\n=== pad → strip round-trip + sidecars on real blobs ===');
const lz2Table = symbols.pc('DATA_lz2_compressed_gfx_ptrs');
const lz16Table = symbols.pc('DATA_lz16_compressed_gfx_ptrs');
let exact = 0, subBank = 0;
for (const e of entries) {
  const p = (e.format === 'lz16' ? lz16Table : lz2Table) + e.fileId * 3;
  const srcPC = snesToPC(rom[p]! | (rom[p + 1]! << 8) | (rom[p + 2]! << 16));
  const tiles = new Uint8Array(e.sizeBytes);
  if (e.format === 'lz16') lz16(rom, srcPC, tiles, 0, e.rowCount!);
  else lz2(rom, srcPC, tiles, 0);

  const padded = padToYychrBank(tiles, e.bpp);
  assert(padded.length % yychrBankBytes(e.bpp) === 0, `0x${e.fileId.toString(16)}: padded to whole banks`);
  assert(padded.length % 2048 === 0, `0x${e.fileId.toString(16)}: no copier-header misdetect`);
  if (padded.length !== tiles.length) subBank++;
  const { bytes, padEdited } = stripYychrPad(padded, e.sizeBytes);
  assert(!padEdited, `0x${e.fileId.toString(16)}: clean pad`);
  if (eq(bytes, tiles)) exact++;
  else assert(false, `${e.format}/0x${e.fileId.toString(16)}: pad/strip round-trip not byte-exact`);

  // The .pal ships as raw CGRAM order (2026-07-19 scheme); .col bytes are the
  // tiles' REAL CGRAM groups (perTile.rows maps sub index → group).
  const pal = buildPalFromCgram(cgram, 0);
  assert(pal.length === 512, `0x${e.fileId.toString(16)}: .pal is 512 bytes`);
  assert(pal.every((_, i) => i % 2 === 0 || (pal[i]! & 0x80) === 0), `0x${e.fileId.toString(16)}: .pal bit 15 clear everywhere`);
  if (e.perTile) {
    const groups = e.perTile.tileSub.map((s) => e.perTile!.rows[s] ?? 0);
    const col = buildColSidecar(groups, e.bpp, padded.length);
    assert(col.length === 256 + padded.length / 16, `0x${e.fileId.toString(16)}: .col sized to header + padded/16`);
    const tileBytes = e.bpp === 2 ? 16 : 32;
    const bank = yychrBankBytes(e.bpp);
    for (let t = 0; t < e.perTile.tileSub.length; t++) {
      const off = t * tileBytes;
      const got = col[256 + (Math.floor(off / bank) * bank) / 16 + (off % bank) / tileBytes]!;
      if (got !== groups[t]) {
        assert(false, `0x${e.fileId.toString(16)}: .col byte for tile ${t} = its CGRAM group`);
        break;
      }
    }
  }
}
console.log(`  ${exact}/${entries.length} byte-exact pad/strip round-trips (${subBank} sub-bank files exercised padding)`);
assert(exact === entries.length, 'every blob round-trips byte-exact');
assert(subBank > 0, 'at least one real file exercised the pad path');

console.log('\n=== chunky ↔ planar bijective on the real GSU banks ===');
{
  // The gsu/ export's round-trip guarantee: transform → inverse is byte-exact on
  // every real bank (the forward direction is additionally pinned against
  // FuSoYa's AllGFX.bin output — ycompress-allgfx.md §3 / tmp/ycompress-verify.ts).
  const banks: [number, number][] = [
    [0x530000, 0x8000], [0x538000, 0x4000], [0x540000, 0x8000], [0x548000, 0x8000],
    [0x550000, 0x8000], [0x558000, 0x8000], [0x560000, 0x8000],
    // $57:0000 — GSU-only bitmap data bank (added to the gsu/ export 2026-07-18;
    // not the GSU program, and byte-disproven as a flip of $56 — see
    // research/graphics-survey/11-vram-loading.md §4).
    [0x570000, 0x3c00]
  ];
  let ok = 0;
  for (const [snes, size] of banks) {
    const pc = snesToPC(snes);
    const chunky = rom.slice(pc, pc + size);
    const planar = chunkyToPlanar(chunky);
    if (planar.length === chunky.length && eq(planarToChunky(planar), chunky)) ok++;
    else assert(false, `$${snes.toString(16)}: chunky→planar→chunky not byte-exact`);
  }
  console.log(`  ${ok}/${banks.length} banks round-trip byte-exact`);
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
if (failures > 0) process.exit(1);
