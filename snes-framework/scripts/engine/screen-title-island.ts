// Title floating island (Mode-7) — the assembled 'meta' view assembled from file $B1
// (CPC char) + the DATA_5F9800 tilemap; edits slice back to $B1. Split out of
// screen-gfx.ts; shares the scene core (titleVariant + tile geometry).

import { loadSceneGfx } from './load-graphics.ts';
import { loadScenePalettes } from './load-palettes.ts';
import { buildPaletteRow, paletteIndexOf } from './color.ts';
import { encodePng } from './png.ts';
import { snesToPC, type SymbolMap } from './symbol-map.ts';
import { tilesAseprite, tilesetPaletteOffsets, type TilesetTile } from './gfx-aseprite.ts';
import { type AsepriteCell, type AsepriteStructural } from './aseprite.ts';
import { TILE_PX, titleVariant } from './screen-scene.ts';

// ===========================================================================
// TITLE FLOATING ISLAND (Mode-7) — the editable view of the title's island/sea.
// SOLVED statically (no emulator/trace): file $B1 (LZ2 → VRAM $0000) IS the island
// char, stored CPC-packed — each byte holds TWO 8bpp pixels (low nibble = even
// pixel, high nibble = odd), 16 colors (CGRAM 0-15). The GSU just unpacks those
// nibbles into Mode-7 8bpp char. The tilemap is `DATA_5F9800` (worlds 1-5) /
// `DATA_5F9C00` (world 6) — a 32×32 grid of char indices. So:
//   island = unpack($B1) → 128 char tiles, placed by DATA_5F9800, colored CGRAM 0-15.
// Verified byte-exact: $B1 unpacked == the title-render trace's `title.m7char.bin`
// (128/128 island tiles), and the assembled render matches `title.m7-flat.png`.
// This assembles the 256×256 island and slices edits back to $B1 (re-pack the
// nibbles) → `saveGfxEdit`. The title CGRAM shimmers in-game, so the exported
// colors are one frame; editing pixel indices is byte-safe regardless.

const ISLAND_TILEMAP_SYM = 'DATA_5F9800'; // title island, worlds 1-5
const ISLAND_TILEMAP_W6_SYM = 'DATA_5F9C00'; // title island, world 6 (SAME $B1 char file)
const ISLAND_COLS = 32;
const ISLAND_ROWS = 32;
const ISLAND_COLORS = 16; // CGRAM 0-15 (the Mode-7 char bytes index these directly)
const M7_CPC_TILE_BYTES = 32; // one 8×8 char tile = 64 px @ 2 px/byte
const ISLAND_PX_W = ISLAND_COLS * TILE_PX; // 256
/** The title's island char is file $B1, decompressed to VRAM $0000. */
const ISLAND_CHAR_VRAM = 0x0000;

/** Bytes per Mode-7 CPC char tile (8×8 @ 2 px/byte). Exported with the pack/unpack pair
 *  so the M1TE2 island export (`screen-m1te2.ts`) reuses the exact CPC codec. */
export const ISLAND_CPC_TILE_BYTES = M7_CPC_TILE_BYTES;

/** Unpack one CPC char tile (32 bytes) → 64 8bpp pixels (low nibble = even pixel). */
export function unpackCpcTile(cpc: Uint8Array, off: number): Uint8Array {
  const out = new Uint8Array(64);
  for (let k = 0; k < M7_CPC_TILE_BYTES; k++) { const b = cpc[off + k]!; out[k * 2] = b & 0x0f; out[k * 2 + 1] = b >> 4; }
  return out;
}
/** Re-pack 64 8bpp pixels (values 0-15) → one CPC char tile (32 bytes). */
export function packCpcTile(px: Uint8Array): Uint8Array {
  const out = new Uint8Array(M7_CPC_TILE_BYTES);
  for (let k = 0; k < M7_CPC_TILE_BYTES; k++) out[k] = ((px[k * 2 + 1]! & 0x0f) << 4) | (px[k * 2]! & 0x0f);
  return out;
}

