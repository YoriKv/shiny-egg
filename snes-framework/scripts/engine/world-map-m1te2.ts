// M1TE2 ".M1" session export/import for the WORLD MAP — the M1TE-editable counterpart
// to the per-world overworld terrain (world-map-terrain.ts) + the level-slot / level
// icons (screen-world-map-icons.ts / world-map-level-icons.ts). Like the level BG-region
// .M1 path (bg-region.ts) this bundles a layer's tilemap + CHR + palette into one .M1 file
// (m1te2.ts); the difference is the world map's data is a SCENE (no level header), so it
// reads the cart directly. Two products:
//
//   • OVERWORLD — one .M1 per world (the full 64×32 screen). M1TE2 v2 supports a 64-wide
//     map, so this is ONE file — the cart stores the whole overworld as a single 64×32
//     screen-block tilemap (the "levels 1-4 / 5-8" left/right split is a CAMERA hscroll,
//     not a data split — see world-map-terrain.ts). Each file carries the three composited
//     map layers as M1TE2 map slots:
//       slot 0 = BG1 foreground  ($7C-class LZ2 tilemap) — path, markers, fortress
//       slot 1 = BG2 background   ($7D-class LZ2 tilemap) — hills, clouds, scenery
//       slot 2 = BG3 ground       ($7E LZ2 tilemap, 2bpp) — the tan terrain + tree line
//     BG1+BG2 draw 4bpp from the shared $74/$75/$4C char (base $4000); BG3 draws 2bpp from
//     the $56 char ($2000). The palette is the per-world overworld CGRAM rows 0-7 (BG) —
//     M1TE2 holds 128 colors = exactly those rows, so the overworld colors are EXACT.
//     The overworld is native tilemap data, so every word + CHR byte maps VERBATIM: edits
//     round-trip placement (→ the $7C/$7D/$7E tilemaps), pixels (→ $74/$75/$4C + $56), and
//     palette (→ the master blob).
//
//   • ICONS — one .M1 with EVERY level-select picture: the 60 per-level icons (6 worlds ×
//     10 slots, in level order) plus the level MARKER + boss CASTLE shapes. Unlike the
//     overworld these are NOT native tilemap data, so the .M1 is a synthesized grid (map
//     slot 0): per-level icons are bank-$53 GSU-chunky pixels converted to 4bpp planar
//     (round-trip → the $53 .bin, nibble RMW); marker/castle are the cart $74/$75 tiles
//     (round-trip → saveGfxEdit). The display palette is FAITHFUL: the icons span only a few
//     distinct 16-color palettes (the per-level icons use 2 world-invariant OBJ palettes;
//     the marker/castle use the 6 per-world BG tints — ≤ 6 distinct in all), which fit
//     M1TE2's 8 palette rows, so each cell is shown in its true colors (`buildIconLayout`).
//     Pixel edits round-trip in the INDEX/BYTE domain regardless. The diff re-derives the
//     whole layout from the base cart (deterministic), so the .M1 needs no per-icon sidecar.

import { encodeM1te2, parseM1te2, MAP_STRIDE, MAP_WORDS } from './m1te2.ts';
import {
  buildWorldMapTerrainContext, terrainLayerFileId, type WorldMapTerrainContext
} from './world-map-terrain.ts';
import {
  buildLevelIconContext, renderWorldMapLevelIcon, sliceLevelIconIndices,
  type LevelIconContext, type LevelIconCanvas, type IconWrite
} from './world-map-level-icons.ts';
import {
  buildWorldMapIconContext, renderWorldMapIcon,
  type WorldMapIconContext, type WorldMapIconCanvas
} from './screen-world-map-icons.ts';
import { chrWindow, sameBytes, fileForVramByteBpp, diffM1tePalette, type M1tePaletteEdit } from './m1te2-util.ts';
import { decode4bppTile, encode4bppTile } from './tile.ts';
import { type SymbolMap } from './symbol-map.ts';

