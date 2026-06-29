// BG1 layer renderer (§6.2). Iterates the object decoder's
// `levelDataBuffer` as 16-bit Map16 IDs and rasterises each cell into an
// RGBA bitmap by composing its 4 sub-tile descriptors against VRAM tile
// data + CGRAM palette colors.
//
// **Render-nothing convention.** Cells with Map16 ID == 0 are skipped
// (left transparent). This is the editor's fallback for "no handler
// ported yet" — the object outline overlay still shows the bounds, BG1
// just stays blank for that object. As real Bank13 stamp handlers come
// online they write non-zero Map16 IDs and those cells start rendering
// real tiles.
//
// **Output sizing.** The cart's per-screen LRU page allocator backs up
// to 64 screens (mapped 16 wide × 8 tall = 128 screen slots, of which
// at most 64 are simultaneously allocated). We render at the FULL
// theoretical extent (16 × 8 screens = 256 × 128 cells = 4096 × 2048
// px) so the bitmap is directly drawable by the canvas at level-cell
// origin. Most cells are transparent → most of the bitmap is empty
// alpha=0 bytes that compress trivially in IPC transport.
//
// **Sub-tile rendering** is the same shape as `renderMap16Gallery` in
// `render-gallery.ts`: decode each Map16 cell to 4 sub-tile descriptors
// (TL, TR, BL, BR), each with a tile index + palette row + flips; blit
// each 8×8 tile from VRAM into a 16×16 cell region of the output. The tile
// color depth is NOT fixed — it follows the scene's BG mode (`bg1Bpp`): 4bpp
// in BG Mode 1/2 (the 218 standard levels), 2bpp in BG Mode 0 (level mode $0A /
// level $6B). Decoding 2bpp as 4bpp scrambles every tile — see `bg1Bpp` below.
//
// **Incremental re-render** (`renderBg1Patch`, research/plan-incremental-
// render.md Tier 2): the full path and the patch path BOTH drive one shared
// per-cell renderer (`makeBg1CellRenderer`), so a patched backing canvas stays
// byte-identical to a fresh full render. Patch renders only the cells a diff
// flagged; full renders all of them.

import { decode4bppTile, decode2bppTile } from './tile.ts';
import { buildPaletteRow } from './color.ts';
import { decodeMap16, type Map16SubTile, type Map16Tables } from './map16.ts';
import { SCREEN_PAGE_UNALLOCATED, LRU_PAGE_MASK, resolveCellMap16 } from './cell-grid.ts';
// Bg1RenderResult lives in `../types.ts` (Node-free, so the renderer-facing
// contract can re-export it); imported for local use and re-exported to keep
// the `snes-framework/render-bg1` import path intact.
import type { Bg1RenderResult, LayerCellPatch } from '../types.ts';
export type { Bg1RenderResult, LayerCellPatch };

const CELL_PX = 16;
const TILE_PX = 8;
/** 4bpp = 32 bytes/tile (BG Mode 1/2 — the common case); 2bpp = 16 bytes/tile
 *  (BG Mode 0, level mode $0A only — see RenderBg1Args.bg1Bpp). */
const TILE_BYTES_4BPP = 32;
const TILE_BYTES_2BPP = 16;
const SCREENS_WIDE = 16;
const SCREENS_TALL = 8;
const CELLS_PER_SCREEN_EDGE = 16;

const TOTAL_WIDTH = SCREENS_WIDE * CELLS_PER_SCREEN_EDGE * CELL_PX;
const TOTAL_HEIGHT = SCREENS_TALL * CELLS_PER_SCREEN_EDGE * CELL_PX;

// Sub-tile slot offsets within a 16×16 cell: TL/TR/BL/BR.
const SUB_OFF = [
  { dx: 0,       dy: 0       }, // TL
  { dx: TILE_PX, dy: 0       }, // TR
  { dx: 0,       dy: TILE_PX }, // BL
  { dx: TILE_PX, dy: TILE_PX }, // BR
] as const;

