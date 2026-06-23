// Dynamic-sprite glyph editor — the GSU-rasterized sprites' functional equivalent
// of the metasprite (research/graphics-editing/metasprite.md §3/§9). Boss /
// dynamic-tile sprites have NO Bank4D cel table; their CHR streams from the
// bank-$54/$55 chunky glyph sheet (`FXDATA_5xxxxx`, graphicsassets §5.8). This
// exports each byte-validated glyph as a PNG and writes edits back to the raw
// glyph `.bin` via `saveRawChrEdit` — the same raw-CHR mechanism the animation
// frame-strips ship.
//
// Format (sprite-dynamic-gfx.ts): chunky **1 byte/pixel**, the **low nibble** is
// the 4bpp OBJ palette index, **256-byte row stride**; a sprite's body is a
// sub-rectangle. The **high nibble carries other data**, so the write-back is
// read-modify-write (preserve it). Only `RIGID_GLYPH_SPRITES` are offered — their
// source byte-matches the rasterized render, so editing them is the real glyph.

import { DYNAMIC_BODY_SOURCES, DYNAMIC_GFX_ANCHOR_SYMBOL, RIGID_GLYPH_SPRITES } from './sprite-dynamic-gfx.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { buildPaletteRow } from './color.ts';
import { encodePng, type ImageData } from './png.ts';
import type { SymbolMap } from './symbol-map.ts';

/** SNES base the per-sprite deltas are measured from (`DATA_gfx_bank54_part2`). */
const ANCHOR_SNES = 0x548000;
const ROW_STRIDE = 0x100;
const SWATCH_PX = 8;

/** The 4 raw glyph `.bin`s (bank $54/$55), each 0x8000 bytes, by SNES base. */
const GLYPH_BINS: { baseSnes: number; file: string }[] = [
  { baseSnes: 0x540000, file: 'Graphics/SuperFX/DATA_540000.bin' },
  { baseSnes: 0x548000, file: 'Graphics/SuperFX/DATA_548000.bin' },
  { baseSnes: 0x550000, file: 'Graphics/SuperFX/DATA_550000.bin' },
  { baseSnes: 0x558000, file: 'Graphics/SuperFX/DATA_558000.bin' }
];

/** Map a glyph SNES address → its raw `.bin` + byte offset within it, or null. */
function glyphBin(snes: number): { file: string; offset: number } | null {
  for (const b of GLYPH_BINS) {
    if (snes >= b.baseSnes && snes < b.baseSnes + 0x8000) return { file: b.file, offset: snes - b.baseSnes };
  }
  return null;
}

export interface GlyphSource {
  /** Representative sprite num (lowest of a shared source). */
  spriteNum: number;
  srcSnes: number;
  srcPC: number;
  width: number;
  height: number;
  /** OBJ palette row 0..7 (→ CGRAM row 8..15). */
  paletteRow: number;
  /** Other sprite nums that draw the SAME glyph bytes (edits affect them too). */
  sharedWith: number[];
}

/** The distinct byte-validated glyph sources (deduped by `srcSnes`; sprites that
 *  share a source collapse into one, the lowest num representing). */
export function glyphSources(rom: Uint8Array, symbols: SymbolMap): GlyphSource[] {
  const anchorPC = symbols.tryPc(DYNAMIC_GFX_ANCHOR_SYMBOL);
  if (anchorPC === undefined) return [];
  const bySnes = new Map<number, GlyphSource>();
  for (const num of [...RIGID_GLYPH_SPRITES].sort((a, b) => a - b)) {
    const s = DYNAMIC_BODY_SOURCES[num];
    if (!s) continue;
    const srcSnes = ANCHOR_SNES + s.delta;
    const existing = bySnes.get(srcSnes);
    if (existing) { existing.sharedWith.push(num); continue; }
    const srcPC = anchorPC + s.delta;
    if (srcPC < 0 || srcPC + (s.height - 1) * ROW_STRIDE + s.width > rom.length) continue;
    if (!glyphBin(srcSnes)) continue;
    bySnes.set(srcSnes, { spriteNum: num, srcSnes, srcPC, width: s.width, height: s.height, paletteRow: s.paletteRow, sharedWith: [] });
  }
  return [...bySnes.values()].sort((a, b) => a.spriteNum - b.spriteNum);
}

/** A glyph's raw w×h indices (each pixel's low nibble) from ROM. */
function decodeGlyph(rom: Uint8Array, srcPC: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = rom[srcPC + y * ROW_STRIDE + x]! & 0x0f;
  return out;
}

/** The OBJ palette row as ARGB, index 0 transparent (the glyph's background). */
function glyphPalette(cgram: Uint8Array, row: number): Uint32Array {
  return buildPaletteRow(cgram, 8 + row, true);
}

