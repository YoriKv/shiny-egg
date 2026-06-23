// Metasprite reconstruction — the editable "meta" view of a sprite (the inverse
// of the OBJ→cart pipeline; see research/graphics-editing/metasprite.md).
//
// A metasprite is the artist's OBJ authoring file; the cart stores only its
// COMPILED cel table (Bank4D 5-byte records). This module rebuilds a
// recognisable assembled character FROM that cel table — assemble each cel tile
// from the level's sprite VRAM through CGRAM into a tight bitmap — so it can be
// exported as a PNG, edited, and re-applied to the cart's tile sheets.
//
// The write-back is **pixels-only** (the MVP, metasprite.md §6/§9): an edit to
// the canvas slices back to the underlying 8×8 sheet tiles and patches the gfx
// file via `saveGfxEdit`. It does NOT rewrite cel layout — the cel arrangement
// stays fixed, so the lossy OBJ→cart clamp/renumber/sentinel routing is never
// re-triggered. A tile shared by several sprites (the cart deduplicates) edits
// for all of them; the caller reports that.
//
// **Faithful gate.** A canvas is `faithful` only if every record slices back to
// the exact tile bytes it displays (base-aware). Only faithful canvases are
// offered for editing; the rest are preview-only → fall back to the raw
// `sprites/` sheet. `faithful` is an EDIT round-trip property, not a guarantee
// the reconstruction matches the game (the render is a partial best-effort — see
// metasprite.md §4 ⚠).
//
// The cel tile → gfx-file mapping goes through the level gfx MANIFEST (the same
// one the faithful `sprites/` export uses), so a metasprite edit and a raw-sheet
// edit target the identical `(format, fileId)` — no separate sheet model.

import { loadLevelGfx, fileForVramByte, type GfxHeader, type GfxFileEntry } from './load-graphics.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { resolveSpriteCel, AMBIENT_SPRITE_ID_BASE } from './sprite-tile-base.ts';
import { renderSpriteCel } from './sprite-cel.ts';
import { decode4bppTile, encode4bppTile } from './tile.ts';
import { buildPaletteRow } from './color.ts';
import { u16le } from './rom-read.ts';
import { encodePng, type ImageData } from './png.ts';
import { imageAseprite } from './gfx-aseprite.ts';
import type { SymbolMap } from './symbol-map.ts';

const TILE_BYTES_4BPP = 32;
const TILE_PX = 8;
/** OBJ name table is 16 tiles wide — a 16×16 sprite's lower row is +16 tiles. */
const OBJ_NAME_TABLE_WIDTH = 16;
/** Highest normal (cel-rendered) sprite id, exclusive end at the ambient base. */
const NORMAL_SPRITE_COUNT = AMBIENT_SPRITE_ID_BASE; // 0x000..0x1B9

/** The header shape both `loadLevelGfx` and `loadLevelPalettes` consume — i.e.
 *  the app's `RenderHeaderRequest`. */
export type MetaspriteHeader = GfxHeader & PaletteHeader;

/** One 8×8 sheet tile a record occupies, with the gfx file it maps to + the
 *  canvas cell to slice it from. A record has 1 (8×8) or 4 (16×16 quad). */
interface MetaspriteUnit {
  /** gfx file (the `saveGfxEdit` target — same id the faithful `sprites/` export uses). */
  fileId: number;
  format: 'lz2' | 'lz16';
  /** File-relative 8×8 tile index. */
  fileTile: number;
  /** Base tile bytes (32B, 4bpp planar) from level VRAM — the slice's base. */
  baseBytes: Uint8Array;
  /** Top-left of this 8×8 cell on the canvas. */
  cellX: number;
  cellY: number;
}

export interface MetaspriteRecord {
  /** Index of this record in the resolved cel (== the owner-map tag). */
  recordIndex: number;
  size: 8 | 16;
  hflip: boolean;
  vflip: boolean;
  /** OBJ palette row 0..7 (→ CGRAM row 8..15). */
  paletteRow: number;
  /** The 8×8 sheet tiles this record paints (1 or 4), or `null` for a dynamic-body
   *  placeholder / unmappable record (not editable). */
  units: MetaspriteUnit[] | null;
}