// ── overworld constants (mirrors world-map-terrain.ts) ───────────────────────
const COLS = 64;
const ROWS = 32;
const MAP_CHAR_BASE = 0x4000; // BG1/BG2 char base on the overworld (reaches $74/$75/$4C)
const GROUND_CHAR_VRAM = 0x2000; // BG3 ground char ($56), 2bpp
const GROUND_TM_VRAM = 0x2800; // BG3 ground tilemap ($7E), 64×32, DMA'd here
const GROUND_TM_FILE_ID = 0x7e; // the $7E LZ2 tilemap gfx-file the BG3 ground round-trips to
const TILE4 = 32;
const TILE2 = 16;

/** Screen-block word index for cell (col,row) — block 0 = cols 0-31 @ $000, block 1 =
 *  cols 32-63 @ $400 (the SNES SC=01 two-screen layout); identical to world-map-terrain. */
const wordIndex = (c: number, r: number): number => (c >= 32 ? 0x400 : 0) + r * 32 + (c & 31);
/** Read a 16-bit BG word at word-index `wi` from a screen-block tilemap byte buffer. */
const wordAt = (tm: Uint8Array, wi: number): number => tm[wi * 2]! | (tm[wi * 2 + 1]! << 8);

// ── tileset-1 "blank" marker ─────────────────────────────────────────────────
// The overworld BG char base is VRAM $4000, but the 4bpp map char ($4C/$74/$75) loads
// at $6000+ — a 256-tile gap — so the first 4bpp tileset (char 0-255, what M1TE shows
// as "tileset 1") maps to an UNLOADED VRAM band. It is blank in the editor and the real
// overworld never references it (`mapGfx` loads nothing at $4000; every BG1/BG2 word
// uses char 256+, and vanilla "blank" foreground is char 447 — a loaded transparent tile,
// NOT char 0). But at runtime the game fills $4000-$6000 with the unrelated level-select
// panel char, so a cell that points into tileset 1 draws garbage in-game while showing
// transparent in M1TE. We paint EVERY tileset-1 tile (0..255) with a ✕ so the trap is
// visible, and the import flags any cell that references it (`tileset1Cells`).
//
// Tile 0 is marked too. M1TE treats char 0 as its "empty" tile (its erase tool writes
// char 0, and it keeps tile 0 blank), but YI has no such sentinel: scenes render purely
// through PPU registers (BGMODE/NBA/SC/TM·TS/color-math — see scene-regs.ts), the
// overworld tilemap is just lz2-decompressed + DMA'd raw (CODE_17CDCF), and the PPU
// fetches char 0 from char base $4000 like any other char — "empty" is strictly per-pixel
// color index 0, never a per-char rule. So char 0 is the same trap as 1-255. (The ✕ never
// reaches the cart: nothing backs $4000-$6000, so the diff skips tiles 0..255 — it is a
// pure editor-side marker. M1TE's erase will draw a ✕ until its erase is fixed.)
//
// The ✕ uses pixel index 15 — the LAST color of whatever 4bpp palette row M1TE shows the
// tileset in. M1TE draws each tile pixel as `palette[selectedRow*16 + index]` and picks the
// row from the user's palette selection (it ignores the .M1 header), so we can't pin a
// specific row; index 15 lands on a consistent end-of-row slot whatever row is selected.
const TILESET1_TILES = 256;
const TILESET1_X_INDEX = 15;

/** The 8×8 4bpp planar "✕" tile — pixel index 15 on both diagonals, index 0 elsewhere. */
function buildXMarkerTile(): Uint8Array {
  const idx = new Uint8Array(64);
  for (let i = 0; i < 8; i++) { idx[i * 8 + i] = TILESET1_X_INDEX; idx[i * 8 + (7 - i)] = TILESET1_X_INDEX; }
  const out = new Uint8Array(TILE4);
  encode4bppTile(idx, 0, out, 0);
  return out;
}

/** Paint all 256 tiles of a 4bpp CHR window (tileset 1) with the ✕ marker. Mutates `chr4`
 *  in place. The diff skips this same range, so it never round-trips as a CHR edit. */
