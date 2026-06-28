// Overworld-map export round-trip pin (world-map-terrain.ts).
//
// The displayed overworld is BG1 ⊕ BG2 ⊕ BG3 composited (ground-truthed via the yi-shiny
// `world-map-terrain` trace): the DATA_00B3F4 pair is BG1 (foreground) + BG2 (background
// scenery) of ONE 64-wide screen. Both layers draw from the SAME char base, so the export
// is ONE combined .aseprite per world with TWO tilemap layers over a UNIFIED shared tileset
// (the union of both layers' keys → any tile is placeable in either layer).
//
//   1. Export → 6 entries (one per world); each has both BG file ids, a 2-layer .aseprite,
//      512×256.
//   2. Each world decodes two 4096-byte (2048-word) tilemaps with ≥1 distinct tile.
//   3. The assembled COMPOSITE render is non-empty (real map content, not all backdrop).
//   4. The combined .aseprite has ONE shared tileset = unifiedTerrainKeys, and TWO named
//      layers (BG1/BG2); each layer's layout ROUND-TRIPS (unedited diff → null).
//   5. A single-cell edit on a layer changes exactly one word in THAT layer's tilemap and
//      leaves the other layer untouched.
//   6. The unified tileset makes a BG2-only tile placeable in BG1 (cross-layer sharing).
//
// Run: node snes-framework/scripts/engine/world-map-terrain.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import {
  exportWorldMapTerrain, buildWorldMapTerrainContext, renderWorldMapTerrain,
  worldMapTerrainAseprite, diffWorldMapTerrainPlacement, diffWorldMapTerrainPixels,
  terrainTileKeys, unifiedTerrainKeys,
  exportWorldMapGround, buildWorldMapGroundContext, renderWorldMapGround,
  worldMapGroundAseprite, diffWorldMapGroundPlacement, groundTileKeys
} from './world-map-terrain.ts';
import { mapTilemapFileId } from './screen-gfx.ts';
import { decodeAsepriteStructural, decodeAsepriteMultiStructural, type AsepriteStructuralLayer } from './aseprite.ts';
import { diffAsepritePalette } from './gfx-aseprite.ts';
import { imageDataU32ToBgr15 } from './color.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

/** The master-blob's current `offset → BGR-15` words, sourced from a scene's
 *  (provenance, cgram) — the same source the export read. Used to pin the palette
 *  write-back: an UNEDITED export must diff to 0 colour edits against this. */
function blobWordsFrom(provenance: Int32Array, cgram: Uint8Array): Map<number, number> {
  const w = new Map<number, number>();
  for (let ci = 0; ci < provenance.length; ci++) {
    const off = provenance[ci]!;
    if (off >= 0) w.set(off, (cgram[ci * 2]! | (cgram[ci * 2 + 1]! << 8)) & 0x7fff);
  }
  return w;
}

/** Assert a track's palette write-back: offsets cover the meaningful entries, an unedited
 *  palette diffs to 0 edits, and flipping the first blob-backed entry yields exactly one. */
function assertPaletteRoundTrip(label: string, palette: Uint32Array, offsets: number[], blobWords: Map<number, number>): void {
  assert(offsets.length > 0 && offsets.length <= palette.length, `${label}: paletteOffsets covers the meaningful entries (${offsets.length} of ${palette.length})`);
  assert(diffAsepritePalette(palette, offsets, blobWords).length === 0, `${label}: unedited palette → 0 master-blob colour edits`);
  const pi = offsets.findIndex((o) => o >= 0);
  assert(pi >= 0, `${label}: palette has a blob-backed colour to edit`);
  if (pi >= 0) {
    const ep = palette.slice();
    ep[pi] = (ep[pi]! ^ 0x00080808) >>> 0; // flip bit 3 of each RGB byte → ±1 in the 5-bit channel
    const eds = diffAsepritePalette(ep, offsets, blobWords);
    assert(eds.length === 1 && eds[0]!.offset === offsets[pi] && eds[0]!.value === imageDataU32ToBgr15(ep[pi]!), `${label}: a 1-colour edit → exactly one PaletteEdit at the right offset`);
  }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message); process.exit(2);
}
const { rom, symbols } = cart;

