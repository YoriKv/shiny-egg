// World-map BG per-tile palette pin (screen-gfx.ts flat-overworld export).
//
//   1. The flat-map BG files f74/f75 export with a PER-TILE palette (rows 0/3/6/7
//      via the verified char→row table), NOT a single per-world tint.
//   2. The fold/Mode-7-only files f7C/f7D/f4C (loaded but never referenced by the
//      flat BG1 tilemap) are EXCLUDED from the export.
//   3. Every per-tile map BG file ROUND-TRIPS byte-exact through the perTilePalette
//      import path (unedited → 0 changes).
//
// Run: node snes-framework/scripts/engine/world-map-bg.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { exportScreenGfxPngs } from './screen-gfx.ts';
import { decodePng } from './png.ts';
import { imageToGfx, lz16Layout, lz2Layout } from './gfx-png.ts';
import { lz2, lz16 } from './decompress/index.ts';
import { snesToPC } from './symbol-map.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message); process.exit(2);
}
const { rom, symbols } = cart;

function decodeBase(format: 'lz2' | 'lz16', fileId: number, sizeBytes: number, rowCount?: number): Uint8Array {
  const t = symbols.pc(format === 'lz16' ? 'DATA_lz16_compressed_gfx_ptrs' : 'DATA_lz2_compressed_gfx_ptrs') + fileId * 3;
  const src = snesToPC(rom[t]! | (rom[t + 1]! << 8) | (rom[t + 2]! << 16));
  const out = new Uint8Array(sizeBytes);
  if (format === 'lz16') lz16(rom, src, out, 0, rowCount!); else lz2(rom, src, out, 0);
  return out;
}

const map = exportScreenGfxPngs(rom, symbols).filter((s) => s.file.includes('/map/'));
const has = (id: string): boolean => map.some((s) => new RegExp(`f${id}\\.png$`, 'i').test(s.file));

// 2. fold-only files excluded.
assert(!has('7C') && !has('7D') && !has('4C'), 'f7C / f7D / f4C excluded (fold/Mode-7-only, never referenced by the flat map)');

// 1. f74/f75 per-tile.
const f74 = map.find((s) => /f74\.png$/i.test(s.file));
const f75 = map.find((s) => /f75\.png$/i.test(s.file));
assert(!!f74?.perTilePalette, 'f74 exports with a per-tile palette');
assert(!!f75?.perTilePalette, 'f75 exports with a per-tile palette');
assert((f74?.perTilePalette?.subPalettes.length ?? 0) >= 2, `f74 exposes multiple palette rows (got ${f74?.perTilePalette?.subPalettes.length})`);
// the BG terrain files are opaque (BG1 index 0 is a real colour), not sprite-transparent.
assert(f74?.index0Transparent === false, 'f74 renders BG index 0 opaque');

// 3. per-tile round-trip byte-exact.
let rtFail = 0, rtCount = 0;
for (const s of map) {
  if (!s.perTilePalette) continue;
  rtCount++;
  const base = decodeBase(s.format, s.fileId, s.sizeBytes, s.rowCount);
  const img = decodePng(Buffer.from(s.png));
  const layout = s.format === 'lz16' ? lz16Layout(s.rowCount!) : lz2Layout(s.sizeBytes, s.bpp);
  const ptp = s.perTilePalette;
  const tilePalette = (t: number): readonly number[] => ptp.subPalettes[ptp.tileSub[t] ?? 0] ?? ptp.subPalettes[0]!;
  const tiles = imageToGfx(img, layout, { base, index0Transparent: s.index0Transparent, tilePalette }).subarray(0, s.sizeBytes);
  if (!(tiles.length === base.length && tiles.every((v, i) => v === base[i]))) { rtFail++; console.error(`    mismatch: ${s.file}`); }
}
assert(rtCount >= 2 && rtFail === 0, `per-tile map BG round-trips byte-exact (${rtCount} files, ${rtFail} failed)`);

console.log(failures === 0 ? '\nAll world-map BG pins passed.' : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
