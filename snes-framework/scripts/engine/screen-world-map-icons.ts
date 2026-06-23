// World-map level-slot icons — the assembled 'meta' view of the overworld's level
// markers (the normal marker + boss castle, per world in its tint). Edits slice back
// to the shared $74/$75 BG tiles. Split out of screen-gfx.ts; shares the scene core.

import { loadSceneGfx, type GfxFileEntry } from './load-graphics.ts';
import { loadScenePalettes } from './load-palettes.ts';
import { buildPaletteRow, paletteIndexOf } from './color.ts';
import { encodePng, type ImageData } from './png.ts';
import { decode4bppTile, encode4bppTile } from './tile.ts';
import { u16le } from './rom-read.ts';
import { type SymbolMap } from './symbol-map.ts';
import { imageAseprite } from './gfx-aseprite.ts';
import { TILE_PX, TILE_BYTES_4BPP, MAP_BG1_CHAR_ADDR, WORLD_COUNT, mapTintRow, mapGfx, mapPalette, type IconUnit, type IconTileEdit } from './screen-scene.ts';

// ===========================================================================
// World-map LEVEL-SLOT ICONS — the editable "meta" view of the overworld's level
// markers (the BG twin of the object metatile, for the world map). The overworld
// stamps a 3×3 BG1 tilemap block per level slot from two shapes — the normal level
// MARKER and the boss-slot CASTLE — both OR'd with the per-world palette tint
// (`mapTintRow`). This assembles each shape into a recognizable 24×24 PNG and
// slices edits back to the underlying BG1 char tiles (in the `$74`/`$75` files the
// corrected map export writes) → `saveGfxEdit`. See
// `research/graphics-editing/world-map-screens.md`.
//
// The icon shapes are fixed cart tables (Bank17): each is 3 rows × 3 columns of
// tilemap words. The marker's char tiles (`$187/$18E/$18F/$198`) live in `$74`; the
// castle's (`$1F5/$1F6/$1F7`) in `$75`. **The tile PIXELS are world-invariant** —
// only the display tint differs per world — so editing a marker in one world edits
// it for ALL worlds (the import's shared-tile conflict report surfaces this, like
// the metatile/metasprite tracks). The extra/bonus slots reuse the MARKER shape in
// this draw path (`CODE_17C946`); they have no distinct BG icon.

const ICON_DIM = 3; // 3×3 tilemap-word block
const ICON_PX = ICON_DIM * TILE_PX; // 24

/** The two level-slot icon shapes, each = 3 row-tables (`dw word×3`) in Bank17.
 *  `rowSyms[r][c]` is the tilemap word at icon cell (row r, col c). */
const ICON_DEFS: { name: 'marker' | 'castle'; label: string; rowSyms: [string, string, string] }[] = [
  { name: 'marker', label: 'level marker (every normal slot, + extra/bonus)', rowSyms: ['DATA_17C9C6', 'DATA_17C9CC', 'DATA_17C9D2'] },
  { name: 'castle', label: 'boss castle/fort (the two boss slots)', rowSyms: ['DATA_17C9D8', 'DATA_17C9DE', 'DATA_17C9E4'] }
];

export interface WorldMapIconCanvas {
  world: number;
  name: 'marker' | 'castle';
  rgba: Uint8Array;
  width: number;
  height: number;
  units: (IconUnit | null)[];
  paletteRowsUsed: number[];
  /** Every cell maps to a map gfx file AND slices back byte-exact → safe to edit. */
  faithful: boolean;
}

/** Decode + palette context for one world's overworld scene — build once per world. */
export interface WorldMapIconContext {
  rom: Uint8Array;
  symbols: SymbolMap;
  world: number;
  vram: Uint8Array;
  cgram: Uint8Array;
  manifest: GfxFileEntry[];
  tintRow: number;
  palettes: (Uint32Array | undefined)[];
}

/** Build a world's overworld decode context (its map VRAM + CGRAM + manifest). */
export function buildWorldMapIconContext(rom: Uint8Array, symbols: SymbolMap, world: number): WorldMapIconContext {
  const vram = new Uint8Array(0x10000);
  const manifest: GfxFileEntry[] = [];
  loadSceneGfx(rom, symbols, mapGfx(rom, symbols, world), vram, manifest);
  const cgram = new Uint8Array(512);
  loadScenePalettes(rom, symbols, mapPalette(rom, symbols, world), cgram);
  return { rom, symbols, world, vram, cgram, manifest, tintRow: mapTintRow(rom, symbols, world), palettes: new Array(8) };
}

/** BG palette row `row` (0..7) as ARGB, opaque index 0 (BG composites index 0 as a
 *  real colour) — cached per context. */
function iconPalFor(ctx: WorldMapIconContext, row: number): Uint32Array {
  let p = ctx.palettes[row];
  if (!p) {
    p = buildPaletteRow(ctx.cgram, row, false);
    ctx.palettes[row] = p;
  }
  return p;
}

