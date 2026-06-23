// World-map OVERWORLD TERRAIN export — the per-world map Yoshi paths across (clouds,
// hills, the dotted level path + markers, forts/castles), the editable LAYOUT view.
//
// DISTINCT from the level-select panel (`screen-gfx.ts` `mapDescriptor`) and the level
// ICONS (`world-map-level-icons.ts`). The map is a **BG1 TILEMAP**, not a char sheet:
//   • Layout = the `DATA_00B3F4` pair (`world*2 + half`): w0 = $7C/$7D, w1 = $7F/$80,
//     … — LZ2-compressed 4096-byte BG tilemaps (2048 words, 64×32 SCREEN-BLOCK layout).
//     half 0 = levels 1-4, half 1 = levels 5-8. (Cracked + validated vs the per-world
//     captures — see `research/graphics-editing/world-map-screens.md`.)
//   • Char = the COMMON $74/$75/$4C files (VRAM $6000-$7FFF, char base $4000, 4bpp) —
//     the SAME tiles the level-select panel draws; the per-world difference is purely
//     the tilemap + palette tint. So map PIXELS edit via those shared char sheets; this
//     module owns the per-world LAYOUT (where each tile/path/marker sits).
//   • Composited over the BG3 decorative ground ($56 char + $7E tilemap, world-invariant).
//
// Export: a per-world×half assembled PNG (the composited VIEW) + an Aseprite **tilemap**
// (the editable layout). Rearranging the Aseprite cells rewrites the `$7C/$7D` tilemap
// (round-trips byte-exact via `saveGfxEdit` — the tilemap IS an LZ2 gfx file). The tileset
// is keyed by the BG word's (char, palette, priority) with the un-flipped char pixels;
// H/V flip rides on the cell, so the full 16-bit BG word reconstructs losslessly.

import { buildWorldMapIconContext, mapTilemapFileId, type WorldMapIconContext } from './screen-gfx.ts';
import { lz2 } from './decompress/index.ts';
import { snesToPC, type SymbolMap } from './symbol-map.ts';
import { u24le } from './rom-read.ts';
import { decode4bppTile, decode2bppTile } from './tile.ts';
import { buildPaletteRow } from './color.ts';
import { encodePng } from './png.ts';
import { tilesAseprite, type TilesetTile } from './gfx-aseprite.ts';
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

/** Decompress a tilemap gfx file (LZ2) → its 4096 raw bytes (2048 BG words). */
function decompTilemap(rom: Uint8Array, symbols: SymbolMap, fileId: number): Uint8Array {
  const ptr = symbols.pc('DATA_lz2_compressed_gfx_ptrs');
  const pc = snesToPC(u24le(rom, ptr + fileId * 3));
  const dest = new Uint8Array(0x4000);
  const { destEnd } = lz2(rom, pc, dest, 0);
  return dest.subarray(0, Math.min(destEnd, TILEMAP_BYTES));
}

export interface WorldMapTerrainContext {
  /** Overworld scene context — `vram` has the common char ($74/$75/$4C @ $6000-$7FFF)
   *  AND the BG3 ground ($56 @ $2000 + $7E tilemap @ $2800); `cgram` is the per-world
   *  palette. Reused from the icon track so the load mirrors the cart exactly. */
  scene: WorldMapIconContext;
  world: number;
  /** 0 = levels 1-4, 1 = levels 5-8. */
  half: 0 | 1;
  /** The `$7C`/`$7D`… LZ2 gfx-file id this map half round-trips to. */
  fileId: number;
  /** 4096 bytes = 2048 BG tilemap words (64×32 screen-block). */
  tilemap: Uint8Array;
}

export function buildWorldMapTerrainContext(rom: Uint8Array, symbols: SymbolMap, world: number, half: 0 | 1): WorldMapTerrainContext {
  const scene = buildWorldMapIconContext(rom, symbols, world);
  const fileId = mapTilemapFileId(rom, symbols, world, half);
  return { scene, world, half, fileId, tilemap: decompTilemap(rom, symbols, fileId) };
}