// Pick the layer named BGn from a multi-structural decode (export names them BG1/BG2).
const layerNamed = (layers: AsepriteStructuralLayer[], bg: 1 | 2): AsepriteStructuralLayer | undefined =>
  layers.find((l) => l.name.toLowerCase().includes(`bg${bg}`));

// 1. Export → 6 per-world entries, each with both file ids + a 2-layer .aseprite.
const maps = exportWorldMapTerrain(rom, symbols, { aseprite: true });
assert(maps.length === 6, `exports 6 overworld maps (1/world), got ${maps.length}`);
assert(maps.every((m) => m.bg1FileId === mapTilemapFileId(rom, symbols, m.world, 0)
  && m.bg2FileId === mapTilemapFileId(rom, symbols, m.world, 1)), 'every entry carries DATA_00B3F4[world*2] + [world*2+1]');
assert(maps.every((m) => m.aseprite && m.aseprite.length > 0), 'every entry has a combined .aseprite');
// Each entry serializes the per-tile (char,pal,prio) key list (for the import to map tiles
// → cart char + row without re-deriving), matching the embedded tileset's order/size.
assert(maps.every((m) => {
  const u = unifiedTerrainKeys(buildWorldMapTerrainContext(rom, symbols, m.world));
  return !!m.tileKeys && m.tileKeys.length === u.length && m.tileKeys.every((k, i) => k === u[i]);
}), 'every entry serializes tileKeys == unifiedTerrainKeys (matching the embedded tileset)');
assert(maps.every((m) => m.width === 512 && m.height === 256), 'every map canvas is 512×256');
// PNG mode → same 6 entries, no .aseprite.
const views = exportWorldMapTerrain(rom, symbols, { aseprite: false });
assert(views.length === 6 && views.every((m) => !m.aseprite), 'PNG mode → 6 entries, view-only (no .aseprite)');

