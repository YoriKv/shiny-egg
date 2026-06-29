// Title island SCENERY — the GSU-billboarded 3D decorations (flags/mountains/castles/
// trees) as a raw 4bpp atlas; edits slice back to DATA_560000.bin. Split out of
// screen-gfx.ts; shares the scene core (titleVariant + tile geometry).

import { loadScenePalettes } from './load-palettes.ts';
import { buildPaletteRow, paletteIndexOf } from './color.ts';
import { encodePng } from './png.ts';
import { type SymbolMap } from './symbol-map.ts';
import { imageAseprite, imagePaletteOffsets } from './gfx-aseprite.ts';
import { TILE_PX, titleVariant } from './screen-scene.ts';

// ===========================================================================
// TITLE ISLAND SCENERY (GSU-rendered 3D decorations) — the editable view of the
// rotating-island ornaments (Yoshi flags, snow-capped mountains, castles/towers,
// trees, bushes, clouds, the explosion) that the SuperFX billboards in 3D on top
// of the Mode-7 island (the flat landmass is `exportTitleIsland`; these are the
// "3D sprites on top"). Solved statically: the title tick `CODE_gm_fade_to_title_screen`
// runs the GSU renderer `FXCODE_08C7CA`, which per output pixel computes a rotated
// source coordinate then samples the source texture `DATA_560000` with `GETB : AND
// #15 : PLOT` — i.e. the source is a FLAT bitmap, 1 BYTE PER PIXEL, only the LOW
// NIBBLE used (4bpp, 16 colors, index 0 transparent/skipped). The high nibble is
// unused by the renderer (preserved on round-trip). The 16 colors are the title
// scene palette's OBJ row 7 (CGRAM row 15, sourced from `DATA_5FCC2E` — verified
// byte-exact vs a live title CGRAM capture).
//
// The bitmap is 256 wide. The first THREE 32px rows (`0x0000..0x6000`) are the
// island scenery; the 4th row (`0x6000..0x8000`, referenced by boss/sprite code as
// `FXDATA_560000+$6041/$6061/$60C1`) is Mode-7 boss pieces, NOT scenery, so the
// export stops at `0x6000` (256×96).
//
// SCOPE: this exports the decoration ART (the editable pixel source). The 3D
// position/scale/rotation of each piece is computed by the GSU per frame from the
// island angle, so it's NOT reconstructable here and NOT editable via this view —
// editing a piece repaints it wherever the GSU billboards it. Edits write back to
// `DATA_560000.bin` (a fixed-size incbin'd blob) via `saveRawChrEdit`, no layout
// move. The title palette shimmers in-game, so the swatch is one frame; editing
// pixel INDICES is byte-safe regardless.

const SCENERY_SRC_SYM = 'DATA_560000'; // FXDATA_560000 incbin → Graphics/SuperFX/DATA_560000.bin
/** Overlay target for scenery edits (relative to `assets/yi`, for `saveRawChrEdit`). */
export const SCENERY_BIN_FILE = 'Graphics/SuperFX/DATA_560000.bin';
const SCENERY_W = 256;
const SCENERY_H = 96; // rows 1-3 only; row 4 (0x6000+) is boss Mode-7 pieces
const SCENERY_BYTES = SCENERY_W * SCENERY_H; // 0x6000 (1 byte/pixel)
const SCENERY_PALETTE_ROW = 15; // OBJ palette 7 — the scenery colors
const SCENERY_COLORS = 16;

/** Decode + palette context for the title scenery (build once). `base` is the
 *  `SCENERY_BYTES` source bytes (1 byte/px; low nibble = color, high nibble unused);
 *  `palette` is 16 ARGB (index 0 transparent). */
export interface TitleSceneryContext {
  rom: Uint8Array;
  symbols: SymbolMap;
  base: Uint8Array;
  palette: Uint32Array;
  cgram: Uint8Array;
  /** CGRAM color index → master-palette-blob byte-offset (`-1` = no blob source) — lets a
   *  scenery palette-color edit (OBJ row 7, CGRAM 240-255) round-trip to the blob. */
  provenance: Int32Array;
}

export function buildTitleSceneryContext(rom: Uint8Array, symbols: SymbolMap): TitleSceneryContext {
  const srcPC = symbols.pc(SCENERY_SRC_SYM);
  const base = rom.slice(srcPC, srcPC + SCENERY_BYTES);
  const cgram = new Uint8Array(512);
  const provenance = new Int32Array(256); // loadScenePalettes fills it (-1 = no blob source)
  loadScenePalettes(rom, symbols, titleVariant(rom, symbols).palette, cgram, provenance);
  const palette = buildPaletteRow(cgram, SCENERY_PALETTE_ROW, true, 'expand', SCENERY_COLORS); // index 0 transparent
  return { rom, symbols, base, palette, cgram, provenance };
}

export interface TitleSceneryCanvas {
  rgba: Uint8Array;
  width: number;
  height: number;
}