export interface MetaspriteCanvas {
  spriteId: number;
  rgba: Uint8Array;
  width: number;
  height: number;
  records: MetaspriteRecord[];
  /** Per-pixel owner (record index / -2 body / -1 transparent) from renderSpriteCel. */
  ownerMap: Int32Array;
  /** OBJ palette rows the cel uses (for the swatch). */
  paletteRowsUsed: number[];
  /** Every mappable record slices back to its displayed bytes byte-exact → the
   *  canvas is safe to edit. False → preview-only (edit via the raw sheet). */
  faithful: boolean;
  /** A SuperFX dynamic body is composited (preview-only region, owner -2). */
  hasDynamicBody: boolean;
}

/** A changed 8×8 sheet tile from a metasprite edit, ready for `saveGfxEdit`. */
export interface MetaspriteTileEdit {
  fileId: number;
  format: 'lz2' | 'lz16';
  fileTile: number;
  bytes: Uint8Array;
}

/** Decode + palette context for one level header — build once, render many. */
export interface MetaspriteContext {
  rom: Uint8Array;
  symbols: SymbolMap;
  header: MetaspriteHeader;
  /** Pre-animation sprite VRAM (each gfx file's decoded tiles at its vramByteOffset). */
  vram: Uint8Array;
  cgram: Uint8Array;
  manifest: GfxFileEntry[];
  /** OBJ palette-row cache (transparent index 0, matching renderSpriteCel). */
  palettes: (Uint32Array | undefined)[];
}

/** Build the per-header decode context (VRAM + CGRAM + gfx manifest). */
export function buildMetaspriteContext(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: MetaspriteHeader,
  /** Editor live gfx-edit cache (`format/fileId` → decompressed tiles) so the
   *  context reflects unsaved-to-build sprite-sheet edits; omit for the base cart. */
  gfxOverride?: ReadonlyMap<string, Uint8Array>
): MetaspriteContext {
  const vram = new Uint8Array(0x10000);
  const manifest: GfxFileEntry[] = [];
  // No tile-animation overlay: it overwrites BG slots, never sprite VRAM, and the
  // metasprite only reads sprite tiles. (Same OBJ-side choice as entity-thumbnails.)
  loadLevelGfx(rom, symbols, header, vram, manifest, gfxOverride);
  const cgram = new Uint8Array(512);
  loadLevelPalettes(rom, symbols, header, cgram);
  return { rom, symbols, header, vram, cgram, manifest, palettes: new Array(8) };
}

/** OBJ palette row `row` (0..7) as ARGB, index 0 transparent — exactly what
 *  renderSpriteCel composites with, so canvas pixels compare byte-exact. */
function palFor(ctx: MetaspriteContext, row: number): Uint32Array {
  let p = ctx.palettes[row];
  if (!p) {
    p = buildPaletteRow(ctx.cgram, 8 + row, true);
    ctx.palettes[row] = p;
  }
  return p;
}

/** The 6 spriteset file ids loaded for this header's sprite tileset. */
function spritesetFiles(ctx: MetaspriteContext): number[] {
  const base = ctx.symbols.pc('DATA_spriteset_files') + ctx.header.spriteTileset * 6;
  return [0, 1, 2, 3, 4, 5].map((i) => ctx.rom[base + i]!);
}

/** True if `spriteId`'s tiles are actually loaded in this level (so its
 *  metasprite renders real art, not garbage from an unrelated sheet): either a
 *  common-page sprite (required gfx file 0) or one whose required file is in this
 *  level's spriteset. */
function spriteLoadable(ctx: MetaspriteContext, spriteId: number, spriteset: number[]): boolean {
  const requiredFileId = u16le(ctx.rom, ctx.symbols.pc('DATA_sprite_gfx_file_table') + spriteId * 2);
  return requiredFileId === 0 || spriteset.includes(requiredFileId & 0xff);
}

/** Linear palette lookup (indices 1..15; transparent/0 default). */
function paletteIndexOf(palette: Uint32Array, u: number): number {
  for (let i = 1; i < 16; i++) if (palette[i] === u) return i;
  return 0;
}

/**
 * Slice one 8×8 sheet tile back out of the canvas — the inverse of a blit.
 * Base-aware (a pixel still showing its base colour keeps its base index) and
 * owner-gated (a pixel a CLOSER record owns, or transparent/body, keeps base —
 * so overlap + dynamic bodies don't corrupt). Returns the 32 planar bytes.
 */
