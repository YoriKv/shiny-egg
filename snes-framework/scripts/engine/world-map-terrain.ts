// World-map OVERWORLD TERRAIN export — the per-world map Yoshi paths across (clouds,
// hills, the dotted level path + markers, forts/castles), the editable LAYOUT view.
//
// DISTINCT from the level-select panel (`screen-gfx.ts` `mapDescriptor`) and the level
// ICONS (`world-map-level-icons.ts`). The map is built from BG **TILEMAPS**, not char
// sheets. Ground-truthed via the yi-shiny `world-map-terrain` trace (fully-unlocked save,
// real overworld displayed, real PPU bases read from `emu.getState()` — the WRAM register
// mirrors are STALE on the overworld, which is why earlier captures only showed the
// level-select box panel; see `research/graphics-editing/world-map-screens.md`):
//
//   • The displayed map is a **3-layer Mode-1 composite** (64×32 doubleWidth, 512×256):
//     the `DATA_00B3F4` pair is **BG1 ⊕ BG2 of ONE screen**, NOT two level-range halves —
//       BG1 (foreground: path, level markers, fortress) = `DATA_00B3F4[world*2]`   (w0 $7C),
//       BG2 (background scenery: hills, clouds, flowers) = `DATA_00B3F4[world*2+1]` (w0 $7D),
//     both LZ2 4096-byte tilemaps (2048 words). "Levels 1-4 vs 5-8" is the left vs right
//     32-col half of the single 64-wide screen (the camera hscrolls between them) — a
//     CAMERA split, not a data split. (BG2 also runs a small runtime parallax hscroll,
//     not applied to this grid-aligned layout view.)
//   • Char = the COMMON $74/$75/$4C files (VRAM $6000-$7FFF, char base $4000, 4bpp) for
//     BOTH BG1 and BG2 — the SAME tiles the level-select panel draws; the per-world
//     difference is the two tilemaps + palette tint. So map PIXELS edit via those shared
//     char sheets; this module owns the per-world per-layer LAYOUT.
//   • Composited over the BG3 decorative ground ($56 char + $7E tilemap, world-invariant).
//
// Export: PNG mode → one composited VIEW per world (`overworld.png`, view-only — a flat
// PNG carries no layout). Aseprite mode → one Aseprite **tilemap** per BG layer
// (`overworld-bg1`/`overworld-bg2`), the editable layout. Rearranging the Aseprite cells
// rewrites that layer's `$7C`/`$7D` tilemap (round-trips byte-exact via `saveGfxEdit` —
// the tilemap IS an LZ2 gfx file). The per-world terrain tileset is WORD-keyed by the BG
// word's (char, palette, priority) with the un-flipped char pixels (the terrain reuses a char
// across palette rows); H/V flip rides on the cell, so the full 16-bit BG word reconstructs
// losslessly. (The decorative GROUND below — a separate, single-palette layer — is instead
// CHAR-keyed, mirroring the title logo; see its section.)

import { buildWorldMapIconContext, mapTilemapFileId, iconFileForVramByte, type WorldMapIconContext } from './screen-gfx.ts';
import { lz2 } from './decompress/index.ts';
import { snesToPC, type SymbolMap } from './symbol-map.ts';
import { u24le } from './rom-read.ts';
import { decode4bppTile, decode2bppTile, encode4bppTile } from './tile.ts';
import { buildPaletteRow, paletteIndexOf } from './color.ts';
import { encodePng } from './png.ts';
import { tilesAseprite, tilesAsepriteMulti, tilesetPaletteOffsets, type TilesetTile } from './gfx-aseprite.ts';
import { type AsepriteCell, type AsepriteStructural } from './aseprite.ts';

const COLS = 64; // 64×32 screen-block tilemap = 2048 words = the decompressed 4096 bytes
const ROWS = 32;
const TILE_PX = 8;
const MAP_CHAR_BASE = 0x4000; // BG1 char base on the overworld (BG12NBA=$22) — reaches $74/$75/$4C
const GROUND_CHAR_VRAM = 0x2000; // BG3 decorative-ground char ($56), 2bpp
const GROUND_TM_VRAM = 0x2800; // BG3 decorative-ground tilemap ($7E), 64×32
const TILE_BYTES_4BPP = 32;
const TILE_BYTES_2BPP = 16;
const TILEMAP_BYTES = COLS * ROWS * 2; // 4096

/** Screen-block word index for cell (col,row): block 0 = cols 0-31 at $000, block 1 =
 *  cols 32-63 at $400 (2 × 32×32 screens, the SNES SC=01 layout). */
const wordIndex = (c: number, r: number): number => (c >= 32 ? 0x400 : 0) + r * 32 + (c & 31);

/** Decompress a tilemap gfx file (LZ2) → its 4096 raw bytes (2048 BG words). A live gfx-cache
 *  override (decompressed tilemap bytes keyed `lz2/<fileId>`) takes precedence, so an export/diff
 *  reflects unbuilt tilemap edits + resets rather than the last-built ROM. */
