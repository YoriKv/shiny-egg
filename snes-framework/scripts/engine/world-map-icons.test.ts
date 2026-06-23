// World-map level-slot icon round-trip pin (screen-gfx.ts world-map-icons) — the
// overworld twin of object-metatile.test.ts.
//
//   1. Export yields 12 FAITHFUL icons (6 worlds × {marker, castle}).
//   2. Each faithful icon ROUND-TRIPS: slicing the UNEDITED canvas reproduces the
//      base map tiles (diff → 0 edits, 0 conflicts).
//   3. A single-pixel edit ISOLATES to one map tile, in the $74 / $75 BG files.
//   4. Tile pixels are WORLD-INVARIANT: a given icon cell maps to the SAME
//      (file, fileTile) in every world (only the tint palette differs).
//
// Run: node snes-framework/scripts/engine/world-map-icons.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import {
  exportWorldMapIcons, buildWorldMapIconContext, renderWorldMapIcon, diffWorldMapIconTiles, worldMapIconAseprite
} from './screen-gfx.ts';
import { decodeAsepriteImage } from './aseprite.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message); process.exit(2);
}
const { rom, symbols } = cart;

// 1. Export → 12 faithful icons.
const icons = exportWorldMapIcons(rom, symbols);
assert(icons.length === 12, `exports 12 icons (6 worlds × 2 shapes), got ${icons.length}`);
assert(icons.every((i) => i.faithful), `all icons faithful (${icons.filter((i) => i.faithful).length}/12)`);
assert(icons.every((i) => i.width === 24 && i.height === 24), 'every icon canvas is 24×24');

// 2. Round-trip + 3. 1-px isolation, per world × name.
let rtFail = 0;
const NAMES = ['marker', 'castle'] as const;
for (let world = 0; world < 6; world++) {
  const ctx = buildWorldMapIconContext(rom, symbols, world);
  for (const name of NAMES) {
    const canvas = renderWorldMapIcon(ctx, name);
    if (!canvas) { rtFail++; continue; }
    const rt = diffWorldMapIconTiles(ctx, canvas, canvas.rgba);
    if (rt.edits.length !== 0 || rt.conflicts !== 0) rtFail++;
  }
}
assert(rtFail === 0, `unedited round-trip → 0 edits across all 12 icons (${rtFail} failed)`);

// 3. single-pixel edit → exactly one tile changes, in a $74/$75 file.
{
  const ctx = buildWorldMapIconContext(rom, symbols, 0);
  const canvas = renderWorldMapIcon(ctx, 'marker')!;
  const edited = canvas.rgba.slice();
  const u32 = new Uint32Array(edited.buffer, edited.byteOffset, canvas.width * canvas.height);
  // center cell (1,1), pixel (2,2) within it → canvas (10,10)
  const idx = 10 * canvas.width + 10;
  u32[idx] = u32[idx] ^ 0x00ffffff; // perturb RGB → off-palette → remaps to some index
  const { edits } = diffWorldMapIconTiles(ctx, canvas, edited);
  assert(edits.length === 1, `1-px edit isolates to a single tile (got ${edits.length})`);
  assert(edits.every((e) => e.fileId === 0x74 || e.fileId === 0x75), `edit targets the $74/$75 BG files (got ${edits.map((e) => '0x' + e.fileId.toString(16)).join(',')})`);
}

// 4. world-invariance: cell→(file,fileTile) identical across worlds for the marker.
{
  const c0 = renderWorldMapIcon(buildWorldMapIconContext(rom, symbols, 0), 'marker')!;
  const c3 = renderWorldMapIcon(buildWorldMapIconContext(rom, symbols, 3), 'marker')!;
  const key = (u: { fileId: number; fileTile: number } | null): string => (u ? `${u.fileId}/${u.fileTile}` : 'null');
  const same = c0.units.every((u, i) => key(u) === key(c3.units[i] ?? null));
  assert(same, 'marker cells map to the same (file,tile) in worlds 0 and 3 (pixels are world-invariant)');
  // and the tint row genuinely differs (world 0 → row 3, world 3 → row 0)
  assert(c0.paletteRowsUsed[0] !== c3.paletteRowsUsed[0], `tint row differs per world (w0 row ${c0.paletteRowsUsed[0]} ≠ w3 row ${c3.paletteRowsUsed[0]})`);
}

// 5. Single-image `.aseprite` round-trip (no tilemap): the assembled icon as an indexed
//    image + its used-row palette flattens back to the canvas byte-exact → the existing
//    slicer reports 0 edits; a 1-px edit isolates to one tile (same path as the PNG).
{
  const ctx = buildWorldMapIconContext(rom, symbols, 0);
  const canvas = renderWorldMapIcon(ctx, 'marker')!;
  const dec = decodeAsepriteImage(worldMapIconAseprite(ctx, canvas));
  assert(dec.width === 24 && dec.height === 24, `icon .aseprite is 24×24 (got ${dec.width}×${dec.height})`);
  const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  assert(eq(dec.rgba, canvas.rgba), 'icon .aseprite flatten reproduces the assembled icon byte-exact');
  assert(diffWorldMapIconTiles(ctx, canvas, dec.rgba).edits.length === 0, 'icon .aseprite round-trips to 0 tile edits');
  const edited = dec.rgba.slice();
  const u32 = new Uint32Array(edited.buffer, edited.byteOffset, 24 * 24);
  const i = 10 * 24 + 10; u32[i] = u32[i]! ^ 0x00ffffff;
  assert(diffWorldMapIconTiles(ctx, canvas, edited).edits.length === 1, 'icon .aseprite 1-px edit isolates to a single tile');
}

console.log(failures === 0 ? '\nAll world-map-icon checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