/** Decode + palette context for the title island (build once). `b1cpc` is the full
 *  decompressed $B1 (4096 CPC bytes = 128 char tiles); `tilemap` is DATA_5F9800. */
export interface TitleIslandContext {
  rom: Uint8Array;
  symbols: SymbolMap;
  b1cpc: Uint8Array;
  tilemap: Uint8Array;
  palette: Uint32Array; // 16 ARGB (CGRAM 0-15)
  cgram: Uint8Array; // for the Aseprite tilemap export (palette = row 0, 16 colors)
  /** CGRAM color index → master-palette-blob byte-offset (`-1` = no blob source) — lets an
   *  island (Mode-7, CGRAM 0-15) palette-color edit round-trip to the blob. */
  provenance: Int32Array;
  /** $B1 char slots referenced by NEITHER island tilemap (worlds 1-5 AND world 6),
   *  so writing new art to them can't corrupt the other world. The combined import's
   *  budget for ADDED tiles (~9 slots — most "unused by W1-5" chars are used by W6). */
  addableChars: number[];
}

export function buildTitleIslandContext(rom: Uint8Array, symbols: SymbolMap): TitleIslandContext {
  const vram = new Uint8Array(0x10000);
  loadSceneGfx(rom, symbols, titleVariant(rom, symbols).gfx, vram);
  const b1cpc = vram.slice(ISLAND_CHAR_VRAM, ISLAND_CHAR_VRAM + 0x1000); // $B1 decompressed (CPC)
  const cgram = new Uint8Array(512);
  const provenance = new Int32Array(256); // loadScenePalettes fills it (-1 = no blob source)
  loadScenePalettes(rom, symbols, titleVariant(rom, symbols).palette, cgram, provenance);
  const palette = buildPaletteRow(cgram, 0, false, 'expand', ISLAND_COLORS); // CGRAM 0-15, opaque
  const pc = symbols.pc(ISLAND_TILEMAP_SYM);
  // Char slots free in BOTH worlds (the addable-tile budget). $B1 is shared by the
  // W1-5 and W6 islands, so a slot is only safe to overwrite with new art if neither
  // tilemap references it (probe: 9 such slots; 16 chars unused by W1-5 ARE used by W6).
  const charCount = Math.floor(b1cpc.length / M7_CPC_TILE_BYTES);
  const usedAnyWorld = new Set<number>();
  for (let i = 0; i < ISLAND_COLS * ISLAND_ROWS; i++) usedAnyWorld.add(rom[pc + i]!);
  let w6pc: number; try { w6pc = symbols.pc(ISLAND_TILEMAP_W6_SYM); } catch { w6pc = snesToPC(0x5f9c00); }
  for (let i = 0; i < ISLAND_COLS * ISLAND_ROWS; i++) usedAnyWorld.add(rom[w6pc + i]!);
  const addableChars: number[] = [];
  for (let c = 0; c < charCount; c++) if (!usedAnyWorld.has(c)) addableChars.push(c);
  return { rom, symbols, b1cpc, tilemap: rom.subarray(pc, pc + ISLAND_COLS * ISLAND_ROWS), palette, cgram, provenance, addableChars };
}

interface IslandUnit { char: number; cellX: number; cellY: number; basePx: Uint8Array }

export interface TitleIslandCanvas {
  rgba: Uint8Array;
  width: number;
  height: number;
  units: IslandUnit[];
  /** Every cell's char tile re-packs byte-exact → safe to edit. */
  faithful: boolean;
}

/** Assemble the 32×32 island into a 256×256 RGBA canvas + per-cell source map. */
export function renderTitleIsland(ctx: TitleIslandContext): TitleIslandCanvas {
  const width = ISLAND_PX_W;
  const height = ISLAND_ROWS * TILE_PX;
  const rgba = new Uint8Array(width * height * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  const units: IslandUnit[] = [];
  let faithful = true;
  for (let r = 0; r < ISLAND_ROWS; r++) {
    for (let c = 0; c < ISLAND_COLS; c++) {
      const char = ctx.tilemap[r * ISLAND_COLS + c]!;
      const cellX = c * TILE_PX, cellY = r * TILE_PX;
      const off = char * M7_CPC_TILE_BYTES;
      const px = off + M7_CPC_TILE_BYTES <= ctx.b1cpc.length ? unpackCpcTile(ctx.b1cpc, off) : new Uint8Array(64);
      for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) u32[(cellY + y) * width + (cellX + x)] = ctx.palette[px[y * 8 + x]!]!;
      units.push({ char, cellX, cellY, basePx: px });
      if (off + M7_CPC_TILE_BYTES > ctx.b1cpc.length) faithful = false;
    }
  }
  return { rgba, width, height, units, faithful };
}