interface RenderBg1Args {
  /** 64 KB VRAM buffer populated by `loadLevelGfx` + `loadTileAnimation`. */
  vram: Uint8Array;
  /** 512-byte CGRAM populated by `loadLevelPalettes`. */
  cgram: Uint8Array;
  /** Map16 page tables. */
  map16Tables: Map16Tables;
  /** 32-KB Map16 ID buffer from the object decoder. Indexed by
   *  `(lru_page << 9) + (cell_y << 5) + cell_x * 2`. */
  levelDataBuffer: Uint8Array;
  /** 128-byte per-screen LRU-page map. screenPageMap[(screenY<<4)|screenX]
   *  = page index (1..63) or $80 = unallocated. */
  screenPageMap: Uint8Array;
  /** BG1 char-data base in VRAM (from `loadSceneRegs(...).bg1CharAddr`).
   *  Without this every cell renders the wrong tile data: e.g. for level
   *  1-1 (jungle) the cart sets base $E000, so Map16 tile-index $240
   *  resolves to VRAM `($E000 + $240*32) & $FFFF = $2800` (the coin
   *  animation slot). If we omit the base we read VRAM `$4800` (sprite
   *  gfx) instead — visibly wrong tiles in every cell. */
  bg1CharAddr: number;
  /** Optional per-region BG1 overrides for "Graphic / Palette Changer"
   *  sprites (see bg1-regions.ts). Cells whose absolute column falls in a
   *  band's [minCellX, maxCellX) render with that band's `vram` + `cgram`
   *  instead of the top-level `vram`/`cgram`; columns outside every band
   *  fall back to the top-level pair. Omit (the common case) for a single
   *  whole-level tileset. */
  bands?: ReadonlyArray<{
    minCell: number;
    maxCell: number;
    vram: Uint8Array;
    cgram: Uint8Array;
  }>;
  /** Axis the `bands` cells index along: 'x' (columns, default — horizontal
   *  levels) or 'y' (rows — vertically-scrolling levels like 0x2B). */
  bandAxis?: 'x' | 'y';
  /** BG1 color depth. `4` (default) = BG Mode 1/2 (the 218 standard levels);
   *  `2` = BG Mode 0 (level mode $0A / level $6B), where BG1 tiles are 2bpp
   *  (16 bytes each) and the sub-tile's 3-bit palette field selects a 4-color
   *  group (CGRAM `[g*4 .. g*4+3]`) instead of a 16-color row. Decoding 2bpp
   *  data as 4bpp scrambles every tile — derive this from the scene's BGMODE
   *  (`loadSceneRegs(...).bgmodeMode === 0 ? 2 : 4`). Mirrors the cart's
   *  Mode-0 BG1 (and GoldenEgg's `Header[9]==10 ? 2bpp`). */
  bg1Bpp?: 2 | 4;
}

/** Build the 8 BG palette rows from a CGRAM buffer. `colorsPerRow` is 16 for
 *  4bpp (CGRAM[row*16..]) or 4 for 2bpp (CGRAM[row*4..], the 4-color groups a
 *  BG-Mode-0 tile's palette field selects). */
function buildPalettes(cgram: Uint8Array, colorsPerRow: number): Uint32Array[] {
  const out: Uint32Array[] = [];
  for (let r = 0; r < 8; r++) {
    out.push(buildPaletteRow(cgram, r, /*transparent0=*/ false, 'expand', colorsPerRow));
  }
  return out;
}

// Shared decode scratch: decode4bppTile overwrites all 64 bytes and everything
// here is synchronous, so one module-level buffer replaces a per-sub-tile
// allocation (~130k per full-level render — pure GC churn).
const tileIndicesScratch = new Uint8Array(64);

/** Blit an 8×8 tile into the RGBA output at (dx, dy), decoding via `decode`
 *  (`decode4bppTile` or `decode2bppTile` — both write 64 palette indices). Skips
 *  palette index 0 (treated as transparent — leaves alpha=0 in the output). */
function blitTileTransparent0(
  decode: typeof decode4bppTile,
  vram: Uint8Array,
  tileByteOff: number,
  palette: Uint32Array,
  hflip: boolean,
  vflip: boolean,
  outU32: Uint32Array,
  outStride: number,
  dx: number,
  dy: number
): void {
  const indices = tileIndicesScratch;
  decode(vram, tileByteOff, hflip, vflip, indices, 0);
  for (let row = 0; row < TILE_PX; row++) {
    const dstRow = (dy + row) * outStride + dx;
    const srcRow = row * TILE_PX;
    for (let col = 0; col < TILE_PX; col++) {
      const idx = indices[srcRow + col];
      if (idx === 0) continue; // transparent — leave alpha=0
      outU32[dstRow + col] = palette[idx];
    }
  }
}

