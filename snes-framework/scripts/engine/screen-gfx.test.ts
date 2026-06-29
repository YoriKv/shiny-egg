// System-screen gfx export (boot / title / storybook / map). Pins:
//   1. the screens export the expected folder shapes — screens/boot/,
//      screens/storybook/, screens/map/common/ + per-world screens/map/world-N/
//      (NO raw screens/title/ char sheets — only the assembled logo/island/scenery,
//      tested separately), and the `groups` filter partitions them into the
//      `systemscreens` (boot/storybook + title views) vs `worldmap` (map) tracks,
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
  logoTileKeys,
  titleLogoAseprite,
  exportTitleIsland,
  buildTitleIslandContext,
  renderTitleIsland,
  diffTitleIslandTiles,
  titleIslandAseprite,
  diffTitleIslandCombined,
  islandTileChars,
  exportTitleScenery,
  buildTitleSceneryContext,
  renderTitleScenery,
  diffTitleScenery,
  titleSceneryAseprite,
  exportStorybookScene,
  buildStorybookSceneContext,
  renderStorybookScene,
  diffStorybookSceneTiles,
  storybookSceneAseprite,
  type ScreenGfxPng
} from './screen-gfx.ts';
import { decodePng } from './png.ts';
import { decodeAsepriteRegion, decodeAsepriteStructural, decodeAsepriteImage } from './aseprite.ts';
import { diffGfxFileAseprite, diffAsepritePalette } from './gfx-aseprite.ts';
import { imageDataU32ToBgr15 } from './color.ts';
import { imageToGfx, lz16Layout, lz2Layout, readSwatchPalette, type GfxImageLayout } from './gfx-png.ts';
import { decode2bppTile, decode4bppTile, encode2bppTile, encode4bppTile } from './tile.ts';
import { lz2, lz16 } from './decompress/index.ts';
import { snesToPC } from './symbol-map.ts';
import { PALETTE_BLOB_LABEL } from '../palette-edit.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } else console.log(`  ✓ ${m}`); };
const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** The master-blob's current `offset → BGR-15` words from a scene's (provenance, cgram) —
 *  the same source the export read. Pins the palette write-back (unedited → 0 edits). */
function blobWordsFrom(provenance: Int32Array, cgram: Uint8Array): Map<number, number> {
  const w = new Map<number, number>();
  for (let ci = 0; ci < provenance.length; ci++) {
    const off = provenance[ci]!;
    if (off >= 0) w.set(off, (cgram[ci * 2]! | (cgram[ci * 2 + 1]! << 8)) & 0x7fff);
  }
  return w;
}

/** Pin a track's palette write-back: offsets cover the meaningful entries, an unedited
 *  palette → 0 color edits, and flipping the first blob-backed entry → exactly one. */
function assertPaletteRoundTrip(label: string, palette: Uint32Array, offsets: number[], blobWords: Map<number, number>): void {
  assert(offsets.length > 0 && offsets.length <= palette.length, `${label}: paletteOffsets covers the meaningful entries (${offsets.length} of ${palette.length})`);
  assert(diffAsepritePalette(palette, offsets, blobWords).length === 0, `${label}: unedited palette → 0 master-blob color edits`);
  const pi = offsets.findIndex((o) => o >= 0);
  assert(pi >= 0, `${label}: palette has a blob-backed color to edit`);
  if (pi >= 0) {
    const ep = palette.slice();
    ep[pi] = (ep[pi]! ^ 0x00080808) >>> 0; // flip bit 3 of each RGB byte → ±1 in the 5-bit channel
    const eds = diffAsepritePalette(ep, offsets, blobWords);
    assert(eds.length === 1 && eds[0]!.offset === offsets[pi] && eds[0]!.value === imageDataU32ToBgr15(ep[pi]!), `${label}: a 1-color edit → exactly one PaletteEdit at the right offset`);
  }
}

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
// Per-tile palette decoder for fidelity entries (map BG f74/f75) — each tile decodes
// against its own row; the swatch is ignored (same as the import).
const tilePaletteOf = (e: ScreenGfxPng): ((t: number) => readonly number[]) | undefined =>
  e.perTilePalette
    ? (t) => e.perTilePalette!.subPalettes[e.perTilePalette!.tileSub[t] ?? 0] ?? e.perTilePalette!.subPalettes[0]!
    : undefined;

// (1) folder shapes.
const has = (re: RegExp): boolean => entries.some((e) => re.test(e.file));
assert(has(/^screens\/boot\/f[0-9A-F]+\.png$/), 'exports screens/boot/');
// Title raw char sheets (f1D/f1F/f73/f74) are NOT exported — only the assembled
// logo/island/scenery views (emitted by the driver; tested separately below).
assert(!has(/^screens\/title\/f[0-9A-F]+\.png$/), 'no raw screens/title/ char sheets');
assert(has(/^screens\/storybook\/f[0-9A-F]+\.png$/), 'exports screens/storybook/');
assert(has(/^screens\/map\/common\/f[0-9A-F]+\.png$/), 'exports screens/map/common/');
// (Per-world map GFX is now empty: the only per-world map tilesets are the BG1
// fold/Mode-7-only sheets, which the flat-map BG export skips — so common/ holds all
// map gfx files. Per-world content lives in the world-map level-slot icons, exported
// separately by exportWorldMapIcons.)
assert(new Set(entries.map((e) => e.file)).size === entries.length, 'every screen file path is unique');
console.log(`  (exported ${entries.length} screen files)`);