/** Render the scenery atlas to a 256×96 RGBA canvas (index 0 → transparent). */
export function renderTitleScenery(ctx: TitleSceneryContext): TitleSceneryCanvas {
  const width = SCENERY_W, height = SCENERY_H;
  const rgba = new Uint8Array(width * height * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  for (let i = 0; i < SCENERY_BYTES; i++) u32[i] = ctx.palette[ctx.base[i]! & 0x0f]!;
  return { rgba, width, height };
}

/** Diff an edited scenery canvas vs its base → the full re-packed source region
 *  (high nibble preserved) + the changed-pixel count. Base-aware: a pixel still
 *  showing its base color keeps its base nibble. `changed === 0` ⇒ no edit. */
export function diffTitleScenery(
  ctx: TitleSceneryContext,
  editedRgba: Uint8Array
): { region: Uint8Array; changed: number } {
  const eu32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, SCENERY_W * SCENERY_H);
  const region = ctx.base.slice();
  let changed = 0;
  for (let i = 0; i < SCENERY_BYTES; i++) {
    const bIdx = ctx.base[i]! & 0x0f;
    const col = eu32[i]!;
    const idx = col === ctx.palette[bIdx] ? bIdx : paletteIndexOf(ctx.palette, col, SCENERY_COLORS);
    if (idx !== bIdx) { region[i] = (ctx.base[i]! & 0xf0) | idx; changed++; }
  }
  return { region, changed };
}

/** Encode the scenery canvas to a PNG: the 256×96 atlas (index 0 transparent) + a
 *  16-color swatch column (opaque, so color 0 is visible). Import reads only the
 *  top-left `width×height`. */
export function titleSceneryPng(ctx: TitleSceneryContext, canvas: TitleSceneryCanvas): Uint8Array {
  const width = canvas.width + TILE_PX;
  const height = Math.max(canvas.height, SCENERY_COLORS * TILE_PX);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < canvas.height; y++) rgba.set(canvas.rgba.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4), y * width * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  // Swatch: opaque (force alpha) so the transparent color 0 is still visible.
  for (let i = 0; i < SCENERY_COLORS; i++) {
    const c = (ctx.palette[i]! & 0x00ffffff) | 0xff000000;
    for (let dy = 0; dy < TILE_PX; dy++) for (let dx = 0; dx < TILE_PX; dx++) u32[(i * TILE_PX + dy) * width + (canvas.width + dx)] = c;
  }
  return new Uint8Array(encodePng({ width, height, rgba }));
}

/** The scenery atlas as a single-image (no-tilemap) `.aseprite`: the 256×96 indexed
 *  image in its 16-color row 7 palette (index 0 transparent). Import flattens it back
 *  → `diffTitleScenery`, like the PNG. */
export function titleSceneryAseprite(ctx: TitleSceneryContext, canvas: TitleSceneryCanvas): { bytes: Uint8Array; paletteOffsets: number[] } {
  const bytes = imageAseprite({ rgba: canvas.rgba, width: canvas.width, height: canvas.height, palette: ctx.palette, index0Transparent: true, layerName: 'scenery' });
  // Color write-back map — the SAME single row 7 / 16-color / index-0-transparent palette.
  const paletteOffsets = imagePaletteOffsets({ provenance: ctx.provenance, rows: [SCENERY_PALETTE_ROW], index0Transparent: true, colorsPerRow: SCENERY_COLORS });
  return { bytes, paletteOffsets };
}

/** One assembled title-scenery PNG, shaped for the manifest. */
export interface TitleSceneryPng {
  /** Relative path: `screens/title/scenery.png`. */
  file: string;
  description: string;
  width: number;
  height: number;
  png: Uint8Array;
  /** The same atlas as a single-image `.aseprite` (built only when requested). */
  aseprite?: Uint8Array;
  /** Per-`.aseprite`-palette-entry master-blob byte-offset (`-1` = transparent/non-blob) —
   *  editing the embedded palette writes those colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[];
}

/** Export the title island's 3D decoration art (the GSU-billboarded scenery) as an
 *  editable PNG (or a single-image `.aseprite` when `aseprite`). Edits slice back to
 *  `DATA_560000.bin` (low nibble = color, high nibble preserved) via saveRawChrEdit. */
export function exportTitleScenery(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean } = {}): TitleSceneryPng {
  const ctx = buildTitleSceneryContext(rom, symbols);
  const canvas = renderTitleScenery(ctx);
  const ase = opts.aseprite ? titleSceneryAseprite(ctx, canvas) : undefined;
  return {
    file: 'screens/title/scenery.png',
    description:
      'title island 3D scenery (GSU-billboarded decorations: flags, mountains, castles, trees, clouds). Raw 4bpp source atlas (256×96, 1 byte/px low-nibble) from DATA_560000.bin; the GSU positions/scales/rotates each piece, so this edits the ART only. Editing the embedded palette writes those colors back to the master palette blob.',
    width: canvas.width,
    height: canvas.height,
    png: titleSceneryPng(ctx, canvas),
    aseprite: ase?.bytes,
    paletteOffsets: ase?.paletteOffsets
  };
}
