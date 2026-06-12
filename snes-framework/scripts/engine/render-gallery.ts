// End-to-end visual renderers that compose every piece of the engine module:
// load-graphics → VRAM, load-palettes → CGRAM, tile decoder → 4bpp pixels,
// color → RGB, map16 decoder → sub-tile descriptors. Pure functions that
// produce ImageData-compatible RGBA buffers (Uint8Array, byte-per-channel,
// width × height × 4).
//
// Used by the editor's Phase 2.5 visual proof (TilesPanel) before the
// per-object decode engine (Phase 3) is wired up — so we can see actual
// in-level tile graphics, not just outlines.

import { decode4bppTile, decode2bppTile } from './tile.ts';
import { bgr15ToImageDataU32, buildPaletteRow } from './color.ts';
import { decodeMap16, type Map16SubTile, type Map16Tables } from './map16.ts';
import { loadLevelGfx, type GfxHeader } from './load-graphics.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import { loadMap16Tables } from './map16.ts';
import { loadSceneRegs } from './scene-regs.ts';
import type { SymbolMap } from './symbol-map.ts';

const TILE_PIXELS_W = 8;
const TILE_PIXELS_H = 8;
const TILE_BYTES_4BPP = 32;
const TILE_BYTES_2BPP = 16;
const MAP16_PIXELS = 16;
const PIXEL_BYTES = 4; // RGBA8888

/** Combined header for everything the renderers need from a level. */
export interface RenderHeader extends GfxHeader, PaletteHeader {
  /** header[10] — picks the per-tileset animated-tile handler. Optional;
   *  0 (default) skips per-tileset animation but still runs the always-on
   *  default-slot loads. */
  animationTileset?: number;
  /** header[9] — LevelMode. Read by some animation handlers. */
  levelMode?: number;
}

export interface RenderResult {
  /** RGBA8888 packed bytes; length = width * height * 4. */
  rgba: Uint8Array;
  width: number;
  height: number;
}

/**
 * Decode a 4bpp tile and write its 8×8 RGBA pixels into `rgba` at the
 * given top-left destination pixel `(dx, dy)`. The destination buffer is
 * row-major RGBA8888 with `destStride` pixels per row.
 *
 * `palette` is a 16-entry Uint32Array of ARGB-packed colors in
 * ImageData-native byte order (R low, A high). When `transparent0` is true
 * pixels with palette index 0 are LEFT UNTOUCHED (caller's background
 * shows through); otherwise the actual color is written.
 */
// Shared decode scratch: decode4bppTile/decode2bppTile overwrite all 64 bytes
// and everything here is synchronous, so one module-level buffer replaces a
// per-tile allocation across the gallery's grid renders.
const tileIndicesScratch = new Uint8Array(64);

function blit4bppTile(
  vram: Uint8Array,
  tileByteOff: number,
  palette: Uint32Array,
  transparent0: boolean,
  hflip: boolean,
  vflip: boolean,
  rgba: Uint8Array,
  destStride: number,
  dx: number,
  dy: number
): void {
  const indices = tileIndicesScratch;
  decode4bppTile(vram, tileByteOff, hflip, vflip, indices, 0);
  // Reinterpret RGBA buffer as Uint32Array for one-write-per-pixel.
  // Note: requires byte-aligned dx; for our gallery layouts dx is always a
  // multiple of 8 (tile boundary), so this is fine.
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  for (let row = 0; row < TILE_PIXELS_H; row++) {
    const dstRow = (dy + row) * destStride + dx;
    const srcRow = row * TILE_PIXELS_W;
    for (let col = 0; col < TILE_PIXELS_W; col++) {
      const idx = indices[srcRow + col];
      if (idx === 0 && transparent0) continue;
      u32[dstRow + col] = palette[idx];
    }
  }
}

/** Blit a 2bpp 8×8 tile — same shape as `blit4bppTile` but reads 16-byte
 *  tile data and indexes into a 4-entry palette row (0..3). */