function fillTileset1Marker(chr4: Uint8Array): void {
  const x = buildXMarkerTile();
  for (let t = 0; t < TILESET1_TILES; t++) chr4.set(x, t * TILE4);
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERWORLD — one .M1 per world (the full 64×32 screen, BG1+BG2+BG3 composited).
//
// Stray tiles outside the terrain band (audited 2026-07-19, prompted by
// overworld-w3's BG2 bottom rows): the scattered words in BG2 rows 28-31, BG1
// row 0 + a sparse column down rows 1-13, etc. are REAL cart data — w3's BG2
// verified word-for-word identical (0/2048) to the live gm$22 VRAM capture
// (../yi-shiny world-map-terrain). They are authoring leftovers, not designed
// fringe: worlds 0-3 carry irregular smatterings while w4/w5 are perfectly
// clean, and the walking view's constant BG2 vscroll ($80 — the visible window
// wraps rows 16-31 then 0-11) parks them in the shoreline band behind BG1's
// silhouette strip. Kept in the export on purpose — they're file bytes that
// round-trip, so they can be cleaned up (painted to fill) through the .M1.
// ─────────────────────────────────────────────────────────────────────────────

/** One exported overworld `.M1` (a world's full 64×32 screen). */
export interface OverworldM1 {
  world: number;
  /** BG1 foreground tilemap (slot 0) round-trips to this $7C-class LZ2 file. */
  bg1FileId: number;
  /** BG2 background tilemap (slot 1) → this $7D-class LZ2 file. */
  bg2FileId: number;
  /** BG3 ground tilemap (slot 2) → the world-invariant $7E LZ2 file. */
  bg3FileId: number;
  bytes: Uint8Array;
}

/** The BG3 ground's current screen-block tilemap (read from the VRAM region the $7E file is
 *  DMA'd into — byte-identical to the decompressed $7E). 4096 bytes = 2048 words. */
const groundTilemap = (vram: Uint8Array): Uint8Array => vram.slice(GROUND_TM_VRAM, GROUND_TM_VRAM + COLS * ROWS * 2);

/** Build a world's overworld as one `.M1` session: BG1/BG2/BG3 tilemaps in slots 0/1/2 over
 *  the shared 4bpp ($74/$75/$4C) + 2bpp ($56) CHR windows, colored by the per-world CGRAM
 *  (rows 0-7). The cart's screen-block tilemaps (left block @ words 0x000, right @ 0x400)
 *  are de-interleaved into the doc's plain row-major 64-wide grid (`wordIndex`). */
export function buildOverworldM1(c: WorldMapTerrainContext): OverworldM1 {
  const vram = c.scene.vram;
  const palette = c.scene.cgram.slice(0, 256); // 128 BG colors; encodeM1te2 masks bit15
  const chr4 = chrWindow(vram, MAP_CHAR_BASE, TILE4);
  fillTileset1Marker(chr4); // mark the unloaded char-0-255 band with a red ✕ (see note above)
  const chr2 = chrWindow(vram, GROUND_CHAR_VRAM, TILE2);
  const ground = groundTilemap(vram);
  const m0 = new Uint16Array(MAP_STRIDE * MAP_STRIDE); // BG1
  const m1 = new Uint16Array(MAP_STRIDE * MAP_STRIDE); // BG2
  const m2 = new Uint16Array(MAP_STRIDE * MAP_STRIDE); // BG3 ground
  for (let r = 0; r < ROWS; r++) {
    for (let cc = 0; cc < COLS; cc++) {
      const wi = wordIndex(cc, r);
      const cell = r * MAP_STRIDE + cc;
      m0[cell] = wordAt(c.bg1Tilemap, wi);
      m1[cell] = wordAt(c.bg2Tilemap, wi);
      m2[cell] = wordAt(ground, wi);
    }
  }
  return {
    world: c.world, bg1FileId: terrainLayerFileId(c, 0), bg2FileId: terrainLayerFileId(c, 1), bg3FileId: GROUND_TM_FILE_ID,
    bytes: encodeM1te2({ mapWidth: 64, mapHeight: 32, tileSize: 8, palette, maps: [m0, m1, m2], chr4bpp: chr4, chr2bpp: chr2 })
  };
}

/** A CHR pixel edit sliced from an overworld `.M1` (for `saveGfxEdit`). `tileBytes` is the
 *  file's tile stride — 32 for the 4bpp BG char ($74/$75/$4C), 16 for the 2bpp ground char
 *  ($56) — since these share the lz2/lz16 format but differ in bpp. */
export interface OverworldChrEdit { format: 'lz2' | 'lz16'; fileId: number; fileTile: number; tileBytes: 16 | 32; bytes: Uint8Array }
/** A tilemap WORD edit (for splicing into the LZ2 tilemap file at `fileOffset`). */
export interface OverworldWordEdit { fileId: number; fileOffset: number; word: number }

export interface OverworldM1Diff {
  /** $74/$75/$4C (4bpp BG1/BG2 char) + $56 (2bpp BG3 ground char) pixel edits. */
  chrEdits: OverworldChrEdit[];
  /** $7C/$7D (BG1/BG2) + $7E (BG3 ground) tilemap word edits, by file offset. */
  wordEdits: OverworldWordEdit[];
  /** Changed CGRAM colors (excludes M1TE2's auto-blacked transparent slots). */
  paletteEdits: M1tePaletteEdit[];
  /** CHR tiles changed but not resolvable to a map gfx file (wrap / unknown). */
  skippedTiles: number;
  /** BG1/BG2 cells referencing tileset 1 (char 0-255 — the unloaded, ✕-marked band).
   *  These still round-trip verbatim, but draw unrelated panel gfx in-game, so the
   *  import surfaces them as an error (see the tileset-1 marker note). */
  tileset1Cells: number;
}

/**
 * Diff an edited overworld `.M1` against the cart → CHR pixel edits + tilemap word edits +
 * palette color edits. CHR is a direct planar byte compare (the .M1 CHR is the same raw
 * format as VRAM, no re-plane); tilemap words compare the doc's plain 64-wide grid against
 * the cart's current word at each (re-interleaved) screen-block position; palette compares
 * CGRAM rows 0-7.
 */
export function diffOverworldM1(c: WorldMapTerrainContext, m1Bytes: Uint8Array): OverworldM1Diff {
  const doc = parseM1te2(m1Bytes);
  const { vram, cgram, manifest } = c.scene;
  const ground = groundTilemap(vram);

  // ── CHR — 4bpp BG char ($4000 window → $74/$75/$4C) then 2bpp ground char ($2000 → $56).
  // Tiles 0..255 are the ✕-marked tileset-1 band (no backing file at $4000-$6000), so they
  // are never editable — skip them so the synthetic marker doesn't read back as a CHR edit.
  const chrEdits: OverworldChrEdit[] = [];
  let skippedTiles = 0;
  for (let t = TILESET1_TILES; t < 1024; t++) {
    const vramByte = (MAP_CHAR_BASE + t * TILE4) & 0xffff;
    if (vramByte + TILE4 > vram.length || sameBytes(doc.chr4bpp, t * TILE4, vram, vramByte, TILE4)) continue;
    const f = fileForVramByteBpp(manifest, vramByte, TILE4);
    if (!f) { skippedTiles++; continue; }
    chrEdits.push({ format: f.format, fileId: f.fileId, fileTile: f.fileTile, tileBytes: TILE4, bytes: doc.chr4bpp.slice(t * TILE4, t * TILE4 + TILE4) });
  }
  for (let t = 0; t < 1024; t++) {
    const vramByte = (GROUND_CHAR_VRAM + t * TILE2) & 0xffff;
    if (vramByte + TILE2 > vram.length || sameBytes(doc.chr2bpp, t * TILE2, vram, vramByte, TILE2)) continue;
    const f = fileForVramByteBpp(manifest, vramByte, TILE2);
    if (!f) { skippedTiles++; continue; }
    chrEdits.push({ format: f.format, fileId: f.fileId, fileTile: f.fileTile, tileBytes: TILE2, bytes: doc.chr2bpp.slice(t * TILE2, t * TILE2 + TILE2) });
  }

  // ── Tilemap words — each slot's cells vs the cart's current word at that screen-block pos.
  const slots: { slot: 0 | 1 | 2; tm: Uint8Array; fileId: number }[] = [
    { slot: 0, tm: c.bg1Tilemap, fileId: terrainLayerFileId(c, 0) },
    { slot: 1, tm: c.bg2Tilemap, fileId: terrainLayerFileId(c, 1) },
    { slot: 2, tm: ground, fileId: GROUND_TM_FILE_ID }
  ];
  const wordEdits: OverworldWordEdit[] = [];
  let tileset1Cells = 0;
  for (const s of slots) {
    const map = doc.maps[s.slot]!;
    for (let r = 0; r < ROWS; r++) {
      for (let cc = 0; cc < COLS; cc++) {
        const wi = wordIndex(cc, r);
        const docWord = map[r * MAP_STRIDE + cc]! & 0xffff;
        // BG1/BG2 (slots 0/1, 4bpp char base $4000) cells pointing into the ✕-marked
        // tileset-1 band (char 0-255 — char 0 included: YI has no empty-tile sentinel, so
        // it is the same trap as 1-255). BG3 (slot 2) is excluded — its 2bpp char base
        // $2000 puts the real $56 ground in tileset 0, so it is not blank.
        if (s.slot !== 2 && (docWord & 0x3ff) < TILESET1_TILES) tileset1Cells++;
        if (docWord !== wordAt(s.tm, wi)) wordEdits.push({ fileId: s.fileId, fileOffset: wi * 2, word: docWord });
      }
    }
  }

  // ── Palette — changed CGRAM rows 0-7, skipping the auto-blacked transparent slots.
  return { chrEdits, wordEdits, paletteEdits: diffM1tePalette(doc.palette, cgram), skippedTiles, tileset1Cells };
}

/** The base (cart) screen-block tilemap bytes for one of an overworld file's tilemap files —
 *  so the importer can splice this `.M1`'s word edits onto the right 4096-byte buffer (BG1 →
 *  bg1Tilemap, BG2 → bg2Tilemap, BG3 → the $7E ground), then `saveGfxEdit`. */
export function overworldTilemapBase(c: WorldMapTerrainContext, fileId: number): Uint8Array | null {
  if (fileId === terrainLayerFileId(c, 0)) return c.bg1Tilemap;
  if (fileId === terrainLayerFileId(c, 1)) return c.bg2Tilemap;
  if (fileId === GROUND_TM_FILE_ID) return groundTilemap(c.scene.vram);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ICONS — one .M1 with the per-level icons (level order) + marker + castle.
// ─────────────────────────────────────────────────────────────────────────────

const ICON_WORLDS = 6;
const ICON_SLOTS = 10;
const ICON_CELLS = 3; // 24×24 = 3×3 8×8 cells
const ICON_PX = 24;
// The icons fill a 32-wide region (10 slots × 3 cells = 30) of the doc's 64-stride grid;
// the .M1 is written with mapWidth 32 (buildIconsM1). Array indices use MAP_STRIDE.
/** The marker/castle row sits below the 6 world rows (each 3 cells tall). */
const MC_ROW = ICON_WORLDS * ICON_CELLS; // 18
const M1_MAP_HEIGHT = MC_ROW + ICON_CELLS; // 21 rows occupied

/** One placed icon in the synthesized grid, carrying everything the diff needs to slice the
 *  edited `.M1` tiles back to the cart (re-derived deterministically, never serialized). */
interface IconM1Item {
  kind: 'level' | 'marker' | 'castle';
  world: number;
  slot: number; // -1 for marker/castle
  /** Top-left grid cell (8×8) of the 3×3 icon. */
  gridCol0: number;
  gridRow0: number;
  /** The 9 M1TE2 4bpp tile indices (row-major 3×3). */
  tiles: number[];
  /** level: its decode context + canvas (base 24×24 chunky indices + $53 source). */
  levelCtx?: LevelIconContext;
  levelCanvas?: LevelIconCanvas;
  /** marker/castle: its 9 per-cell cart-tile units (un-flipped base bytes + $74/$75 target). */
  canvas?: WorldMapIconCanvas;
}

/** The whole synthesized icons layout: the M1TE2 doc fields + the placed-icon list. Built
 *  identically by the export (to encode) and the diff (to attribute edited tiles). */
interface IconM1Layout {
  chr4bpp: Uint8Array;
  tilemap: Uint16Array; // slot 0
  palette: Uint8Array; // 256 B (synthesized for display)
  mapHeight: number;
  icons: IconM1Item[];
}

/** Allocate a 4bpp tile in the dedup'd tileset: an all-zero tile is the M1TE2 empty tile 0;
 *  otherwise first-seen content gets the next index (so export + diff agree tile-for-tile). */
function allocTile(tiles: Uint8Array[], byKey: Map<string, number>, planar: Uint8Array): number {
  let blank = true;
  for (let i = 0; i < TILE4; i++) if (planar[i] !== 0) { blank = false; break; }
  if (blank) return 0;
  const key = Array.from(planar, (b) => b.toString(16).padStart(2, '0')).join('');
  const existing = byKey.get(key);
  if (existing !== undefined) return existing;
  const idx = tiles.length;
  if (idx >= 1024) return 0; // M1TE2 4bpp cap (astronomically far off; 60 icons ≈ 560 tiles)
  tiles.push(planar.slice());
  byKey.set(key, idx);
  return idx;
}

/** Convert an 8×8 block of an icon's chunky nibble indices → a 4bpp planar tile. */
function chunkyCellToPlanar(indices24: Uint8Array, tr: number, tc: number): Uint8Array {
  const idx8 = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) idx8[y * 8 + x] = indices24[(tr * 8 + y) * ICON_PX + (tc * 8 + x)]!;
  const out = new Uint8Array(TILE4);
  encode4bppTile(idx8, 0, out, 0);
  return out;
}

/**
 * Build the icons grid deterministically from the base cart: 6 world-rows of 10 per-level
 * icons (level order) in slot 0, then a marker + castle row beneath. Per-level icon pixels
 * are converted chunky→4bpp; marker/castle copy the cart $74/$75 tiles (un-flipped, the cell
 * carries flip).
 *
 * The display palette is FAITHFUL. The icons span only a handful of distinct 16-color
 * palettes — the per-level icons use just two OBJ palettes (CGRAM rows 8 & 9, world-INVARIANT,
 * so all 60 collapse to those two), and the marker/castle use the six per-world BG tint rows;
 * the union is ≤ 6 distinct, which fits M1TE2's 8 palette rows. So `palRowFor` dedupes each
 * cell's actual 16-color CGRAM block (keyed by content — collapsing the same palette across
 * the per-world map CGRAMs) into an M1TE2 row, and the cell's word references it. M1TE renders
 * `palette[row*16 + pixel]` (base 0), so this shows every icon in its true colors. Overflow
 * beyond 8 rows (never in practice) falls back to row 0. Pixel edits round-trip in the
 * index/byte domain regardless, so the palette only affects display.
 */
function buildIconLayout(rom: Uint8Array, symbols: SymbolMap, gfxOverride?: ReadonlyMap<string, Uint8Array>): IconM1Layout {
  const tiles: Uint8Array[] = [new Uint8Array(TILE4)]; // tile 0 = empty
  const byKey = new Map<string, number>();
  const tilemap = new Uint16Array(MAP_WORDS); // 64×64-stride doc grid (icons fill a 32-wide region)
  const palette = new Uint8Array(256);
  const icons: IconM1Item[] = [];

  // Map a 16-color CGRAM block (a `cgram` row) → an M1TE2 palette row, deduped by content so
  // the same palette from different per-world CGRAMs collapses to one row (and an OBJ icon
  // palette that coincides with a marker BG tint shares its row). ≤ 8 rows; overflow → row 0.
  const palRows = new Map<string, number>();
  let nextRow = 0;
  const palRowFor = (cgram: Uint8Array, row: number): number => {
    const block = cgram.subarray(row * TILE4, row * TILE4 + TILE4);
    const key = Array.from(block, (b) => b.toString(16).padStart(2, '0')).join('');
    const existing = palRows.get(key);
    if (existing !== undefined) return existing;
    if (nextRow >= 8) return 0; // M1TE2 has 8 palette rows (the union is ≤ 6, so never hit)
    const r = nextRow++;
    palette.set(block, r * TILE4);
    palRows.set(key, r);
    return r;
  };

  // Per-level icons — world-major (level order). All 9 cells of an icon share its OBJ palette
  // row (8 + paletteRow); that row is world-invariant, so the 60 icons collapse to 2 rows.
  for (let world = 0; world < ICON_WORLDS; world++) {
    const ctx = buildLevelIconContext(rom, symbols, world);
    for (let slot = 0; slot < ICON_SLOTS; slot++) {
      const canvas = renderWorldMapLevelIcon(ctx, slot);
      if (!canvas || !canvas.faithful) continue;
      const palRow = palRowFor(ctx.cgram, 8 + canvas.paletteRow);
      const gridRow0 = world * ICON_CELLS;
      const gridCol0 = slot * ICON_CELLS;
      const tileIdx: number[] = [];
      for (let tr = 0; tr < ICON_CELLS; tr++) {
        for (let tc = 0; tc < ICON_CELLS; tc++) {
          const ti = allocTile(tiles, byKey, chunkyCellToPlanar(canvas.indices, tr, tc));
          tileIdx.push(ti);
          tilemap[(gridRow0 + tr) * MAP_STRIDE + (gridCol0 + tc)] = (ti & 0x3ff) | (palRow << 10);
        }
      }
      icons.push({ kind: 'level', world, slot, gridCol0, gridRow0, tiles: tileIdx, levelCtx: ctx, levelCanvas: canvas });
    }
  }

  // Marker + castle (world-0; pixels are world-invariant). Each CELL draws in its own BG palette
  // row (the word's palette bits OR'd with the world tint), so it's colored per cell.
  const mcCtx = buildWorldMapIconContext(rom, symbols, 0, gfxOverride);
  for (const name of ['marker', 'castle'] as const) {
    const canvas = renderWorldMapIcon(mcCtx, name);
    if (!canvas || !canvas.faithful) continue;
    const gridRow0 = MC_ROW;
    const gridCol0 = name === 'marker' ? 0 : ICON_CELLS; // marker cols 0-2, castle cols 3-5
    const tileIdx: number[] = [];
    for (let cell = 0; cell < ICON_CELLS * ICON_CELLS; cell++) {
      const u = canvas.units[cell];
      const ti = u ? allocTile(tiles, byKey, u.baseBytes.slice()) : 0; // un-flipped; cell carries flip
      tileIdx.push(ti);
      const tr = Math.floor(cell / ICON_CELLS), tc = cell % ICON_CELLS;
      const palRow = u ? palRowFor(mcCtx.cgram, u.paletteRow) : 0;
      const flip = (u?.hflip ? 0x4000 : 0) | (u?.vflip ? 0x8000 : 0);
      tilemap[(gridRow0 + tr) * MAP_STRIDE + (gridCol0 + tc)] = (ti & 0x3ff) | (palRow << 10) | flip;
    }
    icons.push({ kind: name, world: 0, slot: -1, gridCol0, gridRow0, tiles: tileIdx, canvas });
  }

  const chr4bpp = new Uint8Array(tiles.length * TILE4);
  for (let i = 0; i < tiles.length; i++) chr4bpp.set(tiles[i]!, i * TILE4);
  return { chr4bpp, tilemap, palette, mapHeight: M1_MAP_HEIGHT, icons };
}

/** Build the combined icons `.M1` (all per-level icons in level order + marker + castle). */
export function buildIconsM1(rom: Uint8Array, symbols: SymbolMap, gfxOverride?: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const layout = buildIconLayout(rom, symbols, gfxOverride);
  return encodeM1te2({
    mapWidth: 32, mapHeight: layout.mapHeight, tileSize: 8, palette: layout.palette,
    maps: [layout.tilemap, new Uint16Array(MAP_WORDS), new Uint16Array(MAP_WORDS)],
    chr4bpp: layout.chr4bpp, chr2bpp: new Uint8Array(0)
  });
}

export interface IconsM1Diff {
  /** Per-level icon edits → bank-$53 `.bin` writes (nibble RMW; via saveRawChrEdit). */
  levelWrites: IconWrite[];
  /** Marker/castle edits → the shared $74/$75 BG files (via saveGfxEdit). */
  markerCastleEdits: { format: 'lz2' | 'lz16'; fileId: number; fileTile: number; bytes: Uint8Array }[];
  /** Per-level icons that changed (for the import count). */
  levelIconsChanged: number;
  /** Marker/castle shapes that changed. */
  markerCastleChanged: number;
  /** A shared $74/$75 tile written inconsistently from two cells (first write wins). */
  conflicts: number;
}

/**
 * Diff an edited icons `.M1` against the cart. Re-derives the deterministic grid from the
 * base cart (`buildIconLayout` — same tile allocation as the export), then for each placed
 * icon reads its edited pixels out of the `.M1` CHR at its tile indices and slices them
 * back: per-level icons → bank-$53 nibble RMW (index domain, no palette round-trip);
 * marker/castle → their $74/$75 char tiles (direct planar byte compare).
 */
export function diffIconsM1(rom: Uint8Array, symbols: SymbolMap, m1Bytes: Uint8Array, gfxOverride?: ReadonlyMap<string, Uint8Array>): IconsM1Diff {
  const doc = parseM1te2(m1Bytes);
  const layout = buildIconLayout(rom, symbols, gfxOverride);
  const levelWrites: IconWrite[] = [];
  const mcByTile = new Map<string, Uint8Array>();
  let levelIconsChanged = 0, markerCastleChanged = 0, conflicts = 0;

  for (const item of layout.icons) {
    if (item.kind === 'level') {
      // Reassemble the icon's 24×24 nibble indices from the edited .M1 4bpp tiles.
      const edited = new Uint8Array(ICON_PX * ICON_PX);
      const idx8 = new Uint8Array(64);
      for (let tr = 0; tr < ICON_CELLS; tr++) {
        for (let tc = 0; tc < ICON_CELLS; tc++) {
          decode4bppTile(doc.chr4bpp, item.tiles[tr * ICON_CELLS + tc]! * TILE4, false, false, idx8, 0);
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) edited[(tr * 8 + y) * ICON_PX + (tc * 8 + x)] = idx8[y * 8 + x]!;
        }
      }
      const res = sliceLevelIconIndices(item.levelCtx!, item.levelCanvas!, edited);
      if (res && res.changed) { levelWrites.push(...res.writes); levelIconsChanged++; }
    } else {
      let changed = false;
      for (let cell = 0; cell < ICON_CELLS * ICON_CELLS; cell++) {
        const u = item.canvas!.units[cell];
        if (!u) continue;
        const ti = item.tiles[cell]!;
        if (sameBytes(doc.chr4bpp, ti * TILE4, u.baseBytes, 0, TILE4)) continue;
        changed = true;
        const key = `${u.format}/${u.fileId}/${u.fileTile}`;
        const bytes = doc.chr4bpp.slice(ti * TILE4, ti * TILE4 + TILE4);
        const prev = mcByTile.get(key);
        if (prev) { if (!sameBytes(prev, 0, bytes, 0, TILE4)) conflicts++; continue; } // first write wins
        mcByTile.set(key, bytes);
      }
      if (changed) markerCastleChanged++;
    }
  }

  const markerCastleEdits: IconsM1Diff['markerCastleEdits'] = [];
  for (const [key, bytes] of mcByTile) {
    const [format, fileId, fileTile] = key.split('/');
    markerCastleEdits.push({ format: format as 'lz2' | 'lz16', fileId: Number(fileId), fileTile: Number(fileTile), bytes });
  }
  return { levelWrites, markerCastleEdits, levelIconsChanged, markerCastleChanged, conflicts };
}

