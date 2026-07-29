// Graphics ⇄ PNG round-trip for external editing. A gfx file's paletteless indexed
// tiles are rendered to an INDEXED PNG (color type 3) whose PLTE *is* the SNES
// palette — the file is self-describing without stitching a swatch strip beside the
// art (which is what this used to do; every editor shows a PLTE, none show a swatch).
// Import reads the indices straight back, so an untouched export round-trips byte-
// exact even when the palette repeats a color, and re-encodes SNES tile bytes for
// `saveGfxEdit`.
//
// Layout: just the tile grid — `tilesWide` × `tilesTall` 8×8 tiles, tile N at
// (N % tilesWide, N / tilesWide). No gutter, no swatch.
//
// IMPORT MATCHING (the two cases `imageToGfx` handles):
//   • INDEXED PNG whose PLTE still matches the export palette → match BY INDEX. The
//     only exact answer: a color can be ambiguous (duplicate palette entries, per-tile
//     sub-palettes sharing colors), an index never is.
//   • anything else (truecolor save, re-indexed with a different palette) → match by
//     COLOR: exact first, else CLOSEST palette color (`nearestPaletteIndex`), with the
//     base-aware rule below so unedited pixels keep their original index regardless.
//
// PER-TILE PALETTES (BG3 fidelity). A 2bpp BG3 sheet's tiles are drawn with DIFFERENT
// 4-color sub-palettes per tilemap cell (the cell's 3-bit palette field), but a tile
// pixel is still a single 0-3 index into ITS sub-palette — the sub-palette is cell
// metadata, not in the tile. So the exported PLTE is every sub-palette concatenated
// (`subPalettes`), and tile `t` (sub-palette `s = tileSub(t)`, `cpr` colors per row)
// writes pixel value `v` as PLTE index `s * cpr + v`: the picture shows each tile in
// its real colors AND the index still decodes unambiguously. A single flat color→index
// map would be WRONG here — BG3 sub-palettes share colors at different positions, so
// the same RGB means different indices in different tiles.

import { nearestPaletteIndex } from './color.ts';
import { type ImageData, type IndexedImage } from './png.ts';
import { decode2bppTile, decode4bppTile, encode2bppTile, encode4bppTile } from './tile.ts';

export interface GfxImageLayout {
  /** Tiles per row in the grid (16 for both lz2 and lz16 in YI). */
  tilesWide: number;
  /** Tile rows in the grid (lz16: rowCount; lz2: ceil(tileCount/tilesWide)). */
  tilesTall: number;
  bpp: 2 | 4;
}

/** Colors per palette row for a bit depth — also the per-tile index stride in a
 *  per-tile-palette sheet's PLTE. */
export const colorsForBpp = (bpp: 2 | 4): number => (bpp === 4 ? 16 : 4);

const layoutDims = (l: GfxImageLayout) => ({
  tileBytes: l.bpp === 4 ? 32 : 16,
  width: l.tilesWide * 8,
  height: l.tilesTall * 8
});

/** Build the export image: the tile grid colored by `paletteRgba` (N×4 RGBA bytes,
 *  color i at `i*4`), as an INDEXED image (indices + palette) ready for
 *  `encodeIndexedPng`. `.rgba` is filled too, so callers that also emit an `.aseprite`
 *  can crop the rendered pixels straight out of it.
 *
 *  `opts.tileSub(t)` gives tile `t`'s sub-palette index (BG3/BG2 per-tile fidelity):
 *  the tile is colored from `paletteRgba`'s `tileSub(t)`-th block of `colorsForBpp(bpp)`
 *  colors, and its pixels index into that block. Without it the whole sheet uses the
 *  first (only) block. The palette's alpha is honoured — index 0 of a sprite/BG3 row is
 *  transparent, which rides in the PNG's tRNS. */