function decompTilemap(rom: Uint8Array, symbols: SymbolMap, fileId: number, gfxOverride?: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const ov = gfxOverride?.get(`lz2/${fileId}`);
  if (ov) return ov.subarray(0, Math.min(ov.length, TILEMAP_BYTES));
  const ptr = symbols.pc('DATA_lz2_compressed_gfx_ptrs');
  const pc = snesToPC(u24le(rom, ptr + fileId * 3));
  const dest = new Uint8Array(0x4000);
  const { destEnd } = lz2(rom, pc, dest, 0);
  return dest.subarray(0, Math.min(destEnd, TILEMAP_BYTES));
}

/** Overworld terrain BG layer: 0 = BG1 (foreground, `DATA_00B3F4[world*2]`), 1 = BG2
 *  (background scenery, `[world*2+1]`). Both draw 4bpp from char base $4000. */
export type TerrainLayer = 0 | 1;

export interface WorldMapTerrainContext {
  /** Overworld scene context — `vram` has the common char ($74/$75/$4C @ $6000-$7FFF,
   *  reachable from char base $4000) AND the BG3 ground ($56 @ $2000 + $7E tilemap @
   *  $2800); `cgram` is the per-world palette. Reused from the icon track so the load
   *  mirrors the cart exactly. */
  scene: WorldMapIconContext;
  world: number;
  /** BG1 (foreground) LZ2 tilemap file = `DATA_00B3F4[world*2]` (w0 $7C). */
  bg1FileId: number;
  /** BG2 (background scenery) LZ2 tilemap file = `DATA_00B3F4[world*2+1]` (w0 $7D). */
  bg2FileId: number;
  /** 4096 bytes = 2048 BG words (64×32 screen-block) for each layer. */
  bg1Tilemap: Uint8Array;
  bg2Tilemap: Uint8Array;
}

export function buildWorldMapTerrainContext(rom: Uint8Array, symbols: SymbolMap, world: number, gfxOverride?: ReadonlyMap<string, Uint8Array>): WorldMapTerrainContext {
  const scene = buildWorldMapIconContext(rom, symbols, world, gfxOverride);
  const bg1FileId = mapTilemapFileId(rom, symbols, world, 0);
  const bg2FileId = mapTilemapFileId(rom, symbols, world, 1);
  return {
    scene, world, bg1FileId, bg2FileId,
    bg1Tilemap: decompTilemap(rom, symbols, bg1FileId, gfxOverride),
    bg2Tilemap: decompTilemap(rom, symbols, bg2FileId, gfxOverride)
  };
}

/** The layer's decompressed tilemap (BG1 or BG2). */
const layerTilemap = (c: WorldMapTerrainContext, layer: TerrainLayer): Uint8Array => layer === 0 ? c.bg1Tilemap : c.bg2Tilemap;
/** The layer's LZ2 tilemap gfx-file id (BG1 = `$7C`-class, BG2 = `$7D`-class). */
export const terrainLayerFileId = (c: WorldMapTerrainContext, layer: TerrainLayer): number => layer === 0 ? c.bg1FileId : c.bg2FileId;

/** A 16-color BG palette row as ARGB; `transparentZero` makes index 0 transparent. */
function bgRow(cgram: Uint8Array, row: number, transparentZero: boolean): Uint32Array {
  return buildPaletteRow(cgram, row, transparentZero, 'expand', 16);
}

export interface WorldMapTerrainCanvas {
  rgba: Uint8Array;
  width: number;
  height: number;
  /** Always true — every BG word round-trips losslessly (char,pal,prio,flip preserved). */
  faithful: boolean;
}

/**
 * Assemble the per-world overworld: BG3 decorative ground (2bpp, row 0) behind BG2
 * (background scenery) behind BG1 (foreground), the two `DATA_00B3F4` tilemaps composited
 * — both 4bpp, char base $4000, each word in its own palette row, index 0 transparent so
 * lower layers show through. The composited 512×256 picture the player roams. (BG2's small
 * runtime parallax hscroll is NOT applied — this is the grid-aligned layout view, so the
 * Aseprite cells line up with the tilemap.)
 */