function sliceUnit(
  rgbaU32: Uint32Array,
  width: number,
  ownerMap: Int32Array,
  recIndex: number,
  cellX: number,
  cellY: number,
  hflip: boolean,
  vflip: boolean,
  palette: Uint32Array,
  baseBytes: Uint8Array
): Uint8Array {
  const baseIdx = new Uint8Array(64);
  decode4bppTile(baseBytes, 0, false, false, baseIdx, 0);
  const rawIdx = new Uint8Array(64);
  for (let trow = 0; trow < 8; trow++) {
    for (let tcol = 0; tcol < 8; tcol++) {
      // Raw tile pixel (trow,tcol) was blitted to dest (col,row) under the
      // record's flip (decode4bppTile semantics): col = hflip?7-tcol:tcol, etc.
      const destCol = hflip ? 7 - tcol : tcol;
      const destRow = vflip ? 7 - trow : trow;
      const cx = cellX + destCol;
      const cy = cellY + destRow;
      const bIdx = baseIdx[trow * 8 + tcol]!;
      let v = bIdx;
      const p = cy * width + cx;
      if (cx >= 0 && cy >= 0 && cx < width && p < ownerMap.length && ownerMap[p] === recIndex) {
        const u = rgbaU32[p]!;
        v = u === palette[bIdx] ? bIdx : paletteIndexOf(palette, u);
      }
      rawIdx[trow * 8 + tcol] = v;
    }
  }
  const out = new Uint8Array(TILE_BYTES_4BPP);
  encode4bppTile(rawIdx, 0, out, 0);
  return out;
}

/** The 1 (8×8) or 4 (16×16 quad) sheet units a cel record occupies, with each
 *  unit's gfx-file mapping + canvas cell. `null` if any tile is unmapped. */
function recordUnits(
  ctx: MetaspriteContext,
  tile: number,
  size: 8 | 16,
  hflip: boolean,
  vflip: boolean,
  canvasX: number,
  canvasY: number,
  tileBaseBytes: number
): MetaspriteUnit[] | null {
  const quads: { qcol: number; qrow: number }[] =
    size === 8 ? [{ qcol: 0, qrow: 0 }]
      : [{ qcol: 0, qrow: 0 }, { qcol: 1, qrow: 0 }, { qcol: 0, qrow: 1 }, { qcol: 1, qrow: 1 }];
  const units: MetaspriteUnit[] = [];
  for (const { qcol, qrow } of quads) {
    const vramTile = tile + qrow * OBJ_NAME_TABLE_WIDTH + qcol;
    const vramByte = tileBaseBytes + vramTile * TILE_BYTES_4BPP;
    if (vramByte < 0 || vramByte + TILE_BYTES_4BPP > ctx.vram.length) return null;
    const map = fileForVramByte(ctx.manifest, vramByte, TILE_BYTES_4BPP);
    if (!map) return null;
    // The dest cell that drew this quad sub-tile (render's sx/sy ↔ srcCol/srcRow).
    const sx = size === 8 ? 0 : (hflip ? 1 - qcol : qcol);
    const sy = size === 8 ? 0 : (vflip ? 1 - qrow : qrow);
    units.push({
      fileId: map.fileId,
      format: map.format,
      fileTile: map.fileTile,
      baseBytes: ctx.vram.subarray(vramByte, vramByte + TILE_BYTES_4BPP),
      cellX: canvasX + sx * TILE_PX,
      cellY: canvasY + sy * TILE_PX
    });
  }
  return units;
}

/**
 * Render one sprite's metasprite to a canvas + its record/owner/sheet map, or
 * `null` if it has no renderable cel under this header. Computes the faithful
 * gate (every mappable record slices back to its displayed bytes byte-exact).
 */
