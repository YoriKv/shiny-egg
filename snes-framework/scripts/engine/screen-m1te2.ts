// M1TE2 ".M1" session export/import for the TILEMAP-based system screens — the title floating
// island (Mode-7), the storybook first scene, and the six bonus-game screens (gm$2A,
// screen-bonus.ts). Same idea as the world map (world-map-m1te2.ts):
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
// for 4bpp, 4 for 2bpp), so the logo would render with the wrong colors. Edit the logo via the
// PNG/Aseprite export instead. The island (4bpp, row 0 → CGRAM 0-15) and the storybook BG3
// (Mode-1, 2bpp, base 0, 4-color rows) both match M1TE's base-0 model exactly, so they display
// faithfully — and every edit round-trips in the index/byte domain regardless.

import { encodeM1te2, parseM1te2, MAP_STRIDE, MAP_WORDS } from './m1te2.ts';
import { buildStorybookSceneContext, type StorybookSceneContext } from './screen-scene.ts';
import {
  buildTitleIslandContext, unpackCpcTile, packCpcTile, ISLAND_CPC_TILE_BYTES,
  type TitleIslandContext, type IslandTileEdit, type IslandPlacementEdit
} from './screen-title-island.ts';
import { chrWindow, sameBytes, fileForVramByteBpp, diffM1tePalette, type M1tePaletteEdit } from './m1te2-util.ts';
import { buildBonusSceneContext, BONUS_GAME_COUNT, type BonusSceneContext } from './screen-bonus.ts';
import { decode4bppTile, encode4bppTile } from './tile.ts';
import { u16le } from './rom-read.ts';
import { type SymbolMap } from './symbol-map.ts';

const TILE2 = 16;
const TILE4 = 32;
const EMPTY_MAP = (): Uint16Array => new Uint16Array(MAP_WORDS);

/** A CHR pixel edit sliced from a screen `.M1` (for `saveGfxEdit`). */
export interface ScreenChrEdit { format: 'lz2' | 'lz16'; fileId: number; fileTile: number; bytes: Uint8Array }
/** A changed CGRAM color an `.M1` import detected (caller maps `cgramIndex` → the blob).
 *  Re-exported from the shared M1TE2 util so import-side consumers keep one type. */
export type ScreenPaletteEdit = M1tePaletteEdit;

// ─────────────────────────────────────────────────────────────────────────────
// STORYBOOK FIRST SCENE — BG3 tilemap (2bpp f27), slot 2. Pixels-only (runtime-streamed map).
// ─────────────────────────────────────────────────────────────────────────────

/** The scene's screen-block dims, from the BG3 SC size. The shipped cart is 32×32; the
 *  plain row-major VRAM read below is only correct for a single 32-wide screen, so we cap
 *  the exported region at 32×32 (a wider/taller BG3 would need screen-block de-interleaving,
 *  which the cart never exercises). The `.M1` is still written in v2. */
function storybookDims(ctx: StorybookSceneContext): { cols: number; w: number; h: number } {
  const cols = (ctx.regs.bg3ScSize === 1 || ctx.regs.bg3ScSize === 3) ? 64 : 32;
  const rows = (ctx.regs.bg3ScSize === 2 || ctx.regs.bg3ScSize === 3) ? 64 : 32;
  return { cols, w: Math.min(32, cols), h: Math.min(32, rows) };
}