/** A 16-colour BG palette row as ARGB; `transparentZero` makes index 0 transparent. */
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
 * Assemble the per-world map half: the BG3 decorative ground (2bpp, row 0) behind the
 * BG1 map tilemap (4bpp, the word's palette row, index 0 transparent so the ground
 * shows through the map's fill). A VIEW — the composited 512×256 picture the player sees.
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

  // (2) BG1 map tilemap (front) — char base $4000 (4bpp), each word its own palette row,
  //     index 0 transparent (the $1BF fill is index-0 → the ground shows through).
  const palCache: (Uint32Array | undefined)[] = new Array(8);
  const palFor = (row: number): Uint32Array => (palCache[row] ??= bgRow(cgram, row, true));
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const off = wordIndex(cc, r) * 2;
    const w = c.tilemap[off]! | (c.tilemap[off + 1]! << 8);
    const ch = w & 0x3ff, pal = (w >> 10) & 7, hf = (w & 0x4000) !== 0, vf = (w & 0x8000) !== 0;
    const vb = (MAP_CHAR_BASE + ch * TILE_BYTES_4BPP) & 0xffff;
    if (vb + TILE_BYTES_4BPP > vram.length) continue;
    decode4bppTile(vram, vb, hf, vf, idx, 0);
    const p = palFor(pal);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const ci = idx[y * 8 + x]!;
      if (ci === 0) continue; // transparent — keep the ground behind
      u32[(r * 8 + y) * W + cc * 8 + x] = p[ci]!;
    }
  }
  return { rgba, width: W, height: H, faithful: true };
}

/** PNG of the assembled view (the composited map). View-only — the editable layout is
 *  the `.aseprite`, map pixels edit via the shared `$74`/`$75`/`$4C` char sheets. */
export function worldMapTerrainPng(canvas: WorldMapTerrainCanvas): Uint8Array {
  return new Uint8Array(encodePng({ width: canvas.width, height: canvas.height, rgba: canvas.rgba }));
}

// --- Aseprite tilemap (the editable LAYOUT surface) --------------------------
// The tileset is keyed by the BG word's (char, palette, priority) — the bits that pick
// a distinct tileset entry; H/V flip rides on the cell (Aseprite's native flip), so the
// full 16-bit BG word reconstructs losslessly. The map fill (char $1BF, index-0 tile)
// is just another tileset entry. Tile index 0 = empty (Aseprite reserves it).

/** The (char,palette,priority) key for a BG word = bits 0-13 (flip bits 14/15 masked off). */
const wordKey = (w: number): number => w & 0x3fff;

// --- Generic BG-tilemap ⇄ Aseprite core (shared by the per-world map + the ground) ---
// A tilemap is a 64×32 screen-block array of 16-bit BG words. The Aseprite tileset is
// keyed by each word's (char,pal,prio); H/V flip rides on the cell, so the full word
// reconstructs losslessly. Index 0 = Aseprite's reserved empty tile.

/** Ordered list of distinct word-keys (index 0 = empty; real keys at 1+) in screen-block
 *  reading order. Shared by the aseprite export + the placement diff so both agree on the
 *  tile↔word mapping. */
function distinctWordKeys(tilemap: Uint8Array): number[] {
  const keys: number[] = [-1];
  const seen = new Set<number>();
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const off = wordIndex(cc, r) * 2;
    const k = wordKey(tilemap[off]! | (tilemap[off + 1]! << 8));
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  return keys;
}

/** A BG tilemap → an Aseprite tilemap project (tileset of distinct (char,pal,prio) tiles
 *  decoded from `vram` at `charBase`, `bpp`-bit, un-flipped; cells carry per-cell flip). */