/** A single-cell BG1 blitter bound to a fixed render context. Renders the cell
 *  at absolute (absCellX, absCellY) into `dest` (a u32 view) at pixel
 *  (destX, destY) with row stride `destStride`. No-ops (draws nothing) for
 *  unallocated screens, page-0 backing, or Map16 ID 0 — callers that need the
 *  cell CLEARED must pre-zero the destination region. */
type Bg1CellRenderer = (
  absCellX: number,
  absCellY: number,
  dest: Uint32Array,
  destStride: number,
  destX: number,
  destY: number
) => void;

/**
 * Build the per-cell BG1 renderer over a fixed render context (palette rows,
 * Graphic/Palette-Changer bands, gfx). `renderBg1` (full) and `renderBg1Patch`
 * (incremental) both drive the returned closure, so their pixels are
 * byte-identical by construction.
 */
function makeBg1CellRenderer(args: RenderBg1Args): Bg1CellRenderer {
  const { vram, cgram, map16Tables, levelDataBuffer, screenPageMap, bg1CharAddr } = args;

  // BG1 color depth: 4bpp (BG Mode 1/2, default) or 2bpp (BG Mode 0, level
  // mode $0A). Drives tile stride (32 vs 16 bytes), the tile decoder, and the
  // palette group size (16- vs 4-color rows).
  const bpp = args.bg1Bpp ?? 4;
  const tileBytes = bpp === 4 ? TILE_BYTES_4BPP : TILE_BYTES_2BPP;
  const decodeTile = bpp === 4 ? decode4bppTile : decode2bppTile;
  const colorsPerRow = bpp === 4 ? 16 : 4;

  // Pre-build the 8 BG palette rows. Sub-tile descriptors carry a 3-bit `ppp`
  // field selecting which row/group.
  const palettes = buildPalettes(cgram, colorsPerRow);

  // Per-region BG1 overrides (Graphic/Palette Changer sprites). Build each
  // band's palette rows once and a cell→band lookup; cells pick their
  // vram/palettes by absolute column (or row). Cells with no band use defaults.
  const bands = args.bands;
  const bandAxis = args.bandAxis ?? 'x';
  const bandPalettes: Uint32Array[][] | null =
    bands && bands.length ? bands.map((b) => buildPalettes(b.cgram, colorsPerRow)) : null;
  let cellToBand: Int16Array | null = null;
  if (bands && bands.length) {
    const lookupLen = (bandAxis === 'y' ? SCREENS_TALL : SCREENS_WIDE) * CELLS_PER_SCREEN_EDGE;
    cellToBand = new Int16Array(lookupLen).fill(-1);
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i]!;
      for (let c = b.minCell; c < b.maxCell && c < cellToBand.length; c++) cellToBand[c] = i;
    }
  }

  // 4-slot sub-tile array passed into decodeMap16 — it replaces each slot with
  // a fresh object literal per call, so no field can be stale between cells.
  // Reused across cells (single-threaded sequential drive). The placeholders
  // just satisfy the typed-array shape.
  const subTiles: Map16SubTile[] = [
    { tileIndex: 0, paletteRow: 0, hflip: false, vflip: false, priority: false },
    { tileIndex: 0, paletteRow: 0, hflip: false, vflip: false, priority: false },
    { tileIndex: 0, paletteRow: 0, hflip: false, vflip: false, priority: false },
    { tileIndex: 0, paletteRow: 0, hflip: false, vflip: false, priority: false },
  ];

  return (absCellX, absCellY, dest, destStride, destX, destY) => {
    const map16Id = resolveCellMap16(
      levelDataBuffer, screenPageMap, absCellX >> 4, absCellY >> 4, absCellX & 0xf, absCellY & 0xf
    );
    if (map16Id === 0) return; // unallocated / unstamped → render-nothing

    try {
      decodeMap16(map16Tables, map16Id, subTiles);
    } catch {
      // Out-of-range page; skip the cell quietly. Should be rare — would
      // indicate a stamp handler wrote a Map16 ID past the 167-page valid range.
      return;
    }

    // Resolve this cell's BG1 gfx/palette: a Graphic/Palette Changer band may
    // override the level-default vram/cgram for its columns (or rows). The band
    // key is the absolute cell index along the band axis (absCellX == screenX*16
    // + cellX for 'x'; absCellY for 'y').
    let cellVram = vram;
    let cellPalettes = palettes;
    if (cellToBand) {
      const key = bandAxis === 'y' ? absCellY : absCellX;
      const bi = cellToBand[key];
      if (bi >= 0) {
        cellVram = bands![bi]!.vram;
        cellPalettes = bandPalettes![bi]!;
      }
    }
    for (let s = 0; s < 4; s++) {
      const st = subTiles[s];
      // VRAM byte offset = bg1CharAddr + tileIdx*tileBytes (32 for 4bpp, 16 for
      // 2bpp), wrapping at the 64KB VRAM boundary (real PPU wraps too). Without
      // the base every cell reads the wrong tile region — see the bg1CharAddr
      // comment in RenderBg1Args above.
      const tileByteOff = (bg1CharAddr + st.tileIndex * tileBytes) & 0xffff;
      if (tileByteOff + tileBytes > cellVram.length) continue;
      blitTileTransparent0(
        decodeTile,
        cellVram,
        tileByteOff,
        cellPalettes[st.paletteRow],
        st.hflip,
        st.vflip,
        dest,
        destStride,
        destX + SUB_OFF[s].dx,
        destY + SUB_OFF[s].dy
      );
    }
  };
}

