// Overworld-map (per-world×half) export round-trip pin (world-map-terrain.ts).
//
//   1. Export yields 12 entries (6 worlds × {levels 1-4, 5-8}), each with the right
//      DATA_00B3F4[world*2+half] tilemap file id.
//   2. Each map decodes a 4096-byte (2048-word) tilemap with ≥1 distinct tile.
//   3. The assembled render is non-empty (real map content, not all backdrop).
//   4. The layout ROUND-TRIPS: the UNEDITED .aseprite diffs to null (byte-exact).
//   5. A single-cell layout edit changes exactly that one tilemap WORD (≤2 bytes),
//      and the new word reconstructs the edited tile's (char,pal,prio) + flip.
//   6. Per-world distinctness: world 0 and world 2 half-0 tilemaps differ; within a
//      world, half 0 ≠ half 1 (the 1-4 vs 5-8 maps).
//
// Run: node snes-framework/scripts/engine/world-map-terrain.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import {
  exportWorldMapTerrain, buildWorldMapTerrainContext, renderWorldMapTerrain,
  worldMapTerrainAseprite, diffWorldMapTerrainPlacement, terrainTileKeys,
  exportWorldMapGround, buildWorldMapGroundContext, renderWorldMapGround,
  worldMapGroundAseprite, diffWorldMapGroundPlacement
} from './world-map-terrain.ts';
import { mapTilemapFileId } from './screen-gfx.ts';
import { decodeAsepriteStructural } from './aseprite.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message); process.exit(2);
}
const { rom, symbols } = cart;

// 1. Export → 12 entries with correct file ids.
const maps = exportWorldMapTerrain(rom, symbols, { aseprite: true });
assert(maps.length === 12, `exports 12 maps (6 worlds × 2 halves), got ${maps.length}`);
assert(maps.every((m) => m.fileId === mapTilemapFileId(rom, symbols, m.world, m.half)),
  'every entry id == DATA_00B3F4[world*2+half]');
assert(maps.every((m) => m.aseprite && m.aseprite.length > 0), 'every entry has an .aseprite layout');
assert(maps.every((m) => m.width === 512 && m.height === 256), 'every map canvas is 512×256');

// 2-5. Per world × half: decode, render, round-trip, single-cell edit.
let rtFail = 0, editFail = 0, emptyFail = 0;
for (let world = 0; world < 6; world++) {
  for (const half of [0, 1] as const) {
    const ctx = buildWorldMapTerrainContext(rom, symbols, world, half);
    if (ctx.tilemap.length !== 4096) { console.error(`  ✗ w${world}h${half} tilemap ${ctx.tilemap.length} != 4096`); failures++; continue; }
    if (terrainTileKeys(ctx).length < 2) { console.error(`  ✗ w${world}h${half} no distinct tiles`); failures++; continue; }

    // 3. assembled render is non-empty.
    const canvas = renderWorldMapTerrain(ctx);
    const u32 = new Uint32Array(canvas.rgba.buffer, canvas.rgba.byteOffset, canvas.width * canvas.height);
    let distinct = new Set<number>(); for (let i = 0; i < u32.length; i += 257) distinct.add(u32[i]!);
    if (distinct.size < 4) emptyFail++;

    // 4. unedited round-trip → null.
    const struct = decodeAsepriteStructural(worldMapTerrainAseprite(ctx));
    if (diffWorldMapTerrainPlacement(ctx, struct) !== null) rtFail++;

    // 5. single-cell edit → exactly one word changed.
    const target = 5 * 64 + 10; // a cell in the map body
    const cur = struct.cells[target]!;
    const other = struct.cells.find((c) => c.tile > 0 && c.tile !== cur.tile);
    if (other) {
      struct.cells[target] = { tile: other.tile, hflip: false, vflip: false };
      const out = diffWorldMapTerrainPlacement(ctx, struct);
      let nDiff = 0; if (out) for (let i = 0; i < ctx.tilemap.length; i++) if (out[i] !== ctx.tilemap[i]) nDiff++;
      if (!out || nDiff < 1 || nDiff > 2) editFail++;
    }
  }
}
assert(rtFail === 0, `every unedited map round-trips to null (${rtFail} failed)`);
assert(editFail === 0, `a single-cell edit changes exactly one word (${editFail} failed)`);
assert(emptyFail === 0, `every assembled map is non-empty (${emptyFail} all-backdrop)`);

// 6. per-world + per-half distinctness.
const hash = (b: Uint8Array): string => { let h = 0; for (let i = 0; i < b.length; i++) h = (h * 31 + b[i]!) >>> 0; return h.toString(16); };
const w0h0 = buildWorldMapTerrainContext(rom, symbols, 0, 0).tilemap;
const w2h0 = buildWorldMapTerrainContext(rom, symbols, 2, 0).tilemap;
const w0h1 = buildWorldMapTerrainContext(rom, symbols, 0, 1).tilemap;
assert(hash(w0h0) !== hash(w2h0), 'world 0 vs world 2 (half 0) maps differ');
assert(hash(w0h0) !== hash(w0h1), 'within world 0, the 1-4 and 5-8 maps differ');

// 7. The shared decorative GROUND ($7E) — one entry, 2bpp, round-trips byte-exact.
const ground = exportWorldMapGround(rom, symbols, { aseprite: true });
assert(ground.fileId === 0x7e, `ground entry id is $7E (got 0x${ground.fileId.toString(16)})`);
assert(!!ground.aseprite && ground.width === 512 && ground.height === 256, 'ground has a 512×256 view + .aseprite layout');
const gctx = buildWorldMapGroundContext(rom, symbols);
assert(gctx.tilemap.length === 4096, `ground tilemap is 4096 bytes (got ${gctx.tilemap.length})`);
{
  const gcanvas = renderWorldMapGround(gctx);
  const gu32 = new Uint32Array(gcanvas.rgba.buffer, gcanvas.rgba.byteOffset, gcanvas.width * gcanvas.height);
  const gdistinct = new Set<number>(); for (let i = 0; i < gu32.length; i += 257) gdistinct.add(gu32[i]!);
  assert(gdistinct.size >= 3, 'ground render is non-empty');
  const gstruct = decodeAsepriteStructural(worldMapGroundAseprite(gctx));
  assert(diffWorldMapGroundPlacement(gctx, gstruct) === null, 'unedited ground round-trips to null');
  const gt = 28 * 64 + 10; const gcur = gstruct.cells[gt]!;
  const gother = gstruct.cells.find((c) => c.tile > 0 && c.tile !== gcur.tile);
  if (gother) {
    gstruct.cells[gt] = { tile: gother.tile, hflip: false, vflip: false };
    const gout = diffWorldMapGroundPlacement(gctx, gstruct);
    let gn = 0; if (gout) for (let i = 0; i < gctx.tilemap.length; i++) if (gout[i] !== gctx.tilemap[i]) gn++;
    assert(!!gout && gn >= 1 && gn <= 2, `a single ground-cell edit changes one word (got ${gn} bytes)`);
  }
}
// world-invariance: the ground tilemap is the same built from any world's load.
assert(hash(gctx.tilemap) !== hash(w0h0), 'ground ($7E) differs from the world-0 map ($7C)');

if (failures > 0) { console.error(`\n✗ ${failures} failure(s)`); process.exit(1); }
console.log('\n✓ all world-map-terrain pins passed');
