// The Raphael boss arena (gm$0F Mode-7 moon fight) — the "Bosses" export track.
//
// Cart anatomy (verified by rendering the composed scene byte-for-byte,
// tmp/render-raphael.ts → the patched moon + bird constellation):
//   • CHARS: lz2 files $B9-$BC, 64 CPC chars each (2 px/byte, the title-island
//     packing — `unpackCpcTile`), concatenated = the full Mode-7 char space 0-255.
//   • PER-CHAR PALETTE ROWS: chars 0-127 draw with row 0; chars 128-191 / 192-255
//     take their row from `DATA_00B637` / `DATA_00B677` (value>>4 — the loader
//     CODE_00B6B7 ORs the offset into the pixels; same tables the YY-CHR track
//     ships as `.col` sidecars).
//   • PALETTE: `DATA_5FE3EA`, 0xA0 bytes = CGRAM rows 0-4, inside the master
//     palette blob (so colors are blob-editable via provenance offsets).
//   • TILEMAP: lz2 file $BD — 64×64 cells, ONE BYTE per cell = char index,
//     row-major 64 wide. No flips (Mode-7).
//
// The export is an Aseprite LAYOUT tilemap (the world-map ground's pattern,
// world-map-terrain.ts): tiles 1..256 = the chars in order (tile 0 = Aseprite's
// mandatory empty), each cell referencing its char's tile. Rearranging cells
// imports back into the $BD blob via `diffRaphaelArenaPlacement` → saveGfxEdit
// (lz2, unitBytes 1). Char PIXELS stay on the YY-CHR track
// (advanced/raphael-chars-*); the arena has no other placement editor — M1TE
// can't represent 1-byte Mode-7 cells (see research/graphics-editing/
// tilemap-placement-import.md).

import { lz2 } from './decompress/lz2.ts';
import { snesToPC, type SymbolMap } from './symbol-map.ts';
import { unpackCpcTile, ISLAND_CPC_TILE_BYTES } from './screen-title-island.ts';
import { tilesAseprite, tilesetPaletteOffsets, type TilesetTile } from './gfx-aseprite.ts';
import { type AsepriteCell, type AsepriteStructural } from './aseprite.ts';
import { buildPaletteRow } from './color.ts';
import { encodePng } from './png.ts';

/** The arena's Mode-7 tilemap gfx file ($BD): 64×64 byte cells. */
export const RAPHAEL_TILEMAP_FILE_ID = 0xbd;
/** The four CPC char files ($B9-$BC), 64 chars each, char space 0-255 in order. */
export const RAPHAEL_CHAR_FILE_IDS = [0xb9, 0xba, 0xbb, 0xbc] as const;
const COLS = 64;
const ROWS = 64;
const TILE_PX = 8;
const TILEMAP_BYTES = COLS * ROWS;
const CHAR_COUNT = 256;
/** SNES addresses of the per-char palette-row tables (chars 128-191 / 192-255). */
const CHAR_PAL_TABLES = [
  { first: 128, snes: 0x00b637 },
  { first: 192, snes: 0x00b677 },
] as const;
/** The arena palette: 0xA0 bytes at this label = CGRAM rows 0-4. */
const ARENA_PALETTE_LABEL = 'DATA_5FE3EA';
const ARENA_PALETTE_BYTES = 0xa0;
const MASTER_BLOB_LABEL = 'DATA_master_palette_rom_blob';

export interface RaphaelArenaContext {
  /** All 256 chars' CPC bytes (32 B/char), files $B9-$BC concatenated. */
  chars: Uint8Array;
  /** Palette row per char (0-7): 0 for chars 0-127, the tables for 128-255. */
  palRow: Uint8Array;
  /** CGRAM (512 B) with rows 0-4 sourced from the arena palette. */
  cgram: Uint8Array;
  /** CGRAM entry → master-palette-blob byte offset (-1 = not blob-backed). */
  provenance: Int32Array;
  /** The $BD tilemap (4096 bytes, row-major 64-wide, byte = char index). */
  tilemap: Uint8Array;
}

const u24le = (rom: Uint8Array, off: number): number => rom[off]! | (rom[off + 1]! << 8) | (rom[off + 2]! << 16);