export function renderMetasprite(ctx: MetaspriteContext, spriteId: number): MetaspriteCanvas | null {
  let resolved;
  try {
    resolved = resolveSpriteCel(
      ctx.rom, ctx.symbols, ctx.header, spriteId, ctx.manifest, false, ctx.header.spritePalette
    );
  } catch {
    return null;
  }
  if (!resolved) return null;
  const img = renderSpriteCel(resolved.cel, {
    vram: ctx.vram,
    cgram: ctx.cgram,
    tileBaseBytes: resolved.tileBaseBytes,
    dynamicBody: resolved.dynamicBody,
    trackOwner: true
  });
  if (img.width <= 0 || img.height <= 0 || !img.owner) return null;
  // All-transparent → no metasprite (an empty box reads as a bug).
  let opaque = false;
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] !== 0) { opaque = true; break; }
  if (!opaque) return null;

  const rgbaU32 = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.width * img.height);
  const rowsUsed = new Set<number>();
  const records: MetaspriteRecord[] = [];
  let faithful = true;
  let hasDynamicBody = resolved.dynamicBody !== undefined;

  resolved.cel.forEach((t, i) => {
    if (t.body) { // dynamic-body placeholder — its pixels come from the bitmap
      hasDynamicBody = true;
      records.push({ recordIndex: i, size: t.size, hflip: t.hflip, vflip: t.vflip, paletteRow: t.paletteRow, units: null });
      return;
    }
    rowsUsed.add(t.paletteRow);
    const canvasX = t.dx + img.originX;
    const canvasY = t.dy + img.originY;
    const units = recordUnits(ctx, t.tile, t.size, t.hflip, t.vflip, canvasX, canvasY, resolved.tileBaseBytes);
    if (!units) faithful = false; // unmappable tile → not editable
    records.push({ recordIndex: i, size: t.size, hflip: t.hflip, vflip: t.vflip, paletteRow: t.paletteRow, units });
  });

  // Faithful gate: every mappable record must slice back to its base bytes from
  // the UNEDITED canvas (so an edit lands on consistent tiles; a slice gap → not
  // editable). A pixel-perfect reconstruction round-trips; overlap/flip/transparency
  // are handled by the owner gate + base-aware slice.
  if (faithful) {
    outer: for (const rec of records) {
      if (!rec.units) continue;
      const palette = palFor(ctx, rec.paletteRow);
      for (const u of rec.units) {
        const sliced = sliceUnit(rgbaU32, img.width, img.owner, rec.recordIndex, u.cellX, u.cellY, rec.hflip, rec.vflip, palette, u.baseBytes);
        for (let k = 0; k < TILE_BYTES_4BPP; k++) {
          if (sliced[k] !== u.baseBytes[k]) { faithful = false; break outer; }
        }
      }
    }
  }

  return {
    spriteId,
    rgba: img.rgba,
    width: img.width,
    height: img.height,
    records,
    ownerMap: img.owner,
    paletteRowsUsed: [...rowsUsed].sort((a, b) => a - b),
    faithful,
    hasDynamicBody
  };
}

/** Sprite ids that render a metasprite under this header (loadable + cel-resolvable
 *  + opaque). Common-page sprites + this level's spriteset enemies. */
export function metaspriteSpriteIds(ctx: MetaspriteContext): number[] {
  const spriteset = spritesetFiles(ctx);
  const ids: number[] = [];
  for (let id = 0; id < NORMAL_SPRITE_COUNT; id++) {
    if (!spriteLoadable(ctx, id, spriteset)) continue;
    if (renderMetasprite(ctx, id)) ids.push(id);
  }
  return ids;
}

/**
 * Diff an edited metasprite canvas against its base: re-slice every record from
 * `editedRgba` and collect the 8×8 sheet tiles that changed. A `conflict` is two
 * records writing the same `(fileId, fileTile)` different bytes (a shared tile
 * edited inconsistently — last write wins, reported).
 */
export function diffMetaspriteTiles(
  ctx: MetaspriteContext,
  canvas: MetaspriteCanvas,
  editedRgba: Uint8Array
): { edits: MetaspriteTileEdit[]; conflicts: number } {
  const editedU32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, canvas.width * canvas.height);
  const byTile = new Map<string, Uint8Array>();
  let conflicts = 0;
  for (const rec of canvas.records) {
    if (!rec.units) continue;
    const palette = palFor(ctx, rec.paletteRow);
    for (const u of rec.units) {
      const sliced = sliceUnit(editedU32, canvas.width, canvas.ownerMap, rec.recordIndex, u.cellX, u.cellY, rec.hflip, rec.vflip, palette, u.baseBytes);
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
  }
  const edits: MetaspriteTileEdit[] = [];
  for (const [key, bytes] of byTile) {
    const [format, fileId, fileTile] = key.split('/');
    edits.push({ fileId: Number(fileId), format: format as 'lz2' | 'lz16', fileTile: Number(fileTile), bytes });
  }
  return { edits, conflicts };
}

