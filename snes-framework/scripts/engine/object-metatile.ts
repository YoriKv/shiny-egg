// Object "metatile" reconstruction — the editable "meta" view of BG1 objects (the
// BG twin of the metasprite; see research/graphics-editing/object-metatile.md).
//
// Std/ext objects stamp **Map16 metatiles** (16×16 = 4 sub-tiles) into the BG1
// grid; each sub-tile draws an 8×8 tile from the level's BG1 tileset CHR with a
// flip + BG palette row. This module renders a Map16 block to a 16×16 PNG, and
// slices an edit back to the underlying BG1 CHR tiles → `saveGfxEdit` (the SAME
// `bg1-tileset/` files the faithful BG export writes). Pixels-only (the MVP): the
// Map16 block definition stays fixed; only its tiles' pixels change.
//
// Simpler than the metasprite: a metatile's 4 quadrants are NON-overlapping, so
// there is no owner map — each quadrant maps 1:1 to one sub-tile. A quadrant
// whose tile isn't in a loaded BG1 file (animated-slot / miss coverage) is not
// editable → the metatile is preview-only (edit those via the animations/ path or
// the raw bg1-tileset/ sheet).
//
// BG vs OBJ palette: BG1 index 0 is an OPAQUE colour (the backdrop the cart shows
// through in-game, but a real editable index here), unlike a sprite's transparent
// index 0 — so the canvas + swatch are fully opaque (matches the faithful
// bg1-tileset/ export's index0Transparent=false).

import { loadLevelGfx, fileForVramByte, type GfxHeader, type GfxFileEntry } from './load-graphics.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { loadMap16Tables, decodeMap16, type Map16Tables, type Map16SubTile } from './map16.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { decode4bppTile, encode4bppTile } from './tile.ts';
import { buildPaletteRow, paletteIndexOf } from './color.ts';
import type { SymbolMap } from './symbol-map.ts';

const TILE_BYTES_4BPP = 32;
const TILE_PX = 8;
const METATILE_PX = 16;

/** The header shape both `loadLevelGfx` and `loadLevelPalettes` consume — i.e.
 *  the app's `RenderHeaderRequest`. */
export type MetatileHeader = GfxHeader & PaletteHeader;

/** One 8×8 quadrant of a metatile, mapped to its BG1 gfx-file tile + canvas cell.
 *  `null` (in `MetatileCanvas.units`) ⇒ that quadrant isn't in a loaded BG1 file
 *  (animated / miss) and isn't editable. */
interface MetatileUnit {
  /** gfx file (the `saveGfxEdit` target — a `bg1-tileset/` file). */
  fileId: number;
  format: 'lz2' | 'lz16';
  /** File-relative 8×8 tile index. */
  fileTile: number;
  /** Base tile bytes (32B, 4bpp planar) from level VRAM — the slice's base. */
  baseBytes: Uint8Array;
  /** Top-left of this 8×8 quadrant on the canvas (one of (0,0)/(8,0)/(0,8)/(8,8)). */
  cellX: number;
  cellY: number;
  hflip: boolean;
  vflip: boolean;
  /** BG palette row 0..7 (CGRAM rows 0..7). */
  paletteRow: number;
}

export interface MetatileCanvas {
  map16Id: number;
  rgba: Uint8Array;
  width: number;
  height: number;
  /** The 4 quadrants (TL, TR, BL, BR); `null` = non-editable (anim/miss/unmapped). */
  units: (MetatileUnit | null)[];
  /** BG palette rows the block uses (for the swatch). */
  paletteRowsUsed: number[];
  /** Every quadrant maps to a BG1 file AND slices back byte-exact → safe to edit. */
  faithful: boolean;
}

/** A changed 8×8 BG1 sheet tile from a metatile edit, ready for `saveGfxEdit`. */
export interface MetatileTileEdit {
  fileId: number;
  format: 'lz2' | 'lz16';
  fileTile: number;
  bytes: Uint8Array;
}

/** Decode + palette context for one level header — build once, render many. */
export interface MetatileContext {
  rom: Uint8Array;
  symbols: SymbolMap;
  header: MetatileHeader;
  /** BG1 tileset VRAM (each gfx file's decoded tiles at its vramByteOffset; no
   *  tile-animation overlay — animated slots stay non-editable → preview). */
  vram: Uint8Array;
  cgram: Uint8Array;
  manifest: GfxFileEntry[];
  map16Tables: Map16Tables;
  /** BG1 char base (VRAM bytes) — sub-tile tileIndex is relative to this. */
  bg1CharAddr: number;
  /** BG palette-row cache (opaque index 0). */
  palettes: (Uint32Array | undefined)[];
}