/** Decompress an lz2 gfx file (live-cache override first, like every scene builder). */
function decompLz2(rom: Uint8Array, symbols: SymbolMap, fileId: number, maxBytes: number, gfxOverride?: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const ov = gfxOverride?.get(`lz2/${fileId}`);
  if (ov) return ov.subarray(0, Math.min(ov.length, maxBytes));
  const pc = snesToPC(u24le(rom, symbols.pc('DATA_lz2_compressed_gfx_ptrs') + fileId * 3));
  const dest = new Uint8Array(0x4000);
  const { destEnd } = lz2(rom, pc, dest, 0);
  return dest.subarray(0, Math.min(destEnd, maxBytes));
}

export function buildRaphaelArenaContext(rom: Uint8Array, symbols: SymbolMap, gfxOverride?: ReadonlyMap<string, Uint8Array>): RaphaelArenaContext {
  const chars = new Uint8Array(CHAR_COUNT * ISLAND_CPC_TILE_BYTES);
  for (let i = 0; i < RAPHAEL_CHAR_FILE_IDS.length; i++) {
    const blob = decompLz2(rom, symbols, RAPHAEL_CHAR_FILE_IDS[i]!, 64 * ISLAND_CPC_TILE_BYTES, gfxOverride);
    chars.set(blob, i * 64 * ISLAND_CPC_TILE_BYTES);
  }
  const palRow = new Uint8Array(CHAR_COUNT); // chars 0-127 stay row 0
  for (const t of CHAR_PAL_TABLES) {
    const pc = snesToPC(t.snes);
    for (let c = 0; c < 64; c++) palRow[t.first + c] = (rom[pc + c]! >> 4) & 0x07;
  }
  const palPC = symbols.tryPc(ARENA_PALETTE_LABEL) ?? snesToPC(0x5fe3ea);
  const cgram = new Uint8Array(512);
  cgram.set(rom.subarray(palPC, palPC + ARENA_PALETTE_BYTES));
  const provenance = new Int32Array(256).fill(-1);
  const blobOff = palPC - symbols.pc(MASTER_BLOB_LABEL);
  for (let i = 0; i < ARENA_PALETTE_BYTES / 2; i++) provenance[i] = blobOff + i * 2;
  const tilemap = decompLz2(rom, symbols, RAPHAEL_TILEMAP_FILE_ID, TILEMAP_BYTES, gfxOverride);
  return { chars, palRow, cgram, provenance, tilemap };
}

/** Assemble the arena view (512×512 RGBA) — the PNG preview. Opaque: Mode-7
 *  color 0 is the sky, a real color. */
export function renderRaphaelArena(ctx: RaphaelArenaContext): { rgba: Uint8Array; width: number; height: number } {
  const W = COLS * TILE_PX;
  const rgba = new Uint8Array(W * W * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, W * W);
  const rows: Uint32Array[] = [];
  for (let r = 0; r < 8; r++) rows.push(buildPaletteRow(ctx.cgram, r, false));
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = ctx.tilemap[r * COLS + c] ?? 0;
    const px = unpackCpcTile(ctx.chars, ch * ISLAND_CPC_TILE_BYTES);
    const pal = rows[ctx.palRow[ch]!]!;
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      u32[(r * TILE_PX + y) * W + c * TILE_PX + x] = pal[px[y * TILE_PX + x]!]!;
    }
  }
  return { rgba, width: W, height: W };
}

/** Aseprite tile index → `(char<<3)|palRow` key (tile 0 = the empty tile, `-1`).
 *  Tiles 1..256 are the full char space in order, so the editor offers every char. */
export function raphaelTileKeys(ctx: RaphaelArenaContext): number[] {
  const keys: number[] = [-1];
  for (let c = 0; c < CHAR_COUNT; c++) keys.push((c << 3) | ctx.palRow[c]!);
  return keys;
}