export function renderWorldMapTerrain(c: WorldMapTerrainContext): WorldMapTerrainCanvas {
  const { vram, cgram } = c.scene;
  const W = COLS * TILE_PX, H = ROWS * TILE_PX;
  const rgba = new Uint8Array(W * H * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, W * H);
  const idx = new Uint8Array(64);

  // (1) BG3 decorative ground (back) — char $2000 (2bpp), tilemap $2800, palette row 0.
  const groundPal = bgRow(cgram, 0, false);
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const off = GROUND_TM_VRAM + wordIndex(cc, r) * 2;
    const w = vram[off]! | (vram[off + 1]! << 8);
    const ch = w & 0x3ff, hf = (w & 0x4000) !== 0, vf = (w & 0x8000) !== 0;
    const vb = (GROUND_CHAR_VRAM + ch * TILE_BYTES_2BPP) & 0xffff;
    decode2bppTile(vram, vb, hf, vf, idx, 0);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) u32[(r * 8 + y) * W + cc * 8 + x] = groundPal[idx[y * 8 + x]!]!;
  }

  // (2)+(3) BG2 (background scenery) then BG1 (foreground) — char base $4000 (4bpp), each
  //     word its own palette row, index 0 transparent (lower layers show through; the $1BF
  //     fill is index-0). Drawing BG2 first then BG1 gives the Mode-1 front-to-back order.
  const palCache: (Uint32Array | undefined)[] = new Array(8);
  const palFor = (row: number): Uint32Array => (palCache[row] ??= bgRow(cgram, row, true));
  const drawBg = (tilemap: Uint8Array): void => {
    for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
      const off = wordIndex(cc, r) * 2;
      const w = tilemap[off]! | (tilemap[off + 1]! << 8);
      const ch = w & 0x3ff, pal = (w >> 10) & 7, hf = (w & 0x4000) !== 0, vf = (w & 0x8000) !== 0;
      const vb = (MAP_CHAR_BASE + ch * TILE_BYTES_4BPP) & 0xffff;
      if (vb + TILE_BYTES_4BPP > vram.length) continue;
      decode4bppTile(vram, vb, hf, vf, idx, 0);
      const p = palFor(pal);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const ci = idx[y * 8 + x]!;
        if (ci === 0) continue; // transparent — keep the layers behind
        u32[(r * 8 + y) * W + cc * 8 + x] = p[ci]!;
      }
    }
  };
  drawBg(c.bg2Tilemap); // BG2 background scenery
  drawBg(c.bg1Tilemap); // BG1 foreground (path, markers, fortress)
  return { rgba, width: W, height: H, faithful: true };
}

/** PNG of the assembled view (the composited map). View-only — the editable layout is
 *  the `.aseprite`, map pixels edit via the shared `$74`/`$75`/`$4C` char sheets. */
export function worldMapTerrainPng(canvas: WorldMapTerrainCanvas): Uint8Array {
  return new Uint8Array(encodePng({ width: canvas.width, height: canvas.height, rgba: canvas.rgba }));
}

// --- Aseprite tilemap (the editable LAYOUT surface) --------------------------
// The per-world TERRAIN (BG1/BG2) tileset is WORD-keyed: keyed by the BG word's
// (char, palette, priority) — the bits that pick a distinct tileset entry — because the
// terrain reuses the SAME char across multiple palette rows (it's not 1:1 char→palette).
// H/V flip rides on the cell (Aseprite's native flip), so the full 16-bit BG word
// reconstructs losslessly. The map fill (char $1BF, index-0 tile) is just another tileset
// entry. Tile index 0 = empty (Aseprite reserves it). (The decorative GROUND below is
// instead CHAR-keyed — it's single-palette, so it mirrors the title-logo model; see there.)

/** The (char,palette,priority) key for a BG word = bits 0-13 (flip bits 14/15 masked off). */
const wordKey = (w: number): number => w & 0x3fff;

// --- Unified tileset shared by BG1 + BG2 -------------------------------------
// Both layers draw 4bpp from the SAME char base ($4000) and, in practice, the same
// $74/$75 char region — and they reuse tiles (33-65 shared per world). So the combined
// Aseprite gives both layers ONE shared tileset = the UNION of both layers' (char,pal,
// prio) keys. That lets a tile either layer uses be placed in either layer (the hardware
// allows it); without the union, each layer's editor would only offer its own tiles.

/** The unified ordered key list for a world (index 0 = empty; then the union of BG1's
 *  then BG2's distinct (char,pal,prio) keys, in screen-block reading order). Both the
 *  Aseprite export and the placement diff derive it from the same cart context, so the
 *  tile↔word mapping is identical on both sides. */
export function unifiedTerrainKeys(c: WorldMapTerrainContext): number[] {
  const keys: number[] = [-1]; // index 0 = Aseprite's mandatory empty tile
  const seen = new Set<number>();
  for (const tm of [c.bg1Tilemap, c.bg2Tilemap]) {
    for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
      const off = wordIndex(cc, r) * 2;
      const k = wordKey(tm[off]! | (tm[off + 1]! << 8));
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  return keys;
}

/** Distinct placeable (char,pal,prio) keys of a world's overworld (index 0 = empty) —
 *  the unified set both layers share. */
export function terrainTileKeys(c: WorldMapTerrainContext): number[] {
  return unifiedTerrainKeys(c);
}

/** A layer's cells (row-major COLS×ROWS) mapping each word → its unified-tileset index. */
function layerCells(tilemap: Uint8Array, keyToTile: Map<number, number>): AsepriteCell[] {
  const cells: AsepriteCell[] = [];
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const off = wordIndex(cc, r) * 2;
    const w = tilemap[off]! | (tilemap[off + 1]! << 8);
    cells.push({ tile: keyToTile.get(wordKey(w)) ?? 0, hflip: (w & 0x4000) !== 0, vflip: (w & 0x8000) !== 0 }); // blank/unmapped → tile 0
  }
  return cells;
}