const paletteIndexOf = (palette: Uint32Array, u: number): number => {
  for (let i = 1; i < 16; i++) if (palette[i] === u) return i;
  return 0;
};

/** Render a glyph (w×h indices) + a full-row OBJ swatch → PNG. */
function glyphPng(indices: Uint8Array, w: number, h: number, palette: Uint32Array): Uint8Array {
  const width = w + SWATCH_PX;
  const height = Math.max(h, 16 * SWATCH_PX);
  const rgba = new Uint8Array(width * height * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = indices[y * w + x]!;
    if (idx !== 0) u32[y * width + x] = palette[idx]!;
  }
  for (let i = 0; i < 16; i++) {
    const c = palette[i]!;
    if (c === 0) continue;
    for (let dy = 0; dy < SWATCH_PX; dy++) for (let dx = 0; dx < SWATCH_PX; dx++) u32[(i * SWATCH_PX + dy) * width + (w + dx)] = c;
  }
  const image: ImageData = { width, height, rgba };
  return new Uint8Array(encodePng(image));
}

export interface GlyphPngEntry {
  spriteNum: number;
  srcSnes: number;
  width: number;
  height: number;
  sharedWith: number[];
  png: Uint8Array;
}

/** Export every byte-validated dynamic-sprite glyph as a PNG (coloured by the
 *  level's OBJ palette + a swatch). The bytes are global; the colouring is the
 *  level's (the slice maps colours → indices, so the edit is palette-independent). */
export function exportSpriteGlyphs(rom: Uint8Array, symbols: SymbolMap, header: PaletteHeader): GlyphPngEntry[] {
  const cgram = new Uint8Array(512);
  loadLevelPalettes(rom, symbols, header, cgram);
  const out: GlyphPngEntry[] = [];
  for (const g of glyphSources(rom, symbols)) {
    const indices = decodeGlyph(rom, g.srcPC, g.width, g.height);
    const png = glyphPng(indices, g.width, g.height, glyphPalette(cgram, g.paletteRow));
    out.push({ spriteNum: g.spriteNum, srcSnes: g.srcSnes, width: g.width, height: g.height, sharedWith: g.sharedWith, png });
  }
  return out;
}

/** One raw-CHR write (the shape `saveRawChrEdit` consumes). */
export interface GlyphWrite {
  binFile: string;
  offset: number;
  bytes: Uint8Array;
}

/**
 * Slice an edited glyph (the top-left `w`×`h` RGBA region) back to raw `.bin`
 * writes — base-aware (an unedited pixel keeps its base index) and read-modify-
 * write (the high nibble of each source byte is preserved). One write per row (the
 * 256-byte stride). Returns null if a row falls outside the known glyph bins.
 */
export function sliceGlyphWrites(
  rom: Uint8Array,
  g: GlyphSource,
  editedRgba: Uint8Array,
  palette: Uint32Array
): { writes: GlyphWrite[]; changed: boolean } | null {
  const { srcPC, srcSnes, width: w, height: h } = g;
  const u32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, w * h);
  const writes: GlyphWrite[] = [];
  let changed = false;
  for (let y = 0; y < h; y++) {
    const bin = glyphBin(srcSnes + y * ROW_STRIDE);
    if (!bin) return null;
    const bytes = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      const cur = rom[srcPC + y * ROW_STRIDE + x]!;
      const baseIdx = cur & 0x0f;
      const u = u32[y * w + x]!;
      const idx = u === palette[baseIdx] ? baseIdx : paletteIndexOf(palette, u);
      const next = (cur & 0xf0) | (idx & 0x0f); // preserve high nibble
      if (next !== cur) changed = true;
      bytes[x] = next;
    }
    writes.push({ binFile: bin.file, offset: bin.offset, bytes });
  }
  return { writes, changed };
}

/** Resolve `spriteNum` to its glyph source + write-back the edited region, or
 *  null if it isn't an editable glyph. The importer's per-glyph entry point.
 *  `changed` is false when the edited region matches the cart (skip the overlay). */
export function glyphWritesForSprite(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: PaletteHeader,
  spriteNum: number,
  editedRgba: Uint8Array
): { writes: GlyphWrite[]; sharedWith: number[]; changed: boolean } | null {
  const g = glyphSources(rom, symbols).find((s) => s.spriteNum === spriteNum);
  if (!g) return null;
  const cgram = new Uint8Array(512);
  loadLevelPalettes(rom, symbols, header, cgram);
  const res = sliceGlyphWrites(rom, g, editedRgba, glyphPalette(cgram, g.paletteRow));
  return res ? { writes: res.writes, sharedWith: g.sharedWith, changed: res.changed } : null;
}