export function gfxToImage(
  tileBytes: Uint8Array,
  layout: GfxImageLayout,
  paletteRgba: Uint8Array,
  opts: { tileSub?: (tileIndex: number) => number } = {}
): IndexedImage {
  const d = layoutDims(layout);
  const cpr = colorsForBpp(layout.bpp);
  const palette = new Uint32Array(Math.floor(paletteRgba.length / 4));
  for (let i = 0; i < palette.length; i++) {
    palette[i] = ((paletteRgba[i * 4 + 3]! << 24) | (paletteRgba[i * 4 + 2]! << 16) | (paletteRgba[i * 4 + 1]! << 8) | paletteRgba[i * 4]!) >>> 0;
  }
  const rgba = new Uint8Array(d.width * d.height * 4); // transparent ground
  const indices = new Uint8Array(d.width * d.height);
  const idx = new Uint8Array(64);
  const tileCount = layout.tilesWide * layout.tilesTall;
  for (let t = 0; t < tileCount; t++) {
    const off = t * d.tileBytes;
    if (off + d.tileBytes > tileBytes.length) break; // partial trailing tile
    if (layout.bpp === 4) decode4bppTile(tileBytes, off, false, false, idx, 0);
    else decode2bppTile(tileBytes, off, false, false, idx, 0);
    const palBase = (opts.tileSub ? opts.tileSub(t) : 0) * cpr;
    const tcol = t % layout.tilesWide, trow = (t / layout.tilesWide) | 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = palBase + idx[r * 8 + c]!;
        const px = (trow * 8 + r) * d.width + tcol * 8 + c;
        indices[px] = p;
        const pi = p * 4;
        rgba[px * 4] = paletteRgba[pi]!;
        rgba[px * 4 + 1] = paletteRgba[pi + 1]!;
        rgba[px * 4 + 2] = paletteRgba[pi + 2]!;
        rgba[px * 4 + 3] = paletteRgba[pi + 3]!;
      }
    }
  }
  return { rgba, width: d.width, height: d.height, indices, palette };
}

/** Decode SNES tile bytes into a `gridW × gridH` per-pixel index grid (tiles
 *  laid out `tilesWide` across, row-major). Cells past the bytes stay 0. */
function tilesToIndexGrid(tiles: Uint8Array, layout: GfxImageLayout): Uint8Array {
  const d = layoutDims(layout);
  const grid = new Uint8Array(d.width * d.height);
  const idx = new Uint8Array(64);
  const tileCount = layout.tilesWide * layout.tilesTall;
  for (let t = 0; t < tileCount; t++) {
    const off = t * d.tileBytes;
    if (off + d.tileBytes > tiles.length) break;
    if (layout.bpp === 4) decode4bppTile(tiles, off, false, false, idx, 0);
    else decode2bppTile(tiles, off, false, false, idx, 0);
    const tcol = t % layout.tilesWide, trow = (t / layout.tilesWide) | 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) grid[(trow * 8 + r) * d.width + tcol * 8 + c] = idx[r * 8 + c]!;
  }
  return grid;
}

/** An RGB-int palette (the manifest's on-disk form) as ImageData-packed u32s. `alpha0`
 *  marks index 0 transparent (sprite / BG3 index-0 semantics) so a nearest-color match
 *  can't resolve painted pixels onto it. */