/**
 * Export the world's overworld as ONE combined Aseprite tilemap: a single shared tileset
 * (the unified key set) with TWO tilemap layers — `BG2 (background)` (bottom) under
 * `BG1 (foreground)` (top), matching the hardware order so the in-Aseprite composite looks
 * like the game. Index-0 transparent, so BG1's fill reveals BG2. Each layer round-trips to
 * its own `$7C`/`$7D`… tilemap file via `diffWorldMapTerrainPlacement`. `keys` is the
 * tileset's `(char,pal,prio)` key list (`unifiedTerrainKeys`) — the SAME array serialized
 * into the manifest as `tileKeys`, so the import maps each tileset tile back to its cart
 * char + palette row without re-deriving (tileset tile `ti` ⇒ `keys[ti]`).
 */
export function worldMapTerrainAseprite(c: WorldMapTerrainContext, keys: number[]): { bytes: Uint8Array; paletteOffsets: number[] } {
  const { vram, cgram } = c.scene;
  const keyToTile = new Map<number, number>();
  const tiles: TilesetTile[] = [];
  const idx = new Uint8Array(64);
  for (let ti = 1; ti < keys.length; ti++) {
    const k = keys[ti]!;
    keyToTile.set(k, ti);
    const ch = k & 0x3ff, pal = (k >> 10) & 7;
    decode4bppTile(vram, (MAP_CHAR_BASE + ch * TILE_BYTES_4BPP) & 0xffff, false, false, idx, 0); // UN-flipped; cell carries flip
    tiles.push({ indices: idx.slice(), paletteRow: pal });
  }
  // Tile 0 = Aseprite's synthetic empty (shared by both layers); every distinct word is a real
  // tile at 1..N, so a fresh export has no tile-0 cells.
  const bytes = tilesAsepriteMulti({
    cgram, bpp: 4, tileW: TILE_PX, tileH: TILE_PX, tiles,
    layers: [
      { name: 'BG2 (background)', cells: layerCells(c.bg2Tilemap, keyToTile) }, // bottom
      { name: 'BG1 (foreground)', cells: layerCells(c.bg1Tilemap, keyToTile) }  // top
    ],
    tilesAcross: COLS, tilesDown: ROWS, index0Transparent: true, tilesetName: 'map-tiles'
  });
  // Color write-back map — SAME bpp/index0Transparent (and default rowStride 16) as above.
  const paletteOffsets = tilesetPaletteOffsets({ tiles, bpp: 4, index0Transparent: true, provenance: c.scene.provenance });
  return { bytes, paletteOffsets };
}

// --- Pixel editing (the combined file's other axis) --------------------------
// The combined `.aseprite` carries BOTH the tilemap layers (placement) AND the shared
// tileset's PIXELS. Editing a tileset tile's pixels = editing that (char,pal) tile's CHR,
// which lives in the shared $74/$75/$4C files (char base $4000). So pixel edits slice back
// to those files — the same char the level-select panel + icons draw, so an edit shows
// everywhere that char appears (across both BG layers AND all worlds). Each tile's row
// comes from its (char,pal,prio) key, so the slice color-matches against that CGRAM row
// directly — independent of how the file packs its palette rows.

/** A CHR tile edit sliced from the combined `.aseprite`'s tileset, for `saveGfxEdit`. */
export interface TerrainTileEdit {
  format: 'lz2' | 'lz16';
  fileId: number;
  fileTile: number;
  bytes: Uint8Array;
}

/**
 * Slice an edited combined `.aseprite`'s tileset PIXELS back to the shared $74/$75/$4C CHR
 * tiles. `tilePixels` is the structural decode's stacked tileset (1 byte/px, tile 0 first);
 * `palette` is the file's embedded palette (resolves a painted pixel's index → color).
 * Base-aware: a pixel still at its base color keeps its base index; a repaint maps to a
 * local index within the tile's own CGRAM row. Two tileset entries that share a char (same
 * char, different palette row) write the SAME CHR — if they disagree, the first wins and
 * `conflicts` counts it. Returns only changed tiles.
 */
