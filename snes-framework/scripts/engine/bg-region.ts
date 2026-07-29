// BG region export/import — the in-situ "edit what you see" surface
// (research/graphics-editing/bg-region-edit.md). Render a positioned region of a
// BG layer as it composites in-level, with per-cell tile metadata, and slice an
// edited region back to the underlying CHR gfx files (→ saveGfxEdit). Pixels-only
// (the MVP): tile pixels change, tilemap/Map16 layout stays fixed.
//
//   - BG1 is the Map16-stamped level grid (level coordinates). A region is a
//     rectangle of level cells; each cell reuses `renderMetatile` /
//     `diffMetatileTiles` (object-metatile.ts) — the BG1 slice is already exact.
//   - BG2/BG3 are flat pre-rendered tilemaps in their OWN screen-blocked space.
//     We render the WHOLE tilemap in RENDERED (de-interleaved) order — the same
//     arrangement `renderBgLayer` produces — and slice each 8×8 back to the BG2/BG3
//     char gfx file. BG3 is 2bpp; BG2 4bpp. Cells whose tile resolves outside the
//     layer's own gfx files (BG2 tile-index wraparound into BG1/HUD char, or an
//     unloaded slot) are gated non-editable (rendered, never written).
//
// See §2.5 of the plan for the reference-verified mechanics this implements.

import {
  buildMetatileContext, renderMetatile, diffMetatileTiles,
  type MetatileContext, type MetatileCanvas, type MetatileHeader, type MetatileTileEdit
} from './object-metatile.ts';
import { decode2bppTile, decode4bppTile, encode2bppTile, encode4bppTile } from './tile.ts';
import { buildPaletteRow, nearestPaletteIndex } from './color.ts';
import { loadLevelGfx, fileForVramByte, type GfxFileEntry } from './load-graphics.ts';
import { loadLevelPalettes } from './load-palettes.ts';
import { loadBg2Tilemap, loadBg3Tilemap } from './load-bg-tilemaps.ts';
import { loadSceneRegs, type SceneRegs } from './scene-regs.ts';
import { deriveDescriptors } from './bg-layers-compose.ts';
import { resolveCellMap16 } from './cell-grid.ts';
import { canvasIndexedPng } from './png.ts';
import { encodeAseprite, type AsepriteCell, type AsepriteStructural } from './aseprite.ts';
import { encodeM1te2, parseM1te2, MAP_STRIDE } from './m1te2.ts';
import { diffM1tePalette, type M1tePaletteEdit } from './m1te2-util.ts';
import { decodeMap16Alloc } from './map16.ts';
import type { SymbolMap } from './symbol-map.ts';

const TILE_PX = 8;
const CELL_PX = 16;          // a BG1 Map16 cell
const SCREEN_BYTES = 0x800;  // one 32×32 BG2/BG3 tilemap screen
const TILE_BYTES_4BPP = 32;  // one 8×8 4bpp CHR tile

export type { MetatileTileEdit };

// ─────────────────────────────────────────────────────────────────────────────
// Shared: a region edit set (dedup'd CHR tile writes, ready for saveGfxEdit).

export interface BgRegionDiff {
  edits: MetatileTileEdit[];
  /** Two cells wrote the same (fileId,fileTile) different bytes (shared tile,
   *  edited inconsistently — last write wins, surfaced like the metatile diff). */
  conflicts: number;
  /** Opaque pixels whose color is in no slot of their cell's palette row (a
   *  wrong-row / off-palette paint, clamped to index 0) — surfaced as import errors. */
  mismatches: number;
}

/** Merge per-cell edit lists, last-write-wins on a shared (format,fileId,fileTile).
 *  `mismatches` is supplied by the caller (accumulated during slicing). */
function mergeEdits(lists: MetatileTileEdit[][], mismatches = 0): BgRegionDiff {
  const byTile = new Map<string, Uint8Array>();
  let conflicts = 0;
  for (const list of lists) {
    for (const e of list) {
      const key = `${e.format}/${e.fileId}/${e.fileTile}`;
      const prev = byTile.get(key);
      if (prev) {
        for (let k = 0; k < e.bytes.length; k++) if (prev[k] !== e.bytes[k]) { conflicts++; break; }
      }
      byTile.set(key, e.bytes);
    }
  }
  const edits: MetatileTileEdit[] = [];
  for (const [key, bytes] of byTile) {
    const [format, fileId, fileTile] = key.split('/');
    edits.push({ format: format as 'lz2' | 'lz16', fileId: Number(fileId), fileTile: Number(fileTile), bytes });
  }
  return { edits, conflicts, mismatches };
}

// ─────────────────────────────────────────────────────────────────────────────
// BG1 region (level-coordinate Map16 grid).

/** A rectangle of BG1 level cells (16×16 px each), in absolute level coords. */
export interface BgRegionRect {
  col0: number;
  row0: number;
  cols: number;
  rows: number;
}

/** Per-cell record for the export sidecar. */
export interface Bg1RegionCell {
  /** Cell index within the region (0..cols-1, 0..rows-1). */
  c: number;
  r: number;
  /** Absolute level cell. */
  absCol: number;
  absRow: number;
  map16Id: number;
  /** True ⇒ every quadrant maps to a loaded BG1 file and slices byte-exact. */
  faithful: boolean;
}

export interface Bg1RegionResult {
  rgba: Uint8Array;
  width: number;
  height: number;
  cells: Bg1RegionCell[];
  /** BG palette rows the region's cells use (the exported PNG's palette). */
  paletteRowsUsed: number[];
}

/**
 * Render a rectangle of the BG1 level grid to RGBA + per-cell metadata. Reuses
 * `renderMetatile` per distinct Map16 id (cached). Empty cells (Map16 0) are
 * transparent and omitted from `cells`.
 */
export function renderBg1Region(
  ctx: MetatileContext,
  levelDataBuffer: Uint8Array,
  screenPageMap: Uint8Array,
  rect: BgRegionRect
): Bg1RegionResult {
  const width = rect.cols * CELL_PX;
  const height = rect.rows * CELL_PX;
  const rgba = new Uint8Array(width * height * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  const cache = new Map<number, MetatileCanvas | null>();
  const cells: Bg1RegionCell[] = [];
  const rowsUsed = new Set<number>();

  for (let r = 0; r < rect.rows; r++) {
    for (let c = 0; c < rect.cols; c++) {
      const absCol = rect.col0 + c;
      const absRow = rect.row0 + r;
      const map16Id = resolveCellMap16(
        levelDataBuffer, screenPageMap, absCol >> 4, absRow >> 4, absCol & 0xf, absRow & 0xf
      );
      if (map16Id === 0) continue;
      let canvas = cache.get(map16Id);
      if (canvas === undefined) { canvas = renderMetatile(ctx, map16Id); cache.set(map16Id, canvas); }
      if (!canvas) continue;
      for (const row of canvas.paletteRowsUsed) rowsUsed.add(row);
      // Blit the 16×16 cell into the region.
      const dx = c * CELL_PX;
      const dy = r * CELL_PX;
      const cu32 = new Uint32Array(canvas.rgba.buffer, canvas.rgba.byteOffset, CELL_PX * CELL_PX);
      for (let y = 0; y < CELL_PX; y++) {
        for (let x = 0; x < CELL_PX; x++) u32[(dy + y) * width + dx + x] = cu32[y * CELL_PX + x]!;
      }
      cells.push({ c, r, absCol, absRow, map16Id, faithful: canvas.faithful });
    }
  }
  return { rgba, width, height, cells, paletteRowsUsed: [...rowsUsed].sort((a, b) => a - b) };
}

/**
 * Slice an edited BG1 region back to BG1 CHR tile edits. Re-renders each faithful
 * cell's base canvas and runs `diffMetatileTiles` against the edited 16×16 block.
 */
export function diffBg1Region(
  ctx: MetatileContext,
  region: Bg1RegionResult,
  editedRgba: Uint8Array
): BgRegionDiff {
  const editedU32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, region.width * region.height);
  const cache = new Map<number, MetatileCanvas | null>();
  const block = new Uint8Array(CELL_PX * CELL_PX * 4);
  const blockU32 = new Uint32Array(block.buffer);
  const lists: MetatileTileEdit[][] = [];
  let mismatches = 0;
  for (const cell of region.cells) {
    if (!cell.faithful) continue;
    let canvas = cache.get(cell.map16Id);
    if (canvas === undefined) { canvas = renderMetatile(ctx, cell.map16Id); cache.set(cell.map16Id, canvas); }
    if (!canvas || !canvas.faithful) continue;
    // Extract this cell's edited 16×16 into a standalone block for diffMetatileTiles.
    const dx = cell.c * CELL_PX;
    const dy = cell.r * CELL_PX;
    for (let y = 0; y < CELL_PX; y++) {
      for (let x = 0; x < CELL_PX; x++) blockU32[y * CELL_PX + x] = editedU32[(dy + y) * region.width + dx + x]!;
    }
    const d = diffMetatileTiles(ctx, canvas, block);
    lists.push(d.edits);
    mismatches += d.mismatches;
  }
  return mergeEdits(lists, mismatches);
}

// ─────────────────────────────────────────────────────────────────────────────
// BG2 / BG3 region (flat pre-rendered tilemap).

/** One 8×8 sub-tile of a BG2/BG3 tilemap, positioned in the rendered region. */
export interface BgSubCell {
  /** Top-left of this 8×8 in the rendered region (px). */
  pxX: number;
  pxY: number;
  /** Resolved 10-bit char index (after the 16×16-cell sub-tile offset). */
  charTile: number;
  paletteRow: number;
  hflip: boolean;
  vflip: boolean;
  /** Byte offset of the parent tilemap word in VRAM (rendered→memory mapping). */
  memoryEntryOff: number;
  /** The parent tilemap word verbatim (`vhopppcc cccccccc`) — carries the priority
   *  bit (and any flags) the placement write preserves on an unchanged-priority edit. */
  entry: number;
  /** True for an 8×8 BG cell (this sub-cell IS the whole word ⇒ placement-editable);
   *  false for a 16×16 cell (one word spans 4 sub-cells ⇒ pixel-only). */
  whole: boolean;
  /** Write-back target — null ⇒ non-editable (wraparound / not in this layer's
   *  gfx files / unloaded). Rendered but never sliced. */
  gfx: { fileId: number; format: 'lz2' | 'lz16'; fileTile: number } | null;
}

