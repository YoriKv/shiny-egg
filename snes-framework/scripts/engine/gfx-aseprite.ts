// Aseprite tileset/tilemap export for the tile-based graphics that AREN'T BG-region
// (research/graphics-editing/aseprite-export.md §6): the faithful gfx sheets and the
// assembled screens (title logo / island). Generalises the BG-region adapters
// (bg-region.ts) into one primitive:
//
//   tilesAseprite(tileset + arrangement + CGRAM) → an indexed `.aseprite` (tileset +
//   tilemap layer + flattened-CGRAM palette, the §1 transparency rule). Flatten with
//   the codec's decodeAsepriteRegion; the existing per-tile base-aware slicers consume
//   the RGBA unchanged. `diffGfxFileAseprite` is the faithful-sheet slice (the .aseprite
//   twin of imageToGfx — base-aware, per palette row, bpp-correct re-plane).

import { encodeAseprite, encodeAsepriteImage, type AsepriteCell } from './aseprite.ts';
import { decode2bppTile, decode4bppTile, encode2bppTile, encode4bppTile } from './tile.ts';
import { buildPaletteRow, paletteIndexOf } from './color.ts';

const TILE_PX = 8;

/** One tileset tile: its UN-flipped indexed pixels (local 0..colorsPerRow-1) + the
 *  CGRAM palette row it's coloured in (so the flat palette + transparency are right). */
export interface TilesetTile {
  indices: Uint8Array; // tileW*tileH local indices
  paletteRow: number;  // 0..15
}

/** A changed tileset tile, ready for the file write-back. */
export interface TileEdit {
  tileIndex: number;
  bytes: Uint8Array;
}

/**
 * Build an `.aseprite` (indexed tileset + one tilemap layer) from a tileset + a
 * tilemap `cells` arrangement (row-major, `cell.tile` 1-based into `tiles`, 0 =
 * empty) + CGRAM. Palette = the rows the tiles use, flattened at the bpp stride.
 * Transparency (§1): `index0Transparent` (sprites/BG2/BG3) ⇒ each row's local-0
 * collapses to the single transparent index 0; else (BG1-opaque) index 0 is a real
 * colour and a trailing transparent slot covers empty cells. Flatten reproduces the
 * rendered RGBA byte-for-byte (every entry resolves to a palette colour with the
 * cell flip re-applied the same way `decode{2,4}bppTile` does).
 */
export function tilesAseprite(args: {
  cgram: Uint8Array;
  bpp: 2 | 4;
  tileW: number;
  tileH: number;
  tiles: TilesetTile[];
  cells: AsepriteCell[];
  tilesAcross: number;
  tilesDown: number;
  index0Transparent: boolean;
  /** CGRAM colours per palette-row STEP, when the cart loads rows at a wider stride
   *  than the tile reads (`buildPaletteRow`'s `rowStride`). Defaults to the tight
   *  bpp stride (16 @ 4bpp, 4 @ 2bpp). Pass 16 for the Mode-0 title logo (2bpp tiles,
   *  16-colour-strided BG palette — see screen-gfx.ts `LOGO_ROW_STRIDE`); otherwise
   *  the embedded palette would mis-colour palRow≥1 and break the render-flatten
   *  equality the import path relies on. */
  rowStride?: number;
  layerName?: string;
  tilesetName?: string;
}): Uint8Array {
  const { cgram, bpp, tileW, tileH, tiles, cells, tilesAcross, tilesDown, index0Transparent } = args;
  const cpr = bpp === 4 ? 16 : 4;
  const stride = args.rowStride ?? cpr;
  const usedRows = [...new Set(tiles.map((t) => t.paletteRow))].sort((a, b) => a - b);
  const rowToBase = new Map<number, number>();
  usedRows.forEach((r, k) => rowToBase.set(r, k * cpr));

  let palette: Uint32Array;
  let transparentIndex: number;
  if (index0Transparent) {
    // Each used row's local-0 composites transparent (alpha-0 entry, matching the
    // PNG swatch); collapse every row's local-0 to the single index 0.
    palette = new Uint32Array(Math.max(1, usedRows.length * cpr));
    usedRows.forEach((r, k) => {
      const row = buildPaletteRow(cgram, r, true, 'expand', cpr, stride);
      for (let i = 0; i < cpr; i++) palette[k * cpr + i] = row[i]!;
    });
    transparentIndex = 0;
  } else {
    // Index 0 is an opaque colour (BG1 backdrop); append one transparent slot for
    // empty cells / out-of-range pixels.
    transparentIndex = usedRows.length * cpr;
    palette = new Uint32Array(transparentIndex + 1);
    usedRows.forEach((r, k) => {
      const row = buildPaletteRow(cgram, r, false, 'expand', cpr, stride);
      for (let i = 0; i < cpr; i++) palette[k * cpr + i] = row[i]!;
    });
  }

  const aseTiles: Uint8Array[] = [new Uint8Array(tileW * tileH)]; // tile 0 = empty
  for (const t of tiles) {
    const base = rowToBase.get(t.paletteRow)!;
    const px = new Uint8Array(tileW * tileH);
    for (let i = 0; i < px.length; i++) {
      const li = t.indices[i]!;
      px[i] = index0Transparent ? (li === 0 ? transparentIndex : base + li) : base + li;
    }
    aseTiles.push(px);
  }

  return encodeAseprite({
    tileW, tileH, tilesAcross, tilesDown,
    tiles: aseTiles, cells, palette, transparentIndex,
    layerName: args.layerName ?? 'GFX', tilesetName: args.tilesetName ?? 'tiles'
  });
}

