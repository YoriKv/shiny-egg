// System-screen gfx export (boot / title / storybook / map). Pins:
//   1. the screens export the expected folder shapes — screens/boot/,
//      screens/title/, screens/storybook/, screens/map/common/ + per-world
//      screens/map/world-N/,
//   2. the boot screen is CROPPED to the "Nintendo Presents" logo (a tile region,
//      not the whole 0x72 sheet),
//   3. every exported file's UNEDITED round-trip (region-aware, base-aware) is
//      BYTE-EXACT (so an unedited screen leaves the build byte-identical),
//   4. a 1-pixel edit decodes to the right index and changes ONLY that tile —
//      for both a region (boot) and a full-file (map) entry,
//   5. the map per-world dedup is content-correct (each id exported once).
//
// Run: node snes-framework/scripts/engine/screen-gfx.test.ts

import { loadDevCart } from './dev-cart.ts';
import {
  exportScreenGfxPngs,
  exportTitleLogo,
  buildTitleLogoContext,
  renderTitleLogo,
  diffTitleLogoTiles,
  diffTitleLogoCombined,
  logoTileMeta,
  titleLogoAseprite,
  exportTitleIsland,
  buildTitleIslandContext,
  renderTitleIsland,
  diffTitleIslandTiles,
  titleIslandAseprite,
  diffTitleIslandPlacement,
  diffTitleIslandCombined,
  islandTileChars,
  exportTitleScenery,
  buildTitleSceneryContext,
  renderTitleScenery,
  diffTitleScenery,
  titleSceneryAseprite,
  type ScreenGfxPng
} from './screen-gfx.ts';
import { decodePng } from './png.ts';
import { decodeAsepriteRegion, decodeAsepriteStructural, decodeAsepriteImage } from './aseprite.ts';
import { diffGfxFileAseprite } from './gfx-aseprite.ts';
import { imageToGfx, lz16Layout, lz2Layout, readSwatchPalette, type GfxImageLayout } from './gfx-png.ts';
import { decode2bppTile, decode4bppTile, encode2bppTile, encode4bppTile } from './tile.ts';
import { lz2, lz16 } from './decompress/index.ts';
import { snesToPC } from './symbol-map.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } else console.log(`  ✓ ${m}`); };
const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

const { rom, symbols } = loadDevCart();
const entries = exportScreenGfxPngs(rom, symbols);

// The full decompressed file blob behind an entry (sizeBytes is always the full file).
const fullBase = (e: ScreenGfxPng): Uint8Array => {
  const out = new Uint8Array(e.sizeBytes);
  if (e.format === 'lz16') lz16(rom, snesToPC(e.addr), out, 0, e.rowCount!); else lz2(rom, snesToPC(e.addr), out, 0);
  return out;
};
const tileBytesOf = (e: ScreenGfxPng): number => (e.bpp === 4 ? 32 : 16);
// The layout the PNG was exported with (region sub-grid, or the full 16-wide file).
const layoutOf = (e: ScreenGfxPng): GfxImageLayout =>
  e.region ? { tilesWide: e.region.w, tilesTall: e.region.h, bpp: e.bpp }
    : e.format === 'lz16' ? lz16Layout(e.rowCount!) : lz2Layout(e.sizeBytes, e.bpp);
// The base bytes the PNG decodes against (the region sub-block, or the full file).
const decodeBase = (e: ScreenGfxPng): Uint8Array => {
  const base = fullBase(e);
  if (!e.region) return base;
  const { x, y, w, h } = e.region; const tb = tileBytesOf(e);
  const out = new Uint8Array(w * h * tb);
  for (let ry = 0; ry < h; ry++) for (let rx = 0; rx < w; rx++) {
    const src = ((y + ry) * 16 + (x + rx)) * tb;
    out.set(base.subarray(src, src + tb), (ry * w + rx) * tb);
  }
  return out;
};
// Per-tile palette decoder for fidelity entries (map BG f74/f75, title logo $1D) —
// each tile decodes against its own row; the swatch is ignored (same as the import).
const tilePaletteOf = (e: ScreenGfxPng): ((t: number) => readonly number[]) | undefined =>
  e.perTilePalette
    ? (t) => e.perTilePalette!.subPalettes[e.perTilePalette!.tileSub[t] ?? 0] ?? e.perTilePalette!.subPalettes[0]!
    : undefined;

// (1) folder shapes.
const has = (re: RegExp): boolean => entries.some((e) => re.test(e.file));
assert(has(/^screens\/boot\/f[0-9A-F]+\.png$/), 'exports screens/boot/');
assert(has(/^screens\/title\/f[0-9A-F]+\.png$/), 'exports screens/title/');
assert(has(/^screens\/storybook\/f[0-9A-F]+\.png$/), 'exports screens/storybook/');
assert(has(/^screens\/map\/common\/f[0-9A-F]+\.png$/), 'exports screens/map/common/');
// (Per-world map GFX is now empty: the only per-world map tilesets are the BG1
// fold/Mode-7-only sheets, which the flat-map BG export skips — so common/ holds all
// map gfx files. Per-world content lives in the world-map level-slot icons, exported
// separately by exportWorldMapIcons.)
assert(new Set(entries.map((e) => e.file)).size === entries.length, 'every screen file path is unique');
console.log(`  (exported ${entries.length} screen files)`);