/** The metasprite as a single-image (no-tilemap) `.aseprite`: the assembled character
 *  coloured in its used OBJ rows (index 0 transparent). Import flattens it back →
 *  `diffMetaspriteTiles`, like the PNG. */
export function metaspriteAseprite(ctx: MetaspriteContext, canvas: MetaspriteCanvas): Uint8Array {
  const pal: number[] = [];
  for (const row of canvas.paletteRowsUsed) { const rp = palFor(ctx, row); for (let i = 0; i < 16; i++) pal.push(rp[i]!); }
  return imageAseprite({ rgba: canvas.rgba, width: canvas.width, height: canvas.height, palette: pal, index0Transparent: true, layerName: `sprite-${canvas.spriteId.toString(16)}` });
}

export interface MetaspritePngEntry {
  spriteId: number;
  faithful: boolean;
  hasDynamicBody: boolean;
  width: number;
  height: number;
  png: Uint8Array;
  /** The same character as a single-image `.aseprite` (built only when requested). */
  aseprite?: Uint8Array;
}

/** Encode a metasprite canvas to a PNG: the assembled character (index 0
 *  transparent) + a self-describing OBJ-palette swatch column per palette row
 *  used (full 16-colour row; index 0 transparent), placed to the right. Import
 *  reads only the top-left `width×height` region. */
export function metaspritePng(ctx: MetaspriteContext, canvas: MetaspriteCanvas): Uint8Array {
  const rows = canvas.paletteRowsUsed;
  const swatchW = rows.length * TILE_PX;
  const swatchH = rows.length ? 16 * TILE_PX : 0;
  const width = canvas.width + swatchW;
  const height = Math.max(canvas.height, swatchH);
  const rgba = new Uint8Array(width * height * 4);
  // Canvas (top-left).
  for (let y = 0; y < canvas.height; y++) {
    rgba.set(canvas.rgba.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4), (y * width) * 4);
  }
  // Swatch columns.
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  rows.forEach((row, ri) => {
    const palette = palFor(ctx, row);
    const x0 = canvas.width + ri * TILE_PX;
    for (let i = 0; i < 16; i++) {
      const color = palette[i]!;
      if (color === 0) continue; // index 0 transparent — leave clear
      for (let dy = 0; dy < TILE_PX; dy++) {
        for (let dx = 0; dx < TILE_PX; dx++) {
          u32[(i * TILE_PX + dy) * width + (x0 + dx)] = color;
        }
      }
    }
  });
  const image: ImageData = { width, height, rgba };
  return new Uint8Array(encodePng(image));
}

/**
 * Render every metasprite under `header` (optionally restricted to `spriteIds`)
 * and encode each to a PNG. Returns one entry per sprite that resolves a cel.
 */
export function exportMetasprites(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: MetaspriteHeader,
  opts: { spriteIds?: ReadonlySet<number>; gfxOverride?: ReadonlyMap<string, Uint8Array>; aseprite?: boolean } = {}
): MetaspritePngEntry[] {
  const ctx = buildMetaspriteContext(rom, symbols, header, opts.gfxOverride);
  const ids = opts.spriteIds ? [...opts.spriteIds].filter((id) => id < NORMAL_SPRITE_COUNT) : metaspriteSpriteIds(ctx);
  const out: MetaspritePngEntry[] = [];
  for (const id of ids.sort((a, b) => a - b)) {
    const canvas = renderMetasprite(ctx, id);
    if (!canvas) continue;
    out.push({
      spriteId: id,
      faithful: canvas.faithful,
      hasDynamicBody: canvas.hasDynamicBody,
      width: canvas.width,
      height: canvas.height,
      png: metaspritePng(ctx, canvas),
      aseprite: opts.aseprite && canvas.faithful ? metaspriteAseprite(ctx, canvas) : undefined
    });
  }
  return out;
}