function packPalette(pal: readonly number[], alpha0: boolean): Uint32Array {
  const out = new Uint32Array(pal.length);
  for (let i = 0; i < pal.length; i++) {
    const c = pal[i]!; // 0xRRGGBB
    const a = i === 0 && alpha0 ? 0 : 0xff;
    out[i] = ((a << 24) | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0;
  }
  return out;
}

/** True when the PNG's own palette still IS the export palette (same colors, same
 *  order, for as many entries as the export defined) — the precondition for trusting
 *  its indices. An editor that re-indexed the image against a different palette fails
 *  this and falls back to color matching. Alpha is ignored: editors differ on whether
 *  they keep a tRNS entry. */
function paletteMatches(png: Uint32Array | undefined, expected: readonly number[]): boolean {
  if (!png || png.length < expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    const c = expected[i]!; // 0xRRGGBB vs the PNG's packed 0xAABBGGRR
    const want = (((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0;
    if ((png[i]! & 0x00ffffff) !== want) return false;
  }
  return true;
}

/**
 * Convert an edited export PNG back to SNES tile bytes.
 *
 * Matching, per the module header: an INDEXED PNG whose PLTE still matches the export
 * palette is read BY INDEX (`v = index - tileSub*colorsPerRow`); anything else is
 * matched BY COLOR — exact, else the closest palette color.
 *
 * `opts.palette` is the export palette as RGB ints (index i = color i) — the manifest's
 * record of what the file was exported with. `opts.subPalettes` + `opts.tileSub` replace
 * it for a per-tile-palette sheet: the full palette is the sub-palettes concatenated,
 * and tile `t` decodes against `subPalettes[tileSub(t)]`. With neither, the palette is
 * read from a legacy swatch strip (see `legacySwatchPalette`).
 *
 * When `opts.base` (the original tile bytes) is given, a pixel still showing its base
 * color keeps its ORIGINAL index — so an unedited file round-trips byte-exact even if
 * the palette has duplicate colors and the artist's tool dropped the indexing; only
 * genuinely repainted pixels are re-matched. `opts.index0Transparent` marks index 0 as
 * the transparent key (so a transparent pixel is "unchanged" only where the base was
 * index 0).
 *
 * `opts.stats.offPalette` counts PAINTED pixels whose color was in no palette slot and
 * so resolved to the NEAREST one — the import surfaces it as an advisory (anti-aliased
 * edits and off-palette paint land here; they now approximate instead of vanishing).
 */
export function imageToGfx(
  img: ImageData,
  layout: GfxImageLayout,
  opts: {
    palette?: readonly number[];
    subPalettes?: readonly (readonly number[])[];
    tileSub?: (tileIndex: number) => number;
    base?: Uint8Array;
    index0Transparent?: boolean;
    stats?: { offPalette: number };
  } = {}
): Uint8Array {
  const d = layoutDims(layout);
  const cpr = colorsForBpp(layout.bpp);
  const i0t = opts.index0Transparent ?? false;
  const perTile = opts.subPalettes && opts.subPalettes.length > 0;
  // The palette we EXPECT the file to have been exported with: the per-tile sub-palettes,
  // or the single recorded palette. With neither, an indexed file speaks for itself (its
  // own PLTE), and a truecolor one must be a legacy swatch-strip export.
  const expected: readonly (readonly number[])[] | null = perTile
    ? opts.subPalettes!
    : opts.palette
      ? [opts.palette]
      : null;
  const subs: readonly (readonly number[])[] =
    expected ?? [img.palette ? [...img.palette].map((u) => ((u & 0xff) << 16) | (u & 0xff00) | ((u >>> 16) & 0xff)) : legacySwatchPalette(img, layout)];
  const packed = subs.map((s) => packPalette(s, i0t));
  const subOf = perTile && opts.tileSub ? opts.tileSub : (): number => 0;
  // Index fast path: an indexed file whose PLTE still IS the export palette (or, with no
  // recorded palette to check against, any indexed file) — each pixel's index is then the
  // artist's exact choice (v = index - the tile's sub base).
  const byIndex = img.indices !== undefined && (!expected || paletteMatches(img.palette, expected.flatMap((s) => [...s])));
  const baseGrid = opts.base ? tilesToIndexGrid(opts.base, layout) : null;

  /** One pixel by COLOR: base-aware "unchanged" first, then exact, then nearest. */
  const matchByColor = (px: number, baseIdx: number, pal: readonly number[], palU32: Uint32Array): number => {
    const di = px * 4;
    const a = img.rgba[di + 3]!;
    const rgb = (img.rgba[di]! << 16) | (img.rgba[di + 1]! << 8) | img.rgba[di + 2]!;
    if (baseIdx >= 0) {
      const unchanged = i0t && baseIdx === 0 ? a === 0 : a !== 0 && rgb === pal[baseIdx];
      if (unchanged) return baseIdx;
    }
    if (a === 0) return 0; // erased → index 0 (the transparent key)
    const exact = pal.indexOf(rgb);
    if (exact >= 0) return exact;
    if (opts.stats) opts.stats.offPalette++;
    const u = (0xff000000 | (img.rgba[di + 2]! << 16) | (img.rgba[di + 1]! << 8) | img.rgba[di]!) >>> 0;
    return nearestPaletteIndex(palU32, u, cpr);
  };

  const tileCount = layout.tilesWide * layout.tilesTall;
  const out = new Uint8Array(tileCount * d.tileBytes);
  const idx = new Uint8Array(64);
  for (let t = 0; t < tileCount; t++) {
    const sub = subOf(t);
    const pal = subs[sub] ?? subs[0]!;
    const palU32 = packed[sub] ?? packed[0]!;
    const palBase = sub * cpr;
    const tcol = t % layout.tilesWide, trow = (t / layout.tilesWide) | 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const gx = tcol * 8 + c, gy = trow * 8 + r;
        let v = 0;
        if (gx < d.width && gy < d.height && gx < img.width && gy < img.height) {
          const px = gy * img.width + gx;
          const bi = baseGrid ? baseGrid[gy * d.width + gx]! : -1;
          if (byIndex) {
            const pi = img.indices![px]! - palBase;
            // In range ⇒ the artist's index. Out of range means they painted with
            // another sub-palette's color, which only the color path can resolve.
            v = pi >= 0 && pi < cpr ? pi : matchByColor(px, bi, pal, palU32);
          } else v = matchByColor(px, bi, pal, palU32);
        }
        idx[r * 8 + c] = v;
      }
    }
    if (layout.bpp === 4) encode4bppTile(idx, 0, out, t * d.tileBytes);
    else encode2bppTile(idx, 0, out, t * d.tileBytes);
  }
  return out;
}

// ── Legacy (pre-indexed-PNG) exports ────────────────────────────────────────
// Exports written before the indexed-PNG switch stitched an opaque SWATCH column of
// the palette to the right of the tile grid (8px wide, after a 2px gutter, each color
// a cell `ceil(gridH / N)` tall clamped to 4..16px), and the manifest carried no
// palette. A folder exported by an older shiny-egg is still importable: with no
// `opts.palette`, read that strip back. New exports never produce it.

const LEGACY_GAP = 2, LEGACY_SWATCH_W = 8, LEGACY_MIN_CELL = 4, LEGACY_MAX_CELL = 16;

/** Recover a legacy export's palette (N RGB ints) from its swatch column, sampling each
 *  cell's centre. Returns a black palette if the image has no swatch (nothing to read),
 *  which leaves every painted pixel to the nearest-color path. */
export function legacySwatchPalette(img: ImageData, layout: GfxImageLayout): number[] {
  const gridW = layout.tilesWide * 8, gridH = layout.tilesTall * 8;
  // Only the single-palette case reaches here (a per-tile sheet's import passes
  // `subPalettes` from the manifest), so the strip holds exactly one row of colors.
  const n = colorsForBpp(layout.bpp);
  const swatchX = gridW + LEGACY_GAP;
  const cellH = Math.min(LEGACY_MAX_CELL, Math.max(LEGACY_MIN_CELL, Math.ceil(gridH / n)));
  const pal: number[] = [];
  for (let i = 0; i < n; i++) {
    const sx = swatchX + (LEGACY_SWATCH_W >> 1);
    const sy = i * cellH + (cellH >> 1);
    if (sx >= img.width || sy >= img.height) { pal.push(0); continue; }
    const si = (sy * img.width + sx) * 4;
    pal.push((img.rgba[si]! << 16) | (img.rgba[si + 1]! << 8) | img.rgba[si + 2]!);
  }
  return pal;
}

/** lz16 layout: always 4bpp, 16 tiles wide, `rowCount` tile-rows tall. */
export const lz16Layout = (rowCount: number): GfxImageLayout => ({ tilesWide: 16, tilesTall: rowCount, bpp: 4 });

/** lz2 layout from the decompressed byte length and bit depth. */
export const lz2Layout = (byteLength: number, bpp: 2 | 4): GfxImageLayout => {
  const tileCount = Math.ceil(byteLength / (bpp === 4 ? 32 : 16));
  return { tilesWide: 16, tilesTall: Math.ceil(tileCount / 16), bpp };
};

/** An RGBA palette buffer (4 bytes per color) as the manifest's RGB-int form
 *  (`0xRRGGBB` per entry) — what the export records so the import can color-match a
 *  PNG the artist saved without its palette. */
export function rgbaToRgbInts(rgba: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i * 4 < rgba.length; i++) out.push((rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!);
  return out;
}