export function diffWorldMapTerrainPixels(
  c: WorldMapTerrainContext, keys: readonly number[], tilePixels: Uint8Array, numTiles: number, palette: Uint32Array
): { edits: TerrainTileEdit[]; conflicts: number } {
  const { vram, cgram, manifest } = c.scene;
  const edits: TerrainTileEdit[] = [];
  const seen = new Map<string, Uint8Array>(); // "fileId/fileTile" → bytes (first writer wins)
  const rowColorsByPal: (Uint32Array | undefined)[] = new Array(8); // CGRAM row → its 16 colors
  let conflicts = 0;
  const baseIdx = new Uint8Array(64), rawIdx = new Uint8Array(64);
  const n = Math.min(numTiles, keys.length);
  for (let ti = 1; ti < n; ti++) {
    const k = keys[ti]!;
    if (k < 0) continue;
    const ch = k & 0x3ff, pal = (k >> 10) & 7;
    const vramByte = (MAP_CHAR_BASE + ch * TILE_BYTES_4BPP) & 0xffff;
    const map = iconFileForVramByte(manifest, vramByte);
    if (!map || vramByte + TILE_BYTES_4BPP > vram.length) continue;
    // The tile's row comes from its key (not the palette layout), so we color-match
    // against CGRAM row `pal`'s 16 colors — independent of how the file packs its rows.
    const rowColors = (rowColorsByPal[pal] ??= bgRow(cgram, pal, true));
    decode4bppTile(vram, vramByte, false, false, baseIdx, 0); // base CHR local indices
    let edited = false;
    for (let p = 0; p < 64; p++) {
      const flat = tilePixels[ti * 64 + p]!;
      const bLocal = baseIdx[p]!;
      // Base-aware: unchanged pixel (same color as base) keeps its base local index;
      // else map the painted color to a local index within THIS tile's palette row.
      if (palette[flat] === rowColors[bLocal]) { rawIdx[p] = bLocal; }
      else { rawIdx[p] = paletteIndexOf(rowColors, palette[flat]!, 16); edited = true; }
    }
    if (!edited) continue;
    const bytes = new Uint8Array(TILE_BYTES_4BPP);
    encode4bppTile(rawIdx, 0, bytes, 0);
    // Unchanged vs the base CHR bytes? (a recolor that re-plans to identical bytes)
    let changed = false;
    for (let b = 0; b < TILE_BYTES_4BPP; b++) if (bytes[b] !== vram[vramByte + b]) { changed = true; break; }
    if (!changed) continue;
    const key2 = `${map.fileId}/${map.fileTile}`;
    const prev = seen.get(key2);
    if (prev) { if (!prev.every((v, i) => v === bytes[i])) conflicts++; continue; }
    seen.set(key2, bytes);
    edits.push({ format: map.format, fileId: map.fileId, fileTile: map.fileTile, bytes });
  }
  return { edits, conflicts };
}

/** New 4096-byte tilemap for a BG layer from an edited combined `.aseprite` layer's `cells`
 *  (for `saveGfxEdit` to `terrainLayerFileId(c, layer)`) + the erased-cell count. `keys` is the
 *  serialized `tileKeys` (tileset tile → (char,pal,prio)); each cell → `keys[cell.tile]` | the
 *  cell's flip → its word. A cell ERASED to the empty tile 0 → this layer's cell 0 word (counted
 *  in `erased`); an out-of-range (new) tile keeps the original word (never corrupts). */
export function diffWorldMapTerrainPlacement(c: WorldMapTerrainContext, layer: TerrainLayer, keys: readonly number[], cells: AsepriteCell[]): { tilemap: Uint8Array | null; erased: number } {
  const base = layerTilemap(c, layer);
  const out = base.slice();
  let changed = false, erased = 0;
  const cell0Word = base[0]! | (base[1]! << 8); // this layer's cell 0 — the authored backdrop word
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const cell = cells[r * COLS + cc];
    const tile = cell?.tile ?? 0;
    const off = wordIndex(cc, r) * 2;
    const orig = out[off]! | (out[off + 1]! << 8);
    let word: number;
    if (tile === 0) { erased++; word = cell0Word; } // erased / empty cell → cell 0's word
    else if (tile >= keys.length) continue; // unknown/new tile → keep base
    else { const k = keys[tile]!; if (k < 0) continue; word = (k | (cell?.hflip ? 0x4000 : 0) | (cell?.vflip ? 0x8000 : 0)) & 0xffff; }
    if (word !== orig) { out[off] = word & 0xff; out[off + 1] = (word >> 8) & 0xff; changed = true; }
  }
  return { tilemap: changed ? out : null, erased };
}