function blit2bppTile(
  vram: Uint8Array,
  tileByteOff: number,
  palette: Uint32Array,
  transparent0: boolean,
  hflip: boolean,
  vflip: boolean,
  rgba: Uint8Array,
  destStride: number,
  dx: number,
  dy: number
): void {
  const indices = tileIndicesScratch;
  decode2bppTile(vram, tileByteOff, hflip, vflip, indices, 0);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  for (let row = 0; row < TILE_PIXELS_H; row++) {
    const dstRow = (dy + row) * destStride + dx;
    const srcRow = row * TILE_PIXELS_W;
    for (let col = 0; col < TILE_PIXELS_W; col++) {
      const idx = indices[srcRow + col];
      if (idx === 0 && transparent0) continue;
      u32[dstRow + col] = palette[idx];
    }
  }
}

/**
 * Render a region of VRAM as a flat grid of 8×8 tiles at the chosen bit
 * depth. Useful for verifying that the gfx loader produced sensible tile
 * data and for inspecting specific BG/sprite VRAM regions per level.
 *
 * `bpp = 4` (default) reads 32-byte tiles and renders with a 16-color
 * palette row stride (BG1 / BG2 / sprite convention). `bpp = 2` reads
 * 16-byte tiles and renders with a 4-color row stride (BG3 / BG4).
 *
 * The starting offset into VRAM is either:
 *   - `opts.vramByteOffset` (absolute byte address, takes precedence), or
 *   - `opts.firstTile * bytesPerTile` (tile-index addressing, the legacy
 *     way; default 0).
 *
 * `tileCount` defaults to "all of VRAM from the start byte" at the chosen
 * bit depth.
 */
export function renderVramGrid(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: RenderHeader,
  opts: {
    /** Which palette row to apply to every tile. Default 0. With `bpp=4`
     *  values 0..15 are valid (rows 8..15 land in sprite palette CGRAM);
     *  with `bpp=2` values 0..63 are valid (4-color stride). */
    paletteRow?: number;
    /** First VRAM tile index to render. Tile index is measured in tiles
     *  of the chosen bit depth (32-byte tiles at 4bpp, 16-byte tiles at
     *  2bpp). Default 0. Overridden by `vramByteOffset` if both given. */
    firstTile?: number;
    /** Absolute VRAM byte offset to start reading at. Default 0.
     *  Overrides `firstTile` when set. Use this for "show VRAM starting
     *  at the BG2 char base" — pass the resolved char address directly. */
    vramByteOffset?: number;
    /** Number of tiles to render. Default = fill the remainder of VRAM. */
    tileCount?: number;
    /** Tiles per row in the output image. Default 16. */
    cellsPerRow?: number;
    /** Bit depth — 2 or 4. Default 4. */
    bpp?: 2 | 4;
    /** Background fill color (BGR-15). Default $0000 = black. */
    bgColor15?: number;
  } = {}
): RenderResult {
  const paletteRow = opts.paletteRow ?? 0;
  const cellsPerRow = opts.cellsPerRow ?? 16;
  const bgColor15 = opts.bgColor15 ?? 0x0000;
  const bpp: 2 | 4 = opts.bpp ?? 4;
  const bytesPerTile = bpp === 4 ? TILE_BYTES_4BPP : TILE_BYTES_2BPP;
  const colorsPerRow = bpp === 4 ? 16 : 4;

  const startByte =
    opts.vramByteOffset ?? (opts.firstTile ?? 0) * bytesPerTile;
  const maxTiles = Math.max(
    0,
    Math.floor((0x10000 - startByte) / bytesPerTile)
  );
  const tileCount = Math.min(opts.tileCount ?? maxTiles, maxTiles);

  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512);
  loadLevelGfx(rom, symbols, header, vram);
  loadTileAnimation(rom, symbols, {
    animationTileset: header.animationTileset ?? 0,
    bg1Tileset: header.bg1Tileset,
    levelMode: header.levelMode ?? 0
  }, vram);
  loadLevelPalettes(rom, symbols, header, cgram);
  const palette = buildPaletteRow(cgram, paletteRow, false, 'expand', colorsPerRow);

  const rows = Math.max(1, Math.ceil(tileCount / cellsPerRow));
  const width = cellsPerRow * TILE_PIXELS_W;
  const height = rows * TILE_PIXELS_H;
  const rgba = new Uint8Array(width * height * PIXEL_BYTES);

  // Background fill
  const bgU32 = bgr15ToImageDataU32(bgColor15);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  u32.fill(bgU32);

  const blit = bpp === 4 ? blit4bppTile : blit2bppTile;
  for (let i = 0; i < tileCount; i++) {
    const tileByteOff = startByte + i * bytesPerTile;
    if (tileByteOff + bytesPerTile > vram.length) break;
    const col = i % cellsPerRow;
    const row = Math.floor(i / cellsPerRow);
    blit(
      vram,
      tileByteOff,
      palette,
      false,
      false,
      false,
      rgba,
      width,
      col * TILE_PIXELS_W,
      row * TILE_PIXELS_H
    );
  }

  return { rgba, width, height };
}