/**
 * A "single image with palette" `.aseprite` (no tileset/tilemap) from an assembled RGBA
 * view + the meaningful CGRAM palette colours (the same the PNG swatch shows) — for the
 * non-tilemap exports (world/level icons, title scenery, metasprites, metatiles). Each
 * pixel is reverse-mapped to its palette index by EXACT colour (transparent pixels → the
 * transparent index), so `decodeAsepriteImage` reproduces the RGBA byte-for-byte and the
 * existing RGBA base-aware slicers consume it unchanged — the import contract is the
 * render, exactly like the PNG path (no swatch needed; the palette is embedded).
 * `index0Transparent` matches the owner's index-0 semantics: sprites/scenery transparent-0
 * (alpha-0 pixels → index 0); BG icons/metatiles opaque-0 ⇒ a trailing transparent slot
 * covers any alpha-0 pixel. Off-palette opaque pixels are appended so the flatten stays
 * exact (capped at the 256 indexed-mode max).
 */
export function imageAseprite(args: {
  rgba: Uint8Array;
  width: number;
  height: number;
  /** Meaningful colours (e.g. the used CGRAM rows), ImageData u32 form (`r|g<<8|b<<16|a<<24`). */
  palette: Uint32Array | readonly number[];
  index0Transparent: boolean;
  layerName?: string;
}): Uint8Array {
  const u32 = new Uint32Array(args.rgba.buffer, args.rgba.byteOffset, args.width * args.height);
  const pal: number[] = Array.from(args.palette, (c) => c >>> 0);
  const colorToIdx = new Map<number, number>();
  for (let i = pal.length - 1; i >= 0; i--) colorToIdx.set(pal[i]!, i); // first occurrence wins
  let transparentIndex: number;
  if (args.index0Transparent) {
    if (pal.length === 0) pal.push(0);
    transparentIndex = 0;
  } else {
    transparentIndex = pal.length;
    pal.push(0); // alpha-0 trailing slot for any transparent / out-of-range pixel
    colorToIdx.set(0, transparentIndex);
  }
  const pixels = new Uint8Array(args.width * args.height);
  for (let i = 0; i < pixels.length; i++) {
    const c = u32[i]! >>> 0;
    if ((c >>> 24) === 0) { pixels[i] = transparentIndex; continue; } // transparent pixel
    let idx = colorToIdx.get(c);
    if (idx === undefined) {
      if (pal.length < 256) { idx = pal.length; pal.push(c); colorToIdx.set(c, idx); }
      else idx = transparentIndex; // palette full (shouldn't happen for these views)
    }
    pixels[i] = idx;
  }
  return encodeAsepriteImage({ width: args.width, height: args.height, pixels, palette: Uint32Array.from(pal), transparentIndex, layerName: args.layerName ?? 'image' });
}