/** One exported map-terrain entry, shaped for the gfx manifest. */
export interface WorldMapTerrainPng {
  /** `screens/map/world-N/overworld.png` — the composited view (→ `.aseprite` by the export
   *  caller in Aseprite mode, where the one file carries BOTH BG layers). */
  file: string;
  description: string;
  world: number;
  /** BG1 (foreground) tilemap file the combined `.aseprite`'s `BG1` layer round-trips to. */
  bg1FileId: number;
  /** BG2 (background) tilemap file the combined `.aseprite`'s `BG2` layer round-trips to. */
  bg2FileId: number;
  width: number;
  height: number;
  png: Uint8Array;
  /** The editable layout as a 2-LAYER Aseprite tilemap (BG1+BG2, shared tileset) — built
   *  only in aseprite mode. */
  aseprite?: Uint8Array;
  /** Per shared-tileset-tile `(char,pal,prio)` key (`unifiedTerrainKeys`; index 0 = empty
   *  sentinel `-1`) — serialized into the manifest as `tileKeys`. The import maps each
   *  tileset tile back to its cart char + palette row from THIS (matching the embedded
   *  tileset's order), so it never re-derives the key list. Built only in aseprite mode. */
  tileKeys?: number[];
  /** Per-`.aseprite`-palette-entry master-blob byte-offset (`-1` = transparent/non-blob) —
   *  editing the embedded palette writes those colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[];
}

/**
 * Export every world's overworld map (6 entries, one per world). The displayed map is
 * BG1 ⊕ BG2 ⊕ BG3 composited. The PNG is the composited VIEW; in aseprite mode the entry
 * carries a 2-LAYER `.aseprite` (BG2 + BG1, one shared unified tileset) — the editable
 * layout, each layer round-tripping to its `$7C`/`$7D`… tilemap file. Map PIXELS always
 * edit via the shared screens/map sheets ($74/$75/$4C).
 */
export function exportWorldMapTerrain(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean; gfxOverride?: ReadonlyMap<string, Uint8Array> } = {}): WorldMapTerrainPng[] {
  const out: WorldMapTerrainPng[] = [];
  for (let world = 0; world < 6; world++) {
    const c = buildWorldMapTerrainContext(rom, symbols, world, opts.gfxOverride);
    const png = worldMapTerrainPng(renderWorldMapTerrain(c));
    // One key list drives BOTH the embedded tileset order AND the serialized `tileKeys`,
    // so the import's tile→(char,pal,prio) mapping is exactly the file's.
    const keys = opts.aseprite ? unifiedTerrainKeys(c) : undefined;
    const ase = keys ? worldMapTerrainAseprite(c, keys) : undefined;
    out.push({
      file: `screens/map/world-${world}/overworld.png`,
      description: `overworld map, world ${world} — BG1 foreground (0x${c.bg1FileId.toString(16)}) ⊕ BG2 background (0x${c.bg2FileId.toString(16)}) ⊕ BG3 ground. The PNG is the composited view. The .aseprite (Aseprite export) has both BG layers over one shared tileset and edits BOTH axes: rearrange a layer's cells to move that layer's path/scenery (→ the $7C/$7D tilemaps), and repaint a tileset tile's pixels to edit its art (→ the shared $74/$75/$4C char, so the change shows wherever that tile is used). Editing the embedded palette writes those colors back to the master palette blob.`,
      world, bg1FileId: c.bg1FileId, bg2FileId: c.bg2FileId,
      width: 512, height: 256, png,
      aseprite: ase?.bytes,
      tileKeys: keys,
      paletteOffsets: ase?.paletteOffsets
    });
  }
  return out;
}

// --- The decorative GROUND (BG3) — one shared, world-invariant layer ---------
// The tan ground + tree line BEHIND the per-world map. Same tilemap-placement model as
// the map above, but 2bpp (BG3): char base $2000 (file $56), tilemap file $7E (a literal
// in the $A2 scene-gfx-layout, loaded to VRAM $2800). World-invariant (identical in all 6
// worlds), all palette row 0 — so it's ONE shared editable layout, not per-world. Map
// PIXELS edit via the shared $56 sheet; this owns the ground LAYOUT.

/** The BG3 ground TILEMAP's LZ2 gfx-file id (a literal in `CODE_load_world_map_gfx`'s
 *  $A2 program: file $7E → VRAM $2800). */
const GROUND_TM_FILE_ID = 0x7e;

export interface WorldMapGroundContext {
  /** World-0 overworld scene — `vram` has the $56 ground char @ $2000; `cgram` row 0. */
  scene: WorldMapIconContext;
  /** The $7E LZ2 tilemap gfx-file id this round-trips to. */
  fileId: number;
  /** 4096 bytes = 2048 BG3 tilemap words. */
  tilemap: Uint8Array;
}

export function buildWorldMapGroundContext(rom: Uint8Array, symbols: SymbolMap, gfxOverride?: ReadonlyMap<string, Uint8Array>): WorldMapGroundContext {
  return {
    scene: buildWorldMapIconContext(rom, symbols, 0, gfxOverride), // world-invariant → any world's load works
    fileId: GROUND_TM_FILE_ID,
    tilemap: decompTilemap(rom, symbols, GROUND_TM_FILE_ID, gfxOverride)
  };
}

/** Assemble the decorative ground: the $7E tilemap over the $56 char (2bpp, palette row 0). */
export function renderWorldMapGround(c: WorldMapGroundContext): WorldMapTerrainCanvas {
  const { vram, cgram } = c.scene;
  const W = COLS * TILE_PX, H = ROWS * TILE_PX;
  const rgba = new Uint8Array(W * H * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, W * H);
  const pal = bgRow(cgram, 0, false); // BG3 ground: index 0 is a real (opaque) color
  const idx = new Uint8Array(64);
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const off = wordIndex(cc, r) * 2;
    const w = c.tilemap[off]! | (c.tilemap[off + 1]! << 8);
    const ch = w & 0x3ff, hf = (w & 0x4000) !== 0, vf = (w & 0x8000) !== 0;
    decode2bppTile(vram, (GROUND_CHAR_VRAM + ch * TILE_BYTES_2BPP) & 0xffff, hf, vf, idx, 0);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) u32[(r * 8 + y) * W + cc * 8 + x] = pal[idx[y * 8 + x]!]!;
  }
  return { rgba, width: W, height: H, faithful: true };
}

