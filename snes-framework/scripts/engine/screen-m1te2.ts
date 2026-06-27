// M1TE2 ".M1" session export/import for the TILEMAP-based system screens — the title floating
// island (Mode-7) and the storybook first scene. Same idea as the world map (world-map-m1te2.ts):
// bundle a screen's tilemap + CHR + palette into one .M1 editable in M1TE, re-derive everything
// from the cart on import so the .M1 alone is the source of truth. The non-tilemap screens (boot
// CHR crop, GSU scenery atlas, the f88 char sheet) have no meaningful tilemap, so they stay
// PNG/Aseprite.
//
//   • ISLAND — Mode-7 tilemap (`DATA_5F9800`, 32×32, 1 byte/cell char) over the $B1 CPC char.
//     Slot 0 (4bpp): each cell's char drawn from the CPC tiles unpacked to 4bpp planar (the
//     Mode-7 bytes index CGRAM 0-15 directly). Round-trips pixels (→ $B1, CPC re-pack) +
//     placement (→ DATA_5F9800, via saveIslandTilemap) + palette.
//   • STORYBOOK SCENE — the first-scene BG3 tilemap (32×32) over the 2bpp f27 char. Slot 2
//     (2bpp). PIXELS-ONLY (→ f27): the BG3 tilemap is runtime-streamed, so there is no static
//     placement target (same limit as the Aseprite scene export) — word moves are ignored.
//
// The TITLE LOGO is deliberately NOT exported here: it's Mode-0 BG2, whose palette field reads
// CGRAM at base +32 (BG2 owns CGRAM 32-63 in Mode 0). M1TE resolves a cell to
// `palette[palRow*stride + pixel]` at base 0 (verified in M1TE's `Form1.cs` big_sub — stride 16
// for 4bpp, 4 for 2bpp), so the logo would render with the wrong colours. Edit the logo via the
// PNG/Aseprite export instead. The island (4bpp, row 0 → CGRAM 0-15) and the storybook BG3
// (Mode-1, 2bpp, base 0, 4-colour rows) both match M1TE's base-0 model exactly, so they display
// faithfully — and every edit round-trips in the index/byte domain regardless.

import { encodeM1te2, parseM1te2 } from './m1te2.ts';
import { buildStorybookSceneContext, type StorybookSceneContext } from './screen-scene.ts';
import {
  buildTitleIslandContext, unpackCpcTile, packCpcTile, ISLAND_CPC_TILE_BYTES,
  type TitleIslandContext, type IslandTileEdit, type IslandPlacementEdit
} from './screen-title-island.ts';
import { chrWindow, sameBytes, diffM1tePalette, type M1tePaletteEdit } from './m1te2-util.ts';
import { decode4bppTile, encode4bppTile } from './tile.ts';
import { u16le } from './rom-read.ts';
import { type SymbolMap } from './symbol-map.ts';

const TILE2 = 16;
const TILE4 = 32;
const EMPTY_MAP = (): Uint16Array => new Uint16Array(1024);

/** A CHR pixel edit sliced from a screen `.M1` (for `saveGfxEdit`). */
export interface ScreenChrEdit { format: 'lz2' | 'lz16'; fileId: number; fileTile: number; bytes: Uint8Array }
/** A changed CGRAM colour an `.M1` import detected (caller maps `cgramIndex` → the blob).
 *  Re-exported from the shared M1TE2 util so import-side consumers keep one type. */
export type ScreenPaletteEdit = M1tePaletteEdit;

// ─────────────────────────────────────────────────────────────────────────────
// STORYBOOK FIRST SCENE — BG3 tilemap (2bpp f27), slot 2. Pixels-only (runtime-streamed map).
// ─────────────────────────────────────────────────────────────────────────────

/** The scene's 32×32 screen-block dims, from the BG3 SC size (it's 32×32 in the shipped cart;
 *  this stays correct if the cart ever used a wider/taller BG3). M1TE2 caps at 32×32. */
function storybookDims(ctx: StorybookSceneContext): { cols: number; w: number; h: number } {
  const cols = (ctx.regs.bg3ScSize === 1 || ctx.regs.bg3ScSize === 3) ? 64 : 32;
  const rows = (ctx.regs.bg3ScSize === 2 || ctx.regs.bg3ScSize === 3) ? 64 : 32;
  return { cols, w: Math.min(32, cols), h: Math.min(32, rows) };
}

export function buildStorybookSceneM1(ctx: StorybookSceneContext): Uint8Array {
  const { cols, w, h } = storybookDims(ctx);
  const slot2 = EMPTY_MAP();
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) slot2[r * 32 + c] = u16le(ctx.vram, ctx.regs.bg3TilemapAddr + (r * cols + c) * 2);
  return encodeM1te2({
    mapHeight: h, tileSize: 8, palette: ctx.cgram.slice(0, 256),
    maps: [EMPTY_MAP(), EMPTY_MAP(), slot2], chr4bpp: new Uint8Array(0), chr2bpp: chrWindow(ctx.vram, ctx.regs.bg3CharAddr, TILE2)
  });
}

export interface StorybookSceneM1Diff { chrEdits: ScreenChrEdit[]; paletteEdits: ScreenPaletteEdit[]; skippedTiles: number }