/**
 * Rasterise BG1 from the object decoder's outputs into a full-extent
 * RGBA bitmap. Cells with Map16 ID == 0 are skipped (rendered as
 * alpha=0). Unallocated screens are skipped wholesale.
 */
export function renderBg1(args: RenderBg1Args): Bg1RenderResult {
  const renderCell = makeBg1CellRenderer(args);
  const { screenPageMap } = args;

  const rgba = new Uint8Array(TOTAL_WIDTH * TOTAL_HEIGHT * 4);
  // Treat the buffer as a u32 view for one-write-per-pixel blits. The array is
  // zero-initialised → all pixels start at alpha=0, RGB=0, which is exactly the
  // "blank/transparent" baseline we want for unstamped cells.
  const outU32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);

  // Skip unallocated screens wholesale (cheap early-out before the per-cell
  // drive, which would otherwise re-check the page map 256× per empty screen).
  for (let screenY = 0; screenY < SCREENS_TALL; screenY++) {
    for (let screenX = 0; screenX < SCREENS_WIDE; screenX++) {
      const slot = screenPageMap[(screenY << 4) | screenX];
      if (slot === SCREEN_PAGE_UNALLOCATED) continue;
      if ((slot & LRU_PAGE_MASK) === 0) continue;
      for (let cellY = 0; cellY < CELLS_PER_SCREEN_EDGE; cellY++) {
        const absCellY = (screenY << 4) | cellY;
        for (let cellX = 0; cellX < CELLS_PER_SCREEN_EDGE; cellX++) {
          const absCellX = (screenX << 4) | cellX;
          renderCell(absCellX, absCellY, outU32, TOTAL_WIDTH, absCellX * CELL_PX, absCellY * CELL_PX);
        }
      }
    }
  }

  return { rgba, width: TOTAL_WIDTH, height: TOTAL_HEIGHT };
}

/**
 * Render ONLY the given absolute cells (a diff's changed-cell list) into a
 * packed patch — one 16×16 RGBA block per coord pair, in coords order. Cells
 * that resolve to nothing (unallocated / Map16 0) produce an all-zero
 * (transparent) block so the renderer's overwrite clears the previous pixels.
 * Byte-identical to the same cells under `renderBg1` (shared `makeBg1CellRenderer`).
 */
export function renderBg1Patch(args: RenderBg1Args, coords: Int32Array): LayerCellPatch {
  const renderCell = makeBg1CellRenderer(args);
  const n = coords.length >>> 1;
  const cellBytes = CELL_PX * CELL_PX * 4;
  const rgba = new Uint8Array(n * cellBytes);
  // One reusable 16×16 scratch; cleared per cell so a "renders nothing" cell
  // emits a transparent block (the renderer applies it to erase old pixels).
  const scratch = new Uint32Array(CELL_PX * CELL_PX);
  const scratchBytes = new Uint8Array(scratch.buffer);
  for (let i = 0; i < n; i++) {
    const x = coords[i * 2]!;
    const y = coords[i * 2 + 1]!;
    scratch.fill(0);
    renderCell(x, y, scratch, CELL_PX, 0, 0);
    rgba.set(scratchBytes, i * cellBytes);
  }
  return { cellPx: CELL_PX, width: TOTAL_WIDTH, height: TOTAL_HEIGHT, coords, rgba };
}