function tilemapToAseprite(
  vram: Uint8Array, cgram: Uint8Array, tilemap: Uint8Array,
  bpp: 2 | 4, charBase: number, layerName: string, tilesetName: string
): Uint8Array {
  const tileBytes = bpp === 4 ? TILE_BYTES_4BPP : TILE_BYTES_2BPP;
  const dec = bpp === 4 ? decode4bppTile : decode2bppTile;
  const keys = distinctWordKeys(tilemap);
  const keyToTile = new Map<number, number>();
  const tiles: TilesetTile[] = [];
  const idx = new Uint8Array(64);
  for (let ti = 1; ti < keys.length; ti++) {
    const k = keys[ti]!;
    keyToTile.set(k, ti);
    const ch = k & 0x3ff, pal = (k >> 10) & 7;
    dec(vram, (charBase + ch * tileBytes) & 0xffff, false, false, idx, 0); // UN-flipped; cell carries flip
    tiles.push({ indices: idx.slice(), paletteRow: pal });
  }
  const cells: AsepriteCell[] = [];
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const off = wordIndex(cc, r) * 2;
    const w = tilemap[off]! | (tilemap[off + 1]! << 8);
    cells.push({ tile: keyToTile.get(wordKey(w))!, hflip: (w & 0x4000) !== 0, vflip: (w & 0x8000) !== 0 });
  }
  return tilesAseprite({
    cgram, bpp, tileW: TILE_PX, tileH: TILE_PX, tiles, cells,
    tilesAcross: COLS, tilesDown: ROWS, index0Transparent: false, layerName, tilesetName
  });
}

/** Reconstruct a full 4096-byte tilemap from an edited placement `.aseprite`. Each cell →
 *  its tile's (char,pal,prio) word | the cell's flip bits → the screen-block word. An
 *  empty / out-of-range cell keeps the original word (never corrupts). Returns the new
 *  tilemap bytes (for `saveGfxEdit`), or `null` if nothing changed. */
function diffTilemapPlacement(tilemap: Uint8Array, struct: AsepriteStructural): Uint8Array | null {
  const keys = distinctWordKeys(tilemap);
  const out = tilemap.slice();
  let changed = false;
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const cell = struct.cells[r * COLS + cc];
    if (!cell || cell.tile <= 0 || cell.tile >= keys.length) continue; // empty/unknown → keep base
    const k = keys[cell.tile]!;
    if (k < 0) continue;
    const word = (k | (cell.hflip ? 0x4000 : 0) | (cell.vflip ? 0x8000 : 0)) & 0xffff;
    const off = wordIndex(cc, r) * 2;
    const orig = out[off]! | (out[off + 1]! << 8);
    if (word !== orig) { out[off] = word & 0xff; out[off + 1] = (word >> 8) & 0xff; changed = true; }
  }
  return changed ? out : null;
}

/** Distinct (char,pal,prio) tile keys of a map half (index 0 = empty) — the placeable set. */
export function terrainTileKeys(c: WorldMapTerrainContext): number[] {
  return distinctWordKeys(c.tilemap);
}

/** Export the map half as an Aseprite tilemap (4bpp, char base $4000). Rearranging the
 *  cells → `diffWorldMapTerrainPlacement`. */
export function worldMapTerrainAseprite(c: WorldMapTerrainContext): Uint8Array {
  return tilemapToAseprite(c.scene.vram, c.scene.cgram, c.tilemap, 4, MAP_CHAR_BASE,
    `overworld-${c.half === 0 ? '1-4' : '5-8'}`, 'map-tiles');
}

/** New 4096-byte map tilemap from an edited placement `.aseprite` (for `saveGfxEdit`), or `null`. */
export function diffWorldMapTerrainPlacement(c: WorldMapTerrainContext, struct: AsepriteStructural): Uint8Array | null {
  return diffTilemapPlacement(c.tilemap, struct);
}

/** One exported map-terrain entry, shaped for the gfx manifest. */
export interface WorldMapTerrainPng {
  /** `screens/map/world-N/overworld-{1-4|5-8}.png` (or `.aseprite`). */
  file: string;
  description: string;
  world: number;
  half: 0 | 1;
  /** The LZ2 tilemap gfx-file id ($7C/$7D…) layout edits round-trip to. */
  fileId: number;
  width: number;
  height: number;
  png: Uint8Array;
  /** The editable layout as an Aseprite tilemap — built only when requested. */
  aseprite?: Uint8Array;
}