export interface IslandTileEdit { char: number; bytes: Uint8Array }

/** Diff an edited island canvas vs its base → the changed $B1 char tiles (CPC bytes),
 *  base-aware (a pixel still showing its base color keeps its base index). A
 *  `conflict` is two cells writing the same char different bytes (the char is reused
 *  in the tilemap; last write wins). `sharedCells` is the count of OTHER island cells
 *  that reuse an edited char and so ALSO change in-game — the island is a 32×32
 *  tilemap over ~100 shared 8×8 chars (the sky tile alone repeats ~250×), so an edit
 *  is never local to the painted cell; the editor surfaces this as a warning. */
export function diffTitleIslandTiles(
  ctx: TitleIslandContext,
  canvas: TitleIslandCanvas,
  editedRgba: Uint8Array
): { edits: IslandTileEdit[]; conflicts: number; sharedCells: number } {
  const eu32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, canvas.width * canvas.height);
  const byChar = new Map<number, Uint8Array>();
  const cellsPerChar = new Map<number, number>();
  const changedCellsPerChar = new Map<number, number>();
  for (const u of canvas.units) cellsPerChar.set(u.char, (cellsPerChar.get(u.char) ?? 0) + 1);
  let conflicts = 0;
  for (const u of canvas.units) {
    const px = new Uint8Array(64);
    let changed = false;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const col = eu32[(u.cellY + y) * canvas.width + (u.cellX + x)]!;
        const bIdx = u.basePx[y * 8 + x]!;
        const idx = col === ctx.palette[bIdx] ? bIdx : paletteIndexOf(ctx.palette, col, ISLAND_COLORS);
        px[y * 8 + x] = idx;
        if (idx !== bIdx) changed = true;
      }
    }
    if (!changed) continue;
    changedCellsPerChar.set(u.char, (changedCellsPerChar.get(u.char) ?? 0) + 1);
    const bytes = packCpcTile(px);
    const prev = byChar.get(u.char);
    if (prev) { for (let k = 0; k < M7_CPC_TILE_BYTES; k++) if (prev[k] !== bytes[k]) { conflicts++; break; } }
    byChar.set(u.char, bytes);
  }
  // Every cell sharing an edited char but NOT itself painted will visually change.
  let sharedCells = 0;
  for (const char of byChar.keys()) sharedCells += (cellsPerChar.get(char) ?? 0) - (changedCellsPerChar.get(char) ?? 0);
  return { edits: [...byChar].map(([char, bytes]) => ({ char, bytes })), conflicts, sharedCells };
}

/** Encode the island canvas to a PNG: the 256×256 island (opaque) + a 16-color
 *  swatch column to the right. Import reads only the top-left `width×height`. */
export function titleIslandPng(ctx: TitleIslandContext, canvas: TitleIslandCanvas): Uint8Array {
  const width = canvas.width + TILE_PX;
  const height = Math.max(canvas.height, ISLAND_COLORS * TILE_PX);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < canvas.height; y++) rgba.set(canvas.rgba.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4), y * width * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  for (let i = 0; i < ISLAND_COLORS; i++) for (let dy = 0; dy < TILE_PX; dy++) for (let dx = 0; dx < TILE_PX; dx++) u32[(i * TILE_PX + dy) * width + (canvas.width + dx)] = ctx.palette[i]!;
  return new Uint8Array(encodePng({ width, height, rgba }));
}