export interface BgRegionResult {
  layer: 2 | 3;
  bpp: 2 | 4;
  rgba: Uint8Array;
  width: number;
  height: number;
  subCells: BgSubCell[];
  paletteRowsUsed: number[];
  /** BG tile size in px (8 or 16). At 16, one tilemap WORD spans a 2×2 block of 8×8
   *  sub-cells; the native-granularity placement export uses this as its tile size. */
  tileSize: number;
}

/** Decode/palette/manifest context for one level's BG2/BG3 layers. */
export interface BgRegionContext {
  vram: Uint8Array;
  cgram: Uint8Array;
  manifest: GfxFileEntry[];
  regs: SceneRegs;
  bg2LoadedBytes: number;
  bg3LoadedBytes: number;
  bg2Visible: boolean;
  bg3Visible: boolean;
}

/** Build the per-level BG2/BG3 context: load gfx + palettes + both tilemaps into
 *  VRAM, decode scene registers, and derive each layer's visibility. */
export function buildBgRegionContext(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: MetatileHeader,
  /** Editor live gfx-edit cache (`format/fileId` → decompressed tiles) so the
   *  context reflects unsaved-to-build gfx edits; omit for the base cart. */
  gfxOverride?: ReadonlyMap<string, Uint8Array>
): BgRegionContext {
  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512);
  const manifest: GfxFileEntry[] = [];
  loadLevelGfx(rom, symbols, header, vram, manifest, gfxOverride);
  loadLevelPalettes(rom, symbols, header, cgram);
  const bg2LoadedBytes = loadBg2Tilemap(rom, symbols, header.bg2Tileset, vram);
  const bg3Load = loadBg3Tilemap(rom, symbols, header.bg3Tileset, vram);
  const regs = loadSceneRegs(rom, symbols, header.levelMode ?? 0);
  const { bg2Layer, bg3Layer } = deriveDescriptors(regs, header.levelMode ?? 0, bg3Load.bg3Disabled);
  return {
    vram, cgram, manifest, regs,
    bg2LoadedBytes, bg3LoadedBytes: bg3Load.bytesWritten,
    bg2Visible: bg2Layer.visible, bg3Visible: bg3Layer.visible
  };
}

function dimsFromScSize(scSize: number): { cols: number; rows: number } {
  switch (scSize & 3) {
    case 0: return { cols: 32, rows: 32 };
    case 1: return { cols: 64, rows: 32 };
    case 2: return { cols: 32, rows: 64 };
    default: return { cols: 64, rows: 64 };
  }
}

/** Clamp declared dims to the screens actually loaded (mirrors render-bg-layers). */
function effectiveDims(dims: { cols: number; rows: number }, loadedBytes: number): { cols: number; rows: number } {
  const screens = Math.floor(loadedBytes / SCREEN_BYTES);
  if (screens <= 0) return { cols: 0, rows: 0 };
  if (dims.cols === 32 && dims.rows === 32) return dims;
  if (dims.cols === 64 && dims.rows === 32) return screens >= 2 ? dims : { cols: 32, rows: 32 };
  if (dims.cols === 32 && dims.rows === 64) return screens >= 2 ? dims : { cols: 32, rows: 32 };
  if (screens >= 4) return dims;
  if (screens >= 2) return { cols: 64, rows: 32 };
  return { cols: 32, rows: 32 };
}

/** dpSlot → owning layer (0..2 BG1, 3..4 BG2, 5..6 BG3, 7+ sprite). */
function dpSlotLayer(dpSlot: number | undefined): 1 | 2 | 3 | 4 | null {
  if (dpSlot === undefined) return null;
  if (dpSlot <= 2) return 1;
  if (dpSlot <= 4) return 2;
  if (dpSlot <= 6) return 3;
  return 4;
}

/**
 * Render a whole BG2 or BG3 tilemap to RGBA in RENDERED (de-interleaved) order +
 * per-8×8 metadata. `layer` = 2 (BG2, 4bpp) or 3 (BG3, 2bpp). A sub-tile is
 * editable only when its char resolves to a gfx file owned by THIS layer (so BG2
 * wraparound into BG1/HUD char is gated non-editable).
 */
export function renderBgRegion(ctx: BgRegionContext, layer: 2 | 3): BgRegionResult {
  const { regs, vram, cgram } = ctx;
  const bpp: 2 | 4 = layer === 3 ? 2 : 4;
  const tilemapAddr = layer === 2 ? regs.bg2TilemapAddr : regs.bg3TilemapAddr;
  const charAddr = layer === 2 ? regs.bg2CharAddr : regs.bg3CharAddr;
  const scSize = layer === 2 ? regs.bg2ScSize : regs.bg3ScSize;
  const tileSize = layer === 2 ? regs.bg2TileSize : regs.bg3TileSize;
  const loadedBytes = layer === 2 ? ctx.bg2LoadedBytes : ctx.bg3LoadedBytes;
  const tileBytes = bpp === 4 ? 32 : 16;
  const colorsPerRow = bpp === 4 ? 16 : 4;
  const decode = bpp === 4 ? decode4bppTile : decode2bppTile;

  const dims = effectiveDims(dimsFromScSize(scSize), loadedBytes);
  const width = dims.cols * tileSize;
  const height = dims.rows * tileSize;
  const rgba = new Uint8Array(width * height * 4);
  if (width === 0 || height === 0) {
    return { layer, bpp, rgba, width: 0, height: 0, subCells: [], paletteRowsUsed: [], tileSize };
  }
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  // BG2/BG3 composite with index-0 transparent (matches composeBgLayers).
  const palettes: Uint32Array[] = [];
  for (let r = 0; r < 8; r++) palettes.push(buildPaletteRow(cgram, r, true, 'expand', colorsPerRow));

  const indices = new Uint8Array(64);
  const subPerSide = tileSize / TILE_PX; // 1 (8×8) or 2 (16×16)
  const subCells: BgSubCell[] = [];
  const rowsUsed = new Set<number>();

  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      // De-interleave: which 32×32 screen block this cell lives in.
      const screenCol = col >>> 5, screenRow = row >>> 5;
      let screenIdx: number;
      if (dims.cols === 32 && dims.rows === 32) screenIdx = 0;
      else if (dims.cols === 64 && dims.rows === 32) screenIdx = screenCol;
      else if (dims.cols === 32 && dims.rows === 64) screenIdx = screenRow;
      else screenIdx = (screenRow << 1) | screenCol;
      const screenBase = tilemapAddr + screenIdx * SCREEN_BYTES;
      const entryOff = screenBase + ((row & 0x1f) * 32 + (col & 0x1f)) * 2;
      if (entryOff + 2 > vram.length) continue;
      const entry = vram[entryOff] | (vram[entryOff + 1] << 8);
      const baseTile = entry & 0x3ff;
      const palRow = (entry >>> 10) & 0x07;
      const hflip = (entry & 0x4000) !== 0;
      const vflip = (entry & 0x8000) !== 0;
      const palette = palettes[palRow]!;
      rowsUsed.add(palRow);

      for (let py = 0; py < subPerSide; py++) {
        for (let px = 0; px < subPerSide; px++) {
          const tileOff = subPerSide === 1 ? 0 : (px ^ (hflip ? 1 : 0)) + (py ^ (vflip ? 1 : 0)) * 16;
          const charTile = (baseTile + tileOff) & 0x3ff;
          const vramByte = (charAddr + charTile * tileBytes) & 0xffff;
          const pxX = col * tileSize + px * TILE_PX;
          const pxY = row * tileSize + py * TILE_PX;
          // Resolve write-back target; editable only if it lands in THIS layer's files.
          let gfx: BgSubCell['gfx'] = null;
          if (vramByte + tileBytes <= vram.length) {
            const f = fileForVramByte(ctx.manifest, vramByte, tileBytes);
            if (f && dpSlotLayer(f.dpSlot) === layer) gfx = { fileId: f.fileId, format: f.format, fileTile: f.fileTile };
            // Paint the pixels regardless (preview shows borrowed/animated tiles too).
            decode(vram, vramByte, hflip, vflip, indices, 0);
            for (let ty = 0; ty < TILE_PX; ty++) {
              for (let tx = 0; tx < TILE_PX; tx++) {
                const idx = indices[ty * TILE_PX + tx]!;
                if (idx === 0) continue; // transparent
                u32[(pxY + ty) * width + pxX + tx] = palette[idx]!;
              }
            }
          }
          subCells.push({ pxX, pxY, charTile, paletteRow: palRow, hflip, vflip, memoryEntryOff: entryOff, entry, whole: subPerSide === 1, gfx });
        }
      }
    }
  }
  return { layer, bpp, rgba, width, height, subCells, paletteRowsUsed: [...rowsUsed].sort((a, b) => a - b), tileSize };
}

/**
 * Slice an edited BG2/BG3 region back to CHR tile edits. Per editable sub-cell:
 * base-aware (a pixel still at its base color keeps its base index), per-row,
 * un-flipped, bpp-correct re-plane. Non-editable sub-cells (gfx === null) skipped.
 */