/** Map a BG1-tile VRAM byte offset → its map gfx file + file-relative tile. */
function iconFileForVramByte(
  manifest: GfxFileEntry[],
  vramByte: number
): { fileId: number; format: 'lz2' | 'lz16'; fileTile: number } | null {
  for (const e of manifest) {
    if (vramByte >= e.vramByteOffset && vramByte < e.vramByteOffset + e.sizeBytes) {
      return { fileId: e.fileId, format: e.format, fileTile: (vramByte - e.vramByteOffset) / TILE_BYTES_4BPP };
    }
  }
  return null;
}

/** Slice one 8×8 cell back out of the icon canvas (inverse of the blit), base-aware
 *  (a pixel still showing its base colour keeps its base index). Returns 32 bytes. */
function sliceIconCell(
  rgbaU32: Uint32Array,
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
      const destCol = hflip ? 7 - tcol : tcol;
      const destRow = vflip ? 7 - trow : trow;
      const u = rgbaU32[(cellY + destRow) * ICON_PX + (cellX + destCol)]!;
      const bIdx = baseIdx[trow * 8 + tcol]!;
      rawIdx[trow * 8 + tcol] = u === palette[bIdx] ? bIdx : paletteIndexOf(palette, u, 16);
    }
  }
  const out = new Uint8Array(TILE_BYTES_4BPP);
  encode4bppTile(rawIdx, 0, out, 0);
  return out;
}

/** Read an icon shape's 9 tilemap words (row-major) from its Bank17 tables. */
function readIconWords(rom: Uint8Array, symbols: SymbolMap, rowSyms: readonly string[]): number[] {
  const words: number[] = [];
  for (const sym of rowSyms) {
    const pc = symbols.pc(sym);
    for (let c = 0; c < ICON_DIM; c++) words.push(u16le(rom, pc + c * 2));
  }
  return words;
}

/** Assemble one icon shape (`marker`/`castle`) for `ctx`'s world into a 24×24 RGBA
 *  canvas + its per-cell source map. The per-world tint (`ctx.tintRow`) is OR'd into
 *  each cell's palette bits exactly as the cart's icon writer does. */
export function renderWorldMapIcon(ctx: WorldMapIconContext, name: 'marker' | 'castle'): WorldMapIconCanvas | null {
  const def = ICON_DEFS.find((d) => d.name === name);
  if (!def) return null;
  const words = readIconWords(ctx.rom, ctx.symbols, def.rowSyms);
  const rgba = new Uint8Array(ICON_PX * ICON_PX * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, ICON_PX * ICON_PX);
  const indices = new Uint8Array(64);
  const units: (IconUnit | null)[] = [];
  const rowsUsed = new Set<number>();
  let faithful = true;
  for (let r = 0; r < ICON_DIM; r++) {
    for (let c = 0; c < ICON_DIM; c++) {
      const word = words[r * ICON_DIM + c]!;
      const char = word & 0x3ff;
      const hflip = (word & 0x4000) !== 0;
      const vflip = (word & 0x8000) !== 0;
      // Palette bits: the base word's (10-12) OR'd with the per-world tint — a
      // bit-level OR within the 3-bit field, i.e. the engine's `ORA mask`.
      const paletteRow = (((word >> 10) & 0x07) | ctx.tintRow) & 0x07;
      const cellX = c * TILE_PX;
      const cellY = r * TILE_PX;
      rowsUsed.add(paletteRow);
      const vramByte = (MAP_BG1_CHAR_ADDR + char * TILE_BYTES_4BPP) & 0xffff;
      const palette = iconPalFor(ctx, paletteRow);
      if (vramByte + TILE_BYTES_4BPP <= ctx.vram.length) {
        decode4bppTile(ctx.vram, vramByte, hflip, vflip, indices, 0);
        for (let y = 0; y < TILE_PX; y++) {
          for (let x = 0; x < TILE_PX; x++) {
            u32[(cellY + y) * ICON_PX + (cellX + x)] = palette[indices[y * 8 + x]!]!;
          }
        }
      }
      const map = iconFileForVramByte(ctx.manifest, vramByte);
      if (!map) { units.push(null); faithful = false; continue; }
      units.push({
        fileId: map.fileId, format: map.format, fileTile: map.fileTile,
        baseBytes: ctx.vram.subarray(vramByte, vramByte + TILE_BYTES_4BPP),
        cellX, cellY, hflip, vflip, paletteRow
      });
    }
  }
  if (faithful) {
    outer: for (const u of units) {
      if (!u) continue;
      const sliced = sliceIconCell(u32, u.cellX, u.cellY, u.hflip, u.vflip, iconPalFor(ctx, u.paletteRow), u.baseBytes);
      for (let k = 0; k < TILE_BYTES_4BPP; k++) if (sliced[k] !== u.baseBytes[k]) { faithful = false; break outer; }
    }
  }
  return { world: ctx.world, name, rgba, width: ICON_PX, height: ICON_PX, units, paletteRowsUsed: [...rowsUsed].sort((a, b) => a - b), faithful };
}

/** Diff an edited icon canvas vs its base → the changed BG1 sheet tiles. A
 *  `conflict` is two cells writing the same `(fileId, fileTile)` different bytes
 *  (a tile reused within the icon, edited inconsistently — last write wins). */