/** The two products' filename roots (used by the export + the M1TE "open" list). */
export const overworldM1Name = (world: number): string => `overworld-w${world}.M1`;
export const ICONS_M1_NAME = 'icons.M1';

/** Build every world-map `.M1` (6 overworlds + 1 icons), with each file's name + metadata
 *  for the manifest. The caller writes the bytes + records the manifest. */
export interface WorldMapM1File {
  file: string;
  kind: 'overworld' | 'icons';
  world?: number;
  bg1FileId?: number;
  bg2FileId?: number;
  bg3FileId?: number;
  bytes: Uint8Array;
}

export function exportWorldMapM1(rom: Uint8Array, symbols: SymbolMap, gfxOverride?: ReadonlyMap<string, Uint8Array>): WorldMapM1File[] {
  const out: WorldMapM1File[] = [];
  for (let world = 0; world < ICON_WORLDS; world++) {
    const c = buildWorldMapTerrainContext(rom, symbols, world, gfxOverride);
    const s = buildOverworldM1(c);
    out.push({
      file: `screens/map/${overworldM1Name(s.world)}`, kind: 'overworld',
      world: s.world, bg1FileId: s.bg1FileId, bg2FileId: s.bg2FileId, bg3FileId: s.bg3FileId, bytes: s.bytes
    });
  }
  out.push({ file: `screens/map/${ICONS_M1_NAME}`, kind: 'icons', bytes: buildIconsM1(rom, symbols, gfxOverride) });
  return out;
}