// The decorative ground is CHAR-keyed (the title-logo model), NOT word-keyed like the terrain
// above: every ground cell is single-palette (palette row 0), so a char maps 1:1 to a tileset
// entry. The tileset is the full $56 CHR sheet in char order at tiles 1..N (tile 0 = Aseprite's
// empty); H/V flip rides on the cell. A cell's priority bit is preserved from the destination
// cell (char-keying doesn't carry priority), which is lossless here since the ground is all
// priority 0. (See screen-scene.ts `logoTileMeta`/`diffTitleLogoCombined` for the twin.)

/** Aseprite tile index → the ground word's `(char, palRow)`. **Tile 0 is Aseprite's mandatory
 *  empty tile** (`null`); the $56 BG3-ground CHR file is replicated 1:1 at tiles 1..N in char
 *  order (every char, placed or not), so the editor offers the full sheet. Each char's palRow =
 *  the (single) row it's placed with, defaulting to the dominant used row for an unplaced char
 *  (the ground is single-palette, so in practice every char is row 0). Backs `groundTileKeys`
 *  (the serialized tileset order shared by the export + the placement diff). */
function groundTileMeta(c: WorldMapGroundContext): ({ char: number; palRow: number } | null)[] {
  const tm = c.tilemap;
  const usedPal = new Map<number, number>(); // char → the (single) palette row it's placed with
  const palCount = new Map<number, number>(); // palette row → cell count (picks the unplaced default)
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const off = wordIndex(cc, r) * 2;
    const w = tm[off]! | (tm[off + 1]! << 8);
    const char = w & 0x3ff, palRow = (w >> 10) & 0x07;
    if (!usedPal.has(char)) usedPal.set(char, palRow);
    palCount.set(palRow, (palCount.get(palRow) ?? 0) + 1);
  }
  // The full char set = every tile of the $56 BG3-ground file (char base $2000 = the file's load
  // addr), so unused tiles ride along as placeable art. char ↔ VRAM byte = $2000 + char*16 (2bpp).
  const e = c.scene.manifest.find((m) => m.vramByteOffset <= GROUND_CHAR_VRAM && GROUND_CHAR_VRAM < m.vramByteOffset + m.sizeBytes);
  const defPal = [...palCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const meta: ({ char: number; palRow: number } | null)[] = [null]; // tile 0 = Aseprite's empty
  if (e) {
    const start = (e.vramByteOffset - GROUND_CHAR_VRAM) / TILE_BYTES_2BPP;
    const count = Math.floor(e.sizeBytes / TILE_BYTES_2BPP);
    for (let k = 0; k < count; k++) { const char = start + k; if (char >= 0 && char <= 0x3ff) meta.push({ char, palRow: usedPal.get(char) ?? defPal }); }
  }
  return meta;
}

/** Pack `groundTileMeta` to a flat `(char<<3)|palRow` per-tile key list (index 0 = empty `-1`)
 *  — the serialized `tileKeys` so the import maps each aseprite tile back to its char. */
export function groundTileKeys(c: WorldMapGroundContext): number[] {
  return groundTileMeta(c).map((m) => (m === null ? -1 : (m.char << 3) | m.palRow));
}

/** Inverse of `groundTileKeys`: the per-tile `{char,palRow}` meta from the serialized keys. */
function groundMetaFromKeys(keys: readonly number[]): ({ char: number; palRow: number } | null)[] {
  return keys.map((k) => (k < 0 ? null : { char: (k >> 3) & 0x3ff, palRow: k & 0x07 }));
}

/** The ground as an Aseprite tilemap (2bpp, char base $2000) — the full $56 CHR sheet at tiles
 *  1..N (tile 0 = Aseprite's empty), each cell referencing its char's tile. `keys` =
 *  `groundTileKeys(c)` (the same array serialized to the manifest). Rearranging cells →
 *  `diffWorldMapGroundPlacement`. */
export function worldMapGroundAseprite(c: WorldMapGroundContext, keys: readonly number[]): { bytes: Uint8Array; paletteOffsets: number[] } {
  const { vram, cgram } = c.scene;
  const meta = groundMetaFromKeys(keys);
  const tileIndex = new Map<number, number>(); // char → aseprite tile index (1-based; tile 0 = empty)
  const tiles: TilesetTile[] = [];
  const idx = new Uint8Array(64);
  for (let ti = 1; ti < meta.length; ti++) {
    const { char, palRow } = meta[ti]!;
    tileIndex.set(char, ti);
    decode2bppTile(vram, (GROUND_CHAR_VRAM + char * TILE_BYTES_2BPP) & 0xffff, false, false, idx, 0); // UN-flipped; cell carries flip
    tiles.push({ indices: idx.slice(), paletteRow: palRow });
  }
  const cells: AsepriteCell[] = [];
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const off = wordIndex(cc, r) * 2;
    const w = c.tilemap[off]! | (c.tilemap[off + 1]! << 8);
    cells.push({ tile: tileIndex.get(w & 0x3ff) ?? 0, hflip: (w & 0x4000) !== 0, vflip: (w & 0x8000) !== 0 }); // cell → its char's tile (0 = empty)
  }
  const bytes = tilesAseprite({
    cgram, bpp: 2, tileW: TILE_PX, tileH: TILE_PX, tiles, cells,
    tilesAcross: COLS, tilesDown: ROWS, index0Transparent: false, // BG3 index 0 is an opaque color
    layerName: 'ground', tilesetName: 'ground-tiles'
  });
  // Color write-back map — SAME bpp/index0Transparent (default 4-color stride) as above.
  const paletteOffsets = tilesetPaletteOffsets({ tiles, bpp: 2, index0Transparent: false, provenance: c.scene.provenance });
  return { bytes, paletteOffsets };
}