// 2-6. Per world.
let rtFail = 0, editFail = 0, crossFail = 0, sharedFail = 0, layerFail = 0, emptyFail = 0;
for (let world = 0; world < 6; world++) {
  const ctx = buildWorldMapTerrainContext(rom, symbols, world);
  if (ctx.bg1Tilemap.length !== 4096 || ctx.bg2Tilemap.length !== 4096) {
    console.error(`  ✗ w${world} tilemap not 4096`); failures++; continue;
  }

  // 3. assembled COMPOSITE render is non-empty.
  const canvas = renderWorldMapTerrain(ctx);
  const u32 = new Uint32Array(canvas.rgba.buffer, canvas.rgba.byteOffset, canvas.width * canvas.height);
  const distinct = new Set<number>(); for (let i = 0; i < u32.length; i += 257) distinct.add(u32[i]!);
  if (distinct.size < 4) emptyFail++;

  // 4. combined .aseprite: ONE shared tileset = unified keys; TWO named layers; round-trip.
  const unified = unifiedTerrainKeys(ctx);
  const ms = decodeAsepriteMultiStructural(worldMapTerrainAseprite(ctx, unified).bytes);
  if (ms.numTiles !== unified.length) sharedFail++; // shared tileset = union of both layers' keys
  if (ms.layers.length !== 2) layerFail++;
  const bg1 = layerNamed(ms.layers, 1), bg2 = layerNamed(ms.layers, 2);
  if (!bg1 || !bg2) { layerFail++; continue; }
  if (diffWorldMapTerrainPlacement(ctx, 0, unified, bg1.cells).tilemap !== null) rtFail++;
  if (diffWorldMapTerrainPlacement(ctx, 1, unified, bg2.cells).tilemap !== null) rtFail++;

  // 5. single-cell edit on BG1 → one word in bg1Tilemap, bg2 untouched.
  const target = 5 * 64 + 10;
  const cur = bg1.cells[target]!;
  const other = bg1.cells.find((c) => c.tile > 0 && c.tile !== cur.tile);
  if (other) {
    const edited = bg1.cells.slice();
    edited[target] = { tile: other.tile, hflip: false, vflip: false };
    const out = diffWorldMapTerrainPlacement(ctx, 0, unified, edited).tilemap;
    let n = 0; if (out) for (let i = 0; i < ctx.bg1Tilemap.length; i++) if (out[i] !== ctx.bg1Tilemap[i]) n++;
    if (!out || n < 1 || n > 2) editFail++;
    // BG2 layout (unedited) still round-trips to null — proves the layers are independent.
    if (diffWorldMapTerrainPlacement(ctx, 1, unified, bg2.cells).tilemap !== null) editFail++;
  }

  // 6. cross-layer sharing: a key BG2 uses but BG1 doesn't is still in the unified set
  //    (so it's placeable in BG1's layer from the shared tileset).
  const wordKey = (w: number) => w & 0x3fff;
  const bg1Keys = new Set<number>(); for (let i = 0; i < ctx.bg1Tilemap.length; i += 2) bg1Keys.add(wordKey(ctx.bg1Tilemap[i]! | (ctx.bg1Tilemap[i + 1]! << 8)));
  let bg2Only = -1;
  for (let i = 0; i < ctx.bg2Tilemap.length; i += 2) { const k = wordKey(ctx.bg2Tilemap[i]! | (ctx.bg2Tilemap[i + 1]! << 8)); if (!bg1Keys.has(k)) { bg2Only = k; break; } }
  if (bg2Only >= 0 && !unified.includes(bg2Only)) crossFail++;
}
assert(emptyFail === 0, `every assembled composite is non-empty (${emptyFail} all-backdrop)`);
assert(sharedFail === 0, `the combined .aseprite has ONE shared tileset = unified keys (${sharedFail} mismatched)`);
assert(layerFail === 0, `every combined .aseprite has 2 layers named BG1/BG2 (${layerFail} failed)`);
assert(rtFail === 0, `every unedited layer round-trips to null (${rtFail} failed)`);
assert(editFail === 0, `a single-cell BG1 edit changes one word, BG2 untouched (${editFail} failed)`);
assert(crossFail === 0, `BG2-only tiles are placeable in BG1 via the shared tileset (${crossFail} missing)`);
assert(terrainTileKeys(buildWorldMapTerrainContext(rom, symbols, 0)).length >= 2, 'unified placeable set is non-trivial');

// 6a. Erase: tile 0 is Aseprite's empty tile; a cell erased to it → this layer's cell 0 word,
// counted in `erased`. Unedited → 0 erased.
{
  const ctx = buildWorldMapTerrainContext(rom, symbols, 0);
  const keys = unifiedTerrainKeys(ctx);
  assert(keys[0] === -1, 'terrain: tile 0 is the empty tile (-1)');
  const ms = decodeAsepriteMultiStructural(worldMapTerrainAseprite(ctx, keys).bytes);
  const bg1 = layerNamed(ms.layers, 1)!;
  const cell0 = ctx.bg1Tilemap[0]! | (ctx.bg1Tilemap[1]! << 8);
  const wordAt = (i: number) => { const cc = i % 64, r = (i / 64) | 0, o = ((cc >= 32 ? 0x400 : 0) + r * 32 + (cc & 31)) * 2; return ctx.bg1Tilemap[o]! | (ctx.bg1Tilemap[o + 1]! << 8); };
  let lc = 0; for (let i = 0; i < bg1.cells.length; i++) if (wordAt(i) !== cell0) { lc = i; break; } // a cell whose word differs from cell 0
  const cells = bg1.cells.slice(); cells[lc] = { tile: 0 };
  const { tilemap: out, erased } = diffWorldMapTerrainPlacement(ctx, 0, keys, cells);
  const cc = lc % 64, r = (lc / 64) | 0, off = ((cc >= 32 ? 0x400 : 0) + r * 32 + (cc & 31)) * 2;
  const word = out ? (out[off]! | (out[off + 1]! << 8)) : -1;
  assert(erased === 1 && out !== null && word === cell0, `terrain: erasing a BG1 cell → cell 0's word 0x${cell0.toString(16)}, erased=1 (got 0x${word.toString(16)}, erased ${erased})`);
  assert(diffWorldMapTerrainPlacement(ctx, 0, keys, bg1.cells).erased === 0, 'terrain: unedited BG1 → 0 erased');
}