export function diffBgRegionTiles(
  ctx: BgRegionContext,
  region: BgRegionResult,
  editedRgba: Uint8Array
): BgRegionDiff {
  const editedU32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, region.width * region.height);
  const tileBytes = region.bpp === 4 ? 32 : 16;
  const colorsPerRow = region.bpp === 4 ? 16 : 4;
  const decode = region.bpp === 4 ? decode4bppTile : decode2bppTile;
  const encode = region.bpp === 4 ? encode4bppTile : encode2bppTile;
  const charAddr = region.layer === 2 ? ctx.regs.bg2CharAddr : ctx.regs.bg3CharAddr;

  const palettes: Uint32Array[] = [];
  for (let r = 0; r < 8; r++) palettes.push(buildPaletteRow(ctx.cgram, r, true, 'expand', colorsPerRow));

  const baseIdx = new Uint8Array(64);
  const rawIdx = new Uint8Array(64);
  const list: MetatileTileEdit[] = [];
  let mismatches = 0;
  for (const sc of region.subCells) {
    if (!sc.gfx) continue;
    const vramByte = (charAddr + sc.charTile * tileBytes) & 0xffff;
    const baseBytes = ctx.vram.subarray(vramByte, vramByte + tileBytes);
    decode(baseBytes, 0, false, false, baseIdx, 0);
    const palette = palettes[sc.paletteRow]!;
    let changed = false;
    for (let trow = 0; trow < 8; trow++) {
      for (let tcol = 0; tcol < 8; tcol++) {
        const destCol = sc.hflip ? 7 - tcol : tcol;
        const destRow = sc.vflip ? 7 - trow : trow;
        const u = editedU32[(sc.pxY + destRow) * region.width + sc.pxX + destCol]!;
        const bIdx = baseIdx[trow * 8 + tcol]!;
        let r: number;
        if (u === palette[bIdx]) r = bIdx;
        else {
          r = nearestPaletteIndex(palette, u, colorsPerRow);
          // The color is in NO slot of this cell's row (wrong palette row, or paint
          // outside the palette): it was APPROXIMATED to the nearest entry — report it
          // so the import can warn instead of silently shifting the color.
          if ((u >>> 24) !== 0 && u !== palette[r]) mismatches++;
        }
        rawIdx[trow * 8 + tcol] = r;
      }
    }
    const out = new Uint8Array(tileBytes);
    encode(rawIdx, 0, out, 0);
    for (let k = 0; k < tileBytes; k++) if (out[k] !== baseBytes[k]) { changed = true; break; }
    if (changed) list.push({ format: sc.gfx.format, fileId: sc.gfx.fileId, fileTile: sc.gfx.fileTile, bytes: out });
  }
  return mergeEdits([list], mismatches);
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG composition (indexed region), shared by both layer kinds.

/** Compose a region RGBA → INDEXED PNG bytes: the region exactly as rendered, with the
 *  used palette rows concatenated (row k's color i at `k * colorsPerRow + i`) as the
 *  PNG's own palette. That order IS the sidecar's palette order (`buildSidecarPalette`)
 *  and the `.aseprite` palette order, so the import reads recolored entries straight
 *  out of the PLTE — the job the stitched-on swatch column used to do. */
