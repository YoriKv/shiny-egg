// Graphics ⇄ PNG round-trip for external editing. A gfx file's paletteless
// indexed tiles are rendered to RGBA with a chosen palette, and a SWATCH strip
// of that palette is appended on the right — the swatch IS the colour↔index
// contract, so the PNG is self-describing: import reads the swatch to recover
// the palette, maps each tile pixel back to its index (exact RGB match; off-
// palette or transparent → index 0), and re-encodes SNES tile bytes for
// `saveGfxEdit`. Unedited tiles round-trip exactly when the palette has no
// duplicate colours; a duplicate maps to the lowest index (visually identical).
//
// Layout: tiles in a `tilesWide`-tile grid on the left, then a `GAP`px gutter,
// then a vertical column of N opaque swatch cells (N = 16 for 4bpp, 4 for 2bpp).
// The swatch cells are always opaque so a transparent index 0 stays eyedroppable.
//
// PER-TILE PALETTES (BG3 fidelity). A 2bpp BG3 sheet's tiles are drawn with
// DIFFERENT 4-colour sub-palettes per tilemap cell (the cell's 3-bit palette
// field), but a tile pixel is still a single 0-3 index into ITS sub-palette —
// the sub-palette is cell metadata, not in the tile. So `gfxToImage`/`imageToGfx`
// accept an optional per-tile palette: each tile is coloured/decoded against its
// OWN sub-palette (passed by the caller from the BG3 tilemap), and the swatch is
// widened (`swatchColors`) to a reference grid of every sub-palette. A global
// colour→index swatch would be WRONG here — BG3 sub-palettes share colours at
// different column positions, so the same RGB can mean different indices in
// different tiles; only per-tile decode is unambiguous.

import type { ImageData } from './png.ts';
import { decode2bppTile, decode4bppTile, encode2bppTile, encode4bppTile } from './tile.ts';

const GAP = 2;
const SWATCH_W = 8;
const MIN_CELL = 4;
const MAX_CELL = 16;

export interface GfxImageLayout {
  /** Tiles per row in the grid (16 for both lz2 and lz16 in YI). */
  tilesWide: number;
  /** Tile rows in the grid (lz16: rowCount; lz2: ceil(tileCount/tilesWide)). */
  tilesTall: number;
  bpp: 2 | 4;
  /** Swatch cell count. Defaults to the bit-depth's per-tile colour count (16 for
   *  4bpp, 4 for 2bpp). BG3's per-tile-fidelity export overrides this to span all
   *  its sub-palettes (≥16 = 4 sub-palettes × 4) so every colour BG3 can use is in
   *  the swatch. Only affects swatch geometry — the tile grid is independent, so
   *  `imageToGfx` decodes correctly without it (it reads `img.width` + per-tile
   *  palettes). */
  swatchColors?: number;
}

const layoutDims = (l: GfxImageLayout) => {
  const N = l.swatchColors ?? (l.bpp === 4 ? 16 : 4);
  const tileBytes = l.bpp === 4 ? 32 : 16;
  const gridW = l.tilesWide * 8;
  const gridH = l.tilesTall * 8;
  const cellH = Math.min(MAX_CELL, Math.max(MIN_CELL, Math.ceil(gridH / N)));
  const swatchX = gridW + GAP;
  return {
    N, tileBytes, gridW, gridH, cellH, swatchX,
    width: swatchX + SWATCH_W,
    height: Math.max(gridH, N * cellH),
  };
};

/** Build the export image: tile grid coloured by `paletteRgba` (N×4 RGBA bytes,
 *  index i = colour i) + an opaque swatch column of those N colours.
 *
 *  `opts.tilePaletteRgba(t)` overrides the colouring of tile `t` with its own
 *  palette (BG3 per-tile fidelity). `paletteRgba` then only feeds the swatch
 *  (the reference grid of every sub-palette). The per-tile palette's alpha is
 *  honoured for tile pixels (BG3 index-0 transparent), but the swatch stays
 *  opaque. */