/** Diff an edited storybook-scene `.M1` → f27 CHR pixel edits + palette. PIXELS-ONLY: the BG3
 *  tilemap is runtime-streamed (no static placement target), and only f27-backed cells are
 *  editable, so CHR edits are gated to the f27 file's VRAM range (the frame border tiles). */
export function diffStorybookSceneM1(ctx: StorybookSceneContext, m1Bytes: Uint8Array): StorybookSceneM1Diff {
  const doc = parseM1te2(m1Bytes);
  const f27 = ctx.f27;
  const chrEdits: ScreenChrEdit[] = [];
  let skippedTiles = 0;
  for (let t = 0; t < 1024; t++) {
    const vramByte = (ctx.regs.bg3CharAddr + t * TILE2) & 0xffff;
    if (vramByte + TILE2 > ctx.vram.length || sameBytes(doc.chr2bpp, t * TILE2, ctx.vram, vramByte, TILE2)) continue;
    if (vramByte < f27.vramByteOffset || vramByte >= f27.vramByteOffset + f27.sizeBytes) { skippedTiles++; continue; }
    chrEdits.push({ format: f27.format, fileId: f27.fileId, fileTile: (vramByte - f27.vramByteOffset) / TILE2, bytes: doc.chr2bpp.slice(t * TILE2, t * TILE2 + TILE2) });
  }
  return { chrEdits, paletteEdits: diffM1tePalette(doc.palette, ctx.cgram), skippedTiles };
}

// ─────────────────────────────────────────────────────────────────────────────
// TITLE ISLAND — Mode-7 tilemap (DATA_5F9800), slot 0 (4bpp, CPC char unpacked).
// ─────────────────────────────────────────────────────────────────────────────

const ISLAND_COLS = 32;
const ISLAND_ROWS = 32;

export function buildTitleIslandM1(ctx: TitleIslandContext): Uint8Array {
  const charCount = Math.floor(ctx.b1cpc.length / ISLAND_CPC_TILE_BYTES); // 128
  const chr4 = new Uint8Array(1024 * TILE4);
  for (let ch = 0; ch < charCount; ch++) encode4bppTile(unpackCpcTile(ctx.b1cpc, ch * ISLAND_CPC_TILE_BYTES), 0, chr4, ch * TILE4);
  const slot0 = EMPTY_MAP();
  for (let i = 0; i < ISLAND_COLS * ISLAND_ROWS; i++) slot0[i] = ctx.tilemap[i]! & 0x3ff; // word = char (palRow 0, no flip)
  return encodeM1te2({
    mapHeight: ISLAND_ROWS, tileSize: 8, palette: ctx.cgram.slice(0, 256),
    maps: [slot0, EMPTY_MAP(), EMPTY_MAP()], chr4bpp: chr4, chr2bpp: new Uint8Array(0)
  });
}

export interface TitleIslandM1Diff { charEdits: IslandTileEdit[]; placement: IslandPlacementEdit[]; paletteEdits: ScreenPaletteEdit[] }

/** Diff an edited island `.M1` → $B1 CPC char edits + DATA_5F9800 placement + palette. Each
 *  .M1 4bpp tile (chars 0..127) is decoded → re-packed CPC → compared to the cart $B1. A cell
 *  whose char moved → a placement byte (chars beyond the 128 island slots are skipped — the
 *  simple .M1 path has no new-char allocation, unlike the combined Aseprite import). */
export function diffTitleIslandM1(ctx: TitleIslandContext, m1Bytes: Uint8Array): TitleIslandM1Diff {
  const doc = parseM1te2(m1Bytes);
  const charCount = Math.floor(ctx.b1cpc.length / ISLAND_CPC_TILE_BYTES);
  const idx = new Uint8Array(64);
  const charEdits: IslandTileEdit[] = [];
  for (let ch = 0; ch < charCount; ch++) {
    decode4bppTile(doc.chr4bpp, ch * TILE4, false, false, idx, 0);
    const cpc = packCpcTile(idx);
    if (!sameBytes(cpc, 0, ctx.b1cpc, ch * ISLAND_CPC_TILE_BYTES, ISLAND_CPC_TILE_BYTES)) charEdits.push({ char: ch, bytes: cpc });
  }
  const placement: IslandPlacementEdit[] = [];
  for (let i = 0; i < ISLAND_COLS * ISLAND_ROWS; i++) {
    const docChar = doc.maps[0][i]! & 0x3ff;
    if (docChar < charCount && docChar !== ctx.tilemap[i]) placement.push({ offset: i, value: docChar });
  }
  return { charEdits, placement, paletteEdits: diffM1tePalette(doc.palette, ctx.cgram) };
}

// ─────────────────────────────────────────────────────────────────────────────

/** One exported system-screen `.M1`, shaped for the manifest + the export driver. */
export interface ScreenM1File {
  file: string;
  kind: 'island' | 'storybook-scene';
  bytes: Uint8Array;
}

/** Build the tilemap-based system screens as `.M1` sessions: the title island
 *  (`screens/title/`) and the storybook first scene (`screens/storybook/`). */
export function exportScreenM1(rom: Uint8Array, symbols: SymbolMap): ScreenM1File[] {
  return [
    { file: 'screens/title/island.M1', kind: 'island', bytes: buildTitleIslandM1(buildTitleIslandContext(rom, symbols)) },
    { file: 'screens/storybook/scene.M1', kind: 'storybook-scene', bytes: buildStorybookSceneM1(buildStorybookSceneContext(rom, symbols)) }
  ];
}