export function buildStorybookSceneM1(ctx: StorybookSceneContext): Uint8Array {
  const { cols, w, h } = storybookDims(ctx);
  const slot2 = EMPTY_MAP();
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) slot2[r * MAP_STRIDE + c] = u16le(ctx.vram, ctx.regs.bg3TilemapAddr + (r * cols + c) * 2);
  return encodeM1te2({
    mapWidth: 32, mapHeight: h, tileSize: 8, palette: ctx.cgram.slice(0, 256),
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
  for (let r = 0; r < ISLAND_ROWS; r++) for (let c = 0; c < ISLAND_COLS; c++) {
    slot0[r * MAP_STRIDE + c] = ctx.tilemap[r * ISLAND_COLS + c]! & 0x3ff; // word = char (palRow 0, no flip)
  }
  return encodeM1te2({
    mapWidth: 32, mapHeight: ISLAND_ROWS, tileSize: 8, palette: ctx.cgram.slice(0, 256),
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
  for (let r = 0; r < ISLAND_ROWS; r++) for (let c = 0; c < ISLAND_COLS; c++) {
    const i = r * ISLAND_COLS + c; // the DATA_5F9800 tilemap is plain 32-wide row-major
    const docChar = doc.maps[0][r * MAP_STRIDE + c]! & 0x3ff;
    if (docChar < charCount && docChar !== ctx.tilemap[i]) placement.push({ offset: i, value: docChar });
  }
  return { charEdits, placement, paletteEdits: diffM1tePalette(doc.palette, ctx.cgram) };
}

// ─────────────────────────────────────────────────────────────────────────────
// BONUS-GAME SCREENS (gm$2A) — Mode-1 static scenes, split across TWO .M1 shapes
// because `tileSize` is one global header field per .M1 and the scene mixes modes:
//   • per-game .M1 (×6, tileSize 8): BG1 + BG2 tilemaps (32×64, 8×8 tiles, shared
//     4bpp char base $E000) in slots 0/1.
//   • backdrop .M1 (×1, tileSize 16): the BG3 tilemap $95 (32×32, 16×16 tiles,
//     2bpp char $4000) in slot 2 — SHARED by all six games, so it exports once
//     (an edit here shows in every bonus game) and M1TE renders the real 2×2
//     char blocks (same as the level BG2/BG3 region .M1s).
// All three tilemaps are ordinary LZ2 blobs, so placement round-trips like the
// overworld terrain. See screen-bonus.ts for the trace.
// ─────────────────────────────────────────────────────────────────────────────

const BONUS_BG12_ROWS = 64; // BG1/BG2 SC size 2 = 32×64 cells
const BONUS_BG3_ROWS = 32;
const BONUS_COLS = 32;

const readBonusMap = (vram: Uint8Array, tmAddr: number, rows: number): Uint16Array => {
  const m = EMPTY_MAP();
  for (let r = 0; r < rows; r++) for (let c = 0; c < BONUS_COLS; c++) {
    m[r * MAP_STRIDE + c] = u16le(vram, (tmAddr + (r * BONUS_COLS + c) * 2) & 0xffff);
  }
  return m;
};

/** One game's BG1+BG2 (8×8 tiles; the 16×16 BG3 backdrop is its own .M1). */
export function buildBonusM1(ctx: BonusSceneContext): Uint8Array {
  const { vram, regs } = ctx;
  return encodeM1te2({
    mapWidth: BONUS_COLS, mapHeight: BONUS_BG12_ROWS, tileSize: 8, palette: ctx.cgram.slice(0, 256),
    maps: [readBonusMap(vram, regs.bg1TilemapAddr, BONUS_BG12_ROWS), readBonusMap(vram, regs.bg2TilemapAddr, BONUS_BG12_ROWS), EMPTY_MAP()],
    chr4bpp: chrWindow(vram, regs.bg1CharAddr, TILE4),
    chr2bpp: new Uint8Array(0)
  });
}

/** The SHARED BG3 backdrop ($95) as its own 16×16-tile .M1 (slot 2 + the 2bpp
 *  char window). Built from any game's context (the backdrop is game-invariant;
 *  the palette shown is that game's). */
export function buildBonusBackdropM1(ctx: BonusSceneContext): Uint8Array {
  const { vram, regs } = ctx;
  return encodeM1te2({
    mapWidth: BONUS_COLS, mapHeight: BONUS_BG3_ROWS, tileSize: 16, palette: ctx.cgram.slice(0, 256),
    maps: [EMPTY_MAP(), EMPTY_MAP(), readBonusMap(vram, regs.bg3TilemapAddr, BONUS_BG3_ROWS)],
    chr4bpp: new Uint8Array(0),
    chr2bpp: chrWindow(vram, regs.bg3CharAddr, TILE2)
  });
}

/** A tilemap WORD edit from a bonus `.M1` (→ splice into the LZ2 tilemap file). */
export interface BonusWordEdit { fileId: number; fileOffset: number; word: number }

export interface BonusM1Diff {
  chrEdits: ScreenChrEdit[];
  wordEdits: BonusWordEdit[];
  paletteEdits: ScreenPaletteEdit[];
  /** CHR tiles / tilemap cells changed but not backed by a scene file (runtime-
   *  written regions like the score digits) — dropped, surfaced as a warning. */
  skippedTiles: number;
}

/** Shared diff core: CHR windows + tilemap slots vs the scene, each gated to the
 *  backing file (the decompressed blob lands 1:1 in its VRAM region, so
 *  fileOffset = distance from the file's dest). */
function diffBonusParts(
  ctx: BonusSceneContext,
  doc: ReturnType<typeof parseM1te2>,
  chrParts: { chr: Uint8Array; charAddr: number; tileBytes: 16 | 32 }[],
  slotParts: { slot: 0 | 1 | 2; tmAddr: number; rows: number; fileId: number }[]
): BonusM1Diff {
  const { vram, manifest } = ctx;
  const chrEdits: ScreenChrEdit[] = [];
  let skippedTiles = 0;
  for (const p of chrParts) {
    for (let t = 0; t < 1024; t++) {
      const vramByte = (p.charAddr + t * p.tileBytes) & 0xffff;
      if (sameBytes(p.chr, t * p.tileBytes, vram, vramByte, p.tileBytes)) continue;
      const f = fileForVramByteBpp(manifest, vramByte, p.tileBytes);
      if (!f) { skippedTiles++; continue; }
      chrEdits.push({ format: f.format, fileId: f.fileId, fileTile: f.fileTile, bytes: p.chr.slice(t * p.tileBytes, (t + 1) * p.tileBytes) });
    }
  }
  const wordEdits: BonusWordEdit[] = [];
  for (const s of slotParts) {
    const file = manifest.find((f) => f.format === 'lz2' && f.fileId === s.fileId);
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < BONUS_COLS; c++) {
      const byteOff = (s.tmAddr + (r * BONUS_COLS + c) * 2) & 0xffff;
      const docWord = doc.maps[s.slot]![r * MAP_STRIDE + c]! & 0xffff;
      if (docWord === u16le(vram, byteOff)) continue;
      if (!file || byteOff < file.vramByteOffset || byteOff + 1 >= file.vramByteOffset + file.sizeBytes) { skippedTiles++; continue; }
      wordEdits.push({ fileId: s.fileId, fileOffset: byteOff - file.vramByteOffset, word: docWord });
    }
  }
  return { chrEdits, wordEdits, paletteEdits: diffM1tePalette(doc.palette, ctx.cgram), skippedTiles };
}

/** Diff an edited per-game bonus `.M1` → 4bpp CHR edits (per owning scene file) +
 *  BG1/BG2 tilemap word edits (per-game files). */
export function diffBonusM1(ctx: BonusSceneContext, m1Bytes: Uint8Array): BonusM1Diff {
  const doc = parseM1te2(m1Bytes);
  return diffBonusParts(
    ctx, doc,
    [{ chr: doc.chr4bpp, charAddr: ctx.regs.bg1CharAddr, tileBytes: TILE4 }],
    [
      { slot: 0, tmAddr: ctx.regs.bg1TilemapAddr, rows: BONUS_BG12_ROWS, fileId: ctx.bg1TmFileId },
      { slot: 1, tmAddr: ctx.regs.bg2TilemapAddr, rows: BONUS_BG12_ROWS, fileId: ctx.bg2TmFileId }
    ]
  );
}

/** Diff the edited shared backdrop `.M1` → 2bpp CHR edits + BG3 ($95) word edits. */
export function diffBonusBackdropM1(ctx: BonusSceneContext, m1Bytes: Uint8Array): BonusM1Diff {
  const doc = parseM1te2(m1Bytes);
  return diffBonusParts(
    ctx, doc,
    [{ chr: doc.chr2bpp, charAddr: ctx.regs.bg3CharAddr, tileBytes: TILE2 }],
    [{ slot: 2, tmAddr: ctx.regs.bg3TilemapAddr, rows: BONUS_BG3_ROWS, fileId: ctx.bg3TmFileId }]
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** One exported system-screen `.M1`, shaped for the manifest + the export driver. */
export interface ScreenM1File {
  file: string;
  kind: 'island' | 'storybook-scene' | 'bonus-game' | 'bonus-backdrop';
  /** bonus-game only: the game index 0-5 (re-derives the scene on import). */
  game?: number;
  bytes: Uint8Array;
}

/** Build the tilemap-based system screens as `.M1` sessions: the title island
 *  (`screens/title/`), the storybook first scene (`screens/storybook/`), the six
 *  bonus-game screens + their shared BG3 backdrop (`screens/bonus/`). */
export function exportScreenM1(rom: Uint8Array, symbols: SymbolMap): ScreenM1File[] {
  return [
    { file: 'screens/title/island.M1', kind: 'island', bytes: buildTitleIslandM1(buildTitleIslandContext(rom, symbols)) },
    { file: 'screens/storybook/scene.M1', kind: 'storybook-scene', bytes: buildStorybookSceneM1(buildStorybookSceneContext(rom, symbols)) },
    ...Array.from({ length: BONUS_GAME_COUNT }, (_, g): ScreenM1File => ({
      file: `screens/bonus/bonus-game-${g}.M1`,
      kind: 'bonus-game',
      game: g,
      bytes: buildBonusM1(buildBonusSceneContext(rom, symbols, g))
    })),
    { file: 'screens/bonus/backdrop.M1', kind: 'bonus-backdrop', bytes: buildBonusBackdropM1(buildBonusSceneContext(rom, symbols, 0)) }
  ];
}