export function bgRegionPng(
  cgram: Uint8Array,
  rgba: Uint8Array,
  width: number,
  height: number,
  paletteRowsUsed: number[],
  bpp: 2 | 4,
  transparentZero: boolean
): Uint8Array {
  const colorsPerRow = bpp === 4 ? 16 : 4;
  const rows = (paletteRowsUsed.length ? paletteRowsUsed : [0]).map((row) =>
    buildPaletteRow(cgram, row, transparentZero, 'expand', colorsPerRow)
  );
  return canvasIndexedPng(rgba, width, height, rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// Aseprite composition — a BG1 region as a real tilemap (tiles = Map16 blocks).

/**
 * Compose a BG1 region as an `.aseprite` tilemap document: each distinct Map16
 * block becomes one 16×16 tile in the tileset; the level grid becomes the tilemap;
 * the palette is ONLY the CGRAM rows the region actually uses (each 4bpp sub-tile
 * draws from one 16-color row), compacted, + a trailing transparent slot — so the
 * artist sees just the colors these tiles can reach, not all 256. Flattening the
 * result (decodeAsepriteRegion) reproduces `region.rgba` byte-for-byte, so the
 * existing `diffBg1Region` slice consumes it unchanged.
 *
 * Pixels (not the Aseprite index) are the round-trip contract: we map each region
 * pixel to ANY palette entry holding its exact color (lowest index wins). Empty
 * cells reference the structural empty tile (id 0). BG1 has no within-tile
 * transparency (index 0 is the opaque backdrop); only out-of-range quadrant pixels
 * (transparent in the render) map to the transparent slot, flattening back
 * transparent too.
 */
export function bg1RegionAseprite(ctx: MetatileContext, region: Bg1RegionResult): Uint8Array {
  const cols8 = region.width / TILE_PX;   // 8×8 tiles across
  const rows8 = region.height / TILE_PX;

  // 8×8 is the foundational pixel unit (research/graphics-editing): each distinct
  // 8×8 CHR-under-a-palette-row is ONE Aseprite tile, so the cart's heavy BG1 CHR
  // sharing (a tile reused by many Map16 blocks) is VISIBLE — editing it updates
  // every placement on-canvas, matching the game. (The 16×16 Map16-block view stays
  // available via the Metatiles track + the level editor.) Import is unchanged: the
  // flatten reproduces region.rgba byte-for-byte and feeds diffBg1Region (per-block
  // 8×8 quadrant slice).
  //
  // Compact palette: only the rows this region uses, each a full 16-color block
  // (opaque index 0, as BG1 renders), + one transparent slot for empty / non-faithful
  // quadrants. A color→index reverse map resolves the preview pixels of those.
  const usedRows = region.paletteRowsUsed;
  const TRANSPARENT = usedRows.length * 16;
  const palette = new Uint32Array(TRANSPARENT + 1);
  const rowToBase = new Map<number, number>();
  const lut = new Map<number, number>();
  usedRows.forEach((r, k) => {
    rowToBase.set(r, k * 16);
    const rowPal = buildPaletteRow(ctx.cgram, r, false, 'expand', 16);
    for (let i = 0; i < 16; i++) {
      const v = rowPal[i]!;
      palette[k * 16 + i] = v;
      if (!lut.has(v)) lut.set(v, k * 16 + i);
    }
  });

  const regionU32 = new Uint32Array(region.rgba.buffer, region.rgba.byteOffset, region.width * region.height);
  const tiles: Uint8Array[] = [new Uint8Array(TILE_PX * TILE_PX)]; // index 0 = empty tile
  const keyToTile = new Map<string, number>(); // (fileId,fileTile,palRow) → tileset index
  const cells: AsepriteCell[] = new Array(cols8 * rows8).fill(0).map(() => ({ tile: 0 }));
  const cache = new Map<number, MetatileCanvas | null>();
  const local = new Uint8Array(64);

  for (const cell of region.cells) {
    let canvas = cache.get(cell.map16Id);
    if (canvas === undefined) { canvas = renderMetatile(ctx, cell.map16Id); cache.set(cell.map16Id, canvas); }
    if (!canvas) continue;
    for (let q = 0; q < 4; q++) {
      const tileCol = cell.c * 2 + (q & 1);
      const tileRow = cell.r * 2 + (q >> 1);
      const cellIdx = tileRow * cols8 + tileCol;
      const unit = canvas.units[q];
      if (unit) {
        // Faithful quadrant: dedup by CHR identity under its row; store the tile
        // UN-flipped and carry the flip on the cell (so a flipped reuse shares it).
        const key = `${unit.fileId}/${unit.fileTile}/${unit.paletteRow}`;
        let tileIdx = keyToTile.get(key);
        if (tileIdx === undefined) {
          const px = new Uint8Array(TILE_PX * TILE_PX);
          decode4bppTile(unit.baseBytes, 0, false, false, local, 0);
          const base = rowToBase.get(unit.paletteRow) ?? 0;
          for (let i = 0; i < 64; i++) px[i] = base + local[i]!; // BG1 index 0 is opaque → a real entry
          tileIdx = tiles.length; tiles.push(px); keyToTile.set(key, tileIdx);
        }
        cells[cellIdx] = { tile: tileIdx, hflip: unit.hflip, vflip: unit.vflip };
      } else {
        // Non-faithful quadrant (animated / unmapped): a unique preview tile straight
        // from the rendered region (never sliced on import — diffBg1Region gates it).
        const px = new Uint8Array(TILE_PX * TILE_PX);
        const dx = tileCol * TILE_PX, dy = tileRow * TILE_PX;
        for (let y = 0; y < TILE_PX; y++)
          for (let x = 0; x < TILE_PX; x++)
            px[y * TILE_PX + x] = lut.get(regionU32[(dy + y) * region.width + dx + x]!) ?? TRANSPARENT;
        cells[cellIdx] = { tile: tiles.length }; tiles.push(px);
      }
    }
  }

  return encodeAseprite({
    tileW: TILE_PX, tileH: TILE_PX,
    tilesAcross: cols8, tilesDown: rows8,
    tiles, cells, palette,
    transparentIndex: TRANSPARENT,
    layerName: 'BG1', tilesetName: 'CHR'
  });
}

/**
 * Compose a BG2/BG3 region as an `.aseprite` tilemap: each distinct
 * `(charTile, paletteRow)` becomes one **un-flipped** 8×8 CHR tile in the tileset;
 * each tilemap cell references it with the cell's H/V flip flags (so an h-flipped
 * reuse shares the tile — exactly how the SNES tilemap works). The palette is ONLY
 * the CGRAM rows the region uses, compacted at the layer stride (BG2 4bpp → 16/row;
 * BG3 2bpp → 4/row) — the artist sees just the colors these tiles can reach. Each
 * row's local index 0 composites transparent, so we collapse every used row's
 * local-0 to the single transparent index 0; opaque pixels (local > 0) map to their
 * row's compact block. Each tile pixel is decoded straight from VRAM as its true
 * local index, so the flatten reproduces `region.rgba` byte-for-byte (the decoder
 * re-applies the cell flip the same way `renderBgRegion` did). Non-editable
 * sub-cells (wraparound / unloaded) are rendered too (preview); the sidecar still
 * gates them on import.
 */
interface BgRegionTilesetBuild {
  /** Indexed 8×8 pixels per Aseprite tile (tile 0 = empty). */
  tiles: Uint8Array[];
  /** Per Aseprite tile: the `(charTile, paletteRow)` it encodes — `null` for tile 0.
   *  This is the inverse of the export's tileset dedup; the placement import uses it
   *  to turn a rearranged cell's tile index back into a BG tilemap word. */
  tileBits: ({ char: number; palRow: number } | null)[];
  /** Per grid cell (row-major, 8px): the tile + flips placed there. */
  cells: AsepriteCell[];
  palette: Uint32Array;
}

/** Build the BG2/BG3 region's Aseprite tileset + cell arrangement (the shared core of
 *  the export and the placement-import reconstruction, so the tile-index→(char,row)
 *  mapping is identical on both sides). Deterministic for a given region. */
function bgRegionTileset(ctx: BgRegionContext, region: BgRegionResult): BgRegionTilesetBuild {
  const { layer, bpp } = region;
  const cpr = bpp === 4 ? 16 : 4;
  const tileBytes = bpp === 4 ? 32 : 16;
  const decode = bpp === 4 ? decode4bppTile : decode2bppTile;
  const charAddr = layer === 2 ? ctx.regs.bg2CharAddr : ctx.regs.bg3CharAddr;
  const tilesAcross = region.width / TILE_PX;
  const tilesDown = region.height / TILE_PX;

  const usedRows = region.paletteRowsUsed;
  const rowToBase = new Map<number, number>();
  const palette = new Uint32Array(Math.max(1, usedRows.length * cpr));
  usedRows.forEach((r, k) => {
    rowToBase.set(r, k * cpr);
    const rowPal = buildPaletteRow(ctx.cgram, r, true, 'expand', cpr);
    for (let i = 0; i < cpr; i++) palette[k * cpr + i] = rowPal[i]!;
  });
  const TRANSPARENT = 0;

  const tiles: Uint8Array[] = [new Uint8Array(TILE_PX * TILE_PX)]; // index 0 = empty
  const tileBits: ({ char: number; palRow: number } | null)[] = [null];
  const keyToTile = new Map<number, number>();
  const cells: AsepriteCell[] = new Array(tilesAcross * tilesDown).fill(0).map(() => ({ tile: 0 }));
  const local = new Uint8Array(64);

  for (const sc of region.subCells) {
    const key = (sc.charTile << 3) | sc.paletteRow; // (charTile, paletteRow)
    let tileIdx = keyToTile.get(key);
    if (tileIdx === undefined) {
      const px = new Uint8Array(TILE_PX * TILE_PX);
      const vramByte = (charAddr + sc.charTile * tileBytes) & 0xffff;
      const base = rowToBase.get(sc.paletteRow) ?? 0;
      if (vramByte + tileBytes <= ctx.vram.length) {
        decode(ctx.vram, vramByte, false, false, local, 0); // UN-flipped; the cell carries flip
        for (let i = 0; i < 64; i++) {
          const li = local[i]!;
          px[i] = li === 0 ? TRANSPARENT : base + li;
        }
      }
      tileIdx = tiles.length;
      tiles.push(px);
      tileBits.push({ char: sc.charTile, palRow: sc.paletteRow });
      keyToTile.set(key, tileIdx);
    }
    cells[(sc.pxY / TILE_PX) * tilesAcross + sc.pxX / TILE_PX] = { tile: tileIdx, hflip: sc.hflip, vflip: sc.vflip };
  }

  return { tiles, tileBits, cells, palette };
}

/**
 * Compose a BG2/BG3 region as an `.aseprite` tilemap: each distinct
 * `(charTile, paletteRow)` becomes one **un-flipped** 8×8 CHR tile in the tileset;
 * each tilemap cell references it with the cell's H/V flip flags. The palette is ONLY
 * the CGRAM rows the region uses, compacted at the layer stride. Each row's local
 * index 0 composites transparent (collapsed to the single transparent index 0). The
 * flatten reproduces `region.rgba` byte-for-byte; the cell arrangement is editable
 * placement (see `diffBgRegionPlacement`).
 */
export function bgRegionAseprite(ctx: BgRegionContext, region: BgRegionResult): Uint8Array {
  const b = bgRegionTileset(ctx, region);
  return encodeAseprite({
    tileW: TILE_PX, tileH: TILE_PX,
    tilesAcross: region.width / TILE_PX, tilesDown: region.height / TILE_PX,
    tiles: b.tiles, cells: b.cells, palette: b.palette,
    transparentIndex: 0,
    layerName: `BG${region.layer}`, tilesetName: 'CHR'
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PLACEMENT export/import — at the BG's NATIVE tile size (one Aseprite tile = one
// tilemap WORD, so 1 cell ↔ 1 word even for 16×16 BG2/BG3). This is the artist's
// "rearrange the layout" view, distinct from the 8×8 PIXEL export (`bgRegionAseprite`).

interface BgPlacementCell { memoryEntryOff: number; entry: number; editable: boolean }
interface BgRegionPlacementBuild {
  /** Native ts×ts indexed tiles (tile 0 = empty). */
  tiles: Uint8Array[];
  /** Per Aseprite tile: the `(baseTile, paletteRow)` word bits it encodes (`null` for
   *  tile 0) — inverse of the dedup; the import turns a moved cell back into a word. */
  tileBits: ({ baseTile: number; palRow: number } | null)[];
  cells: AsepriteCell[];
  palette: Uint32Array;
  /** Per native cell (row-major): the original word + its file target + editability. */
  wordCells: BgPlacementCell[];
  tileSize: number;
  tilesAcross: number;
  tilesDown: number;
}

/** Build the native-granularity placement tileset: one tile per distinct `(baseTile,
 *  paletteRow)` word (a ts×ts composite of its `subPerSide²` un-flipped char tiles),
 *  one cell per BG word carrying the word's flips. Shared by the export + the diff so
 *  the tile-index→word mapping is identical on both sides. */
function bgRegionPlacementBuild(ctx: BgRegionContext, region: BgRegionResult): BgRegionPlacementBuild {
  const { layer, bpp } = region;
  const ts = region.tileSize;
  const subPerSide = ts / TILE_PX;
  const cpr = bpp === 4 ? 16 : 4;
  const tileBytes = bpp === 4 ? 32 : 16;
  const decode = bpp === 4 ? decode4bppTile : decode2bppTile;
  const charAddr = layer === 2 ? ctx.regs.bg2CharAddr : ctx.regs.bg3CharAddr;
  const tilesAcross = region.width / ts;
  const tilesDown = region.height / ts;

  const usedRows = region.paletteRowsUsed;
  const rowToBase = new Map<number, number>();
  const palette = new Uint32Array(Math.max(1, usedRows.length * cpr));
  usedRows.forEach((r, k) => {
    rowToBase.set(r, k * cpr);
    const rp = buildPaletteRow(ctx.cgram, r, true, 'expand', cpr);
    for (let i = 0; i < cpr; i++) palette[k * cpr + i] = rp[i]!;
  });

  const tiles: Uint8Array[] = [new Uint8Array(ts * ts)];
  const tileBits: ({ baseTile: number; palRow: number } | null)[] = [null];
  const keyToTile = new Map<number, number>();
  const n = tilesAcross * tilesDown;
  const cells: AsepriteCell[] = new Array(n).fill(0).map(() => ({ tile: 0 }));
  const wordCells: BgPlacementCell[] = new Array(n).fill(0).map(() => ({ memoryEntryOff: -1, entry: 0, editable: false }));
  const local = new Uint8Array(64);

  for (const sc of region.subCells) {
    if (sc.pxX % ts !== 0 || sc.pxY % ts !== 0) continue; // only the top-left sub-cell of each native cell
    const cellIdx = (sc.pxY / ts) * tilesAcross + sc.pxX / ts;
    const baseTile = sc.entry & 0x3ff; // flip-independent (subCell.charTile already has the flip applied)
    const palRow = (sc.entry >> 10) & 0x07;
    wordCells[cellIdx] = { memoryEntryOff: sc.memoryEntryOff, entry: sc.entry, editable: !!sc.gfx };
    const key = (baseTile << 3) | palRow;
    let tileIdx = keyToTile.get(key);
    if (tileIdx === undefined) {
      const px = new Uint8Array(ts * ts);
      const base = rowToBase.get(palRow) ?? 0;
      for (let sy = 0; sy < subPerSide; sy++) {
        for (let sx = 0; sx < subPerSide; sx++) {
          const charTile = (baseTile + sx + sy * 16) & 0x3ff; // SNES 16×16 quad: base+0/1/0x10/0x11
          const vramByte = (charAddr + charTile * tileBytes) & 0xffff;
          if (vramByte + tileBytes > ctx.vram.length) continue;
          decode(ctx.vram, vramByte, false, false, local, 0); // UN-flipped; the cell carries flip
          for (let y = 0; y < TILE_PX; y++) {
            for (let x = 0; x < TILE_PX; x++) {
              const li = local[y * TILE_PX + x]!;
              px[(sy * TILE_PX + y) * ts + (sx * TILE_PX + x)] = li === 0 ? 0 : base + li;
            }
          }
        }
      }
      tileIdx = tiles.length;
      tiles.push(px);
      tileBits.push({ baseTile, palRow });
      keyToTile.set(key, tileIdx);
    }
    cells[cellIdx] = { tile: tileIdx, hflip: sc.hflip, vflip: sc.vflip };
  }

  // AVAILABLE tiles: the CHR loaded for this layer, offered at EVERY scene palette row
  // (so the artist can place an accessible tile in any of the scene's rows, not just
  // one). Appended to the tileset (NOT on the canvas, so the flatten is byte-identical);
  // a row is always one already in the palette (no index shift). `diffBgRegionPlacement`
  // reads them via `tileBits`, so placing one becomes a normal tilemap word. The
  // `(baseTile, row)` combos the tilemap already uses are skipped (they're placed tiles).
  const manifest = ctx.manifest ?? [];
  const align = subPerSide === 2 ? 0x11 : 0; // 16×16 baseTiles are 2×2-quad-aligned
  const localPx = new Uint8Array(ts * ts);
  for (let baseTile = 0; manifest.length > 0 && baseTile < 0x400; baseTile++) {
    if ((baseTile & align) !== 0) continue;
    // Every char of the (sub)quad must be THIS layer's loaded CHR.
    let accessible = true;
    for (let sy = 0; sy < subPerSide && accessible; sy++) {
      for (let sx = 0; sx < subPerSide; sx++) {
        const vb = (charAddr + ((baseTile + sx + sy * 16) & 0x3ff) * tileBytes) & 0xffff;
        const f = fileForVramByte(manifest, vb, tileBytes);
        if (!f || dpSlotLayer(f.dpSlot) !== layer) { accessible = false; break; }
      }
    }
    if (!accessible) continue;
    // Decode the quad's local indices ONCE; recolor per row.
    for (let sy = 0; sy < subPerSide; sy++) {
      for (let sx = 0; sx < subPerSide; sx++) {
        const vb = (charAddr + ((baseTile + sx + sy * 16) & 0x3ff) * tileBytes) & 0xffff;
        decode(ctx.vram, vb, false, false, local, 0);
        for (let y = 0; y < TILE_PX; y++) {
          for (let x = 0; x < TILE_PX; x++) {
            localPx[(sy * TILE_PX + y) * ts + (sx * TILE_PX + x)] = vb + tileBytes <= ctx.vram.length ? local[y * TILE_PX + x]! : 0;
          }
        }
      }
    }
    for (const row of region.paletteRowsUsed) {
      if (keyToTile.has((baseTile << 3) | row)) continue; // already a placed/used tile at this row
      const rowBase = rowToBase.get(row) ?? 0;
      const px = new Uint8Array(ts * ts);
      for (let i = 0; i < px.length; i++) { const li = localPx[i]!; px[i] = li === 0 ? 0 : rowBase + li; }
      tiles.push(px);
      tileBits.push({ baseTile, palRow: row });
    }
  }
  return { tiles, tileBits, cells, palette, wordCells, tileSize: ts, tilesAcross, tilesDown };
}

/** Compose a BG2/BG3 region as a NATIVE-granularity placement `.aseprite`: one tile per
 *  tilemap word (ts×ts), one cell per word. Rearranging the cells in Aseprite IS
 *  rearranging the tilemap; `diffBgRegionPlacement` reads it back to word edits. */
export function bgRegionPlacementAseprite(ctx: BgRegionContext, region: BgRegionResult): Uint8Array {
  const b = bgRegionPlacementBuild(ctx, region);
  return encodeAseprite({
    tileW: b.tileSize, tileH: b.tileSize,
    tilesAcross: b.tilesAcross, tilesDown: b.tilesDown,
    tiles: b.tiles, cells: b.cells, palette: b.palette,
    transparentIndex: 0,
    layerName: `BG${region.layer}-layout`, tilesetName: 'cells'
  });
}

/** One changed BG tilemap word: `fileOffset` is the byte offset of the word WITHIN the
 *  decompressed tilemap file (= VRAM `memoryEntryOff − tilemapAddr`). */
export interface BgPlacementEdit { fileOffset: number; word: number }
export interface BgPlacementDiff {
  edits: BgPlacementEdit[];
  /** Cells whose placement changed but couldn't be written (non-editable / empty target). */
  skipped: number;
}

/**
 * Diff a rearranged native-granularity placement `.aseprite` against the original
 * region → the changed tilemap WORDS. For each cell whose `(tile, hflip, vflip)`
 * differs, rebuild the word from the moved tile's `(baseTile, paletteRow)` + the cell's
 * flips, preserving the destination cell's original priority bit. The caller splices
 * these into the decompressed tilemap file and `saveGfxEdit`s it. (Pixel edits ride the
 * separate 8px `bgRegionAseprite` export; placement and pixels are distinct modes.)
 */
export function diffBgRegionPlacement(
  ctx: BgRegionContext,
  region: BgRegionResult,
  struct: AsepriteStructural,
  tilemapAddr: number
): BgPlacementDiff {
  const b = bgRegionPlacementBuild(ctx, region);
  const edits: BgPlacementEdit[] = [];
  let skipped = 0;
  for (let i = 0; i < b.cells.length; i++) {
    const orig = b.cells[i]!;
    const now = struct.cells[i];
    const wc = b.wordCells[i]!;
    if (!now) continue;
    if (orig.tile === now.tile && !!orig.hflip === !!now.hflip && !!orig.vflip === !!now.vflip) continue; // unchanged
    const bits = b.tileBits[now.tile];
    if (!wc.editable || !bits || wc.memoryEntryOff < 0) { skipped++; continue; } // non-editable / empty target
    const word =
      (bits.baseTile & 0x3ff) | ((bits.palRow & 7) << 10) | (wc.entry & 0x2000) |
      (now.hflip ? 0x4000 : 0) | (now.vflip ? 0x8000 : 0);
    edits.push({ fileOffset: wc.memoryEntryOff - tilemapAddr, word });
  }
  return { edits, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED import — the 8×8 PIXEL `.aseprite` as a single source of truth.
//
// The plain pixel import (`diffBgRegionTiles`) FLATTENS the `.aseprite` to RGBA and
// base-aware slices each fixed cell — surgical (only changed pixels of only changed
// tiles), and it can't write the tilemap (a moved tile just bakes its pixels into the
// cell it lands on). This is the AUTHORITATIVE alternative the user asked for: treat the
// whole 8×8 file as the new truth and apply ALL of its data, driven by the Aseprite TILE
// INDICES (not RGBA). Two independent steps:
//
//   1. PIXELS — every Aseprite tileset tile's indexed pixels are written to the CHR tile
//      it maps to (the export's deterministic `(charTile,paletteRow)` dedup, rebuilt here
//      so the index→CHR identity is identical on both sides). Index-based, so duplicate-
//      palette-color and base-aware ambiguity disappear; an unedited tile re-encodes to
//      its base bytes (idempotent, no churn).
//
//      A CHR used under N palette rows is exported as N SEPARATE Aseprite tiles (one per
//      row) — but they all write back to the SAME CHR fileTile. So per fileTile we must
//      pick ONE authoritative source. The naive "emit any tile that differs from the
//      current base" oscillates: editing the CHR under one row leaves the OTHER rows'
//      tiles showing the original, and since `saveGfxEdit` feeds each write back into the
//      next import's base, the two views take turns "differing from base" → the CHR
//      flip-flops between edited and original on alternating imports. The fix: identify the
//      edited view against a STABLE `baseVram` (the VANILLA cart, which never moves), make
//      that the authoritative write, and only emit it when it differs from the CURRENT base
//      (idempotency). Unedited sibling views never write, so they can't revert the edit.
//   2. POSITIONS — a BG2/BG3 16×16 tilemap WORD stores ONE base char + palette row + H/V
//      flip; the PPU auto-composes the 2×2 from base+{0,1,0x10,0x11}. So each native cell's
//      `subPerSide²` Aseprite cells are read back, the word's base recovered from the
//      top-left tile (minus its flip offset), and the word rewritten — but only if the
//      whole group still forms a coherent base+offset block (a sub-8×8 shuffle no single
//      word can represent is KEPT as-is and counted `incoherentWords`, never corrupted).
//
// CAVEAT — index-based attribution assumes Aseprite **Manual tileset mode** (same as the
// title-island combined import): in Auto/Stack mode a pixel paint APPENDS a tile + repoints
// the cell, shifting indices. Appended tiles (index ≥ the export's tile count) have no CHR
// slot ⇒ counted `newTiles` and skipped (add new art via the raw sheet / a free slot).
export interface BgRegionCombinedDiff {
  /** Step 1 — CHR pixel writes (dedup'd by target, last-write-wins). */
  tileEdits: MetatileTileEdit[];
  /** Step 2 — tilemap WORD writes (spliced into the decompressed tilemap file). */
  wordEdits: BgPlacementEdit[];
  /** Opaque pixels whose absolute index is outside their tile's palette-row block
   *  (a wrong-row paint) — written at the row stride but flagged. */
  mismatches: number;
  /** A CHR fileTile that two+ EDITED Aseprite views (same char, different palette rows)
   *  disagree on — the lowest-index edited view wins deterministically; surfaced so the
   *  user knows a shared tile was painted inconsistently. */
  conflicts: number;
  /** Aseprite tiles beyond the export's tileset (Auto-mode appended / user-added) —
   *  no CHR slot, skipped. */
  newTiles: number;
  /** 16×16 groups that no longer form a valid base+offset block — word kept as-is. */
  incoherentWords: number;
}

/**
 * Diff an edited 8×8 PIXEL placement `.aseprite` against the original region as a single
 * authoritative source of truth — both the CHR pixels (step 1) and the tilemap words
 * (step 2). Rebuilds the deterministic `bgRegionTileset` so the tile-index → `(char,row)`
 * map is identical to the export, then reads the imported tiles/cells by INDEX. The caller
 * applies `tileEdits` via the CHR write-back and `wordEdits` by splicing the decompressed
 * tilemap file (both `saveGfxEdit`). BG2/BG3 only.
 */
export function diffBgRegionCombined(
  ctx: BgRegionContext,
  region: BgRegionResult,
  struct: AsepriteStructural,
  tilemapAddr: number,
  opts: {
    /** The VANILLA (no live-edit) VRAM — the stable reference that identifies which view of
     *  a shared CHR the artist edited (so re-imports don't flip-flop). Defaults to `ctx.vram`
     *  (correct only when there are no prior live gfx edits, e.g. in unit tests). */
    baseVram?: Uint8Array;
    /** The CURRENT decompressed tilemap bytes (live overlay ⊕ vanilla), so an already-applied
     *  placement move isn't re-reported every import. Defaults to the per-cell vanilla word. */
    currentTilemap?: Uint8Array;
  } = {}
): BgRegionCombinedDiff {
  if (struct.tileW !== TILE_PX || struct.tileH !== TILE_PX) {
    throw new Error(`diffBgRegionCombined expects an 8×8 pixel .aseprite (got ${struct.tileW}×${struct.tileH})`);
  }
  const { layer, bpp } = region;
  const cpr = bpp === 4 ? 16 : 4;
  const tileBytes = bpp === 4 ? 32 : 16;
  const encode = bpp === 4 ? encode4bppTile : encode2bppTile;
  const charAddr = layer === 2 ? ctx.regs.bg2CharAddr : ctx.regs.bg3CharAddr;
  const vanilla = opts.baseVram ?? ctx.vram;

  const canon = bgRegionTileset(ctx, region); // tiles[], tileBits[] (index→{char,palRow}), cells[]
  const tilesAcross8 = region.width / TILE_PX;
  const rowToBase = new Map<number, number>();
  region.paletteRowsUsed.forEach((r, k) => rowToBase.set(r, k * cpr));

  // ── Step 1: PIXELS — every editable tileset tile → its CHR (authoritative, by index).
  // Group candidate writes per CHR fileTile (a char used under N rows = N Aseprite tiles,
  // all targeting this one fileTile), so we can pick ONE base-independent winner per CHR.
  interface Cand { tileIndex: number; out: Uint8Array; mism: number; editedVsVanilla: boolean }
  const byTarget = new Map<string, { fileId: number; format: 'lz2' | 'lz16'; fileTile: number; vramByte: number; cands: Cand[] }>();
  let newTiles = 0;
  const local = new Uint8Array(64);
  for (let t = 1; t < canon.tiles.length; t++) {
    const bits = canon.tileBits[t];
    if (!bits) continue;
    // Resolve the CHR write-back target; editable only if it lands in THIS layer's files.
    const vramByte = (charAddr + bits.char * tileBytes) & 0xffff;
    if (vramByte + tileBytes > ctx.vram.length) continue;
    const f = fileForVramByte(ctx.manifest, vramByte, tileBytes);
    if (!f || dpSlotLayer(f.dpSlot) !== layer) continue; // wraparound / unloaded → non-editable
    if (t >= struct.numTiles) continue; // tile dropped from the imported file (Manual-mode invariant broken)
    // Recover this tile's local plane indices from the imported absolute palette indices.
    const rowBase = rowToBase.get(bits.palRow) ?? 0;
    const srcBase = t * struct.tileW * struct.tileH;
    let mism = 0;
    for (let i = 0; i < 64; i++) {
      const abs = struct.tilePixels[srcBase + i] ?? 0;
      if (abs === 0 || abs === struct.transparentIndex) local[i] = 0;
      else if (abs >= rowBase && abs < rowBase + cpr) local[i] = abs - rowBase;
      else { local[i] = abs % cpr; mism++; } // painted from a different row's block
    }
    const out = new Uint8Array(tileBytes);
    encode(local, 0, out, 0);
    // "Edited" is measured against VANILLA (stable) — NOT the current base, which the
    // live-edit feedback mutates (the source of the flip-flop).
    let editedVsVanilla = false;
    for (let k = 0; k < tileBytes; k++) if (out[k] !== vanilla[vramByte + k]) { editedVsVanilla = true; break; }
    const key = `${f.format}/${f.fileId}/${f.fileTile}`;
    let g = byTarget.get(key);
    if (!g) { g = { fileId: f.fileId, format: f.format, fileTile: f.fileTile, vramByte, cands: [] }; byTarget.set(key, g); }
    g.cands.push({ tileIndex: t, out, mism, editedVsVanilla });
  }
  for (let t = canon.tiles.length; t < struct.numTiles; t++) newTiles++;

  // Resolve each CHR fileTile to ONE authoritative write: the lowest-index EDITED view
  // (base-independent ⇒ stable across re-imports). Emit only if it differs from the CURRENT
  // base (no churn / idempotent). Unedited sibling views never write → no flip-flop.
  const tileEdits: MetatileTileEdit[] = [];
  let conflicts = 0;
  let mismatches = 0;
  for (const g of byTarget.values()) {
    const edited = g.cands.filter((c) => c.editedVsVanilla).sort((a, b) => a.tileIndex - b.tileIndex);
    if (edited.length === 0) continue; // no view changed this CHR vs vanilla → leave as-is
    const win = edited[0]!;
    mismatches += win.mism;
    for (let i = 1; i < edited.length; i++) { // edited views that disagree with the winner = a conflict
      let diff = false;
      for (let k = 0; k < tileBytes; k++) if (edited[i]!.out[k] !== win.out[k]) { diff = true; break; }
      if (diff) { conflicts++; break; }
    }
    let changed = false;
    for (let k = 0; k < tileBytes; k++) if (win.out[k] !== ctx.vram[g.vramByte + k]) { changed = true; break; }
    if (changed) tileEdits.push({ format: g.format, fileId: g.fileId, fileTile: g.fileTile, bytes: win.out });
  }
  const td = { edits: tileEdits, conflicts, mismatches };

  // ── Step 2: POSITIONS — every 16×16 word rebuilt from its 2×2 cell group (authoritative).
  const subPerSide = region.tileSize / TILE_PX; // 2 for 16×16 BG2/BG3 (1 for an 8×8 BG)
  const tilesAcross = region.width / region.tileSize;
  const tilesDown = region.height / region.tileSize;
  // Original word + tilemap offset per native cell (the top-left sub-cell carries them).
  // NOTE: placement is NOT gated on `sc.gfx` (the cell's PIXEL-editability). A word write
  // just repoints the cell at the moved tile's char, so a cell whose ORIGINAL CHR isn't a
  // writable BG2 tile (a transparent "sky" cell — wraparound/unloaded char) is still
  // placement-writable. Gating on `sc.gfx` was the bug that dropped tiles placed into blank
  // areas. The only gates are: a valid tilemap offset, the group is non-empty, and it forms
  // a coherent base+offset block.
  const wordCells = new Map<number, { entry: number; off: number }>();
  for (const sc of region.subCells) {
    if (sc.pxX % region.tileSize !== 0 || sc.pxY % region.tileSize !== 0) continue;
    const ci = (sc.pxY / region.tileSize) * tilesAcross + sc.pxX / region.tileSize;
    wordCells.set(ci, { entry: sc.entry, off: sc.memoryEntryOff });
  }
  const wordEdits: BgPlacementEdit[] = [];
  let incoherentWords = 0;
  const charOf = (cellIdx: number): { char: number; palRow: number } | null => {
    const c = struct.cells[cellIdx];
    if (!c || c.tile <= 0 || c.tile >= canon.tiles.length) return null;
    return canon.tileBits[c.tile] ?? null;
  };
  const cb0 = struct.celBounds ?? { col: 0, row: 0, cols: tilesAcross8, rows: region.height / TILE_PX };
  for (let gy = 0; gy < tilesDown; gy++) {
    for (let gx = 0; gx < tilesAcross; gx++) {
      const wc = wordCells.get(gy * tilesAcross + gx);
      if (!wc || wc.off < 0) continue;
      const fileOffset = wc.off - tilemapAddr;
      // The CURRENT tilemap word (live overlay ⊕ vanilla), not the vanilla region word — else
      // an already-applied move re-reports every import (loadBg2Tilemap reads vanilla, so the
      // overlay never reaches `region`).
      const curWord = opts.currentTilemap && fileOffset >= 0 && fileOffset + 1 < opts.currentTilemap.length
        ? opts.currentTilemap[fileOffset]! | (opts.currentTilemap[fileOffset + 1]! << 8)
        : wc.entry;
      // Was this cell INSIDE the Aseprite cel (authoritative) or trimmed off it? Aseprite trims
      // a tilemap cel to its non-empty bbox, and we re-expand trimmed cells to tile 0 — so an
      // empty (tile-0) cell INSIDE the cel is an intentional CLEAR, but one OUTSIDE was merely
      // trimmed and must keep the cart's original word.
      const anchorCol = gx * subPerSide, anchorRow = gy * subPerSide;
      const inCel = anchorCol >= cb0.col && anchorRow >= cb0.row &&
        anchorCol < cb0.col + cb0.cols && anchorRow < cb0.row + cb0.rows;
      let allEmpty = true;
      for (let sy = 0; sy < subPerSide && allEmpty; sy++) {
        for (let sx = 0; sx < subPerSide; sx++) {
          const cc = struct.cells[(gy * subPerSide + sy) * tilesAcross8 + (gx * subPerSide + sx)];
          if (cc && cc.tile > 0) { allEmpty = false; break; }
        }
      }
      if (allEmpty) {
        if (!inCel) continue; // trimmed off-cel → keep the cart's original word
        // Explicit clear: point the cell at the empty tile (char 0), keeping its palette row +
        // priority (bits 10-13), no flips.
        const clearWord = curWord & 0x3c00;
        if (clearWord !== curWord) wordEdits.push({ fileOffset, word: clearWord });
        continue;
      }
      const tlIdx = (gy * subPerSide) * tilesAcross8 + gx * subPerSide;
      const tl = struct.cells[tlIdx];
      const tlBits = charOf(tlIdx);
      if (!tl || !tlBits) { incoherentWords++; continue; } // partial group (empty anchor) / new tile
      const h = !!tl.hflip, v = !!tl.vflip;
      const tlOff = subPerSide === 1 ? 0 : (h ? 1 : 0) + (v ? 16 : 0);
      const base = (tlBits.char - tlOff) & 0x3ff;
      const palRow = tlBits.palRow;
      // The whole group must compose this word (base+offset, one row, the word's flips).
      let coherent = true;
      for (let sy = 0; sy < subPerSide && coherent; sy++) {
        for (let sx = 0; sx < subPerSide; sx++) {
          const cellIdx = (gy * subPerSide + sy) * tilesAcross8 + (gx * subPerSide + sx);
          const cell = struct.cells[cellIdx];
          const cb = charOf(cellIdx);
          const off = subPerSide === 1 ? 0 : (sx ^ (h ? 1 : 0)) + (sy ^ (v ? 1 : 0)) * 16;
          if (!cell || !cb || cb.char !== ((base + off) & 0x3ff) || cb.palRow !== palRow ||
              !!cell.hflip !== h || !!cell.vflip !== v) { coherent = false; break; }
        }
      }
      if (!coherent) { incoherentWords++; continue; }
      // `curWord` (current tilemap word) + `fileOffset` were resolved at the top of the loop.
      const word = (base & 0x3ff) | ((palRow & 7) << 10) | (curWord & 0x2000) |
        (h ? 0x4000 : 0) | (v ? 0x8000 : 0);
      if (word !== curWord) wordEdits.push({ fileOffset, word });
    }
  }

  return { tileEdits: td.edits, wordEdits, mismatches: td.mismatches, conflicts: td.conflicts, newTiles, incoherentWords };
}

// ─────────────────────────────────────────────────────────────────────────────
// M1TE2 ".M1" session export/import — the whole BG2/BG3 layer (tilemap + CHR +
// palette) bundled into ONE file editable in M1TE2 (m1te2.ts). Everything maps
// VERBATIM (research/graphics-editing/bg-region-edit.md): a YI 16×16 tilemap word IS
// an M1TE2 16×16-mode word (it expands base+{0,1,16,17} with the word's flips, like
// the YI PPU); VRAM CHR IS raw SNES planar (a byte copy); CGRAM IS BGR555 (a byte
// copy). BG2 (4bpp) → M1TE2 map slot 1; BG3 (2bpp) → slot 2. M1TE2 v2 supports up to a
// 64×64 map, which covers any in-level BG layer (max 64×64 words), so the whole layer is
// ONE .M1 — no screen-block split. Round-trips: edit in M1TE2 → CHR pixel writes +
// tilemap-word writes + palette writes back into the cart.

/** A BG layer exported as one `.M1` session file. */
export interface M1te2Export {
  /** The layer's tilemap-word grid dimensions (≤ 64 each). */
  cols: number;
  rows: number;
  bytes: Uint8Array;
}

/** Copy the layer's 1024-tile CHR window from VRAM verbatim (raw SNES planar — the exact
 *  .M1 CHR format, so no re-plane). `tileBytes` = 32 (4bpp) / 16 (2bpp); wraps at 64K. */
function bgChrWindow(vram: Uint8Array, charAddr: number, tileBytes: number): Uint8Array {
  const out = new Uint8Array(1024 * tileBytes);
  for (let t = 0; t < 1024; t++) {
    for (let b = 0; b < tileBytes; b++) out[t * tileBytes + b] = vram[(charAddr + t * tileBytes + b) & 0xffff]!;
  }
  return out;
}

interface BgWordCell { entry: number; off: number; editable: boolean }

/** Per native (tilemap-word) cell of the rendered region: its verbatim word, the byte
 *  offset of the word in VRAM (rendered→memory), and whether it's writable. Indexed
 *  `row*cols + col`. Shared by the M1TE2 export + import so both agree on the grid. */
function bgWordCells(region: BgRegionResult): { cols: number; rows: number; cells: (BgWordCell | undefined)[] } {
  const ts = region.tileSize;
  const cols = region.width / ts;
  const rows = region.height / ts;
  const cells: (BgWordCell | undefined)[] = new Array(cols * rows).fill(undefined);
  for (const sc of region.subCells) {
    if (sc.pxX % ts !== 0 || sc.pxY % ts !== 0) continue; // only each native cell's top-left sub-cell
    cells[(sc.pxY / ts) * cols + (sc.pxX / ts)] = { entry: sc.entry, off: sc.memoryEntryOff, editable: !!sc.gfx };
  }
  return { cols, rows, cells };
}

/**
 * Export a BG2/BG3 layer as one M1TE2 `.M1` session (v2 holds up to 64×64, so the whole
 * layer fits one file). The tilemap goes in the layer's canonical M1TE2 map slot (BG2 → 1,
 * BG3 → 2) at the doc's 64-stride; the CHR in the matching depth block (4bpp / 2bpp); the
 * palette is CGRAM verbatim — all byte-for-byte (see the section header).
 */
export function bgRegionM1te2(ctx: BgRegionContext, region: BgRegionResult): M1te2Export {
  const { layer, bpp } = region;
  const tileBytes = bpp === 4 ? 32 : 16;
  const charAddr = layer === 2 ? ctx.regs.bg2CharAddr : ctx.regs.bg3CharAddr;
  const slot = layer - 1; // BG2 → map slot 1 (4bpp), BG3 → slot 2 (2bpp)
  const tileSize = region.tileSize === 16 ? 16 : 8;

  const chr = bgChrWindow(ctx.vram, charAddr, tileBytes);
  const chr4bpp = bpp === 4 ? chr : new Uint8Array(32768);
  const chr2bpp = bpp === 2 ? chr : new Uint8Array(16384);
  const palette = ctx.cgram.slice(0, 256); // 128 colors; encodeM1te2 masks bit15

  const { cols, rows, cells } = bgWordCells(region);
  const map = new Uint16Array(MAP_STRIDE * MAP_STRIDE);
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      const wc = cells[r * cols + cc];
      if (wc) map[r * MAP_STRIDE + cc] = wc.entry & 0xffff;
    }
  }
  const maps: [Uint16Array, Uint16Array, Uint16Array] =
    [new Uint16Array(MAP_STRIDE * MAP_STRIDE), new Uint16Array(MAP_STRIDE * MAP_STRIDE), new Uint16Array(MAP_STRIDE * MAP_STRIDE)];
  maps[slot] = map;
  return {
    cols, rows,
    bytes: encodeM1te2({ mapWidth: cols <= 32 ? 32 : 64, mapHeight: rows, tileSize, palette, maps, chr4bpp, chr2bpp })
  };
}

/** A changed CGRAM color an `.M1` import detected (caller maps `cgramIndex` → the
 *  master-palette-blob offset for the write-back). Aliased to the shared M1TE2 util type so
 *  every `.M1` producer (BG region / world map / screens) emits one palette-edit shape. */
export type M1te2PaletteEdit = M1tePaletteEdit;

export interface M1te2Diff {
  /** CHR pixel writes (this layer's gfx files). */
  tileEdits: MetatileTileEdit[];
  /** Tilemap WORD writes (`fileOffset` = byte offset within the decompressed tilemap file). */
  wordEdits: BgPlacementEdit[];
  /** Changed CGRAM colors (excludes M1TE2's auto-blacked per-row transparent slots). */
  paletteEdits: M1te2PaletteEdit[];
  /** CHR tiles changed but not writable (wraparound / not this layer's files). */
  skippedTiles: number;
  /** Tilemap cells changed but not writable (non-editable / empty target). */
  skippedWords: number;
}

/**
 * Diff an edited M1TE2 `.M1` against the cart → CHR pixel edits + tilemap word edits +
 * palette color edits. CHR is a direct byte compare (the .M1 CHR is the same raw planar
 * format as VRAM, so no decode/re-plane — and there are no per-row "views" to reconcile,
 * unlike the Aseprite path). Tilemap words compare against the CURRENT word (live overlay
 * ⊕ built, via `currentTilemap`) so an already-applied move isn't re-reported. The whole
 * layer is one `.M1` (v2), read at the doc's 64-stride.
 */
export function diffBgRegionM1te2(
  ctx: BgRegionContext,
  region: BgRegionResult,
  m1Bytes: Uint8Array,
  tilemapAddr: number,
  opts: { currentTilemap?: Uint8Array } = {}
): M1te2Diff {
  const doc = parseM1te2(m1Bytes);
  const { layer, bpp } = region;
  const tileBytes = bpp === 4 ? 32 : 16;
  const charAddr = layer === 2 ? ctx.regs.bg2CharAddr : ctx.regs.bg3CharAddr;
  const chr = bpp === 4 ? doc.chr4bpp : doc.chr2bpp;
  const map = doc.maps[layer - 1]!;

  // ── CHR pixels — each tile whose .M1 bytes differ from the cart VRAM → its CHR file.
  const tileEdits: MetatileTileEdit[] = [];
  let skippedTiles = 0;
  for (let t = 0; t < 1024; t++) {
    const vramByte = (charAddr + t * tileBytes) & 0xffff;
    const bytes = new Uint8Array(tileBytes);
    let changed = false;
    for (let b = 0; b < tileBytes; b++) {
      const nv = chr[t * tileBytes + b] ?? 0;
      bytes[b] = nv;
      if (nv !== ctx.vram[(vramByte + b) & 0xffff]) changed = true;
    }
    if (!changed) continue;
    const f = fileForVramByte(ctx.manifest, vramByte, tileBytes);
    if (!f || dpSlotLayer(f.dpSlot) !== layer) { skippedTiles++; continue; } // wraparound / not this layer
    tileEdits.push({ format: f.format, fileId: f.fileId, fileTile: f.fileTile, bytes });
  }

  // ── Tilemap words — every cell vs the current word at each rendered position.
  const { cols, rows, cells } = bgWordCells(region);
  const wordEdits: BgPlacementEdit[] = [];
  let skippedWords = 0;
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      const wc = cells[r * cols + cc];
      const docWord = map[r * MAP_STRIDE + cc]! & 0xffff;
      if (!wc) { if (docWord !== 0) skippedWords++; continue; } // edit on an empty cell — can't place
      const fileOffset = wc.off - tilemapAddr;
      const curWord = opts.currentTilemap && fileOffset >= 0 && fileOffset + 1 < opts.currentTilemap.length
        ? (opts.currentTilemap[fileOffset]! | (opts.currentTilemap[fileOffset + 1]! << 8))
        : (wc.entry & 0xffff);
      if (docWord === curWord) continue;
      // A tilemap WORD lives in the (editable) tilemap file, so placement is writable even
      // for a non-pixel-editable cell (wraparound/borrowed char) — only `fileOffset` gates
      // it (matches diffBgRegionCombined; the "blank-area placement ignored" fix).
      if (fileOffset < 0) { skippedWords++; continue; }
      wordEdits.push({ fileOffset, word: docWord }); // M1TE2 word IS the verbatim SNES word
    }
  }

  // ── Palette — changed CGRAM colors, skipping the auto-blacked transparent slots.
  const paletteEdits = diffM1tePalette(doc.palette, ctx.cgram);

  return { tileEdits, wordEdits, paletteEdits, skippedTiles, skippedWords };
}

// ─────────────────────────────────────────────────────────────────────────────
// BG1 AREA → M1TE ".M1" (pixel + palette only; NO placement). BG1 is the level's
// Map16-stamped grid, not a flat tilemap, so the .M1 carries an 8×8-mode tilemap
// synthesized from each Map16 cell's 4 sub-tiles (an arbitrary CHR + palette row +
// flips per sub-tile — not a base+{0,1,16,17} block, so it can't be 16×16 mode). The
// tileset is the area's DISTINCT BG1 CHR (deduped by file tile); tile 0 = empty, so
// blank Map16 cells / level gaps stay blank instead of showing a stray tile. Each word
// carries the sub-tile's palette row + flips (M1TE applies palRow×16, like the SNES PPU).
// A 16×16-Map16 block = 32×32 8×8 cells = one .M1; a larger area → one .M1 per block.
//
// Placement (which Map16 / where) is the level editor's job — BG1 has no static tilemap
// to write — so import writes ONLY CHR pixels + palette, never a tilemap word.

interface Bg1M1Build {
  /** 4bpp planar tiles (32 B each); tile 0 = empty. Capped at 1024 (the M1TE 4bpp block). */
  tiles: Uint8Array[];
  /** Per tile: its CHR write-back target — null for the empty tile / non-faithful
   *  (animated / unloaded / borrowed) preview tiles, which render but are never written. */
  tileBits: ({ fileId: number; format: 'lz2' | 'lz16'; fileTile: number } | null)[];
  /** The M1TE word map (slot 0) at the doc's 64-stride; cells outside the block / empty stay 0. */
  map: Uint16Array;
  localCols: number;
  localRows: number;
}

/** Build the BG1 8×8 tileset + word map for the top-left ≤32×32-Map16 block (≤64×64 8×8
 *  cells, the M1TE2 v2 max). Deterministic (region.cells row-major order, first-seen dedup)
 *  so the export and import agree on every tile index → CHR target. Shared by
 *  `bg1RegionM1te2` and `diffBg1RegionM1te2`. */
function bg1M1Build(ctx: MetatileContext, region: Bg1RegionResult): Bg1M1Build {
  const rectCols = region.width / CELL_PX;   // Map16 cells across the whole region
  const rectRows = region.height / CELL_PX;
  const localCols = Math.max(0, Math.min(MAP_STRIDE, rectCols * 2)); // 8×8 cells in the block (≤64)
  const localRows = Math.max(0, Math.min(MAP_STRIDE, rectRows * 2));
  const map = new Uint16Array(MAP_STRIDE * MAP_STRIDE);
  const tiles: Uint8Array[] = [new Uint8Array(TILE_BYTES_4BPP)]; // tile 0 = empty
  const tileBits: Bg1M1Build['tileBits'] = [null];
  const faithfulKey = new Map<string, number>(); // (fileId,fileTile) → dedup index
  const previewKey = new Map<number, number>();  // sub.tileIndex → preview index (non-faithful)
  const MAX_TILES = 1024;

  for (const cell of region.cells) {
    if (cell.c * 2 >= localCols || cell.r * 2 >= localRows) continue; // cell beyond the top-left block
    let subs;
    try { subs = decodeMap16Alloc(ctx.map16Tables, cell.map16Id); } catch { continue; }
    for (let q = 0; q < 4; q++) {
      const sub = subs[q]!;
      const localCol = cell.c * 2 + (q & 1);
      const localRow = cell.r * 2 + (q >> 1);
      if (localCol >= localCols || localRow >= localRows) continue;
      const vramByte = (ctx.bg1CharAddr + sub.tileIndex * TILE_BYTES_4BPP) & 0xffff;
      const inVram = vramByte + TILE_BYTES_4BPP <= ctx.vram.length;
      const f = inVram ? fileForVramByte(ctx.manifest, vramByte, TILE_BYTES_4BPP) : null;
      const writable = f && dpSlotLayer(f.dpSlot) === 1; // a loaded BG1 CHR tile (not animated/borrowed)
      let tileIdx: number;
      if (writable) {
        const key = `${f!.fileId}/${f!.fileTile}`;
        let idx = faithfulKey.get(key);
        if (idx === undefined) {
          if (tiles.length >= MAX_TILES) idx = 0; // overflow (astronomically rare for one block) → blank
          else {
            idx = tiles.length;
            tiles.push(ctx.vram.slice(vramByte, vramByte + TILE_BYTES_4BPP)); // un-flipped planar; word carries flip
            tileBits.push({ fileId: f!.fileId, format: f!.format, fileTile: f!.fileTile });
            faithfulKey.set(key, idx);
          }
        }
        tileIdx = idx;
      } else {
        // Non-faithful (animated / unloaded / borrowed char): a preview tile, never written.
        let idx = previewKey.get(sub.tileIndex);
        if (idx === undefined) {
          if (tiles.length >= MAX_TILES) idx = 0;
          else {
            idx = tiles.length;
            tiles.push(inVram ? ctx.vram.slice(vramByte, vramByte + TILE_BYTES_4BPP) : new Uint8Array(TILE_BYTES_4BPP));
            tileBits.push(null);
            previewKey.set(sub.tileIndex, idx);
          }
        }
        tileIdx = idx;
      }
      map[localRow * MAP_STRIDE + localCol] = (tileIdx & 0x3ff) | ((sub.paletteRow & 7) << 10) | (sub.hflip ? 0x4000 : 0) | (sub.vflip ? 0x8000 : 0);
    }
  }
  return { tiles, tileBits, map, localCols, localRows };
}

/** Export a BG1 area as a single M1TE `.M1` session — an 8×8-mode tilemap of the Map16
 *  sub-tiles (slot 0, 4bpp), the area's distinct CHR, and the CGRAM palette verbatim. Pixel
 *  + palette editing only — placement is the level editor. M1TE2 v2 fits up to a 64×64 8×8
 *  cell map = a 32×32-Map16 block, so a larger selected area is CROPPED to the top-left
 *  block; the caller (`exportBgRegionToDir`) detects that from the region dims and warns. */
export function bg1RegionM1te2(ctx: MetatileContext, region: Bg1RegionResult): M1te2Export {
  const palette = ctx.cgram.slice(0, 256);
  const b = bg1M1Build(ctx, region); // top-left ≤32×32-Map16 block only
  const chr4bpp = new Uint8Array(32768);
  for (let t = 0; t < b.tiles.length && t < 1024; t++) chr4bpp.set(b.tiles[t]!, t * TILE_BYTES_4BPP);
  const maps: [Uint16Array, Uint16Array, Uint16Array] = [b.map, new Uint16Array(MAP_STRIDE * MAP_STRIDE), new Uint16Array(MAP_STRIDE * MAP_STRIDE)];
  return {
    cols: b.localCols, rows: b.localRows,
    bytes: encodeM1te2({ mapWidth: b.localCols <= 32 ? 32 : 64, mapHeight: Math.max(1, b.localRows), tileSize: 8, palette, maps, chr4bpp, chr2bpp: new Uint8Array(16384) })
  };
}

/**
 * Diff an edited BG1-area `.M1` against the cart → CHR pixel edits + palette edits. Rebuilds
 * the deterministic dedup tileset (same as the export) so each .M1 4bpp tile maps back to
 * its BG1 CHR file; a byte difference vs the current CHR → a write. Empty / non-faithful
 * tiles are skipped. NO tilemap words (BG1 placement is the level editor), so a tile
 * rearrangement in M1TE is ignored — pixels at each fixed CHR tile are what's sliced.
 */
export function diffBg1RegionM1te2(ctx: MetatileContext, region: Bg1RegionResult, m1Bytes: Uint8Array): M1te2Diff {
  const doc = parseM1te2(m1Bytes);
  const b = bg1M1Build(ctx, region); // canonical (current-cart) tiles + tileBits
  const tileEdits: MetatileTileEdit[] = [];
  let skippedTiles = 0;
  for (let t = 1; t < b.tiles.length && t < 1024; t++) {
    const bits = b.tileBits[t];
    if (!bits) { skippedTiles++; continue; } // empty / non-faithful (animated/unloaded) — never written
    const canonical = b.tiles[t]!;
    const bytes = doc.chr4bpp.slice(t * TILE_BYTES_4BPP, t * TILE_BYTES_4BPP + TILE_BYTES_4BPP);
    let changed = false;
    for (let k = 0; k < TILE_BYTES_4BPP; k++) if (bytes[k] !== canonical[k]) { changed = true; break; }
    if (changed) tileEdits.push({ format: bits.format, fileId: bits.fileId, fileTile: bits.fileTile, bytes });
  }

  // Palette — changed CGRAM colors, skipping M1TE2's auto-blacked transparent slots.
  const paletteEdits = diffM1tePalette(doc.palette, ctx.cgram);

  return { tileEdits, wordEdits: [], paletteEdits, skippedTiles, skippedWords: 0 };
}