/** Build the per-header decode context (BG1 VRAM + CGRAM + manifest + Map16 tables).
 *  `gfxOverride` (the editor's live gfx-edit cache, `format/fileId` → decompressed
 *  tiles) makes the context reflect unsaved-to-build gfx edits — so an export
 *  shows them and an import slices against them. Omit for the base cart. */
export function buildMetatileContext(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: MetatileHeader,
  gfxOverride?: ReadonlyMap<string, Uint8Array>
): MetatileContext {
  const vram = new Uint8Array(0x10000);
  const manifest: GfxFileEntry[] = [];
  loadLevelGfx(rom, symbols, header, vram, manifest, gfxOverride);
  const cgram = new Uint8Array(512);
  loadLevelPalettes(rom, symbols, header, cgram);
  const regs = loadSceneRegs(rom, symbols, header.levelMode ?? 0);
  return {
    rom, symbols, header, vram, cgram, manifest,
    map16Tables: loadMap16Tables(rom, symbols),
    bg1CharAddr: regs.bg1CharAddr,
    palettes: new Array(8)
  };
}

/** BG palette row `row` (0..7) as ARGB, **opaque** index 0 — exactly how a BG1
 *  cell composites, so canvas pixels compare byte-exact and index 0 is editable. */
function palFor(ctx: MetatileContext, row: number): Uint32Array {
  let p = ctx.palettes[row];
  if (!p) {
    p = buildPaletteRow(ctx.cgram, row, false);
    ctx.palettes[row] = p;
  }
  return p;
}

/**
 * Slice one 8×8 quadrant back out of the canvas — the inverse of a blit.
 * Base-aware (a pixel still showing its base colour keeps its base index). No
 * owner gate is needed: a metatile's quadrants don't overlap. Returns 32 bytes.
 */
function sliceQuadrant(
  rgbaU32: Uint32Array,
  cellX: number,
  cellY: number,
  hflip: boolean,
  vflip: boolean,
  palette: Uint32Array,
  baseBytes: Uint8Array,
  /** Optional miss counter: bumped for each opaque pixel whose colour is in no
   *  slot of this row's palette (a wrong-row / off-palette paint, clamped to 0). */
  miss?: { n: number }
): Uint8Array {
  const baseIdx = new Uint8Array(64);
  decode4bppTile(baseBytes, 0, false, false, baseIdx, 0);
  const rawIdx = new Uint8Array(64);
  for (let trow = 0; trow < 8; trow++) {
    for (let tcol = 0; tcol < 8; tcol++) {
      const destCol = hflip ? 7 - tcol : tcol;
      const destRow = vflip ? 7 - trow : trow;
      const u = rgbaU32[(cellY + destRow) * METATILE_PX + (cellX + destCol)]!;
      const bIdx = baseIdx[trow * 8 + tcol]!;
      let r: number;
      if (u === palette[bIdx]) r = bIdx;
      else {
        r = paletteIndexOf(palette, u, 16);
        if (miss && r === 0 && u !== palette[0]) miss.n++;
      }
      rawIdx[trow * 8 + tcol] = r;
    }
  }
  const out = new Uint8Array(TILE_BYTES_4BPP);
  encode4bppTile(rawIdx, 0, out, 0);
  return out;
}

const SUB = new Array(4) as Map16SubTile[];

/**
 * Render a Map16 metatile to a 16×16 canvas + its quadrant/sheet map, or `null`
 * if the id is out of range. Computes the faithful gate (every quadrant maps to a
 * BG1 file and slices back byte-exact).
 */
/**
 * Composite 4 given Map16 sub-tiles → a 16×16 RGBA bitmap (opaque). Used by the
 * structured Map16 editor's LIVE preview (render the in-progress block definition,
 * which isn't in the cart yet) — no file mapping / faithful gate.
 */
export function renderMap16Block(ctx: MetatileContext, subtiles: readonly Map16SubTile[]): Uint8Array {
  const rgba = new Uint8Array(METATILE_PX * METATILE_PX * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, METATILE_PX * METATILE_PX);
  const indices = new Uint8Array(64);
  for (let q = 0; q < 4; q++) {
    const sub = subtiles[q]!;
    const cellX = (q & 1) * TILE_PX;
    const cellY = (q >> 1) * TILE_PX;
    const vramByte = (ctx.bg1CharAddr + sub.tileIndex * TILE_BYTES_4BPP) & 0xffff;
    const palette = palFor(ctx, sub.paletteRow);
    if (vramByte + TILE_BYTES_4BPP > ctx.vram.length) continue;
    decode4bppTile(ctx.vram, vramByte, sub.hflip, sub.vflip, indices, 0);
    for (let row = 0; row < TILE_PX; row++) {
      for (let col = 0; col < TILE_PX; col++) {
        u32[(cellY + row) * METATILE_PX + (cellX + col)] = palette[indices[row * 8 + col]!]!;
      }
    }
  }
  return rgba;
}