export function diffWorldMapIconTiles(
  ctx: WorldMapIconContext,
  canvas: WorldMapIconCanvas,
  editedRgba: Uint8Array
): { edits: IconTileEdit[]; conflicts: number } {
  const editedU32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, canvas.width * canvas.height);
  const byTile = new Map<string, Uint8Array>();
  let conflicts = 0;
  for (const u of canvas.units) {
    if (!u) continue;
    const sliced = sliceIconCell(editedU32, u.cellX, u.cellY, u.hflip, u.vflip, iconPalFor(ctx, u.paletteRow), u.baseBytes);
    let changed = false;
    for (let k = 0; k < TILE_BYTES_4BPP; k++) if (sliced[k] !== u.baseBytes[k]) { changed = true; break; }
    if (!changed) continue;
    const key = `${u.format}/${u.fileId}/${u.fileTile}`;
    const prev = byTile.get(key);
    if (prev) { for (let k = 0; k < TILE_BYTES_4BPP; k++) if (prev[k] !== sliced[k]) { conflicts++; break; } }
    byTile.set(key, sliced);
  }
  const edits: IconTileEdit[] = [];
  for (const [key, bytes] of byTile) {
    const [format, fileId, fileTile] = key.split('/');
    edits.push({ fileId: Number(fileId), format: format as 'lz2' | 'lz16', fileTile: Number(fileTile), bytes });
  }
  return { edits, conflicts };
}

/** Encode an icon canvas to a PNG: the 24×24 icon (opaque) + a self-describing
 *  BG-palette swatch column per used row (full 16-colour, opaque), to the right.
 *  Import reads only the top-left `width×height`. */
export function worldMapIconPng(ctx: WorldMapIconContext, canvas: WorldMapIconCanvas): Uint8Array {
  const rows = canvas.paletteRowsUsed;
  const swatchW = rows.length * TILE_PX;
  const width = canvas.width + swatchW;
  const height = Math.max(canvas.height, rows.length ? 16 * TILE_PX : 0);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < canvas.height; y++) {
    rgba.set(canvas.rgba.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4), y * width * 4);
  }
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  rows.forEach((row, ri) => {
    const palette = iconPalFor(ctx, row);
    const x0 = canvas.width + ri * TILE_PX;
    for (let i = 0; i < 16; i++) {
      const color = palette[i]!;
      for (let dy = 0; dy < TILE_PX; dy++) for (let dx = 0; dx < TILE_PX; dx++) u32[(i * TILE_PX + dy) * width + (x0 + dx)] = color;
    }
  });
  const image: ImageData = { width, height, rgba };
  return new Uint8Array(encodePng(image));
}

/** The assembled icon as a "single image with palette" `.aseprite` (no tilemap): the
 *  24×24 indexed image coloured in its used BG rows (the same colours the PNG swatch shows).
 *  Import flattens it back to the canvas RGBA → `diffWorldMapIconTiles`, like the PNG. */
export function worldMapIconAseprite(ctx: WorldMapIconContext, canvas: WorldMapIconCanvas): Uint8Array {
  const pal: number[] = [];
  for (const row of canvas.paletteRowsUsed) { const rp = iconPalFor(ctx, row); for (let i = 0; i < 16; i++) pal.push(rp[i]!); }
  return imageAseprite({ rgba: canvas.rgba, width: canvas.width, height: canvas.height, palette: pal, index0Transparent: false, layerName: `icon-${canvas.name}` });
}

/** One assembled level-slot icon PNG (per world × shape), shaped for the manifest. */
export interface WorldMapIconPng {
  /** Relative path, e.g. `screens/map/world-0/icon-marker.png`. */
  file: string;
  description: string;
  world: number;
  name: 'marker' | 'castle';
  faithful: boolean;
  width: number;
  height: number;
  png: Uint8Array;
  /** The same icon as a single-image `.aseprite` (built only when `aseprite` is requested). */
  aseprite?: Uint8Array;
}

/** Export the overworld's level-slot icons (marker + castle) for every world as
 *  assembled, editable PNGs. Pixels are world-invariant (only the tint differs), so
 *  each world's copy shows its tint; edits to any one slice back to the SAME shared
 *  `$74/$75` tiles (the import reports the cross-world propagation). */
export function exportWorldMapIcons(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean } = {}): WorldMapIconPng[] {
  const out: WorldMapIconPng[] = [];
  for (let world = 0; world < WORLD_COUNT; world++) {
    const ctx = buildWorldMapIconContext(rom, symbols, world);
    for (const def of ICON_DEFS) {
      const canvas = renderWorldMapIcon(ctx, def.name);
      if (!canvas) continue;
      out.push({
        file: `screens/map/world-${world}/icon-${def.name}.png`,
        description: `map level-slot icon — ${def.label} (world ${world} tint; shared tiles across worlds)`,
        world,
        name: def.name,
        faithful: canvas.faithful,
        width: canvas.width,
        height: canvas.height,
        png: worldMapIconPng(ctx, canvas),
        aseprite: opts.aseprite && canvas.faithful ? worldMapIconAseprite(ctx, canvas) : undefined
      });
    }
  }
  return out;
}