/** The arena as an Aseprite LAYOUT tilemap (4bpp, per-tile palette rows, no flips). */
export function raphaelArenaAseprite(ctx: RaphaelArenaContext, keys: readonly number[]): { bytes: Uint8Array; paletteOffsets: number[] } {
  const tiles: TilesetTile[] = [];
  for (let ti = 1; ti < keys.length; ti++) {
    const k = keys[ti]!;
    const char = (k >> 3) & 0xff;
    tiles.push({ indices: unpackCpcTile(ctx.chars, char * ISLAND_CPC_TILE_BYTES), paletteRow: k & 0x07 });
  }
  const cells: AsepriteCell[] = [];
  for (let i = 0; i < TILEMAP_BYTES; i++) cells.push({ tile: (ctx.tilemap[i] ?? 0) + 1 }); // char c = tile c+1; Mode-7 → no flips
  const bytes = tilesAseprite({
    cgram: ctx.cgram, bpp: 4, tileW: TILE_PX, tileH: TILE_PX, tiles, cells,
    tilesAcross: COLS, tilesDown: ROWS, index0Transparent: false, // Mode-7 color 0 = the sky, opaque
    layerName: 'arena', tilesetName: 'arena-tiles'
  });
  const paletteOffsets = tilesetPaletteOffsets({ tiles, bpp: 4, index0Transparent: false, provenance: ctx.provenance });
  return { bytes, paletteOffsets };
}

/**
 * New 4096-byte $BD tilemap from an edited layout `.aseprite` (for `saveGfxEdit`,
 * `null` if unchanged) + the erased-cell count. Each cell → its tile's char byte;
 * a cell ERASED to the empty tile 0 → cell 0's authored byte (the one blank we can
 * pick, counted in `erased`); a new/unmapped tile keeps the base byte (char
 * allocation is the YY-CHR track's job — the full char space is already offered).
 */
export function diffRaphaelArenaPlacement(ctx: RaphaelArenaContext, keys: readonly number[], struct: AsepriteStructural): { tilemap: Uint8Array | null; erased: number } {
  const out = ctx.tilemap.slice();
  let changed = false, erased = 0;
  const cell0Byte = ctx.tilemap[0]!;
  for (let i = 0; i < TILEMAP_BYTES; i++) {
    const tile = struct.cells[i]?.tile ?? 0;
    let b: number;
    if (tile === 0) { erased++; b = cell0Byte; }
    else {
      const k = keys[tile];
      if (k === undefined || k < 0) continue; // new/unmapped tile → keep base
      b = (k >> 3) & 0xff;
    }
    if (b !== out[i]) { out[i] = b; changed = true; }
  }
  return { tilemap: changed ? out : null, erased };
}

/** One exported arena entry (the bosses track's single product, for now). */
export interface RaphaelArenaExport {
  file: string;
  description: string;
  /** The $BD LZ2 tilemap gfx-file id the layout round-trips to. */
  fileId: number;
  width: number;
  height: number;
  png: Uint8Array;
  /** The editable layout as a single-layer Aseprite tilemap — aseprite mode only. */
  aseprite?: Uint8Array;
  /** Per-tileset-tile `(char<<3)|palRow` key (`raphaelTileKeys`; index 0 = `-1`). */
  tileKeys?: number[];
  /** Per-`.aseprite`-palette-entry master-blob byte-offset (`-1` = non-blob). */
  paletteOffsets?: number[];
}

export function exportRaphaelArena(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean; gfxOverride?: ReadonlyMap<string, Uint8Array> } = {}): RaphaelArenaExport {
  const ctx = buildRaphaelArenaContext(rom, symbols, opts.gfxOverride);
  const view = renderRaphaelArena(ctx);
  const keys = opts.aseprite ? raphaelTileKeys(ctx) : undefined;
  const ase = keys ? raphaelArenaAseprite(ctx, keys) : undefined;
  return {
    file: 'bosses/raphael-arena.png',
    description: `Raphael's moon arena (Mode-7, gm$0F) — tilemap file 0x${RAPHAEL_TILEMAP_FILE_ID.toString(16).toUpperCase()} over the $B9-$BC chars. The .aseprite is the editable LAYOUT; char PIXELS edit via the YY-CHR track (advanced/raphael-chars-*). Editing the embedded palette writes those colors back to the master palette blob.`,
    fileId: RAPHAEL_TILEMAP_FILE_ID,
    width: view.width, height: view.height,
    png: encodePng({ rgba: view.rgba, width: view.width, height: view.height }),
    aseprite: ase?.bytes,
    tileKeys: keys,
    paletteOffsets: ase?.paletteOffsets
  };
}