/** Export every world's overworld map (6 worlds × 2 halves = 12). The PNG is the
 *  composited view; the `.aseprite` (when `opts.aseprite`) is the editable layout that
 *  round-trips to the `$7C`/`$7D`… tilemap files. */
export function exportWorldMapTerrain(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean } = {}): WorldMapTerrainPng[] {
  const out: WorldMapTerrainPng[] = [];
  for (let world = 0; world < 6; world++) {
    for (const half of [0, 1] as const) {
      const c = buildWorldMapTerrainContext(rom, symbols, world, half);
      const canvas = renderWorldMapTerrain(c);
      const span = half === 0 ? '1-4' : '5-8';
      out.push({
        file: `screens/map/world-${world}/overworld-${span}.png`,
        description: `overworld map, world ${world} levels ${span} — BG1 tilemap (file 0x${c.fileId.toString(16)}) over the BG3 decorative ground. The .aseprite is the editable LAYOUT (rearrange cells → rewrites the tilemap); map PIXELS edit via the shared screens/map sheets ($74/$75/$4C).`,
        world, half, fileId: c.fileId, width: canvas.width, height: canvas.height,
        png: worldMapTerrainPng(canvas),
        aseprite: opts.aseprite ? worldMapTerrainAseprite(c) : undefined
      });
    }
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

export function buildWorldMapGroundContext(rom: Uint8Array, symbols: SymbolMap): WorldMapGroundContext {
  return {
    scene: buildWorldMapIconContext(rom, symbols, 0), // world-invariant → any world's load works
    fileId: GROUND_TM_FILE_ID,
    tilemap: decompTilemap(rom, symbols, GROUND_TM_FILE_ID)
  };
}

/** Assemble the decorative ground: the $7E tilemap over the $56 char (2bpp, palette row 0). */
export function renderWorldMapGround(c: WorldMapGroundContext): WorldMapTerrainCanvas {
  const { vram, cgram } = c.scene;
  const W = COLS * TILE_PX, H = ROWS * TILE_PX;
  const rgba = new Uint8Array(W * H * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, W * H);
  const pal = bgRow(cgram, 0, false); // BG3 ground: index 0 is a real (opaque) colour
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

/** The ground as an Aseprite tilemap (2bpp, char base $2000). Rearranging cells →
 *  `diffWorldMapGroundPlacement`. */
export function worldMapGroundAseprite(c: WorldMapGroundContext): Uint8Array {
  return tilemapToAseprite(c.scene.vram, c.scene.cgram, c.tilemap, 2, GROUND_CHAR_VRAM, 'ground', 'ground-tiles');
}

/** New 4096-byte ground tilemap from an edited placement `.aseprite` (for `saveGfxEdit`), or `null`. */
export function diffWorldMapGroundPlacement(c: WorldMapGroundContext, struct: AsepriteStructural): Uint8Array | null {
  return diffTilemapPlacement(c.tilemap, struct);
}

/** Export the decorative ground as one shared editable layout: a composited PNG view +
 *  (when `opts.aseprite`) an Aseprite tilemap that round-trips LAYOUT edits to file $7E. */
export function exportWorldMapGround(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean } = {}): WorldMapTerrainPng {
  const c = buildWorldMapGroundContext(rom, symbols);
  const canvas = renderWorldMapGround(c);
  return {
    file: 'screens/map/common/ground.png',
    description: `overworld decorative ground (BG3, the tan terrain + tree line behind every world's map) — tilemap file 0x${c.fileId.toString(16)} over the $56 char. World-invariant (one shared layer). The .aseprite is the editable LAYOUT; ground PIXELS edit via the screens/map/common/f56 sheet.`,
    world: 0, half: 0, fileId: c.fileId, width: canvas.width, height: canvas.height,
    png: worldMapTerrainPng(canvas),
    aseprite: opts.aseprite ? worldMapGroundAseprite(c) : undefined
  };
}