export function gfxToImage(
  tileBytes: Uint8Array,
  layout: GfxImageLayout,
  paletteRgba: Uint8Array,
  opts: { tilePaletteRgba?: (tileIndex: number) => Uint8Array } = {}
): ImageData {
  const d = layoutDims(layout);
  const rgba = new Uint8Array(d.width * d.height * 4); // transparent ground
  const idx = new Uint8Array(64);
  const tileCount = layout.tilesWide * layout.tilesTall;
  for (let t = 0; t < tileCount; t++) {
    const off = t * d.tileBytes;
    if (off + d.tileBytes > tileBytes.length) break; // partial trailing tile
    if (layout.bpp === 4) decode4bppTile(tileBytes, off, false, false, idx, 0);
    else decode2bppTile(tileBytes, off, false, false, idx, 0);
    const pal = opts.tilePaletteRgba ? opts.tilePaletteRgba(t) : paletteRgba;
    const tcol = t % layout.tilesWide, trow = (t / layout.tilesWide) | 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const v = idx[r * 8 + c]!;
        const di = ((trow * 8 + r) * d.width + tcol * 8 + c) * 4;
        const pi = v * 4;
        rgba[di] = pal[pi]!;
        rgba[di + 1] = pal[pi + 1]!;
        rgba[di + 2] = pal[pi + 2]!;
        rgba[di + 3] = pal[pi + 3]!;
      }
    }
  }
  // Swatch: opaque blocks so a transparent index stays eyedroppable.
  for (let i = 0; i < d.N; i++) {
    const pi = i * 4;
    for (let yy = 0; yy < d.cellH; yy++) {
      for (let xx = 0; xx < SWATCH_W; xx++) {
        const di = ((i * d.cellH + yy) * d.width + d.swatchX + xx) * 4;
        rgba[di] = paletteRgba[pi]!;
        rgba[di + 1] = paletteRgba[pi + 1]!;
        rgba[di + 2] = paletteRgba[pi + 2]!;
        rgba[di + 3] = 255;
      }
    }
  }
  return { rgba, width: d.width, height: d.height };
}

/** Read the swatch palette out of an export-shaped PNG image (N RGB triples,
 *  index i = colour i). Sampled from each cell's centre. */
export function readSwatchPalette(img: ImageData, layout: GfxImageLayout): number[] {
  const d = layoutDims(layout);
  const pal: number[] = [];
  for (let i = 0; i < d.N; i++) {
    const sx = d.swatchX + (SWATCH_W >> 1);
    const sy = i * d.cellH + (d.cellH >> 1);
    const si = (sy * img.width + sx) * 4;
    pal.push((img.rgba[si]! << 16) | (img.rgba[si + 1]! << 8) | img.rgba[si + 2]!);
  }
  return pal;
}

/** Decode SNES tile bytes into a `gridW × gridH` per-pixel index grid (tiles
 *  laid out `tilesWide` across, row-major). Cells past the bytes stay 0. */
function tilesToIndexGrid(tiles: Uint8Array, layout: GfxImageLayout): Uint8Array {
  const d = layoutDims(layout);
  const grid = new Uint8Array(d.gridW * d.gridH);
  const idx = new Uint8Array(64);
  const tileCount = layout.tilesWide * layout.tilesTall;
  for (let t = 0; t < tileCount; t++) {
    const off = t * d.tileBytes;
    if (off + d.tileBytes > tiles.length) break;
    if (layout.bpp === 4) decode4bppTile(tiles, off, false, false, idx, 0);
    else decode2bppTile(tiles, off, false, false, idx, 0);
    const tcol = t % layout.tilesWide, trow = (t / layout.tilesWide) | 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) grid[(trow * 8 + r) * d.gridW + tcol * 8 + c] = idx[r * 8 + c]!;
  }
  return grid;
}

/** Build a colour→index map from a palette (RGB ints), lowest index winning a
 *  duplicate colour (visually identical, keeps the round-trip stable). */