/**
 * A faithful gfx sheet as an `.aseprite`: the file's tiles laid out in a
 * `cellsPerRow`-wide grid (tile N → cell N), each coloured in its palette row.
 * `paletteRowPerTile(t)` is the CGRAM row for file-tile `t` (a single row for most
 * files; the per-tile row for BG2/BG3). `index0Transparent` matches the PNG export's
 * flag (true for sprites/BG2/BG3, false for BG1/HUD).
 */
export function gfxFileAseprite(args: {
  cgram: Uint8Array;
  bpp: 2 | 4;
  tileData: Uint8Array;
  paletteRowPerTile: (tileIndex: number) => number;
  index0Transparent: boolean;
  cellsPerRow?: number;
  layerName?: string;
}): Uint8Array {
  const { cgram, bpp, tileData, paletteRowPerTile, index0Transparent } = args;
  const cellsPerRow = args.cellsPerRow ?? 16;
  const tileBytes = bpp === 4 ? 32 : 16;
  const decode = bpp === 4 ? decode4bppTile : decode2bppTile;
  const total = Math.floor(tileData.length / tileBytes);
  const tiles: TilesetTile[] = [];
  const local = new Uint8Array(64);
  for (let t = 0; t < total; t++) {
    decode(tileData, t * tileBytes, false, false, local, 0);
    tiles.push({ indices: local.slice(), paletteRow: paletteRowPerTile(t) });
  }
  const tilesDown = Math.max(1, Math.ceil(total / cellsPerRow));
  const cells: AsepriteCell[] = [];
  for (let i = 0; i < cellsPerRow * tilesDown; i++) cells.push({ tile: i < total ? i + 1 : 0 });
  return tilesAseprite({
    cgram, bpp, tileW: TILE_PX, tileH: TILE_PX, tiles, cells,
    tilesAcross: cellsPerRow, tilesDown, index0Transparent,
    layerName: args.layerName ?? 'GFX', tilesetName: 'tiles'
  });
}

/**
 * Slice an edited faithful-sheet `.aseprite` flatten (RGBA, `cellsPerRow*8` wide)
 * back to changed CHR tiles — the `.aseprite` twin of `imageToGfx`. Base-aware (a
 * pixel still at its base colour keeps its base index), bpp-correct. `palette` is the
 * file's single render row — pass the `.aseprite`'s own palette (decodeAsepriteRegion
 * `palette`; its first `colorsPerRow` entries ARE that row), so no cart context is
 * needed. `baseTileData` is the file's current decompressed tiles. Returns only the
 * tiles whose bytes changed.
 */
export function diffGfxFileAseprite(args: {
  palette: Uint32Array;
  bpp: 2 | 4;
  baseTileData: Uint8Array;
  flatten: Uint8Array; // RGBA, width = cellsPerRow*8
  width: number;
}): TileEdit[] {
  const { palette, bpp, baseTileData, flatten, width } = args;
  const cpr = bpp === 4 ? 16 : 4;
  const tileBytes = bpp === 4 ? 32 : 16;
  const decode = bpp === 4 ? decode4bppTile : decode2bppTile;
  const encode = bpp === 4 ? encode4bppTile : encode2bppTile;
  const cellsPerRow = width / TILE_PX;
  const total = Math.floor(baseTileData.length / tileBytes);
  const u32 = new Uint32Array(flatten.buffer, flatten.byteOffset, flatten.length >>> 2);

  const baseIdx = new Uint8Array(64);
  const rawIdx = new Uint8Array(64);
  const out: TileEdit[] = [];
  for (let t = 0; t < total; t++) {
    decode(baseTileData, t * tileBytes, false, false, baseIdx, 0);
    const cx = (t % cellsPerRow) * TILE_PX;
    const cy = Math.floor(t / cellsPerRow) * TILE_PX;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const u = u32[(cy + y) * width + cx + x]!;
        const bIdx = baseIdx[y * TILE_PX + x]!;
        rawIdx[y * TILE_PX + x] = u === palette[bIdx] ? bIdx : paletteIndexOf(palette, u, cpr);
      }
    }
    const bytes = new Uint8Array(tileBytes);
    encode(rawIdx, 0, bytes, 0);
    let changed = false;
    for (let k = 0; k < tileBytes; k++) if (bytes[k] !== baseTileData[t * tileBytes + k]) { changed = true; break; }
    if (changed) out.push({ tileIndex: t, bytes });
  }
  return out;
}