/** The title island as a real Aseprite **tilemap** (tileset of distinct CPC char
 *  tiles + a 32×32 cell grid). Mode-7 cells have no flip and index CGRAM 0-15
 *  directly, so the tileset is a single 16-color (4bpp-sized) palette. The flatten
 *  reproduces `renderTitleIsland`'s canvas byte-exact, so the import path is
 *  `decodeAsepriteRegion` → `diffTitleIslandTiles`. */
/** Aseprite tile index → island char. **Tile 0 is Aseprite's mandatory empty tile** (`-1`);
 *  the $B1 CHR file follows 1:1 at tiles 1..N in char order (tile `i` = char `i − 1`), every
 *  char placed or not. (Aseprite reserves tileset index 0 as the empty tile, so the CHR is
 *  1-indexed.) Mode-7 has no per-cell palette/flip, so the char IS the whole tile identity.
 *  Shared by the export + the placement diffs so both agree. */
export function islandTileChars(ctx: TitleIslandContext): number[] {
  const charCount = Math.floor(ctx.b1cpc.length / M7_CPC_TILE_BYTES);
  const tileToChar: number[] = [-1]; // index 0 = Aseprite's empty tile
  for (let char = 0; char < charCount; char++) tileToChar.push(char);
  return tileToChar;
}

export function titleIslandAseprite(ctx: TitleIslandContext, _canvas: TitleIslandCanvas, tileChars: readonly number[]): { bytes: Uint8Array; paletteOffsets: number[] } {
  const tileToChar = tileChars;
  const charToTile = new Map<number, number>();
  const tiles: TilesetTile[] = [];
  for (let ti = 1; ti < tileToChar.length; ti++) {
    const char = tileToChar[ti]!;
    charToTile.set(char, ti);
    const off = char * M7_CPC_TILE_BYTES;
    tiles.push({ indices: off + M7_CPC_TILE_BYTES <= ctx.b1cpc.length ? unpackCpcTile(ctx.b1cpc, off) : new Uint8Array(64), paletteRow: 0 });
  }
  // Mode-7 = no flip. Tile 0 = Aseprite's synthetic empty; unused chars are AVAILABLE (in the
  // tileset, not placed). A fresh export has no tile-0 cells (every cell maps to a char tile).
  const cells: AsepriteCell[] = [];
  for (let i = 0; i < ISLAND_COLS * ISLAND_ROWS; i++) cells.push({ tile: charToTile.get(ctx.tilemap[i]!) ?? 0 });
  const bytes = tilesAseprite({
    cgram: ctx.cgram, bpp: 4, tileW: TILE_PX, tileH: TILE_PX, tiles, cells,
    tilesAcross: ISLAND_COLS, tilesDown: ISLAND_ROWS, index0Transparent: false,
    layerName: 'island', tilesetName: 'island-tiles'
  });
  // Color write-back map — Mode-7 single palette row 0, 16 colors (bpp 4, default stride 16).
  const paletteOffsets = tilesetPaletteOffsets({ tiles, bpp: 4, index0Transparent: false, provenance: ctx.provenance });
  return { bytes, paletteOffsets };
}

/** One changed island tilemap byte: `offset` into `DATA_5F9800` (0..1023), new Mode-7
 *  char index `value`. (Placement is imported via `diffTitleIslandCombined`.) */
export interface IslandPlacementEdit { offset: number; value: number }

/** One edited $B1 char tile (the 32 CPC bytes to write at `char`). */
export interface IslandCharPixelEdit { char: number; bytes: Uint8Array }

/** The result of a COMBINED island import — pixels + placement + added tiles together. */
export interface IslandCombinedDiff {
  /** DATA_5F9800 byte edits (cell → new char index). */
  placement: IslandPlacementEdit[];
  /** $B1 char-tile pixel writes (in-place edits + newly-allocated tiles). */
  pixels: IslandCharPixelEdit[];
  /** Distinct NEW tiles allocated to a free char slot (pixels written). */
  newTiles: number;
  /** New tiles that couldn't be placed — the free-slot budget (`addableChars`) ran out;
   *  their cells keep the original char. */
  unmappedTiles: number;
  /** In-place edits SKIPPED because the char is used only by the world-6 island (writing
   *  it would corrupt W6 with no W1-5 benefit) — surfaced so the user isn't left guessing. */
  skippedW6Tiles: number;
  /** Cells (final layout) that change in-game because they share an in-place-edited char. */
  sharedCells: number;
  /** Cells erased to Aseprite's empty tile 0 → resolved to cell 0's backdrop char. Surfaced
   *  so the caller can warn (an erased cell becomes the backdrop, which may look unexpected). */
  erased: number;
  /** numTiles < export ⇒ tiles were deleted/reordered; the index→char map is unreliable.
   *  Caller should refuse and tell the user to re-export / not delete tiles. */
  removedTiles: boolean;
}