// 6b. Combined-file PIXEL editing (the second axis), used-rows (compacted) palette.
{
  const ctx = buildWorldMapTerrainContext(rom, symbols, 0);
  const keys = unifiedTerrainKeys(ctx);
  const terrainAse = worldMapTerrainAseprite(ctx, keys);
  const ms = decodeAsepriteMultiStructural(terrainAse.bytes);

  // Compacted used-rows palette: only the rows the tiles use are emitted (block k =
  // the k-th used row), so a tile in CGRAM row `pal` lives in block usedRows.indexOf(pal).
  const usedRows = [...new Set(keys.slice(1).map((k) => (k >> 10) & 7))].sort((a, b) => a - b);
  const baseOf = (pal: number): number => usedRows.indexOf(pal) * 16;
  let blockOk = true;
  for (let ti = 1; ti < ms.numTiles && ti < keys.length; ti++) {
    const b = baseOf((keys[ti]! >> 10) & 7);
    for (let p = 0; p < 64; p++) {
      const f = ms.tilePixels[ti * 64 + p]!;
      if (f !== 0 && (f < b || f >= b + 16)) { blockOk = false; break; }
    }
    if (!blockOk) break;
  }
  assert(blockOk, 'every tile\'s pixels live in its used-row palette block (compacted, only used rows emitted)');
  assert(usedRows.length < 8, `palette emits only used rows, not all 8 (got ${usedRows.length} rows)`);

  // Unedited tileset → no pixel edits (round-trip).
  const u = diffWorldMapTerrainPixels(ctx, keys, ms.tilePixels, ms.numTiles, ms.palette);
  assert(u.edits.length === 0 && u.conflicts === 0, `unedited tileset → 0 pixel edits (got ${u.edits.length})`);

  // Edit one tile's pixels → exactly one char (the right $74/$75/$4C tile) changes.
  const edited = ms.tilePixels.slice();
  const ti = 1; // first real tile
  const wantFlat = baseOf((keys[ti]! >> 10) & 7) + 1; // a different, opaque colour in the SAME row's block
  for (let p = 0; p < 64; p++) edited[ti * 64 + p] = wantFlat;
  const d = diffWorldMapTerrainPixels(ctx, keys, edited, ms.numTiles, ms.palette);
  assert(d.edits.length === 1 && d.edits[0]!.bytes.length === 32, `a 1-tile pixel edit slices to exactly one 32-B CHR tile (got ${d.edits.length})`);
  assert(d.edits.length === 1 && (d.edits[0]!.fileId === 0x74 || d.edits[0]!.fileId === 0x75 || d.edits[0]!.fileId === 0x4c),
    'the sliced pixel edit targets a shared map char file ($74/$75/$4C)');

  // 6c. Palette write-back (the third axis): the embedded BG palette round-trips to the
  //     master blob. bpp 4 (16-colour rows, default stride 16); per-world tint provenance.
  assertPaletteRoundTrip('terrain', ms.palette, terrainAse.paletteOffsets, blobWordsFrom(ctx.scene.provenance, ctx.scene.cgram));
}

// 7. layer + per-world distinctness.
const hash = (b: Uint8Array): string => { let h = 0; for (let i = 0; i < b.length; i++) h = (h * 31 + b[i]!) >>> 0; return h.toString(16); };
const w0 = buildWorldMapTerrainContext(rom, symbols, 0);
const w2 = buildWorldMapTerrainContext(rom, symbols, 2);
assert(hash(w0.bg1Tilemap) !== hash(w0.bg2Tilemap), 'within world 0, BG1 ($7C) and BG2 ($7D) tilemaps differ');
assert(hash(w0.bg1Tilemap) !== hash(w2.bg1Tilemap), 'world 0 vs world 2 BG1 tilemaps differ');