/**
 * Render the Map16 cell gallery for a level's loaded tileset+palette. Each
 * Map16 cell is a 16×16 image composed of its 4 sub-tiles (TL, TR, BL, BR),
 * each picking its own palette row from the sub-tile word's `ppp` field.
 *
 * Lays out cells in a `cellsPerRow`-wide grid starting at Map16 ID
 * `firstId` (high byte = page, low byte = within-page tile index).
 *
 * The asm uses tile-base = VRAM `$0000` for BG1 (per the standard mode the
 * level loader configures). Sub-tile tile-index is a 10-bit value (0..1023)
 * directly addressing 32-byte 4bpp tiles starting at that base.
 */
/**
 * Render an explicit list of Map16 IDs into a `cellsPerRow`-wide grid image.
 * Shared core of the page gallery (`renderMap16Gallery`) and the Tiles panel's
 * "Used in this level" view (`renderMap16Cells`).
 *
 * Each sub-tile's VRAM byte offset is `bg1CharAddr + tileIndex*32` — the BG
 * char base is resolved from the level's mode via scene-regs, matching the real
 * BG1 layer render (and `map16-probe`'s coverage check). Reading `tileIndex*32`
 * alone is only correct when the char base is 0, which it isn't for most levels.
 */
function renderMap16CellList(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: RenderHeader,
  ids: readonly number[],
  cellsPerRow: number,
  bgColor15: number
): RenderResult {
  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512);
  loadLevelGfx(rom, symbols, header, vram);
  loadTileAnimation(rom, symbols, {
    animationTileset: header.animationTileset ?? 0,
    bg1Tileset: header.bg1Tileset,
    levelMode: header.levelMode ?? 0
  }, vram);
  loadLevelPalettes(rom, symbols, header, cgram);
  const tables: Map16Tables = loadMap16Tables(rom, symbols);
  const bg1CharAddr = loadSceneRegs(rom, symbols, header.levelMode ?? 0).bg1CharAddr;

  // Pre-build all 8 palette rows for fast per-sub-tile lookup.
  const palettes: Uint32Array[] = [];
  for (let r = 0; r < 8; r++) {
    palettes.push(buildPaletteRow(cgram, r, false));
  }

  const cellCount = ids.length;
  const rows = Math.max(1, Math.ceil(cellCount / cellsPerRow));
  const width = cellsPerRow * MAP16_PIXELS;
  const height = rows * MAP16_PIXELS;
  const rgba = new Uint8Array(width * height * PIXEL_BYTES);

  const bgU32 = bgr15ToImageDataU32(bgColor15);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  u32.fill(bgU32);

  // Sub-tile offsets within a Map16 cell (TL, TR, BL, BR) — matches the
  // SNES convention in docs/leveldataengine.md §3.4.5.
  const subOff = [
    { dx: 0, dy: 0 }, // TL
    { dx: 8, dy: 0 }, // TR
    { dx: 0, dy: 8 }, // BL
    { dx: 8, dy: 8 }, // BR
  ];

  // Reusable scratch — decodeMap16 fills slots in-place.
  const subTilesArr: Map16SubTile[] = [
    { tileIndex: 0, paletteRow: 0, hflip: false, vflip: false, priority: false },
    { tileIndex: 0, paletteRow: 0, hflip: false, vflip: false, priority: false },
    { tileIndex: 0, paletteRow: 0, hflip: false, vflip: false, priority: false },
    { tileIndex: 0, paletteRow: 0, hflip: false, vflip: false, priority: false },
  ];

  for (let i = 0; i < cellCount; i++) {
    const id = ids[i]!;
    try {
      decodeMap16(tables, id, subTilesArr);
    } catch {
      // ID out of range — leave background showing.
      continue;
    }
    const col = i % cellsPerRow;
    const row = Math.floor(i / cellsPerRow);
    const cellX = col * MAP16_PIXELS;
    const cellY = row * MAP16_PIXELS;
    for (let s = 0; s < 4; s++) {
      const st = subTilesArr[s];
      const tileByteOff = (bg1CharAddr + st.tileIndex * TILE_BYTES_4BPP) & 0xffff;
      if (tileByteOff + TILE_BYTES_4BPP > vram.length) continue;
      blit4bppTile(
        vram,
        tileByteOff,
        palettes[st.paletteRow],
        false,
        st.hflip,
        st.vflip,
        rgba,
        width,
        cellX + subOff[s].dx,
        cellY + subOff[s].dy
      );
    }
  }

  return { rgba, width, height };
}