// (1b) groups filter — the `systemscreens` vs `worldmap` track split. `{ system }` emits
// only the boot/title/storybook char sheets; `{ map }` only the per-world map sheets;
// together they partition the full default export with no overlap and no loss.
// The exact prefixes the export driver's path REBASE relies on (systemscreens strips
// `screens/`, worldmap strips `screens/map/`, so each export folder gets a clean layout).
const isMapFile = (f: string): boolean => /^screens\/map\//.test(f);
const sysOnly = exportScreenGfxPngs(rom, symbols, { groups: { system: true, map: false } });
const mapOnly = exportScreenGfxPngs(rom, symbols, { groups: { system: false, map: true } });
assert(sysOnly.length > 0 && sysOnly.every((e) => /^screens\/(boot|title|storybook)\//.test(e.file)), `system group → only boot/title/storybook sheets (${sysOnly.length})`);
assert(mapOnly.length > 0 && mapOnly.every((e) => isMapFile(e.file)), `map group → only screens/map/ sheets (${mapOnly.length})`);
assert(sysOnly.length + mapOnly.length === entries.length, `groups partition the full export (${sysOnly.length}+${mapOnly.length}=${entries.length})`);
const partFiles = new Set([...sysOnly, ...mapOnly].map((e) => e.file));
assert(partFiles.size === entries.length && entries.every((e) => partFiles.has(e.file)), 'groups union == full export, no overlap');

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
  // Palette write-back wiring: the region .aseprite carries a color write-back map (one
  // blob offset per palette entry + the trailing transparent slot). (imagePaletteOffsets'
  // provenance correctness is pinned against real CGRAM by the scenery/icon/level-icon
  // tracks; here we pin the boot region's shape + a self-consistent diff round-trip.)
  const bootOff = bootAse.paletteOffsets!;
  assert(!!bootOff && bootOff.length === 17, `boot region paletteOffsets = 16 colors + trailing slot (got ${bootOff?.length})`);
  assert(bootOff[16] === -1, 'boot region offsets end with a trailing transparent slot (-1)');
  const bootBi = bootOff.slice(0, 16).findIndex((o) => o >= 0); // a blob-backed entry (some OBJ slots have no blob source)
  assert(bootBi >= 0, 'boot region has at least one blob-backed color');
  const bootBlob = new Map<number, number>();
  for (let i = 0; i < 16; i++) if (bootOff[i]! >= 0) bootBlob.set(bootOff[i]!, imageDataU32ToBgr15(dec.palette[i]!));
  assert(diffAsepritePalette(dec.palette, bootOff, bootBlob).length === 0, 'boot region: unedited palette → 0 color edits');
  const bootFlip = dec.palette.slice(); bootFlip[bootBi] = (bootFlip[bootBi]! ^ 0x00080808) >>> 0;
  const bootEd = diffAsepritePalette(bootFlip, bootOff, bootBlob);
  assert(bootEd.length === 1 && bootEd[0]!.offset === bootOff[bootBi], 'boot region: a 1-color edit → exactly one PaletteEdit at the right offset');
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
// per-tile fidelity is active where it should be (map BG f74/f75).
assert(entries.some((e) => /^screens\/map\//.test(e.file) && e.perTilePalette != null), 'map BG terrain uses per-tile palette');

// (3a) Per-tile-palette char sheets (map BG f74/f75, storybook f88) export a
// MULTI-ROW .aseprite (every used CGRAM row's colors concatenated) whose palette round-trips
// to the master blob. (imagePaletteOffsets' provenance correctness is pinned against real
// CGRAM by the scenery/icon/level-icon image tracks; here we pin the multi-row sheets' shape +
// a self-consistent diff round-trip.)
{
  const perTileAse = exportScreenGfxPngs(rom, symbols, { aseprite: true }).filter((e) => e.perTilePalette && e.paletteOffsets);
  assert(perTileAse.length >= 3, `per-tile char sheets emit a multi-row .aseprite + paletteOffsets (got ${perTileAse.length})`);
  for (const e of perTileAse) {
    const aimg = decodeAsepriteImage(e.aseprite!);
    // PIXELS: the multi-row .aseprite must round-trip byte-exact through the per-tile import
    // path (decodeAsepriteImage → imageToGfx with the per-tile palette) — same as the PNG.
    const base = decodeBase(e);
    const round = imageToGfx(aimg, layoutOf(e), { base, index0Transparent: e.index0Transparent, tilePalette: tilePaletteOf(e) }).subarray(0, base.length);
    assert(eq(round, base), `${e.file}: per-tile .aseprite pixel round-trip byte-exact`);
    // COLORS: paletteOffsets parallels the embedded multi-row palette; self-consistent blob
    // words (each blob-backed entry's current color at its offset) → unedited 0, flip → 1.
    const pal = aimg.palette;
    const off = e.paletteOffsets!;
    const bw = new Map<number, number>();
    for (let i = 0; i < off.length; i++) if (off[i]! >= 0) bw.set(off[i]!, imageDataU32ToBgr15(pal[i]!));
    assertPaletteRoundTrip(e.file, pal, off, bw);
  }
}

// (3c) LIVE BASELINE (pixels) — the export reflects UNBUILT gfx edits via `gfxOverride`, so a
// second export taken before a rebuild shows prior edits and re-importing it won't revert them
// (export baseline ≡ the import's `liveTiles`). A no-op override (= base) leaves the export
// byte-identical; an edited override changes only that file and round-trips back to the edit.
{
  const target = entries.find((e) => !e.region && !e.perTilePalette);
  assert(!!target, 'found a full-file single-palette screen entry to test gfxOverride');
  if (target) {
    const base = decodeBase(target);
    const key = `${target.format}/${target.fileId}`;
    const exp = (gfxOverride?: ReadonlyMap<string, Uint8Array>): ScreenGfxPng =>
      exportScreenGfxPngs(rom, symbols, gfxOverride ? { gfxOverride } : {}).find((e) => e.file === target.file)!;
    const plain = exp();
    assert(eq(plain.png, exp(new Map([[key, base]])).png), 'a no-op gfxOverride (= base tiles) leaves the export byte-identical');
    const edited = base.slice(); edited[0] ^= 0xff; edited[1] ^= 0xff; // perturb tile 0 indices
    const live = exp(new Map([[key, edited]]));
    assert(!eq(live.png, plain.png), 'an edited gfxOverride changes the exported file (export reflects the unbuilt edit)');
    // Re-import the live export against the live baseline (decodeBase = the edit) → 0 change.
    const round = imageToGfx(decodePng(Buffer.from(live.png)), layoutOf(live), { base: edited, index0Transparent: live.index0Transparent, tilePalette: tilePaletteOf(live) }).subarray(0, edited.length);
    assert(eq(round, edited), 'the live-edited export re-imports to the edit (no pixel revert across a pre-rebuild cycle)');
  }
}

// (3d) LIVE BASELINE (colors) — `romWithLivePalette` patches the master-palette blob at each
// edit's blob offset; this proves that lands in CGRAM at the index whose provenance is that
// offset, so the export's CGRAM reflects unbuilt color edits (≡ the import's effectiveBlobWords)
// → no color revert pre-rebuild. (Project-free: patches the ROM directly, like the helper does.)
{
  const ctx = buildTitleSceneryContext(rom, symbols);
  const ci = [...ctx.provenance].findIndex((o) => o >= 0);
  assert(ci >= 0, 'scenery palette has a blob-backed CGRAM color to test the blob patch');
  if (ci >= 0) {
    const offset = ctx.provenance[ci]!;
    const blobPC = symbols.pc(PALETTE_BLOB_LABEL);
    const orig = (rom[blobPC + offset]! | (rom[blobPC + offset + 1]! << 8)) & 0x7fff;
    const want = (orig ^ 0x1234) & 0x7fff; // a guaranteed-different 15-bit color
    const patched = rom.slice();
    patched[blobPC + offset] = want & 0xff; patched[blobPC + offset + 1] = (want >> 8) & 0xff;
    const ctx2 = buildTitleSceneryContext(patched, symbols);
    const got = (ctx2.cgram[ci * 2]! | (ctx2.cgram[ci * 2 + 1]! << 8)) & 0x7fff;
    assert(got === want, `a blob patch at provenance[${ci}]'s offset lands in CGRAM[${ci}] (got 0x${got.toString(16)}, want 0x${want.toString(16)})`);
    assert(ctx2.provenance[ci] === offset, 'the blob patch leaves provenance unchanged (same blob source)');
  }
}

// (3b) STORYBOOK narrowed export. The storybook char-sheet export is deliberately
// narrowed to ONE file — f88 (the BG 4bpp sheet, per-tile palette from the capture,
// opaque index 0). f87/f8A/f4A/f8B are no longer exported; f27 moves to the scene-layout
// view (3d). Tilemap-data files (f73/f74/f75) + the never-displayed f89 stay skipped.
{
  const sbook = entries.filter((e) => /^screens\/storybook\//.test(e.file));
  const ids = sbook.map((e) => e.fileId).sort((a, b) => a - b);
  assert(ids.length === 1 && ids[0] === 0x88, `storybook char-sheet export is narrowed to f88 (got ${ids.map((i) => '0x' + i.toString(16)).join(',')})`);
  // The other former sheets + tilemap-data + never-displayed are all absent as char sheets.
  for (const id of [0x73, 0x74, 0x75, 0x87, 0x89, 0x8a, 0x4a, 0x8b, 0x27]) {
    assert(!sbook.some((e) => e.fileId === id), `storybook char sheet 0x${id.toString(16)} not exported (narrowed/scene/skip)`);
  }
  const f88 = sbook.find((e) => e.fileId === 0x88)!;
  assert(f88.bpp === 4 && f88.perTilePalette != null, 'storybook f88 is 4bpp per-tile palette');
  assert(f88.index0Transparent === false, 'storybook BG char f88 has opaque index 0');
}

// (3c) STORYBOOK f88 Aseprite output (single-image, per-tile-colored; the palette lives
// in-file so the `.aseprite` omits the swatch the PNG appends — the bare tile grid). The
// flatten reproduces the PNG's tile-grid region byte-for-byte.
{
  const sbookAse = exportScreenGfxPngs(rom, symbols, { aseprite: true }).filter((e) => /^screens\/storybook\//.test(e.file));
  assert(sbookAse.length === 1 && sbookAse.every((e) => !!e.aseprite), 'storybook f88 builds an .aseprite when requested');
  for (const e of sbookAse) {
    const png = decodePng(Buffer.from(e.png));
    const dec = decodeAsepriteImage(e.aseprite!);
    assert(dec.width < png.width && dec.height <= png.height,
      `storybook ${e.file} .aseprite drops the swatch (${dec.width}×${dec.height} vs png ${png.width}×${png.height})`);
    let match = true;
    for (let y = 0; y < dec.height && match; y++)
      match = eq(dec.rgba.subarray(y * dec.width * 4, (y + 1) * dec.width * 4),
                 png.rgba.subarray(y * png.width * 4, (y * png.width + dec.width) * 4));
    assert(match, `storybook ${e.file} .aseprite flatten == the PNG tile grid (swatch excluded)`);
  }
}

// (3d) STORYBOOK FIRST-SCENE LAYOUT (f27). f27 (the BG3 decorative frame) exports laid
// out as the FIRST scene renders it — the BG3 tilemap read straight from the gfx-bundle
// VRAM (byte-identical to the `storybook-render` trace's first-scene capture). Cells whose
// char lands in f27 are editable + slice back byte-exact; the frame interior is preview-only.
{
  const scene = exportStorybookScene(rom, symbols);
  assert(scene.file === 'screens/storybook/scene-f27.png', 'storybook scene exports to screens/storybook/scene-f27.png');
  assert(scene.faithful, 'storybook scene is faithfully reconstructable (every f27 cell slices back byte-exact)');
  assert(scene.width === 256 && scene.height === 256, `storybook scene canvas is 256×256 (got ${scene.width}×${scene.height})`);

  const ctx = buildStorybookSceneContext(rom, symbols);
  const canvas = renderStorybookScene(ctx);
  const editable = canvas.units.filter((u) => u !== null);
  assert(editable.length > 0 && editable.length < canvas.units.length,
    `storybook scene has both editable f27 cells and preview-only interior cells (got ${editable.length}/${canvas.units.length})`);
  assert(editable.every((u) => u!.fileId === 0x27 && u!.format === 'lz2'), 'every editable scene cell maps to the lz2 f27 char file');

  // Unedited round-trip: diffing the canvas against itself yields no edits.
  const clean = diffStorybookSceneTiles(ctx, canvas, canvas.rgba);
  assert(clean.edits.length === 0 && clean.conflicts === 0, 'unedited storybook scene diff is empty (round-trips byte-exact)');

  // A 1-pixel in-palette edit on an editable cell → exactly one f27 (2bpp) tile edit.
  const u32 = new Uint32Array(canvas.rgba.buffer, canvas.rgba.byteOffset, canvas.width * canvas.height);
  let edited2: Uint8Array | null = null;
  for (const u of editable) {
    const o = u!.cellY * canvas.width + u!.cellX;
    for (let p = 1; p < 64 && !edited2; p++) {
      const px = o + (p % 8) + Math.floor(p / 8) * canvas.width;
      if (u32[px] !== u32[o]) {
        const e = canvas.rgba.slice();
        new Uint32Array(e.buffer, e.byteOffset, canvas.width * canvas.height)[o] = u32[px]!;
        edited2 = e;
      }
    }
    if (edited2) break;
  }
  assert(edited2 !== null, 'found a storybook scene cell with ≥2 colors to test an edit');
  if (edited2) {
    const d = diffStorybookSceneTiles(ctx, canvas, edited2);
    assert(d.edits.length === 1, `a 1-pixel scene edit changes exactly one f27 tile (got ${d.edits.length})`);
    assert(d.edits.every((e) => e.fileId === 0x27 && e.format === 'lz2' && e.bytes.length === 16), 'scene edits are 2bpp f27 (16-byte tiles)');
  }

  // Aseprite tilemap: flatten reproduces the canvas, and round-trips to 0 edits.
  const sceneAseFull = storybookSceneAseprite(ctx, canvas);
  const sceneAse = decodeAsepriteRegion(sceneAseFull.bytes);
  assert(sceneAse.width === canvas.width && sceneAse.height === canvas.height, `scene .aseprite canvas is ${canvas.width}×${canvas.height} (got ${sceneAse.width}×${sceneAse.height})`);
  assert(eq(sceneAse.rgba, canvas.rgba), 'scene .aseprite flatten reproduces the assembled scene byte-exact');
  assert(diffStorybookSceneTiles(ctx, canvas, sceneAse.rgba).edits.length === 0, 'scene .aseprite round-trips to 0 tile edits');

  // Palette write-back: paletteOffsets is one master-blob byte-offset per .aseprite palette
  // entry. Build the blob's current words from (provenance, cgram) — the same source the
  // export read — and confirm an UNEDITED palette diffs to 0 color edits, while flipping
  // one entry yields exactly one PaletteEdit. (The decoder pads the palette to 256 entries;
  // the encoder writes only the meaningful ones, and diffAsepritePalette min-clamps to
  // offsets.length, so offsets covers exactly the meaningful prefix — not the padding.)
  assertPaletteRoundTrip('storybook', sceneAse.palette, sceneAseFull.paletteOffsets, blobWordsFrom(ctx.provenance, ctx.cgram));
}

// (4) 1-pixel edit on tile 0: change pixel (0,0) to another (unique) swatch color
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
  if (k < 0) { console.log(`  (skipped ${label} 1-pixel edit: tile 0 row has no unique alternate color)`); return; }
  const col = pal[k]!;
  img.rgba[0] = (col >> 16) & 0xff; img.rgba[1] = (col >> 8) & 0xff; img.rgba[2] = col & 0xff; img.rgba[3] = k === 0 ? 0 : 255;
  const round = imageToGfx(img, layoutOf(e), { base, index0Transparent: e.index0Transparent }).subarray(0, base.length);
  const ei = idx0.slice(); ei[0] = k;
  const exp = new Uint8Array(tileBytes);
  encode(ei, 0, exp, 0);
  assert(eq(round.subarray(0, tileBytes), exp), `${label} 1-pixel edit: tile 0 byte = expected (index ${bi}→${k})`);
  assert(eq(round.subarray(tileBytes), base.subarray(tileBytes)), `${label} 1-pixel edit: every other tile byte-identical`);
}
// pixelEditCheck reads a single-row swatch, so it only applies to NON-per-tile entries.
// The map's only 4bpp sheets now are the per-tile f74/f75 (covered by the round-trip
// above); the OBJ-marker chrome (single-palette sheets) is no longer exported. So the
// boot region is the remaining swatch-based pixel-edit case here.
pixelEditCheck(boot, 'boot (region)');

// (5) map export is content-correct. The OBJ-marker chrome (cursor $73, HUD $8F, the
// $8C/$95-$A0 path/Yoshi markers, lz16 ≥ $8000) is NOT exported — raw OBJ char, not an
// editable map sheet. So only the world-invariant BG char ($56 ground + $74/$75 terrain)
// is exported, all under common/, each id once. (The per-world OVERWORLD MAP and the
// level-slot icons are their own tracks — world-map-terrain.ts / -level-icons.ts.)
const mapFiles = entries.filter((e) => /^screens\/map\//.test(e.file));
const mapIds = mapFiles.map((e) => e.fileId);
assert(new Set(mapIds).size === mapIds.length, 'each map gfx file id is exported exactly once');
assert(mapFiles.length > 0 && mapFiles.every((e) => /\/common\//.test(e.file)),
  'all exported map char is world-invariant (common/); the OBJ-marker chrome is dropped');
assert(!entries.some((e) => /^screens\/map\/world-\d/.test(e.file)),
  'no per-world map char sheets are exported (OBJ markers removed)');

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
  // 1-pixel edit: find a cell with ≥2 distinct colors, recolor one pixel to
  // another color ALREADY in that cell (guaranteed in-palette) → exactly that tile.
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
  assert(edited2 !== null, 'found a logo cell with ≥2 colors to test an edit');
  if (edited2) {
    const d = diffTitleLogoTiles(ctx, canvas, edited2);
    assert(d.edits.length === 1, `a 1-pixel in-palette logo edit changes exactly one tile (got ${d.edits.length})`);
    assert(d.edits.every((e) => e.format === 'lz2' && e.bytes.length === 16), 'logo edits are 2bpp ($1D, 16-byte tiles)');
  }
  // Aseprite tilemap: the .aseprite flatten reproduces the assembled canvas byte-exact
  // (cell flips re-applied), and the embedded-palette flatten slices back to 0 edits —
  // so the import path is decodeAsepriteRegion → diffTitleLogoTiles.
  const lkeys = logoTileKeys(ctx);
  const logoFull = titleLogoAseprite(ctx, canvas, lkeys);
  const logoAse = decodeAsepriteRegion(logoFull.bytes);
  assert(logoAse.width === canvas.width && logoAse.height === canvas.height, `logo .aseprite canvas is ${canvas.width}×${canvas.height} (got ${logoAse.width}×${logoAse.height})`);
  // Tile 0 is Aseprite's empty tile; every cell (backdrop included) references a real CHR tile
  // at 1..N, so the flatten reproduces the assembled canvas byte-exact.
  assert(eq(logoAse.rgba, canvas.rgba), 'logo .aseprite flatten reproduces the assembled logo byte-exact');
  assert(logoAse.rgba[3] === 255, 'logo: cell 0 (backdrop) renders OPAQUE — it references the backdrop char tile, not the empty tile 0');

  // (6b) COMBINED logo import (Manual tileset mode): one .aseprite = pixels + placement.
  // Unedited → nothing; an in-place pixel edit → ≥1 char edit + 0 placement; a cell move →
  // exactly that word + 0 pixels; fewer tiles than export → refused.
  const lbase = decodeAsepriteStructural(titleLogoAseprite(ctx, canvas, lkeys).bytes);
  // Palette write-back: logo BG2 sub-palettes (CGRAM rows 8..15, 2bpp tight stride 4).
  assertPaletteRoundTrip('title logo', lbase.palette, logoFull.paletteOffsets, blobWordsFrom(ctx.provenance, ctx.cgram));
  const lmeta = logoTileMeta(ctx);
  // Tile 0 = Aseprite's mandatory empty tile (null); the $1D CHR file follows 1:1 at tiles
  // 1..128 in char order (tile i = char 0x300+i-1). The backdrop char 0x322 is a normal tile.
  assert(lmeta[0] === null && lmeta.length === 129, `logo tileset: empty tile 0 + full $1D file (129 entries, got ${lmeta.length})`);
  assert((() => { for (let i = 1; i < lmeta.length; i++) if (lmeta[i]!.char !== 0x300 + i - 1) return false; return true; })(),
    'logo tileset: tile i = char 0x300+i-1 (CHR 1:1 at indices 1..N)');
  assert(lmeta[0x23]!.char === 0x322, `logo tileset: backdrop char 0x322 is a normal tile at index 0x23 (got 0x${lmeta[0x23]?.char.toString(16)})`);
  assert((() => { const d = diffTitleLogoCombined(ctx, lkeys, lbase); return d.placement.length === 0 && d.pixels.length === 0 && d.skipped === 0 && !d.removedTiles; })(),
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
      const d = diffTitleLogoCombined(ctx, lkeys, { ...lbase, tilePixels: tp });
      assert(d.pixels.length >= 1 && d.placement.length === 0, `logo combined: a pixel edit → char edit, no placement (got ${d.pixels.length}px ${d.placement.length}place)`);
    }
  }
  {
    let pi = -1, pj = -1;
    for (let i = 0; i < lbase.cells.length && pj < 0; i++) for (let j = i + 1; j < lbase.cells.length; j++) if (lbase.cells[i]!.tile !== lbase.cells[j]!.tile) { pi = i; pj = j; break; }
    if (pi >= 0) {
      const cells = lbase.cells.slice(); cells[pi] = { ...lbase.cells[pj]! }; // move cell pj's tile into cell pi
      const d = diffTitleLogoCombined(ctx, lkeys, { ...lbase, cells });
      const pcL = symbols.pc('DATA_title_screen_logo_tilemap');
      const origPi = rom[pcL + pi * 2]! | (rom[pcL + pi * 2 + 1]! << 8);
      const mj = lmeta[lbase.cells[pj]!.tile]!;
      const exp = (mj.char & 0x3ff) | ((mj.palRow & 7) << 10) | (origPi & 0x2000) | (lbase.cells[pj]!.hflip ? 0x4000 : 0) | (lbase.cells[pj]!.vflip ? 0x8000 : 0);
      assert(d.placement.length === 1 && d.placement[0]!.offset === pi && d.placement[0]!.value === exp && d.pixels.length === 0,
        `logo combined: a cell move → exactly that word (got ${d.placement.length} place, 0x${d.placement[0]?.value.toString(16)} vs 0x${exp.toString(16)}, ${d.pixels.length}px)`);
    }
  }
  assert((() => { const d = diffTitleLogoCombined(ctx, lkeys, { ...lbase, numTiles: lbase.numTiles - 1 }); return d.removedTiles && d.placement.length === 0 && d.pixels.length === 0; })(),
    'logo combined: fewer tiles than export → removedTiles (refused)');
  {
    const pcL = symbols.pc('DATA_title_screen_logo_tilemap');
    const origAt = (i: number) => rom[pcL + i * 2]! | (rom[pcL + i * 2 + 1]! << 8);
    let textCell = -1; // an interior cell whose vanilla word is a real (non-backdrop) tile
    for (let i = 0; i < lbase.cells.length; i++) { const gx = i % 32, gy = (i / 32) | 0; if (gx > 0 && gx < 31 && gy > 0 && gy < 13 && origAt(i) !== 0x2722) { textCell = i; break; } }
    assert(textCell >= 0, 'logo combined: found an interior text cell');
    // Blanking by PAINTING the backdrop char's own tile (a normal placement) → the $2722 word.
    const backdropTile = lmeta.findIndex((m) => m?.char === 0x322);
    const painted = lbase.cells.slice(); painted[textCell] = { tile: backdropTile, hflip: false, vflip: false };
    const dp = diffTitleLogoCombined(ctx, lkeys, { ...lbase, cells: painted });
    assert(dp.placement.length === 1 && dp.placement[0]!.value === 0x2722 && dp.erased === 0 && dp.pixels.length === 0,
      `logo combined: painting the backdrop char tile → $2722 (got 0x${dp.placement[0]?.value.toString(16)}, erased ${dp.erased})`);
    // ERASING a cell to the empty tile 0 → cell 0's backdrop word, and is counted in `erased`.
    const erasedCells = lbase.cells.slice(); erasedCells[textCell] = { tile: 0 };
    const de = diffTitleLogoCombined(ctx, lkeys, { ...lbase, cells: erasedCells });
    assert(de.erased === 1 && de.placement.length === 1 && de.placement[0]!.offset === textCell && de.placement[0]!.value === 0x2722,
      `logo combined: erasing a cell → cell 0's word 0x2722, erased=1 (got 0x${de.placement[0]?.value.toString(16)}, erased ${de.erased})`);
    // Unedited backdrop cells (which reference a real tile, not the empty) → 0 erased.
    assert(diffTitleLogoCombined(ctx, lkeys, lbase).erased === 0, 'logo combined: unedited → 0 erased');
  }
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
  // 1-pixel edit: recolor one pixel to another color already in that cell.
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
  assert(edited !== null, 'found an island cell with ≥2 colors to test an edit');
  if (edited) {
    const d = diffTitleIslandTiles(ctx, canvas, edited);
    assert(d.edits.length === 1, `a 1-pixel island edit changes exactly one char tile (got ${d.edits.length})`);
    assert(d.edits.every((e) => e.bytes.length === 32), 'island edits are CPC char tiles (32 bytes)');
    // The tile-sharing warning: editing one cell of a char spreads to its other cells.
    assert(d.sharedCells === (cellsPerChar.get(chosenChar)! - 1),
      `island edit reports the other cells reusing the edited tile (got ${d.sharedCells}, char used by ${cellsPerChar.get(chosenChar)})`);
  }
  // Aseprite tilemap: tile 0 holds the blank (sky) char's real pixels (flag bit 4 cleared), so
  // the flatten reproduces the assembled island byte-exact — sky backdrop included.
  const islandAse = decodeAsepriteRegion(titleIslandAseprite(ctx, canvas, islandTileChars(ctx)).bytes);
  assert(islandAse.width === canvas.width && islandAse.height === canvas.height, `island .aseprite canvas is ${canvas.width}×${canvas.height} (got ${islandAse.width}×${islandAse.height})`);
  assert(eq(islandAse.rgba, canvas.rgba), 'island .aseprite flatten reproduces the assembled island byte-exact');
  assert(islandAse.rgba[3] === 255, 'island: cell 0 (sky backdrop) renders OPAQUE — it references the sky char tile, not the empty tile 0');

  // Palette write-back: Mode-7 single palette (CGRAM 0-15, bpp 4 / default stride 16).
  const islandFull = titleIslandAseprite(ctx, canvas, islandTileChars(ctx));
  const istruct = decodeAsepriteStructural(islandFull.bytes);
  assertPaletteRoundTrip('title island', istruct.palette, islandFull.paletteOffsets, blobWordsFrom(ctx.provenance, ctx.cgram));
  // AVAILABLE chars: an unused $B1 char (in the tileset, not placed on the canvas) can be
  // placed → its char writes to DATA_5F9800 (via the combined diff, the production path).
  {
    const t2c = islandTileChars(ctx);
    const usedChars = new Set(Array.from(ctx.tilemap));
    let iav = -1; for (let t = 1; t < t2c.length; t++) if (!usedChars.has(t2c[t]!)) { iav = t; break; }
    assert(iav > 0, 'island export includes available (unused) $B1 chars');
    const cells2 = istruct.cells.slice(); cells2[0] = { tile: iav, hflip: false, vflip: false };
    const d = diffTitleIslandCombined(ctx, t2c, { ...istruct, cells: cells2 });
    assert(d.placement.some((p) => p.offset === 0 && p.value === t2c[iav] && !usedChars.has(p.value)),
      `island placing an available char → that unused char at cell 0 (got ${d.placement.find((p) => p.offset === 0)?.value})`);
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
  const t2c = islandTileChars(ctx);
  const baseStruct = decodeAsepriteStructural(titleIslandAseprite(ctx, canvas, t2c).bytes);
  const exportTileCount = t2c.length;

  // Tile 0 = Aseprite's mandatory empty tile (-1); the $B1 CHR file follows 1:1 at tiles 1..N
  // in char order (tile i = char i-1). Mode-7 → no palette/flip, so a char IS the tile identity.
  assert(t2c[0] === -1, 'island tileset: tile 0 is the empty tile (-1)');
  assert(t2c.length === Math.floor(ctx.b1cpc.length / 32) + 1, `island tileset: empty + full $B1 file (${t2c.length} entries)`);
  assert((() => { for (let i = 1; i < t2c.length; i++) if (t2c[i] !== i - 1) return false; return true; })(),
    'island tileset: tile i = char i-1 (CHR 1:1 at indices 1..N)');

  {
    const d = diffTitleIslandCombined(ctx, t2c, baseStruct);
    assert(d.placement.length === 0 && d.pixels.length === 0 && d.newTiles === 0 &&
      d.unmappedTiles === 0 && d.skippedW6Tiles === 0 && !d.removedTiles,
      'combined: unedited island → no edits of any kind');
  }

  // in-place pixel edit on a USED tile → one char write, no placement. Pick a land cell (a
  // body tile > 0); tile 0 is the blank/sky char (the empty tile) and isn't pixel-editable.
  {
    const t0 = baseStruct.cells.find((c) => c.tile > 0)!.tile;
    const tp = baseStruct.tilePixels.slice();
    tp[t0 * 64] = (tp[t0 * 64]! + 1) & 0x0f;
    const d = diffTitleIslandCombined(ctx, t2c, { ...baseStruct, tilePixels: tp });
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
    const d = diffTitleIslandCombined(ctx, t2c, { ...baseStruct, cells });
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
    const d = diffTitleIslandCombined(ctx, t2c, { ...baseStruct, tilePixels: tp, cells, numTiles: nt + 1 });
    assert(d.newTiles === 1 && d.pixels.length === 1 && d.pixels[0]!.char === ctx.addableChars[0],
      `combined: a new tile → allocated to free char 0x${ctx.addableChars[0]?.toString(16)} (got newTiles=${d.newTiles}, char 0x${d.pixels[0]?.char.toString(16)})`);
    assert(d.placement.length === 1 && d.placement[0]!.offset === 0 && d.placement[0]!.value === ctx.addableChars[0],
      'combined: the new tile is placed at its cell (placement → the allocated char)');
  }

  // fewer tiles than export → refused (indices unreliable)
  {
    const d = diffTitleIslandCombined(ctx, t2c, { ...baseStruct, numTiles: baseStruct.numTiles - 1 });
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
      const d = diffTitleIslandCombined(ctx, t2c, { ...baseStruct, tilePixels: tp });
      assert(d.skippedW6Tiles === 1 && d.pixels.length === 0,
        `combined: a world-6-only tile edit is skipped (got skipped=${d.skippedW6Tiles}, pixels=${d.pixels.length})`);
    }
  }

  // Erasing a cell to the empty tile 0 → cell 0's authored backdrop (sky) char, counted in
  // `erased` so the importer can warn. Unedited → 0 erased.
  {
    const cell0 = ctx.tilemap[0]!; // cell 0 = the authored sky backdrop char
    let landCell = -1; // an interior cell whose vanilla char is NOT the backdrop
    for (let i = 0; i < baseStruct.cells.length; i++) { const gx = i % 32, gy = (i / 32) | 0; if (gx > 0 && gx < 31 && gy > 0 && gy < 31 && ctx.tilemap[i] !== cell0) { landCell = i; break; } }
    assert(landCell >= 0, 'combined: found an interior land cell to erase');
    const cells = baseStruct.cells.slice(); cells[landCell] = { tile: 0 };
    const d = diffTitleIslandCombined(ctx, t2c, { ...baseStruct, cells });
    assert(d.erased === 1 && d.placement.length === 1 && d.placement[0]!.offset === landCell && d.placement[0]!.value === cell0 && d.pixels.length === 0,
      `combined: erasing a cell → cell 0's char 0x${cell0.toString(16)}, erased=1 (got 0x${d.placement[0]?.value.toString(16)}, erased ${d.erased})`);
    assert(diffTitleIslandCombined(ctx, t2c, baseStruct).erased === 0, 'combined: unedited island → 0 erased');
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
  const sceneryFull = titleSceneryAseprite(ctx, canvas);
  const sceneryAse = decodeAsepriteImage(sceneryFull.bytes);
  assert(sceneryAse.width === 256 && sceneryAse.height === 96, `scenery .aseprite is 256×96 (got ${sceneryAse.width}×${sceneryAse.height})`);
  assert(eq(sceneryAse.rgba, canvas.rgba), 'scenery .aseprite flatten reproduces the atlas byte-exact');
  assert(diffTitleScenery(ctx, sceneryAse.rgba).changed === 0, 'scenery .aseprite round-trips to 0 changes');
  // Palette write-back: scenery OBJ row 7 (CGRAM 240-255, single row, index 0 transparent).
  assertPaletteRoundTrip('title scenery', sceneryAse.palette, sceneryFull.paletteOffsets, blobWordsFrom(ctx.provenance, ctx.cgram));

  // 1-pixel edit: recolor a non-transparent pixel to another color in the row.
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
    assert((d.region[pi]! & 0x0f) === alt, 'scenery edit writes the new color into the low nibble');
    assert((d.region[pi]! & 0xf0) === (ctx.base[pi]! & 0xf0), 'scenery edit preserves the high nibble');
    assert(d.region.filter((b, i) => b !== ctx.base[i]).length === 1, 'scenery edit touches only the edited byte');
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