export function renderMetatile(ctx: MetatileContext, map16Id: number): MetatileCanvas | null {
  try {
    decodeMap16(ctx.map16Tables, map16Id, SUB);
  } catch {
    return null; // overflow / out-of-range page or tile
  }
  const rgba = new Uint8Array(METATILE_PX * METATILE_PX * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, METATILE_PX * METATILE_PX);
  const indices = new Uint8Array(64);
  const units: (MetatileUnit | null)[] = [];
  const rowsUsed = new Set<number>();
  let faithful = true;
  for (let q = 0; q < 4; q++) {
    const sub = SUB[q]!;
    const cellX = (q & 1) * TILE_PX;
    const cellY = (q >> 1) * TILE_PX;
    rowsUsed.add(sub.paletteRow);
    const vramByte = (ctx.bg1CharAddr + sub.tileIndex * TILE_BYTES_4BPP) & 0xffff;
    const palette = palFor(ctx, sub.paletteRow);
    if (vramByte + TILE_BYTES_4BPP <= ctx.vram.length) {
      decode4bppTile(ctx.vram, vramByte, sub.hflip, sub.vflip, indices, 0);
      for (let row = 0; row < TILE_PX; row++) {
        for (let col = 0; col < TILE_PX; col++) {
          u32[(cellY + row) * METATILE_PX + (cellX + col)] = palette[indices[row * 8 + col]!]!;
        }
      }
    }
    const map = fileForVramByte(ctx.manifest, vramByte, TILE_BYTES_4BPP);
    if (!map) { units.push(null); faithful = false; continue; }
    units.push({
      fileId: map.fileId, format: map.format, fileTile: map.fileTile,
      baseBytes: ctx.vram.subarray(vramByte, vramByte + TILE_BYTES_4BPP),
      cellX, cellY, hflip: sub.hflip, vflip: sub.vflip, paletteRow: sub.paletteRow
    });
  }
  if (faithful) {
    outer: for (const u of units) {
      if (!u) continue;
      const sliced = sliceQuadrant(u32, u.cellX, u.cellY, u.hflip, u.vflip, palFor(ctx, u.paletteRow), u.baseBytes);
      for (let k = 0; k < TILE_BYTES_4BPP; k++) if (sliced[k] !== u.baseBytes[k]) { faithful = false; break outer; }
    }
  }
  return { map16Id, rgba, width: METATILE_PX, height: METATILE_PX, units, paletteRowsUsed: [...rowsUsed].sort((a, b) => a - b), faithful };
}

/**
 * Diff an edited metatile canvas against its base: re-slice each editable quadrant
 * and collect the BG1 sheet tiles that changed. A `conflict` is two quadrants
 * writing the same `(fileId, fileTile)` different bytes (a tile shared within the
 * block, edited inconsistently — last write wins, reported).
 */
export function diffMetatileTiles(
  ctx: MetatileContext,
  canvas: MetatileCanvas,
  editedRgba: Uint8Array
): { edits: MetatileTileEdit[]; conflicts: number; mismatches: number } {
  const editedU32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, canvas.width * canvas.height);
  const byTile = new Map<string, Uint8Array>();
  let conflicts = 0;
  const miss = { n: 0 };
  for (const u of canvas.units) {
    if (!u) continue;
    const sliced = sliceQuadrant(editedU32, u.cellX, u.cellY, u.hflip, u.vflip, palFor(ctx, u.paletteRow), u.baseBytes, miss);
    let changed = false;
    for (let k = 0; k < TILE_BYTES_4BPP; k++) if (sliced[k] !== u.baseBytes[k]) { changed = true; break; }
    if (!changed) continue;
    const key = `${u.format}/${u.fileId}/${u.fileTile}`;
    const prev = byTile.get(key);
    if (prev) {
      for (let k = 0; k < TILE_BYTES_4BPP; k++) if (prev[k] !== sliced[k]) { conflicts++; break; }
    }
    byTile.set(key, sliced); // last write wins on conflict
  }
  const edits: MetatileTileEdit[] = [];
  for (const [key, bytes] of byTile) {
    const [format, fileId, fileTile] = key.split('/');
    edits.push({ fileId: Number(fileId), format: format as 'lz2' | 'lz16', fileTile: Number(fileTile), bytes });
  }
  return { edits, conflicts, mismatches: miss.n };
}