// 8. The shared decorative GROUND ($7E) — single layer, 2bpp, round-trips byte-exact.
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
  const gkeys = groundTileKeys(gctx);
  const groundAse = worldMapGroundAseprite(gctx, gkeys);
  const gstruct = decodeAsepriteStructural(groundAse.bytes);
  assert(diffWorldMapGroundPlacement(gctx, gkeys, gstruct).tilemap === null, 'unedited ground round-trips to null');
  // Char-keyed (the title-logo model, NOT the terrain's word-keyed one): the tileset is the FULL
  // $56 CHR sheet in char order at tiles 1..N (every char, placed or not), so tile i = char i-1 —
  // not just the distinct words actually used.
  assert(gkeys[0] === -1, 'ground: tile 0 is the empty tile (-1)');
  assert(gkeys.length === 1 + 128, `ground tileset = empty + full $56 sheet (129 entries, got ${gkeys.length})`);
  assert(gkeys.slice(1).every((k, i) => ((k >> 3) & 0x3ff) === i), 'ground tile i = char i (CHR 1:1 at indices 1..N)');
  {
    const usedChars = new Set<number>();
    for (let i = 0; i < gctx.tilemap.length; i += 2) usedChars.add((gctx.tilemap[i]! | (gctx.tilemap[i + 1]! << 8)) & 0x3ff);
    assert(gkeys.length - 1 > usedChars.size, `ground export includes available (unused) $56 chars (${gkeys.length - 1 - usedChars.size})`);
  }
  // Erase: tile 0 is Aseprite's empty tile; a cell erased to it → cell 0's word, counted in `erased`.
  {
    const cell0 = gctx.tilemap[0]! | (gctx.tilemap[1]! << 8);
    const gWordAt = (i: number) => { const cc = i % 64, r = (i / 64) | 0, o = ((cc >= 32 ? 0x400 : 0) + r * 32 + (cc & 31)) * 2; return gctx.tilemap[o]! | (gctx.tilemap[o + 1]! << 8); };
    let lc = 0; for (let i = 0; i < gstruct.cells.length; i++) if (gWordAt(i) !== cell0) { lc = i; break; } // a cell whose word differs from cell 0
    const cells = gstruct.cells.slice(); cells[lc] = { tile: 0 };
    const { tilemap: gout, erased } = diffWorldMapGroundPlacement(gctx, gkeys, { ...gstruct, cells });
    const cc = lc % 64, r = (lc / 64) | 0, off = ((cc >= 32 ? 0x400 : 0) + r * 32 + (cc & 31)) * 2;
    const word = gout ? (gout[off]! | (gout[off + 1]! << 8)) : -1;
    assert(erased === 1 && gout !== null && word === cell0, `ground: erasing a cell → cell 0's word 0x${cell0.toString(16)}, erased=1 (got 0x${word.toString(16)}, erased ${erased})`);
  }
  const gt = 28 * 64 + 10; const gcur = gstruct.cells[gt]!;
  const gother = gstruct.cells.find((c) => c.tile > 0 && c.tile !== gcur.tile);
  if (gother) {
    gstruct.cells[gt] = { tile: gother.tile, hflip: false, vflip: false };
    const gout = diffWorldMapGroundPlacement(gctx, gkeys, gstruct).tilemap;
    let gn = 0; if (gout) for (let i = 0; i < gctx.tilemap.length; i++) if (gout[i] !== gctx.tilemap[i]) gn++;
    assert(!!gout && gn >= 1 && gn <= 2, `a single ground-cell edit changes one word (got ${gn} bytes)`);
  }
  // Ground palette write-back (BG3, 2bpp → 4-colour rows, default stride 4).
  assertPaletteRoundTrip('ground', gstruct.palette, groundAse.paletteOffsets, blobWordsFrom(gctx.scene.provenance, gctx.scene.cgram));
}
assert(hash(gctx.tilemap) !== hash(w0.bg1Tilemap), 'ground ($7E) differs from the world-0 BG1 map ($7C)');

if (failures > 0) { console.error(`\n✗ ${failures} failure(s)`); process.exit(1); }
console.log('\n✓ all world-map-terrain pins passed');