/** New 4096-byte ground tilemap from an edited placement `.aseprite` (for `saveGfxEdit`, or
 *  `null` if unchanged) + the erased-cell count. `keys` is the serialized `tileKeys`. Each cell
 *  → the BG word from its tile's (char, palRow) + the cell's flip (the dest cell's priority bit
 *  preserved). A cell ERASED to the empty tile 0 → cell 0's authored word (the one blank we can
 *  pick), counted in `erased`; a new/unmapped tile keeps the base word (never corrupts). */
export function diffWorldMapGroundPlacement(c: WorldMapGroundContext, keys: readonly number[], struct: AsepriteStructural): { tilemap: Uint8Array | null; erased: number } {
  const meta = groundMetaFromKeys(keys);
  const base = c.tilemap;
  const out = base.slice();
  let changed = false, erased = 0;
  const cell0Word = base[0]! | (base[1]! << 8); // cell 0 — authored backdrop word (the erase target)
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const cell = struct.cells[r * COLS + cc];
    const tile = cell?.tile ?? 0;
    const off = wordIndex(cc, r) * 2;
    const orig = out[off]! | (out[off + 1]! << 8);
    let word: number;
    if (tile === 0) { erased++; word = cell0Word; } // erased / empty cell → cell 0's word
    else {
      const m = meta[tile];
      if (!m) continue; // new/unmapped tile (CHR allocation out of scope) → keep base
      word = ((m.char & 0x3ff) | ((m.palRow & 7) << 10) | (orig & 0x2000) | (cell?.hflip ? 0x4000 : 0) | (cell?.vflip ? 0x8000 : 0)) & 0xffff;
    }
    if (word !== orig) { out[off] = word & 0xff; out[off + 1] = (word >> 8) & 0xff; changed = true; }
  }
  return { tilemap: changed ? out : null, erased };
}

/** One exported decorative-ground entry (single BG3 layer, world-invariant). */
export interface WorldMapGroundPng {
  file: string;
  description: string;
  /** The $7E LZ2 tilemap gfx-file id the ground's layout round-trips to. */
  fileId: number;
  width: number;
  height: number;
  png: Uint8Array;
  /** The editable layout as a single-layer Aseprite tilemap — built only in aseprite mode. */
  aseprite?: Uint8Array;
  /** Per-tileset-tile `(char<<3)|palRow` key (`groundTileKeys`; index 0 = `-1`) — serialized
   *  as `tileKeys` so the import reuses the file's tileset order. Aseprite mode only. */
  tileKeys?: number[];
  /** Per-`.aseprite`-palette-entry master-blob byte-offset (`-1` = transparent/non-blob) —
   *  editing the embedded palette writes those colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[];
}

/** Export the decorative ground as one shared editable layout: a composited PNG view +
 *  (when `opts.aseprite`) an Aseprite tilemap that round-trips LAYOUT edits to file $7E. */
export function exportWorldMapGround(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean; gfxOverride?: ReadonlyMap<string, Uint8Array> } = {}): WorldMapGroundPng {
  const c = buildWorldMapGroundContext(rom, symbols, opts.gfxOverride);
  const canvas = renderWorldMapGround(c);
  const keys = opts.aseprite ? groundTileKeys(c) : undefined;
  const ase = keys ? worldMapGroundAseprite(c, keys) : undefined;
  return {
    // Top-level of the map folder (NOT a common/ subfolder — the common/ folder was
    // removed; this world-invariant layer has no per-world home, so it sits at the root).
    file: 'screens/map/ground.png',
    description: `overworld decorative ground (BG3, the tan terrain + tree line behind every world's map) — tilemap file 0x${c.fileId.toString(16)} over the $56 char. World-invariant (one shared layer). The .aseprite is the editable LAYOUT; ground PIXELS edit via the M1TE2 overworld .M1 (BG3 slot), which bundles the $56 char. Editing the embedded palette writes those colors back to the master palette blob.`,
    fileId: c.fileId, width: canvas.width, height: canvas.height,
    png: worldMapTerrainPng(canvas),
    aseprite: ase?.bytes,
    tileKeys: keys,
    paletteOffsets: ase?.paletteOffsets
  };
}