// (2) boot is cropped to the logo region (a sub-grid, not the full 256-tile sheet).
const boot = entries.find((e) => /^screens\/boot\//.test(e.file))!;
assert(!!boot.region, 'boot screen export carries a tile-region crop');
const bootTiles = boot.region!.w * boot.region!.h;
assert(bootTiles < boot.sizeBytes / tileBytesOf(boot), `boot crop (${bootTiles} tiles) is smaller than the full 0x72 sheet (${boot.sizeBytes / tileBytesOf(boot)})`);

// (2b) Boot logo as a single-image `.aseprite` (no tilemap): the cropped region as an
// indexed image + palette; its flatten slices back to 0 edits against the base region
// (diffGfxFileAseprite over the region's flat tile grid — the import path).
{
  const bootAse = exportScreenGfxPngs(rom, symbols, { aseprite: true }).find((e) => /^screens\/boot\//.test(e.file))!;
  assert(!!bootAse.aseprite, 'boot screen builds a single-image .aseprite when requested');
  const dec = decodeAsepriteImage(bootAse.aseprite!);
  assert(dec.width === boot.region!.w * 8 && dec.height === boot.region!.h * 8,
    `boot .aseprite is the region size (${boot.region!.w * 8}×${boot.region!.h * 8}, got ${dec.width}×${dec.height})`);
  const baseRegion = decodeBase(boot);
  assert(diffGfxFileAseprite({ palette: dec.palette, bpp: boot.bpp, baseTileData: baseRegion, flatten: dec.rgba, width: dec.width }).length === 0,
    'boot .aseprite round-trips to 0 tile edits');
  // A 1-px edit slices to ≥1 tile (sanity that the path detects changes).
  const edited = dec.rgba.slice();
  const u = new Uint32Array(edited.buffer, edited.byteOffset, dec.width * dec.height);
  let done = false;
  for (let i = 0; i < u.length && !done; i++) for (let k = 0; k < 16 && !done; k++) {
    if ((dec.palette[k]! >>> 0) !== u[i]! && (dec.palette[k]! >>> 24) !== 0) { u[i] = dec.palette[k]!; done = true; }
  }
  assert(done && diffGfxFileAseprite({ palette: dec.palette, bpp: boot.bpp, baseTileData: baseRegion, flatten: edited, width: dec.width }).length >= 1,
    'boot .aseprite a 1-px edit slices to a tile');
}

// (3) unedited round-trip byte-exact for every file (region- AND per-tile-aware).
let exact = 0;
for (const e of entries) {
  const img = decodePng(Buffer.from(e.png));
  const base = decodeBase(e);
  const round = imageToGfx(img, layoutOf(e), { base, index0Transparent: e.index0Transparent, tilePalette: tilePaletteOf(e) }).subarray(0, base.length);
  if (eq(round, base)) exact++;
  else assert(false, `${e.file} unedited round-trip byte-exact`);
}
assert(exact === entries.length, `all ${entries.length} screen files round-trip byte-exact`);
// per-tile fidelity is active where it should be (map BG f74/f75 + the title logo $1D).
assert(entries.find((e) => e.file === 'screens/title/f1D.png')?.perTilePalette != null, 'title logo char $1D uses per-tile palette (matches title/logo.png)');
assert(entries.some((e) => /^screens\/map\//.test(e.file) && e.perTilePalette != null), 'map BG terrain uses per-tile palette');

// (3b) STORYBOOK palette correctness pin. The gm$05 storybook is a runtime-streamed
// multi-page cutscene (51 story beats); a static decode only sees the initial
// Nintendo-logo frame, so the per-tile rows come from a CAPTURE (storybook-palette-
// facts.ts, the `storybook-render` trace) — NOT a static tilemap scan. Each char file
// renders PER-TILE (perTilePalette) coloured in its captured dominant row using the
// cart's static palette-$50 CGRAM. Two classification fixes vs the old static decode:
//   * the OBJ sprite sheets (f8A/f4A, loaded into OBJ VRAM $8000+) read OBJ palette
//     rows 8-15 with TRANSPARENT index 0 — the old decode mis-classed them as BG row 0
//     (the wrong HALF of CGRAM), rendering the stork/cloud illustrations as garbage;
//   * the tilemap-data files (f73/f74/f75) and f89 (loaded but never displayed across
//     the whole cutscene) are absent from the facts and SKIPPED.
{
  const sbook = entries.filter((e) => /^screens\/storybook\//.test(e.file));
  assert(sbook.length > 0, 'storybook exports char files');
  assert(sbook.every((e) => e.perTilePalette != null), 'every storybook char file uses per-tile palette');
  // Tilemap-data files + the never-displayed f89 are skipped (NOT exported as char sheets).
  for (const id of [0x73, 0x74, 0x75, 0x89]) {
    assert(!sbook.some((e) => e.fileId === id), `storybook non-char file 0x${id.toString(16)} is skipped`);
  }
  // The BG char file $87 spans >1 sub-palette (rows 0-5); the BG3 2bpp file $27 too.
  const f87 = sbook.find((e) => e.fileId === 0x87);
  const f27 = sbook.find((e) => e.fileId === 0x27);
  assert(f87 != null && f87.bpp === 4 && f87.perTilePalette!.subPalettes.length > 1,
    `storybook char $87 (4bpp) spans multiple sub-palettes (got ${f87?.perTilePalette?.subPalettes.length})`);
  assert(f27 != null && f27.bpp === 2 && f27.perTilePalette!.subPalettes.length > 1,
    `storybook BG3 char $27 (2bpp) spans multiple sub-palettes (got ${f27?.perTilePalette?.subPalettes.length})`);
  // BG3 2bpp tight 4-colour stride; $87 has tiles in a non-first row (not flat row 0).
  assert(f27!.perTilePalette!.subPalettes.every((p) => p.length === 4), 'storybook BG3 sub-palettes are 4 colours (2bpp, tight stride)');
  assert(f87!.perTilePalette!.tileSub.some((s) => s > 0), 'storybook char $87 has tiles in a non-first row (the mis-colour fix)');
  assert(f87!.index0Transparent === false, 'storybook BG char $87 has opaque index 0');
  // The OBJ sprite sheets f8A/f4A are classed OBJ: 4bpp + TRANSPARENT index 0 (the
  // classification fix — they were mis-coloured at BG row 0 before).
  for (const id of [0x8a, 0x4a]) {
    const f = sbook.find((e) => e.fileId === id);
    assert(f != null && f.bpp === 4 && f.index0Transparent === true,
      `storybook OBJ sprite sheet 0x${id.toString(16)} is 4bpp with transparent index 0 (OBJ-class fix)`);
  }
}

// (3c) STORYBOOK Aseprite output. Each storybook char file also exports as a single-
// image `.aseprite` (the per-tile-coloured sheet + the used-row colours as the indexed
// palette). The palette lives IN the file, so the `.aseprite` OMITS the reference swatch
// the PNG appends to the right — it's the bare tile grid (narrower than the PNG). The
// correctness invariant: its flatten reproduces the PNG's TILE-GRID region byte-for-byte
// (imageToGfx never reads the swatch when a per-tile palette is supplied), so the import
// (decodeAsepriteImage → imageToGfx with perTilePalette) round-trips byte-exact like the
// PNG (pinned by (3)). Covers both transparency modes (BG opaque-0 + OBJ transparent-0).
{
  const sbookAse = exportScreenGfxPngs(rom, symbols, { aseprite: true }).filter((e) => /^screens\/storybook\//.test(e.file));
  assert(sbookAse.length > 0 && sbookAse.every((e) => !!e.aseprite), 'every storybook char file builds an .aseprite when requested');
  for (const e of sbookAse) {
    const png = decodePng(Buffer.from(e.png));
    const dec = decodeAsepriteImage(e.aseprite!);
    // Swatch excluded: the .aseprite is the bare tile grid, narrower than the swatched PNG.
    assert(dec.width < png.width && dec.height <= png.height,
      `storybook ${e.file} .aseprite drops the swatch (${dec.width}×${dec.height} vs png ${png.width}×${png.height})`);
    // Flatten == the PNG's tile-grid region (cols 0..dec.width, rows 0..dec.height).
    let match = true;
    for (let y = 0; y < dec.height && match; y++)
      match = eq(dec.rgba.subarray(y * dec.width * 4, (y + 1) * dec.width * 4),
                 png.rgba.subarray(y * png.width * 4, (y * png.width + dec.width) * 4));
    assert(match, `storybook ${e.file} .aseprite flatten == the PNG tile grid (swatch excluded)`);
  }
}

// (4) 1-pixel edit on tile 0: change pixel (0,0) to another (unique) swatch colour
// → that tile's bytes change to the right index, others untouched.
function pixelEditCheck(e: ScreenGfxPng, label: string): void {
  const tileBytes = tileBytesOf(e);
  const decode = e.bpp === 4 ? decode4bppTile : decode2bppTile;
  const encode = e.bpp === 4 ? encode4bppTile : encode2bppTile;
  const base = decodeBase(e);
  const img = decodePng(Buffer.from(e.png));
  const pal = readSwatchPalette(img, layoutOf(e));
  const idx0 = new Uint8Array(64);
  decode(base, 0, false, false, idx0, 0);
  const bi = idx0[0]!;
  let k = -1;
  for (let cand = 0; cand < pal.length; cand++) {
    if (cand === bi) continue;
    if (pal.filter((c) => c === pal[cand]).length === 1) { k = cand; break; }
  }
  if (k < 0) { console.log(`  (skipped ${label} 1-pixel edit: tile 0 row has no unique alternate colour)`); return; }
  const col = pal[k]!;
  img.rgba[0] = (col >> 16) & 0xff; img.rgba[1] = (col >> 8) & 0xff; img.rgba[2] = col & 0xff; img.rgba[3] = k === 0 ? 0 : 255;
  const round = imageToGfx(img, layoutOf(e), { base, index0Transparent: e.index0Transparent }).subarray(0, base.length);
  const ei = idx0.slice(); ei[0] = k;
  const exp = new Uint8Array(tileBytes);
  encode(ei, 0, exp, 0);
  assert(eq(round.subarray(0, tileBytes), exp), `${label} 1-pixel edit: tile 0 byte = expected (index ${bi}→${k})`);
  assert(eq(round.subarray(tileBytes), base.subarray(tileBytes)), `${label} 1-pixel edit: every other tile byte-identical`);
}
// pixelEditCheck reads a single-row swatch, so target NON-per-tile entries (per-tile
// fidelity is covered by the round-trip above + the dedicated logo test below).
pixelEditCheck(boot, 'boot (region)');
pixelEditCheck(entries.find((e) => /screens\/map\/.*\.png$/.test(e.file) && e.bpp === 4 && !e.region && !e.perTilePalette)!, 'map (4bpp)');

// (5) map dedup is content-correct (each id exported once). The BG terrain/panel char
// ($56/$74/$75) is world-invariant → common/; the OBJ-marker chrome is NOT — the cart's
// DATA_00B409[world*8] set genuinely differs (world 5 / "World 6" loads $95-$98 where
// worlds 0-4 load $9d-$a0), so those land per-world. (The per-world OVERWORLD MAP and
// the level-slot icons are their own tracks — world-map-terrain.ts / -level-icons.ts.)
const mapFiles = entries.filter((e) => /^screens\/map\//.test(e.file));
const mapIds = mapFiles.map((e) => e.fileId);
assert(new Set(mapIds).size === mapIds.length, 'each map gfx file id is exported exactly once');
assert(mapFiles.some((e) => /\/common\//.test(e.file)), 'map exports a shared common/ set');
// Every BG file (opaque index 0) is common; only OBJ-marker chrome (transparent index 0,
// sprite row 8) may be per-world.
assert(mapFiles.every((e) => /\/common\//.test(e.file) || e.index0Transparent),
  'only OBJ-marker chrome is per-world; the BG terrain/panel char is all common');

// (6) Title "Yoshi's Island" logo meta-view: faithful, 32×14, slices back to $1D,
// unedited round-trips to zero edits, and a 1-pixel edit changes exactly one tile.
const logo = exportTitleLogo(rom, symbols);
assert(logo.file === 'screens/title/logo.png', 'title logo exports to screens/title/logo.png');
assert(logo.faithful, 'title logo is faithfully reconstructable (every cell slices back byte-exact)');
assert(logo.width === 256 && logo.height === 112, `title logo canvas is 256×112 (got ${logo.width}×${logo.height})`);
{
  const ctx = buildTitleLogoContext(rom, symbols);
  const canvas = renderTitleLogo(ctx);
  assert(canvas.units.every((u) => u !== null), 'every logo cell maps to a loaded char file (no nulls)');
  // unedited → no edits
  const clean = diffTitleLogoTiles(ctx, canvas, canvas.rgba);
  assert(clean.edits.length === 0 && clean.conflicts === 0, 'unedited logo diff is empty (round-trips byte-exact)');
  // the logo char comes from a single lz2 (2bpp) file — verify it's $1D
  const fileIds = new Set(canvas.units.filter(Boolean).map((u) => `${u!.format}/0x${u!.fileId.toString(16)}`));
  assert(fileIds.has('lz2/0x1d') && fileIds.size === 1, `logo char is the lz2 $1D sheet (got ${[...fileIds].join(',')})`);
  // 1-pixel edit: find a cell with ≥2 distinct colours, recolour one pixel to
  // another colour ALREADY in that cell (guaranteed in-palette) → exactly that tile.
  const u32 = new Uint32Array(canvas.rgba.buffer, canvas.rgba.byteOffset, canvas.width * canvas.height);
  const px = (cx: number, cy: number): number => u32[cy * canvas.width + cx]!;
  let edited2: Uint8Array | null = null;
  for (const u of canvas.units) {
    if (!u) continue;
    const c0 = px(u.cellX, u.cellY);
    let alt = -1, altX = 0, altY = 0;
    for (let y = 0; y < 8 && alt < 0; y++) for (let x = 0; x < 8; x++) {
      const c = px(u.cellX + x, u.cellY + y);
      if (c !== c0) { alt = c; altX = u.cellX; altY = u.cellY; break; }
    }
    if (alt < 0) continue;
    edited2 = canvas.rgba.slice();
    new Uint32Array(edited2.buffer, edited2.byteOffset, canvas.width * canvas.height)[altY * canvas.width + altX] = alt;
    break;
  }
  assert(edited2 !== null, 'found a logo cell with ≥2 colours to test an edit');
  if (edited2) {
    const d = diffTitleLogoTiles(ctx, canvas, edited2);
    assert(d.edits.length === 1, `a 1-pixel in-palette logo edit changes exactly one tile (got ${d.edits.length})`);
    assert(d.edits.every((e) => e.format === 'lz2' && e.bytes.length === 16), 'logo edits are 2bpp ($1D, 16-byte tiles)');
  }
  // Aseprite tilemap: the .aseprite flatten reproduces the assembled canvas byte-exact
  // (cell flips re-applied), and the embedded-palette flatten slices back to 0 edits —
  // so the import path is decodeAsepriteRegion → diffTitleLogoTiles.
  const logoAse = decodeAsepriteRegion(titleLogoAseprite(ctx, canvas));
  assert(logoAse.width === canvas.width && logoAse.height === canvas.height, `logo .aseprite canvas is ${canvas.width}×${canvas.height} (got ${logoAse.width}×${logoAse.height})`);
  assert(eq(logoAse.rgba, canvas.rgba), 'logo .aseprite flatten reproduces the assembled logo byte-exact');
  assert(diffTitleLogoTiles(ctx, canvas, logoAse.rgba).edits.length === 0, 'logo .aseprite round-trips to 0 tile edits');

  // (6b) COMBINED logo import (Manual tileset mode): one .aseprite = pixels + placement.
  // Unedited → nothing; an in-place pixel edit → ≥1 char edit + 0 placement; a cell move →
  // exactly that word + 0 pixels; fewer tiles than export → refused.
  const lbase = decodeAsepriteStructural(titleLogoAseprite(ctx, canvas));
  const lmeta = logoTileMeta(ctx);
  assert((() => { const d = diffTitleLogoCombined(ctx, lbase); return d.placement.length === 0 && d.pixels.length === 0 && d.skipped === 0 && !d.removedTiles; })(),
    'logo combined: unedited → no edits');
  {
    const t0 = lbase.cells.find((c) => c.tile > 0)!.tile;
    const tp = lbase.tilePixels.slice();
    let painted = false;
    for (let i = 0; i < 64 && !painted; i++) {
      const v = tp[t0 * 64 + i]!; if (v === 0) continue; const nv = (v & ~3) + (((v & 3) % 3) + 1);
      if (lbase.palette[nv] !== lbase.palette[v]) { tp[t0 * 64 + i] = nv; painted = true; }
    }
    if (painted) {
      const d = diffTitleLogoCombined(ctx, { ...lbase, tilePixels: tp });
      assert(d.pixels.length >= 1 && d.placement.length === 0, `logo combined: a pixel edit → char edit, no placement (got ${d.pixels.length}px ${d.placement.length}place)`);
    }
  }
  {
    let pi = -1, pj = -1;
    for (let i = 0; i < lbase.cells.length && pj < 0; i++) for (let j = i + 1; j < lbase.cells.length; j++) if (lbase.cells[i]!.tile !== lbase.cells[j]!.tile) { pi = i; pj = j; break; }
    if (pi >= 0) {
      const cells = lbase.cells.slice(); cells[pi] = { ...lbase.cells[pj]! }; // move cell pj's tile into cell pi
      const d = diffTitleLogoCombined(ctx, { ...lbase, cells });
      const pcL = symbols.pc('DATA_title_screen_logo_tilemap');
      const origPi = rom[pcL + pi * 2]! | (rom[pcL + pi * 2 + 1]! << 8);
      const mj = lmeta[lbase.cells[pj]!.tile]!;
      const exp = (mj.char & 0x3ff) | ((mj.palRow & 7) << 10) | (origPi & 0x2000) | (lbase.cells[pj]!.hflip ? 0x4000 : 0) | (lbase.cells[pj]!.vflip ? 0x8000 : 0);
      assert(d.placement.length === 1 && d.placement[0]!.offset === pi && d.placement[0]!.value === exp && d.pixels.length === 0,
        `logo combined: a cell move → exactly that word (got ${d.placement.length} place, 0x${d.placement[0]?.value.toString(16)} vs 0x${exp.toString(16)}, ${d.pixels.length}px)`);
    }
  }
  assert((() => { const d = diffTitleLogoCombined(ctx, { ...lbase, numTiles: lbase.numTiles - 1 }); return d.removedTiles && d.placement.length === 0 && d.pixels.length === 0; })(),
    'logo combined: fewer tiles than export → removedTiles (refused)');
}

// (7) Title floating island (Mode-7): exported, faithful, 256×256, slices back to
// $B1 (CPC). Unedited round-trips to zero edits; a 1-pixel edit re-packs exactly one
// 32-byte CPC char tile. $B1 itself is NOT in the generic screen entries (the island
// meta-view owns it).
const island = exportTitleIsland(rom, symbols);
assert(island.file === 'screens/title/island.png', 'island exports to screens/title/island.png');
assert(island.faithful, 'island is faithfully reconstructable (every char re-packs byte-exact)');
assert(island.width === 256 && island.height === 256, `island canvas is 256×256 (got ${island.width}×${island.height})`);
assert(!entries.some((e) => e.fileId === 0xb1), 'file $B1 is NOT in the generic screen entries (island meta-view owns it)');
{
  const ctx = buildTitleIslandContext(rom, symbols);
  const canvas = renderTitleIsland(ctx);
  const distinctChars = new Set(canvas.units.map((u) => u.char));
  assert(distinctChars.size > 50, `island uses many distinct char tiles (${distinctChars.size})`);
  const clean = diffTitleIslandTiles(ctx, canvas, canvas.rgba);
  assert(clean.edits.length === 0 && clean.conflicts === 0, 'unedited island diff is empty (round-trips byte-exact)');
  assert(clean.sharedCells === 0, 'an unedited island reports no shared-cell spread');
  // 1-pixel edit: recolour one pixel to another colour already in that cell.
  const cellsPerChar = new Map<number, number>();
  for (const u of canvas.units) cellsPerChar.set(u.char, (cellsPerChar.get(u.char) ?? 0) + 1);
  const u32 = new Uint32Array(canvas.rgba.buffer, canvas.rgba.byteOffset, canvas.width * canvas.height);
  let edited: Uint8Array | null = null;
  let chosenChar = -1;
  for (const u of canvas.units) {
    const c0 = u32[u.cellY * canvas.width + u.cellX]!;
    let alt = -1;
    for (let y = 0; y < 8 && alt < 0; y++) for (let x = 0; x < 8; x++) { const c = u32[(u.cellY + y) * canvas.width + (u.cellX + x)]!; if (c !== c0) { alt = c; break; } }
    if (alt < 0) continue;
    edited = canvas.rgba.slice();
    new Uint32Array(edited.buffer, edited.byteOffset, canvas.width * canvas.height)[u.cellY * canvas.width + u.cellX] = alt;
    chosenChar = u.char;
    break;
  }
  assert(edited !== null, 'found an island cell with ≥2 colours to test an edit');
  if (edited) {
    const d = diffTitleIslandTiles(ctx, canvas, edited);
    assert(d.edits.length === 1, `a 1-pixel island edit changes exactly one char tile (got ${d.edits.length})`);
    assert(d.edits.every((e) => e.bytes.length === 32), 'island edits are CPC char tiles (32 bytes)');
    // The tile-sharing warning: editing one cell of a char spreads to its other cells.
    assert(d.sharedCells === (cellsPerChar.get(chosenChar)! - 1),
      `island edit reports the other cells reusing the edited tile (got ${d.sharedCells}, char used by ${cellsPerChar.get(chosenChar)})`);
  }
  // Aseprite tilemap: the .aseprite flatten reproduces the assembled island byte-exact,
  // and slices back to 0 edits (import path: decodeAsepriteRegion → diffTitleIslandTiles).
  const islandAse = decodeAsepriteRegion(titleIslandAseprite(ctx, canvas));
  assert(islandAse.width === canvas.width && islandAse.height === canvas.height, `island .aseprite canvas is ${canvas.width}×${canvas.height} (got ${islandAse.width}×${islandAse.height})`);
  assert(eq(islandAse.rgba, canvas.rgba), 'island .aseprite flatten reproduces the assembled island byte-exact');
  assert(diffTitleIslandTiles(ctx, canvas, islandAse.rgba).edits.length === 0, 'island .aseprite round-trips to 0 tile edits');

  // PLACEMENT: the island tilemap (DATA_5F9800, 1 byte/cell Mode-7 char) is
  // rearrangeable. Unedited → 0 byte edits; moving one cell to another char → exactly
  // that one tilemap byte changes.
  const istruct = decodeAsepriteStructural(titleIslandAseprite(ctx, canvas));
  assert(diffTitleIslandPlacement(ctx, istruct).length === 0, 'island placement round-trips (unedited → 0 byte edits)');
  let pi = -1, pj = -1;
  for (let i = 0; i < istruct.cells.length && pj < 0; i++) for (let j = i + 1; j < istruct.cells.length; j++) {
    if (istruct.cells[i]!.tile !== istruct.cells[j]!.tile) { pi = i; pj = j; break; }
  }
  if (pi >= 0) {
    const moved = istruct.cells.slice(); moved[pi] = istruct.cells[pj]!;
    const ed = diffTitleIslandPlacement(ctx, { ...istruct, cells: moved });
    assert(ed.length === 1 && ed[0]!.offset === pi && ed[0]!.value === ctx.tilemap[pj],
      `island 1-cell move → exactly that tilemap byte (got ${ed.length}, value ${ed[0]?.value} vs ${ctx.tilemap[pj]})`);
  }
  // AVAILABLE chars: unused $B1 chars are in the tileset (not on the canvas); placing
  // one writes that char into DATA_5F9800.
  const usedIslandTiles = new Set(istruct.cells.map((c) => c.tile));
  let iav = -1;
  for (let t = 1; t < istruct.numTiles; t++) if (!usedIslandTiles.has(t)) { iav = t; break; }
  assert(iav > 0, `island export includes available (unused) $B1 chars (${istruct.numTiles - usedIslandTiles.size})`);
  if (iav > 0) {
    const cells2 = istruct.cells.slice(); cells2[0] = { tile: iav, hflip: false, vflip: false };
    const ed2 = diffTitleIslandPlacement(ctx, { ...istruct, cells: cells2 });
    const usedChars = new Set(Array.from(ctx.tilemap));
    assert(ed2.length === 1 && ed2[0]!.offset === 0 && !usedChars.has(ed2[0]!.value),
      `island placing an available char → that unused char at cell 0 (got ${ed2.length}, value ${ed2[0]?.value})`);
  }
}

// (8b) Title island COMBINED import (assumes Manual Aseprite tileset mode): ONE .aseprite
// carries pixel edits + cell repositions + newly-added tiles, applied together by stable
// tile index. Pins: unedited → nothing; an in-place pixel edit → exactly one char write +
// no placement; a cell move → exactly one placement byte + no pixels; a NEW tile → allocated
// to a free (unused-by-both-worlds) $B1 char; fewer tiles than export → refused; and an edit
// to a WORLD-6-only tile is skipped (so it can't corrupt the W6 island).
{
  const ctx = buildTitleIslandContext(rom, symbols);
  const canvas = renderTitleIsland(ctx);
  const baseStruct = decodeAsepriteStructural(titleIslandAseprite(ctx, canvas));
  const t2c = islandTileChars(ctx);
  const exportTileCount = t2c.length;

  {
    const d = diffTitleIslandCombined(ctx, baseStruct);
    assert(d.placement.length === 0 && d.pixels.length === 0 && d.newTiles === 0 &&
      d.unmappedTiles === 0 && d.skippedW6Tiles === 0 && !d.removedTiles,
      'combined: unedited island → no edits of any kind');
  }

  // in-place pixel edit on a USED tile → one char write, no placement
  {
    const t0 = baseStruct.cells[0]!.tile;
    const tp = baseStruct.tilePixels.slice();
    tp[t0 * 64] = (tp[t0 * 64]! + 1) & 0x0f;
    const d = diffTitleIslandCombined(ctx, { ...baseStruct, tilePixels: tp });
    assert(d.pixels.length === 1 && d.pixels[0]!.char === t2c[t0] && d.placement.length === 0 && d.newTiles === 0,
      `combined: a pixel edit → 1 char write (char 0x${t2c[t0]?.toString(16)}), no placement (got ${d.pixels.length}px ${d.placement.length}place)`);
    assert(d.sharedCells >= 1, 'combined: a pixel edit reports its in-game cell spread');
  }

  // cell move → one placement byte, no pixels
  {
    let pi = -1, pj = -1;
    for (let i = 0; i < baseStruct.cells.length && pj < 0; i++) for (let j = i + 1; j < baseStruct.cells.length; j++) {
      if (baseStruct.cells[i]!.tile !== baseStruct.cells[j]!.tile) { pi = i; pj = j; break; }
    }
    const cells = baseStruct.cells.slice(); cells[pi] = { ...baseStruct.cells[pj]! };
    const d = diffTitleIslandCombined(ctx, { ...baseStruct, cells });
    assert(d.placement.length === 1 && d.placement[0]!.offset === pi && d.placement[0]!.value === ctx.tilemap[pj] && d.pixels.length === 0,
      `combined: a cell move → 1 placement byte, no pixels (got ${d.placement.length}place ${d.pixels.length}px)`);
  }

  // a NEW appended tile placed in a cell → allocated to the first free (both-worlds-unused) char
  {
    assert(ctx.addableChars.length > 0, `island has free char slots to add tiles (${ctx.addableChars.length})`);
    const nt = baseStruct.numTiles;
    const tp = new Uint8Array(baseStruct.tilePixels.length + 64);
    tp.set(baseStruct.tilePixels);
    for (let k = 0; k < 64; k++) tp[nt * 64 + k] = (k % 15) + 1; // distinctive non-blank pattern (won't dedup)
    const cells = baseStruct.cells.slice(); cells[0] = { tile: nt, hflip: false, vflip: false };
    const d = diffTitleIslandCombined(ctx, { ...baseStruct, tilePixels: tp, cells, numTiles: nt + 1 });
    assert(d.newTiles === 1 && d.pixels.length === 1 && d.pixels[0]!.char === ctx.addableChars[0],
      `combined: a new tile → allocated to free char 0x${ctx.addableChars[0]?.toString(16)} (got newTiles=${d.newTiles}, char 0x${d.pixels[0]?.char.toString(16)})`);
    assert(d.placement.length === 1 && d.placement[0]!.offset === 0 && d.placement[0]!.value === ctx.addableChars[0],
      'combined: the new tile is placed at its cell (placement → the allocated char)');
  }

  // fewer tiles than export → refused (indices unreliable)
  {
    const d = diffTitleIslandCombined(ctx, { ...baseStruct, numTiles: baseStruct.numTiles - 1 });
    assert(d.removedTiles && d.placement.length === 0 && d.pixels.length === 0,
      'combined: fewer tiles than export → removedTiles (refused)');
  }

  // editing a WORLD-6-only tile is skipped (protects the W6 island)
  {
    const w15 = new Set<number>(ctx.tilemap);
    const addable = new Set<number>(ctx.addableChars);
    let tW6 = -1;
    for (let t = 1; t < exportTileCount; t++) { const c = t2c[t]!; if (c >= 0 && !w15.has(c) && !addable.has(c)) { tW6 = t; break; } }
    assert(tW6 > 0, 'island tileset includes a world-6-only available tile (to test the W6 guard)');
    if (tW6 > 0) {
      const tp = baseStruct.tilePixels.slice();
      tp[tW6 * 64] = (tp[tW6 * 64]! + 1) & 0x0f;
      const d = diffTitleIslandCombined(ctx, { ...baseStruct, tilePixels: tp });
      assert(d.skippedW6Tiles === 1 && d.pixels.length === 0,
        `combined: a world-6-only tile edit is skipped (got skipped=${d.skippedW6Tiles}, pixels=${d.pixels.length})`);
    }
  }
}

// (9) Title island SCENERY (GSU 3D decorations): the DATA_560000.bin source atlas
// exported as a 256×96 4bpp (1 byte/px low-nibble) PNG. Unedited diff is empty; a
// 1-pixel edit changes exactly one source byte and preserves its high nibble.
{
  const scenery = exportTitleScenery(rom, symbols);
  assert(scenery.file === 'screens/title/scenery.png', 'scenery exports to screens/title/scenery.png');
  assert(scenery.width === 256 && scenery.height === 96, `scenery canvas is 256×96 (got ${scenery.width}×${scenery.height})`);

  const ctx = buildTitleSceneryContext(rom, symbols);
  const canvas = renderTitleScenery(ctx);
  assert(ctx.base.length === 256 * 96, `scenery source region is 0x6000 bytes (got 0x${ctx.base.length.toString(16)})`);
  const clean = diffTitleScenery(ctx, canvas.rgba);
  assert(clean.changed === 0, 'unedited scenery diff is empty (round-trips byte-exact)');
  assert(clean.region.length === ctx.base.length && clean.region.every((b, i) => b === ctx.base[i]), 'unedited scenery region == base');

  // Single-image .aseprite round-trip (no tilemap; transparent index 0): flatten ==
  // canvas → diffTitleScenery reports no change.
  const sceneryAse = decodeAsepriteImage(titleSceneryAseprite(ctx, canvas));
  assert(sceneryAse.width === 256 && sceneryAse.height === 96, `scenery .aseprite is 256×96 (got ${sceneryAse.width}×${sceneryAse.height})`);
  assert(eq(sceneryAse.rgba, canvas.rgba), 'scenery .aseprite flatten reproduces the atlas byte-exact');
  assert(diffTitleScenery(ctx, sceneryAse.rgba).changed === 0, 'scenery .aseprite round-trips to 0 changes');

  // 1-pixel edit: recolour a non-transparent pixel to another colour in the row.
  const u32 = new Uint32Array(canvas.rgba.buffer, canvas.rgba.byteOffset, 256 * 96);
  let pi = -1, alt = 0;
  for (let i = 0; i < 256 * 96; i++) {
    const base = ctx.base[i]! & 0x0f;
    if (base === 0) continue; // skip transparent
    // pick a different opaque palette index
    for (let k = 1; k < 16; k++) if (k !== base && ctx.palette[k] !== ctx.palette[base]) { alt = k; break; }
    if (alt) { pi = i; break; }
  }
  assert(pi >= 0, 'found a non-transparent scenery pixel to edit');
  if (pi >= 0) {
    const edited = canvas.rgba.slice();
    new Uint32Array(edited.buffer, edited.byteOffset, 256 * 96)[pi] = ctx.palette[alt]!;
    const d = diffTitleScenery(ctx, edited);
    assert(d.changed === 1, `a 1-pixel scenery edit changes exactly one source byte (got ${d.changed})`);
    assert((d.region[pi]! & 0x0f) === alt, 'scenery edit writes the new colour into the low nibble');
    assert((d.region[pi]! & 0xf0) === (ctx.base[pi]! & 0xf0), 'scenery edit preserves the high nibble');
    assert(d.region.filter((b, i) => b !== ctx.base[i]).length === 1, 'scenery edit touches only the edited byte');
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