function colorIndexMap(pal: readonly number[]): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = pal.length - 1; i >= 0; i--) map.set(pal[i]!, i);
  return map;
}

/**
 * Convert an export-shaped PNG image back to SNES tile bytes. Reads the swatch
 * for the palette, then maps each tile pixel to its index by exact RGB match
 * (transparent or off-palette → index 0).
 *
 * When `opts.base` (the original tile bytes) is given, a pixel still showing its
 * base colour keeps its ORIGINAL index — so an unedited file round-trips
 * byte-exact even if the palette has duplicate colours; only genuinely repainted
 * pixels are remapped. `opts.index0Transparent` marks index 0 as the transparent
 * key (so a transparent pixel is "unchanged" only where the base was index 0).
 *
 * `opts.tilePalette(t)` decodes tile `t` against its OWN palette (BG3 per-tile
 * fidelity) — the swatch is then ignored (it can't disambiguate sub-palettes
 * that share colours). Each tile's palette is the same RGB list its sub-palette
 * was rendered with at export, so unedited tiles still round-trip byte-exact.
 */
export function imageToGfx(
  img: ImageData,
  layout: GfxImageLayout,
  opts: {
    base?: Uint8Array;
    index0Transparent?: boolean;
    tilePalette?: (tileIndex: number) => readonly number[];
  } = {}
): Uint8Array {
  const d = layoutDims(layout);
  // Global swatch palette/map (used unless a per-tile palette is supplied).
  const globalPal = opts.tilePalette ? null : readSwatchPalette(img, layout);
  const globalMap = globalPal ? colorIndexMap(globalPal) : null;
  const baseGrid = opts.base ? tilesToIndexGrid(opts.base, layout) : null;
  const i0t = opts.index0Transparent ?? false;

  const tileCount = layout.tilesWide * layout.tilesTall;
  const out = new Uint8Array(tileCount * d.tileBytes);
  const idx = new Uint8Array(64);
  for (let t = 0; t < tileCount; t++) {
    const pal = opts.tilePalette ? opts.tilePalette(t) : globalPal!;
    const map = opts.tilePalette ? colorIndexMap(pal) : globalMap!;
    const tcol = t % layout.tilesWide, trow = (t / layout.tilesWide) | 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const gx = tcol * 8 + c, gy = trow * 8 + r;
        let v = 0;
        if (gx < d.gridW && gy < d.gridH) {
          const di = (gy * img.width + gx) * 4;
          const a = img.rgba[di + 3]!;
          const rgb = (img.rgba[di]! << 16) | (img.rgba[di + 1]! << 8) | img.rgba[di + 2]!;
          if (baseGrid) {
            const bi = baseGrid[gy * d.gridW + gx]!;
            const unchanged = i0t && bi === 0 ? a === 0 : a !== 0 && rgb === pal[bi];
            v = unchanged ? bi : a === 0 ? 0 : map.get(rgb) ?? 0;
          } else if (a !== 0) {
            v = map.get(rgb) ?? 0;
          }
        }
        idx[r * 8 + c] = v;
      }
    }
    if (layout.bpp === 4) encode4bppTile(idx, 0, out, t * d.tileBytes);
    else encode2bppTile(idx, 0, out, t * d.tileBytes);
  }
  return out;
}

/** lz16 layout: always 4bpp, 16 tiles wide, `rowCount` tile-rows tall. */
export const lz16Layout = (rowCount: number): GfxImageLayout => ({ tilesWide: 16, tilesTall: rowCount, bpp: 4 });

/** lz2 layout from the decompressed byte length and bit depth. */
export const lz2Layout = (byteLength: number, bpp: 2 | 4): GfxImageLayout => {
  const tileCount = Math.ceil(byteLength / (bpp === 4 ? 32 : 16));
  return { tilesWide: 16, tilesTall: Math.ceil(tileCount / 16), bpp };
};