/**
 * Combined island import — **assumes the artist edited in Aseprite's Manual tileset
 * mode** (Aseprite only APPENDS on a new tile, never reorders existing ones), so the
 * tileset INDEX is a stable identity. One edited `.aseprite` then carries all three
 * kinds of change at once, resolved by index:
 *   - **pixels:** tile `t` in `1..exportTileCount-1` whose pixels changed → its char
 *     (`islandTileChars`), an in-place paint shared across every cell using that char;
 *   - **placement:** each cell → the char its tile maps to → `DATA_5F9800`;
 *   - **added tiles:** a tile index `>= exportTileCount` is NEW → dedup to an identical
 *     existing char, else ALLOCATE a free `ctx.addableChars` slot (unused by BOTH island
 *     worlds, so the write can't corrupt the world-6 island) and write its pixels.
 *
 * Safety rails: an in-place edit to a char used ONLY by world 6 is skipped (`skippedW6Tiles`);
 * new tiles beyond the free budget are reported (`unmappedTiles`); and a file with FEWER
 * tiles than the export (`removedTiles`) is refused (indices unreliable). Assumes the
 * palette wasn't reordered (indices still mean CGRAM 0-15) and tiles weren't deleted.
 */
export function diffTitleIslandCombined(ctx: TitleIslandContext, tileChars: readonly number[], struct: AsepriteStructural): IslandCombinedDiff {
  const tileToChar = tileChars; // the serialized tileKeys (tileset tile → $B1 char) — the file's own order
  const exportTileCount = tileToChar.length; // empty tile 0 + every $B1 char (1..N)
  const charCount = Math.floor(ctx.b1cpc.length / M7_CPC_TILE_BYTES);
  const out: IslandCombinedDiff = { placement: [], pixels: [], newTiles: 0, unmappedTiles: 0, skippedW6Tiles: 0, sharedCells: 0, erased: 0, removedTiles: false };
  if (struct.numTiles < exportTileCount) { out.removedTiles = true; return out; }

  const CELLS = ISLAND_COLS * ISLAND_ROWS;
  const TPX = TILE_PX * TILE_PX; // 64 indices per 8×8 tile
  const tilePx = (t: number): Uint8Array => struct.tilePixels.subarray(t * TPX, t * TPX + TPX);
  const origPx = (c: number): Uint8Array => unpackCpcTile(ctx.b1cpc, c * M7_CPC_TILE_BYTES);
  const sameTile = (a: Uint8Array, b: Uint8Array): boolean => { for (let k = 0; k < TPX; k++) if ((a[k]! & 0x0f) !== (b[k]! & 0x0f)) return false; return true; };
  // A char is safe to OVERWRITE iff it's an island tile (W1-5 — editing it is intended,
  // shared-with-W6 is the inherent cart reality) or addable (free in both worlds). The
  // remainder are W6-only chars present as available tiles — never write them.
  const w15Used = new Set<number>(ctx.tilemap);
  const addableSet = new Set<number>(ctx.addableChars);
  const safeToWrite = (c: number): boolean => w15Used.has(c) || addableSet.has(c);

  // (1) In-place pixel edits: existing tiles whose pixels changed → their char.
  const editedChars = new Set<number>();
  for (let t = 1; t < exportTileCount; t++) {
    const c = tileToChar[t]; if (c === undefined || c < 0) continue;
    if (sameTile(tilePx(t), origPx(c))) continue;
    if (!safeToWrite(c)) { out.skippedW6Tiles++; continue; }
    out.pixels.push({ char: c, bytes: packCpcTile(tilePx(t)) }); editedChars.add(c);
  }

  // (2) Resolve each cell to a char; collect placed NEW-tile indices. `occupied` = chars
  //     a cell already references via an existing tile — never reallocate those.
  const resolved = new Array<number | undefined>(CELLS);
  const occupied = new Set<number>(editedChars);
  const newIdx = new Set<number>();
  for (let i = 0; i < CELLS; i++) {
    const tile = struct.cells[i]?.tile ?? 0; // tile 0 = empty (tileToChar[0] = -1, not resolved here)
    if (tile < exportTileCount) { const c = tileToChar[tile]; if (c !== undefined && c >= 0) { resolved[i] = c; occupied.add(c); } }
    else newIdx.add(tile);
  }

  // (3) Allocate each placed NEW tile: dedup to an identical existing char (no write),
  //     else take the next free addable slot. Beyond the budget → unmapped.
  const newToChar = new Map<number, number>();
  const freePool = ctx.addableChars.filter((c) => !occupied.has(c));
  let fp = 0;
  for (const t of [...newIdx].sort((a, b) => a - b)) {
    let dup = -1;
    for (let c = 0; c < charCount; c++) if (sameTile(tilePx(t), origPx(c))) { dup = c; break; }
    if (dup >= 0) { newToChar.set(t, dup); occupied.add(dup); continue; }
    while (fp < freePool.length && occupied.has(freePool[fp]!)) fp++;
    if (fp >= freePool.length) { out.unmappedTiles++; continue; }
    const c = freePool[fp++]!;
    newToChar.set(t, c); occupied.add(c);
    out.pixels.push({ char: c, bytes: packCpcTile(tilePx(t)) }); out.newTiles++;
  }

  // (4) Placement edits: each cell's resolved char vs the original tilemap. A cell ERASED to the
  //     empty tile 0 → cell 0's authored backdrop char (the one blank we can pick), counted in
  //     `erased` so the caller can warn. An unmapped new tile leaves the cell as-is.
  // (5) Spread: count cells (final layout) referencing an in-place-edited char.
  const cell0Char = ctx.tilemap[0]!; // tilemap cell 0 — the authored backdrop (sky) char
  for (let i = 0; i < CELLS; i++) {
    const tile = struct.cells[i]?.tile ?? 0;
    if (tile === 0) { // erased / empty cell → cell 0's backdrop char
      out.erased++;
      if (cell0Char !== ctx.tilemap[i]) out.placement.push({ offset: i, value: cell0Char });
      continue;
    }
    const c = tile < exportTileCount ? resolved[i] : newToChar.get(tile);
    if (c === undefined || c < 0) continue; // unmapped new tile → leave the cell as-is
    if (c !== ctx.tilemap[i]) out.placement.push({ offset: i, value: c });
    if (editedChars.has(c)) out.sharedCells++;
  }
  return out;
}

/** One assembled title-island PNG, shaped for the manifest. */
export interface TitleIslandPng {
  /** Relative path: `screens/title/island.png`. */
  file: string;
  description: string;
  faithful: boolean;
  width: number;
  height: number;
  png: Uint8Array;
}

/** Export the title's floating island (Mode-7) as an assembled, editable PNG. Edits
 *  slice back to file $B1's char tiles (CPC re-pack) → saveGfxEdit. */
export function exportTitleIsland(rom: Uint8Array, symbols: SymbolMap): TitleIslandPng {
  const ctx = buildTitleIslandContext(rom, symbols);
  const canvas = renderTitleIsland(ctx);
  return {
    file: 'screens/title/island.png',
    description: 'title floating island (Mode-7, assembled from $B1 char + DATA_5F9800 tilemap; palette animates). Tiles are SHARED across the tilemap — editing a pixel changes that 8×8 tile everywhere it repeats (import reports the spread).',
    faithful: canvas.faithful,
    width: canvas.width,
    height: canvas.height,
    png: titleIslandPng(ctx, canvas)
  };
}