export function renderMap16Gallery(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: RenderHeader,
  opts: {
    /** First Map16 ID to render (default $0000). */
    firstId?: number;
    /** Number of Map16 cells to render. Default = the real cell count of
     *  the page containing `firstId` (read from the per-page-count table),
     *  so we don't bleed past the page's end into the next page's data.
     *  YI's pages have **variable** sizes — some only 2-3 cells. */
    cellCount?: number;
    /** Cells per row in the output image (default 16). */
    cellsPerRow?: number;
    /** Background fill BGR-15 (default $0000 = black). */
    bgColor15?: number;
  } = {}
): RenderResult {
  const firstId = opts.firstId ?? 0x0000;
  const cellsPerRow = opts.cellsPerRow ?? 16;
  const bgColor15 = opts.bgColor15 ?? 0x0000;

  // Default cellCount = the actual cell count of the page containing
  // `firstId`. YI's pages are variable-sized (most are far smaller than
  // 256 cells), so the legacy "256 per page" default rendered past each
  // page's end and showed bleed-through from the next page.
  const tables: Map16Tables = loadMap16Tables(rom, symbols);
  const startPage = (firstId >>> 8) & 0xff;
  const startCellInPage = firstId & 0xff;
  const pageCells = startPage < tables.pageCellCounts.length
    ? tables.pageCellCounts[startPage]
    : 0;
  const cellCount = opts.cellCount ?? Math.max(0, pageCells - startCellInPage);

  const ids = Array.from({ length: cellCount }, (_, i) => firstId + i);
  return renderMap16CellList(rom, symbols, header, ids, cellsPerRow, bgColor15);
}

/**
 * Render a specific set of Map16 IDs (e.g. the ones a level actually stamps)
 * into a grid, row-major in `ids` order. Backs the Tiles panel's "Used" view —
 * the per-cell metadata (count / coverage / palette) comes from
 * `levelMap16Usage`; this is just the matching pixels, same order.
 */
export function renderMap16Cells(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: RenderHeader,
  ids: readonly number[],
  opts: { cellsPerRow?: number; bgColor15?: number } = {}
): RenderResult {
  return renderMap16CellList(rom, symbols, header, ids, opts.cellsPerRow ?? 16, opts.bgColor15 ?? 0x0000);
}
