// Screen-graphics SCENE core — the shared infrastructure for the screen exports:
// the boot/title/storybook/overworld-map CHAR-SHEET export (exportScreenGfxPngs) +
// the title-logo assembled view, plus the scene descriptors, per-world map helpers,
// variant builders and tile/render helpers the icon/island/scenery sections reuse.
// The peripheral assembled views live in screen-world-map-icons.ts /
// screen-title-island.ts / screen-title-scenery.ts; screen-gfx.ts barrels them all.
//
// (Was the monolithic screen-gfx.ts.) Original header:
// System-screen graphics export — the boot ("Nintendo Presents"), title (rotating
// island) and overworld-map screens, as editable color-indexed PNGs (the tile grid,
// its palette row in the PLTE), round-tripping through the SAME `saveGfxEdit` path as the per-level gfx
// files (a screen file and a level file with the same id ARE the same compressed
// blob — `DATA_lz{2,16}_compressed_gfx_ptrs`).
//
// These screens are loaded by the SAME `scene_gfx_layout` / `scene_palette_layout`
// interpreters as levels, but the game-mode handlers enter them at a different
// program offset with the DP file-id / palette-pointer slots set directly (see
// `loadSceneGfx` / `loadScenePalettes`). The three descriptors below mirror the
// cart's `CODE_load_*_gfx` + `CODE_load_*_palettes` specialisations exactly:
//
//   boot  — gm$00 `CODE_gm00_ninpresents_prep`: gfx Y=$68 (literal-only),
//           palettes X=$40 (`CODE_00BB05` → `CODE_load_palettes`), scene-regs $02.
//   title — `CODE_gm_load_title_screen`: gfx via `CODE_load_overworld_gfx`
//           (Y=$4F, DP $10=$1F on a NORMAL boot — see `titleVariant`; the cart
//           defaults $68 but swaps in $1F unless the final-world/high-score state
//           is set), palettes via `CODE_00BAEA` (X=$26, DP $10/$12/$14 from
//           `DATA_00BAE2`/`DATA_00BAE6`), scene-regs $00.
//   map   — gm$20 per-world: gfx `CODE_load_world_map_gfx` (Y=$A2, DP slots from
//           `DATA_00B3F4`/`DATA_00B409` per world), palettes
//           `CODE_load_world_map_palettes` (X=$6E, DP slots from
//           `DATA_00BB0B`/`DATA_00BB17` per world), scene-regs $28.
//
// **Why bpp/row is a small per-screen rule, not the level classifier.** The level
// `inferRenderParams` keys on `dpSlot` semantics + a mode-1 char/tilemap layout.
// Screens reuse the DP slots for unrelated files (the map's DP $10..$1C are two
// BG1 tilesets + $74/$75/$4C + eight spritesets), and the title runs in BG mode 0
// (all BG layers 2bpp). So the per-screen bpp/row is fixed by the scene-layout
// ENTRY POSITION (world-invariant — the map's $A2 program is the same for every
// world, only the resolved file ids differ), verified visually:
//   boot  — the one font file is 4bpp OBJ → sprite palette row 8.
//   title — a composited Mode-0(top)/Mode-7(bottom) scene (per-scanline BGMODE
//           split). Mode-0 CHR: lz2 $1F = BG char (2bpp); $1D = the per-tile logo
//           char (logo section); lz16 < $8000 ($74, file-select/score font) = BG
//           (4bpp row 0); lz16 ≥ $8000 ($73, decorative OBJ) = sprite row 8. The
//           Mode-7 floating island/sea is exported by `exportTitleIsland` (its char
//           is $B1, CPC-packed — see the island section); $B1 is skipped by the
//           generic classifier.
//   map   — see `research/graphics-editing/world-map-screens.md` (ground-truth
//           captured). What this exporter currently covers is the gm$22 LEVEL-SELECT
//           view (BG Mode 1, scene-register row $28: TM=$17 = BG1+BG2+BG3+OBJ on the
//           MAIN screen, TS=$00, CGADSUB=$00 ⇒ **NO color math**). Its two visible
//           BG layers (verified against the per-world captures):
//             • **BG1 = the per-world level-select panel** (level numbers, boxes,
//               castle, SCORE) + the level-slot icons. Tilemap $3800 (32×32,
//               per-world), char $4000 (the `$74`/`$75` files at VRAM $7000/$7800 +
//               `$4C` at $6000, 4bpp). Tinted per world: the engine ORs `DATA_17C9EA`
//               (mask>>10: w0→3,1→4,2→5,3→0,4→1,5→2) into its tilemap words, so the
//               panel/icon tiles draw across rows 0/3/6/7.
//             • **BG3 = the decorative back layer** under the panel (the tan
//               ground + trees). Tilemap $2800 (64×32), char $2000 (the `$56` file,
//               2bpp), palette **row 0**. **World-invariant** (identical tilemap AND
//               char in all 6 worlds — only the palette tint differs). NOTE: this is
//               the menu backdrop, NOT the per-world overworld map (see below).
//             • **BG2 is a DEAD layer** — tilemap+char byte-identical to BG1, and
//               with color math off it sits fully behind BG1 (every pixel covered),
//               so it contributes nothing. (The old "second pass to push >16 colors"
//               note was wrong — the color spread is BG1's per-tile palette rows.)
//           Per exported file: lz16 `$74`/`$75` (BG1 PANEL char, NOT sprites) →
//           per-tile tint rows; lz2 `$56` (BG3 backdrop char at VRAM $2000) → row 0;
//           lz16 at VRAM ≥ $8000 (OBJ markers — cursor/HUD chrome) → sprite row 8;
//           the $2800 file (`$7E`) is the BG3 decorative-ground TILEMAP → skipped.
//           **NOT YET EXPORTED — the per-world OVERWORLD MAP itself** (the terrain
//           Yoshi paths across: clouds, hills, the dotted level path + markers,
//           forts/castles). It DOES change per world and has TWO halves per world
//           (levels 1-4 vs 5-8). Decode (cracked + visually validated against the
//           captures — see `research/graphics-editing/world-map-screens.md`):
//             • The map is a **BG1 TILEMAP**, NOT a char sheet and NOT Mode-7. The
//               `DATA_00B3F4` pairs (w0 = `$7c`/`$7d`, w1 = `$7f`/`$80`, … — index by
//               `world*2`, NOT `world`) are LZ2-compressed **4096-byte tilemaps**
//               (2048 BG words = a 64×32 screen-block layout). Half 0 = levels 1-4,
//               half 1 = levels 5-8.
//             • Its CHAR tiles are the COMMON `$74`/`$75`/`$4C` files (VRAM
//               $6000-$7FFF, char base $4000, 4bpp) — the SAME tiles the level-select
//               panel uses; the per-world difference is purely the tilemap + palette.
//             • Composited over the BG3 decorative ground (`$56` char + `$7E`
//               tilemap, world-invariant).
//           gm$20 stages each half to VRAM $0000/$1000; `CODE_17CDCF`/`CODE_17CE11`
//           re-stream them (state $08/$09 → half0, $0b → half1). The level-select
//           capture never SHOWS the map (its BG1 tilemap is the panel), which is why
//           an earlier analysis wrongly called these files "never displayed".
//           **TODO:** export it as a per-world×half tilemap-placement surface (the
//           tilemap-placement-import.md pattern) → round-trips to `$7c`/`$7d`; pixels
//           edit via the shared `$74`/`$75`/`$4C` char. NB `mapGfx` below currently
//           mis-indexes `DATA_00B3F4` (uses `world`, not `world*2`) — fix before use.
// bpp/row only affect preview legibility + the exported palette — the import is base-aware,
// so an unedited file round-trips byte-exact regardless, and edits map to the
// shown row's colors.

import { loadSceneGfx, type GfxFileEntry, type SceneGfx } from './load-graphics.ts';
import { loadSceneRegsByIndex, type SceneRegs } from './scene-regs.ts';
import { loadScenePalettes, type ScenePalette } from './load-palettes.ts';
import { storybookFileClass, storybookTileRow, type StorybookFileClass } from './storybook-palette-facts.ts';
import { buildPaletteRow, nearestPaletteIndex } from './color.ts';
import { gfxToImage, lz16Layout, lz2Layout, rgbaToRgbInts, type GfxImageLayout } from './gfx-png.ts';
import { canvasIndexedPng, encodeIndexedPng, type ImageData } from './png.ts';
import { decode2bppTile, encode2bppTile } from './tile.ts';
import { u16le, u24le } from './rom-read.ts';
import { type SymbolMap } from './symbol-map.ts';
import { lz2 } from './decompress/index.ts';
import { type PerTilePalette } from './render-gfx-files.ts';
import { tilesAseprite, imageAseprite, tilesetPaletteOffsets, imagePaletteOffsets, type TilesetTile } from './gfx-aseprite.ts';
import { type AsepriteCell, type AsepriteStructural } from './aseprite.ts';

/** Sprite palette CGRAM row (rows 8..15 are the OBJ palettes); the boot font +
 *  every OBJ sheet previews against the first one. */
const SPRITE_PALETTE_ROW = 8;
/** YI's single BG3 (2bpp) tileset on the world map decompresses to VRAM $2000. */
const MAP_BG3_VRAM = 0x2000;
/** The map file at VRAM $2800 (`$7E`) lands in the BG3 TILEMAP region (the runtime
 *  world-fold machine overwrites it) — it's tilemap data, not a char sheet, so the
 *  classifier skips it. */
const MAP_BG3_TILEMAP_VRAM = 0x2800;
/** Map OBJ-marker char (Yoshi/stork, cursor, HUD border) loads at VRAM $8000+; an
 *  lz16 file BELOW that ($74/$75 at $7000/$7800) is BG1 terrain char, not a sprite. */
const MAP_OBJ_VRAM = 0x8000;
/** Overworld BG1 char base (VRAM bytes) — scene-register row $28 (`BG12NBA=$22`).
 *  A char# resolves to VRAM as `(MAP_BG1_CHAR_ADDR + char*32) & 0xFFFF`. */
export const MAP_BG1_CHAR_ADDR = 0x4000;

/** Tile geometry shared across every screen export (8×8 px tiles, 32-byte 4bpp).
 *  Defined here (not in a section) because the base export + the icon/island/
 *  scenery sections all reference them. */
export const TILE_PX = 8;
export const TILE_BYTES_4BPP = 32;

/** One 8×8 cell of an assembled icon/logo block → its source gfx-file tile + canvas
 *  cell (the `saveGfxEdit` target); `null` in a canvas's `units` ⇒ that cell's tile
 *  isn't in a loaded gfx file (preview). Shared by the world-map icon AND title-logo
 *  assembled views. */
export interface IconUnit {
  fileId: number;
  format: 'lz2' | 'lz16';
  fileTile: number;
  baseBytes: Uint8Array;
  cellX: number;
  cellY: number;
  hflip: boolean;
  vflip: boolean;
  paletteRow: number;
}

/** A changed 8×8 gfx-file tile from an icon/logo edit, ready for `saveGfxEdit`. */
export interface IconTileEdit {
  fileId: number;
  format: 'lz2' | 'lz16';
  fileTile: number;
  bytes: Uint8Array;
}

/** A tile-region crop within a file's 16-wide tile grid (col `x`, row `y`,
 *  `w`×`h` tiles). The boot screen's only visible graphic is the "Nintendo
 *  Presents" logo in the top-left of the shared global sprite sheet 0x72; the
 *  rest of that sheet is in-game HUD/sprites the boot never shows. Exporting the
 *  crop isolates the logo for editing; the import maps edits back into the full
 *  file (only the cropped tiles are editable). */
export interface TileRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Boot logo crop — the boot screen's only piece of file 0x72 is its logo/copyright
 *  sprite: the 4 OBJ cels seeded from `DATA_ninpresents_gsu_table` (tiles 0,2,4,6).
 *  Each cel is a 16×16 OBJ sprite = tiles {N, N+1, N+16, N+17}, so the four together
 *  cover tiles 0–7 (row 0) + 16–23 (row 1) = cols 0..7, rows 0..1. (Tile col 8
 *  onward in those rows is the in-game HUD "PLAYER" box, not the boot logo — an
 *  earlier w=9 crop wrongly included its first column.) The GSU-rasterized warning
 *  TEXT is a separate piece (glyph shapes the SuperFX plots to a scratch bitmap,
 *  not displayed from 0x72 tile positions), so it isn't part of this crop. */
const BOOT_LOGO_REGION: TileRegion = { x: 0, y: 0, w: 8, h: 2 };

/** One screen gfx file rendered to an editable PNG. Shaped to slot straight into
 *  the gfx-manifest `entries` list (so the existing import loop handles it). */
export interface ScreenGfxPng {
  /** Relative path under the export dir (e.g. `screens/map/world-0/f7c.png`). */
  file: string;
  /** One-line "what's in this PNG" for the manifest. */
  description: string;
  format: 'lz2' | 'lz16';
  fileId: number;
  bpp: 2 | 4;
  sizeBytes: number;
  /** lz16 tile-rows (`sizeBytes / 512`); undefined for lz2. `sizeBytes`/`rowCount`
   *  always describe the FULL file (the import decodes + re-saves the whole blob),
   *  even when `region` exports only a sub-grid. */
  rowCount?: number;
  /** SNES address of the source blob (for reference). */
  addr: number;
  index0Transparent: boolean;
  /** When set, the PNG is only this tile-region of the file (e.g. the boot logo);
   *  import maps edits back into the full file by these coords. */
  region?: TileRegion;
  /** The CGRAM group this file's flat preview renders in (16-color rows for 4bpp,
   *  4-color groups for 2bpp). Display metadata (the YY-CHR export's row badge);
   *  superseded by `perTilePalette` when present. */
  paletteRow: number;
  /** The owning screen's full 512-byte CGRAM (BGR-15 LE) — the co-loaded palette
   *  state the YY-CHR export ships raw. Display-only, never data. */
  cgram: Uint8Array;
  /** Flat-map BG files (`f74`/`f75`): per-tile palette fidelity — each tile is
   *  colored in the palette row it actually draws with (the map BG spans rows
   *  0/3/6/7, not one tint). Import decodes per-tile via this (the same mechanism
   *  the level BG2/BG3 export uses). */
  perTilePalette?: PerTilePalette;
  /** The single palette the sheet was exported (and indexed) with, as RGB ints —
   *  absent when `perTilePalette` supplies it instead. Manifest-carried so the import
   *  can color-match a PNG the artist saved without its palette. */
  palette?: number[];
  png: Uint8Array;
  /** A cropped screen REGION (e.g. the boot logo) as a single-image (no-tilemap)
   *  `.aseprite` — built only when requested. Import slices it via diffGfxFileAseprite
   *  over the region's flat tile grid (the `region` flag routes it there). */
  aseprite?: Uint8Array;
  /** Region `.aseprite` only: per-palette-entry master-blob byte-offset (`-1` = transparent/
   *  non-blob) — editing the embedded palette writes those colors back to the blob. */
  paletteOffsets?: number[];
}

/** Per-file render parameters, fixed by the scene-layout entry (see file header). */
interface FileClass {
  bpp: 2 | 4;
  /** CGRAM palette row to color the preview (and index the PNG against). */
  paletteRow: number;
  /** Export only this tile-region of the file (see {@link TileRegion}). */
  region?: TileRegion;
  /** Level-select PANEL char file (`f74`/`f75` — BG1, NOT the overworld map): render
   *  PER-TILE (rows 0/3/6/7 via the per-world tint), and SKIP the file entirely if no
   *  tile is referenced by the panel tilemap. (`f7C`/`f7D` are the per-world Mode-7
   *  OVERWORLD MAP halves, not panel char — they fall here too but get skipped; see
   *  the file header's "NOT YET EXPORTED" note.) */
  mapBg?: boolean;
  /** Storybook (gm$05) char file: render PER-TILE from the captured palette facts
   *  (storybook-palette-facts.ts). The display class fixes which CGRAM half + index-0
   *  transparency the export uses — `bg`/`bg3` (rows 0-7, opaque 0) vs `obj` (the
   *  f8A/f4A sprite sheets: rows 8-15, transparent 0). Per-tile rows resolve from the
   *  facts, not a static tilemap scan (the cutscene is runtime-streamed multi-page). */
  storybookClass?: StorybookFileClass;
}

interface ScreenVariant {
  /** Sub-folder under the screen dir (`''` for single-variant screens, `common`
   *  / `world-N` for the map). Filled in by the map's per-world dedup. */
  group: string;
  gfx: SceneGfx;
  palette: ScenePalette;
}

interface ScreenDescriptor {
  id: 'boot' | 'title' | 'map' | 'storybook';
  /** `scene-mode` byte index for `loadSceneRegsByIndex` (informational; the
   *  bpp/row rule is fixed per entry rather than derived from it). */
  sceneRegsIndex: number;
  /** Classify one gfx file by its scene-layout position. Returns `null` to SKIP a
   *  file that isn't an editable tile sheet (the map's BG3-tilemap blob). */
  classify(entry: GfxFileEntry): FileClass | null;
}

/** Boot ("Nintendo Presents"): loads the shared global sprite sheet 0x72, but only
 *  shows the "Nintendo Presents" logo in its top-left — so the export is cropped to
 *  that {@link BOOT_LOGO_REGION} (the rest of 0x72 is in-game HUD/sprites, exported
 *  by the per-level `sprites/global-f72.png`). */
const BOOT: ScreenDescriptor = {
  id: 'boot',
  sceneRegsIndex: 0x02,
  classify: () => ({ bpp: 4, paletteRow: SPRITE_PALETTE_ROW, region: BOOT_LOGO_REGION })
};

/** Storybook scene-regs index (`CODE_gm05_load_cutscene` does `LDX #$24`) —
 *  informational; the per-tile palette now comes from the captured facts, not a
 *  live scene-register/VRAM scan. */
const STORYBOOK_SCENE_REGS_INDEX = 0x24;

/**
 * Storybook (gm$05 `CODE_gm05_load_cutscene`: gfx Y=$79, palette X=$50 via
 * `CODE_00BB05`, scene-regs $24) — the illustrated opening-story cutscene that auto-
 * plays after boot ("A long, long time ago…" → the stork carrying the twins → Yoshi's
 * Island). (The doc reserves "prologue" for the gm$38 PLAYABLE intro; this is the
 * gm$05 attract storybook.)
 *
 * **Runtime-streamed multi-page — the per-tile palette CANNOT be read statically.**
 * The cutscene streams ~51 story-page tilemaps + OAM at runtime (gm$07 script tick);
 * a static decode only reproduces the initial Nintendo-logo frame, so the story-page
 * char tiles would default to row 0 (wrong palette — and for the OBJ sprite sheets,
 * the wrong HALF of CGRAM). So the per-tile rows come from a CAPTURE (the world-map
 * pattern), baked into `storybook-palette-facts.ts` by the yi-shiny `storybook-render`
 * trace.
 *
 * **Palette BASE (NOT the title-logo case).** The storybook runs in BG **Mode 1**
 * (BG1/BG2 4bpp, BG3 2bpp — vs the title's Mode 0), so it has **no per-BG CGRAM offset**:
 * a BG cell's palette field `P` reads CGRAM[P*colors] directly (BG 4bpp → P*16, BG3
 * 2bpp → P*4), and OBJ palette `P` reads the OBJ half at row `8+P`. That is why each
 * tile is colored at base 0 (BG) / base 8 (OBJ) here — do **not** add a Mode-0-style
 * +offset (the inverse of the title-logo `LOGO_BG2_PALETTE_BASE` fix; that one is BG2
 * in Mode 0, this is not). Verified against the trace's live CGRAM: the settled intro
 * frames are byte-identical to the static palette-$50 load.
 *
 * **Colors are the static palette-$50 load (one frame), not per-page.** The cutscene
 * does NOT just reuse one palette across pages — later story pages STREAM page-specific
 * colors into most BG rows (2-7) and OBJ row 0 as illustrations appear, so the same row
 * shows different colors on different pages. The export colors each tile in its captured
 * dominant row using the cart's own static palette-$50 CGRAM (no captured colors
 * committed, provenance-clean like the world map): faithful for the settled/common palette,
 * but an illustration tile whose row is re-streamed (e.g. f87's rows 2-3, the clouds) shows
 * the settled placeholder colors, not its per-page colors. Editing is INDEX-based and
 * round-trips byte-exact regardless of the shown color (`paletteAnimated`).
 *
 * `classify` keys off the facts: `bg`/`bg3` char sheets (f87/f88, f27) render at BG
 * rows 0-7 with opaque index 0; the `obj` sprite sheets (f8A/f4A, loaded into the OBJ
 * VRAM region $8000+) render at OBJ palette rows 8-15 with transparent index 0. Files
 * absent from the facts are skipped — the tilemap-data files (f73/f74/f75, which sit
 * AT the BG tilemap bases) and f89 (loaded but never referenced across the entire
 * cutscene, the storybook analogue of the world-map fold-only files). */
const STORYBOOK: ScreenDescriptor = {
  id: 'storybook',
  sceneRegsIndex: STORYBOOK_SCENE_REGS_INDEX,
  classify: (e) => {
    const cls = storybookFileClass(e.fileId);
    if (!cls) return null; // tilemap-data (f73/f74/f75) or never-displayed (f89)
    return { bpp: cls === 'bg3' ? 2 : 4, paletteRow: 0, storybookClass: cls };
  }
};

/** The overworld's per-world BG palette "tint" row, from `DATA_17C9EA` (`mask>>10`):
 *  the engine ORs this mask into every map BG tilemap word it stamps, so terrain +
 *  level-icon tiles all draw with it. World 3 = row 0 (untinted); 0/1/2/4/5 = rows
 *  3/4/5/1/2. Verified against a live capture — see
 *  `research/graphics-editing/world-map-screens.md`. */
export function mapTintRow(rom: Uint8Array, symbols: SymbolMap, world: number): number {
  const mask = u16le(rom, symbols.pc('DATA_17C9EA') + world * 2);
  return (mask >> 10) & 0x07;
}

/** Overworld map (BG mode 1) classifier for `tintRow` (this world's tint). Map BG
 *  terrain — lz2, plus lz16 `$74/$75` at VRAM <$8000 (BG1 char, NOT sprites) —
 *  renders 4bpp at `tintRow`; the 2bpp BG3 char at VRAM $2000 → row 0. Two file sets
 *  are dropped (`null`): the `$2800` file (`$7E`, the BG3 tilemap region, not a tile
 *  sheet) and the OBJ-marker set (lz16 ≥ $8000: cursor `$73`, HUD `$8F`, and the
 *  `$8C`/`$95`-`$A0` map markers) — raw OBJ char chrome, not an editable map sheet, so
 *  they're not exported. */
function mapDescriptor(tintRow: number): ScreenDescriptor {
  return {
    id: 'map',
    sceneRegsIndex: 0x28,
    classify: (e) => {
      if (e.vramByteOffset === MAP_BG3_TILEMAP_VRAM) return null; // $7E: BG3 tilemap, not char
      if (e.vramByteOffset === MAP_BG3_VRAM) return { bpp: 2, paletteRow: 0 }; // BG3 decorative-ground char ($56)
      if (e.format === 'lz16' && e.vramByteOffset >= MAP_OBJ_VRAM) return null; // OBJ markers (cursor/HUD/path chrome) — not exported
      // BG1 level-select panel char (f74/f75) — per-tile palette; the renderer SKIPS a
      // file none of whose tiles the panel tilemap references (f7C/f7D = per-world
      // Mode-7 map halves, f4C — see the file header's "NOT YET EXPORTED" note).
      return { bpp: 4, paletteRow: tintRow, mapBg: true };
    }
  };
}

// --- Flat-overworld BG per-tile palette ------------------------------------
// The map's $1C00 BG1 tilemap is RUNTIME-STREAMED (no static cart source), and the
// map BG spans palette rows 0/3/6/7 — NOT one per-world tint (graphicsassets §11.6).
// So per-tile rows come from ground-truth captures of all 6 worlds (generator
// `tmp/gen-wm-tile-rows.ts`, 0 ambiguous): each referenced BG1 char tile either
// FOLLOWS the per-world tint (`DATA_17C9EA`) or uses a FIXED row. A char in NEITHER
// set isn't drawn by the flat map (it's only in the world-change FOLD transition —
// which is Mode-1, a BG scroll/tilemap wipe, NOT Mode-7; graphicsassets.md §11.1),
// so a file with no referenced tile is excluded. See world-map-screens.md.

/** BG1 char tiles drawn with a FIXED palette row (identical in every world). */
const WM_BG_FIXED_ROW: Record<number, number> = {
  // $4000-region HUD/panel decorations (row 6). NOTE: not in any loaded map gfx
  // file (drawn via a separate HUD path) — listed only so the "referenced" set is
  // complete; they never reach an exported sheet.
  0x5a: 6, 0x5b: 6, 0x5c: 6, 0x5d: 6, 0x5e: 6, 0x5f: 6, 0x60: 6, 0x61: 6, 0x62: 6,
  0x70: 6, 0x71: 6, 0x72: 6, 0x73: 6, 0x74: 6, 0x75: 6, 0x76: 6, 0x77: 6, 0x78: 6,
  // f74-region fixed tiles (the rest of f74/f75 follow the tint, below)
  0x180: 3, 0x186: 3, 0x19f: 6, 0x1bf: 0
};
/** BG1 char tiles drawn with the PER-WORLD tint row (`mapTintRow`). */
const WM_BG_TINT_CHARS = new Set<number>([
  0x187, 0x18d, 0x18e, 0x18f, 0x190, 0x191, 0x192, 0x193, 0x194, 0x195, 0x196,
  0x198, 0x199, 0x1a1, 0x1af,
  0x1e0, 0x1e1, 0x1e2, 0x1e3, 0x1e4, 0x1e5, 0x1e6, 0x1e7, 0x1e8, 0x1e9, 0x1ea,
  0x1eb, 0x1ec, 0x1ed, 0x1ee, 0x1ef, 0x1f0, 0x1f1, 0x1f2, 0x1f3, 0x1f4, 0x1f5,
  0x1f6, 0x1f7, 0x1f8, 0x1f9, 0x1fa, 0x1fb
]);

/** The BG1 char# whose 4bpp tile decompresses to VRAM byte `vb` (char base $4000,
 *  10-bit `& 0xFFFF` wrap). Inverse of `(MAP_BG1_CHAR_ADDR + char*32) & 0xFFFF`. */
const mapBgCharOf = (vb: number): number => ((vb - MAP_BG1_CHAR_ADDR) & 0xffff) >>> 5;

/** Palette row a map BG char draws with for `tintRow` (its world): a fixed row, the
 *  per-world tint, or `null` if the flat map never references it. */
function mapBgTileRow(char: number, tintRow: number): number | null {
  if (char in WM_BG_FIXED_ROW) return WM_BG_FIXED_ROW[char]!;
  if (WM_BG_TINT_CHARS.has(char)) return tintRow;
  return null;
}

/** Pack a 16-color CGRAM BG row (index 0 OPAQUE) into RGBA bytes. */
function bgRowRgba(cgram: Uint8Array, row: number): Uint8Array {
  const p = buildPaletteRow(cgram, row, false, 'expand', 16);
  const out = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    const v = p[i]!;
    out[i * 4] = v & 0xff; out[i * 4 + 1] = (v >> 8) & 0xff; out[i * 4 + 2] = (v >> 16) & 0xff; out[i * 4 + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

/**
 * The single-image (no-tilemap) `.aseprite` + color write-back map for a PER-TILE-palette
 * char sheet (storybook `f88` / map-BG `f74-f75` / title-logo `f1D`). The embedded palette is
 * the used CGRAM rows CONCATENATED (per-row blocks) — so every used row's colors are present
 * and editable, while the bare tile grid (swatch dropped) stays colored per-tile (the import
 * re-derives indices per tile via `perTilePalette`, byte-identical to the PNG path). `subRgba`
 * are those rows (RGBA, `colors` each); `cgramRows[k]` is row k's CGRAM row number → its
 * provenance/blob offset (the color write-back map mirrors the per-row-block palette layout,
 * one offset per entry, so a color shared across rows is two independent editable entries).
 */
function perTileSheetAseprite(args: {
  image: ImageData; layout: GfxImageLayout; subRgba: Uint8Array[]; colors: number;
  index0Transparent: boolean; layerName: string; cgramRows: number[]; provenance?: Int32Array;
}): { aseprite: Uint8Array; paletteOffsets?: number[] } {
  const { image, layout, subRgba, colors, index0Transparent, layerName, cgramRows, provenance } = args;
  const gridW = layout.tilesWide * TILE_PX, gridH = layout.tilesTall * TILE_PX;
  const gridRgba = new Uint8Array(gridW * gridH * 4); // bare grid (the .aseprite carries the palette in-file → no swatch)
  for (let y = 0; y < gridH; y++) gridRgba.set(image.rgba.subarray(y * image.width * 4, (y * image.width + gridW) * 4), y * gridW * 4);
  const palU32: number[] = [];
  for (const sp of subRgba) for (let i = 0; i < colors; i++)
    palU32.push((sp[i * 4]! | (sp[i * 4 + 1]! << 8) | (sp[i * 4 + 2]! << 16) | (sp[i * 4 + 3]! << 24)) >>> 0);
  const aseprite = imageAseprite({ rgba: gridRgba, width: gridW, height: gridH, palette: palU32, index0Transparent, layerName });
  // Color write-back: entry k*colors+i ⇒ CGRAM cgramRows[k]*colors+i → provenance. (rowStride
  // = colors: every per-tile row here reads CGRAM at the tight `colors`-stride — see the *Rgba builders.)
  const paletteOffsets = provenance ? imagePaletteOffsets({ provenance, rows: cgramRows, index0Transparent, colorsPerRow: colors }) : undefined;
  return { aseprite, paletteOffsets };
}

/**
 * Render a level-select PANEL char file (`f74`/`f75` — BG1, not the overworld map)
 * PER-TILE: each tile colored in the palette row it actually draws with (rows
 * 0/3/6/7 via `mapBgTileRow`), plus a multi-row reference swatch — exactly the level
 * BG2/BG3 fidelity model, so the existing per-tile-palette import path round-trips it.
 * In `aseprite` mode it also emits a multi-row `.aseprite` whose embedded palette colors
 * round-trip to the master blob. Returns `null` when NO tile is referenced by the panel
 * tilemap (e.g. `f7C`/`f7D`, the per-world Mode-7 map halves, are excluded — see the header).
 */
function renderMapBgFile(
  rom: Uint8Array,
  symbols: SymbolMap,
  vram: Uint8Array,
  cgram: Uint8Array,
  entry: GfxFileEntry,
  tintRow: number,
  file: string,
  description: string,
  opts: { aseprite?: boolean } = {},
  provenance?: Int32Array
): ScreenGfxPng | null {
  const tileCount = Math.floor(entry.sizeBytes / TILE_BYTES_4BPP);
  const rowPerTile: number[] = [];
  const usedRows = new Set<number>();
  let anyReferenced = false;
  for (let t = 0; t < tileCount; t++) {
    const vb = (entry.vramByteOffset + t * TILE_BYTES_4BPP) & 0xffff;
    const row = mapBgTileRow(mapBgCharOf(vb), tintRow);
    if (row !== null) { anyReferenced = true; rowPerTile.push(row); usedRows.add(row); }
    else rowPerTile.push(tintRow); // unreferenced tile in a referenced file → default (base-aware import keeps it exact)
  }
  if (!anyReferenced) return null; // whole file unused by the flat map → skip
  usedRows.add(tintRow); // always expose the tint row
  const exposeRows = [...usedRows].sort((a, b) => a - b);
  const rowIndex = new Map(exposeRows.map((r, i) => [r, i]));
  const subRgba = exposeRows.map((r) => bgRowRgba(cgram, r));
  const subRgb = subRgba.map((rgba) => {
    const rgb: number[] = [];
    for (let i = 0; i < 16; i++) rgb.push((rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!);
    return rgb;
  });
  const tileSub = rowPerTile.map((r) => rowIndex.get(r) ?? 0);
  const tileData = vram.subarray(entry.vramByteOffset, entry.vramByteOffset + entry.sizeBytes);
  const rowCount = entry.format === 'lz16' ? entry.sizeBytes / 512 : undefined;
  const baseLayout = entry.format === 'lz16' ? lz16Layout(rowCount!) : lz2Layout(entry.sizeBytes, 4);
  // One PLTE spanning every exposed row: tile t's pixel v → index tileSub[t]*16 + v.
  const fullPal = new Uint8Array(subRgba.length * 16 * 4);
  subRgba.forEach((sp, i) => fullPal.set(sp, i * 16 * 4));
  const layout = baseLayout;
  const image = gfxToImage(tileData, layout, fullPal, { tileSub: (t) => tileSub[t] ?? 0 });
  const png = encodeIndexedPng(image);
  const ase = opts.aseprite
    ? perTileSheetAseprite({ image, layout, subRgba, colors: 16, index0Transparent: false, layerName: `map-f${entry.fileId.toString(16)}`, cgramRows: exposeRows, provenance })
    : undefined;
  return {
    file,
    description,
    format: entry.format,
    fileId: entry.fileId,
    bpp: 4,
    sizeBytes: entry.sizeBytes,
    rowCount,
    addr: fileAddr(rom, symbols, entry.format, entry.fileId),
    index0Transparent: false, // BG1 index 0 is an opaque color
    paletteRow: exposeRows[0] ?? 0,
    cgram,
    perTilePalette: { tileSub, subPalettes: subRgb, rows: exposeRows, paletteAnimated: false },
    png: new Uint8Array(png),
    aseprite: ase?.aseprite,
    paletteOffsets: ase?.paletteOffsets
  };
}

/** Pack an N-color CGRAM palette row into RGBA bytes. `transparentZero` follows the
 *  layer's index-0 semantics: BG/BG3 composite color 0 as a real (opaque) color, OBJ
 *  sprite tiles composite index 0 transparent. 4bpp → 16 colors; 2bpp BG3 → 4 colors
 *  at the tight 4-color stride. (The Mode-0 title logo is also tight-4-color, but it's
 *  BG2 so its caller offsets the row — see LOGO_BG2_PALETTE_BASE — not handled here.) */
function bgSubRowRgba(cgram: Uint8Array, row: number, colors: number, transparentZero = false): Uint8Array {
  const p = buildPaletteRow(cgram, row, transparentZero, 'expand', colors);
  const out = new Uint8Array(colors * 4);
  for (let i = 0; i < colors; i++) {
    const v = p[i]!;
    out[i * 4] = v & 0xff; out[i * 4 + 1] = (v >> 8) & 0xff; out[i * 4 + 2] = (v >> 16) & 0xff; out[i * 4 + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

/**
 * Render a storybook (gm$05) char file PER-TILE — each tile colored in its captured
 * dominant palette row (`storybook-palette-facts.ts`, from the `storybook-render`
 * trace) using the cart's static palette-$50 CGRAM, plus a multi-row reference swatch.
 * Same per-tile-palette fidelity model as the level BG2/BG3 / map-BG exports, so the
 * existing import path round-trips it byte-exact. `cls.storybookClass` fixes the CGRAM
 * half + transparency: `obj` (f8A/f4A sprite sheets) reads OBJ palette rows 8-15 with
 * transparent index 0; `bg`/`bg3` read BG rows 0-7 with opaque index 0 — all at base 0
 * (BG) / base 8 (OBJ), the Mode-1 mapping with NO per-BG offset (see the STORYBOOK
 * descriptor; this is NOT the Mode-0 title-logo base case). A tile the cutscene never
 * displayed falls back to the file's default row (base-aware import keeps it byte-exact
 * regardless). `paletteAnimated` is set — the scene streams page-specific colors, so the
 * shown colors are the settled palette-$50 frame (illustration tiles on re-streamed rows
 * are representative, not per-page exact); editing INDICES is byte-safe regardless. */
function renderStorybookCharFile(
  rom: Uint8Array,
  symbols: SymbolMap,
  vram: Uint8Array,
  cgram: Uint8Array,
  entry: GfxFileEntry,
  cls: FileClass,
  file: string,
  description: string,
  opts: { aseprite?: boolean } = {},
  provenance?: Int32Array
): ScreenGfxPng {
  const bpp = cls.bpp;
  const transparentZero = cls.storybookClass === 'obj'; // OBJ sprite tiles: index 0 transparent
  const tileBytes = bpp === 4 ? TILE_BYTES_4BPP : TILE_BYTES_2BPP;
  const colors = bpp === 4 ? 16 : 4;
  const tileCount = Math.floor(entry.sizeBytes / tileBytes);
  const rowPerTile: number[] = [];
  const usedRows = new Set<number>();
  for (let t = 0; t < tileCount; t++) {
    const row = storybookTileRow(entry.fileId, t) ?? 0;
    rowPerTile.push(row); usedRows.add(row);
  }
  const exposeRows = [...usedRows].sort((a, b) => a - b);
  const rowIndex = new Map(exposeRows.map((r, i) => [r, i]));
  const tileSub = rowPerTile.map((r) => rowIndex.get(r) ?? 0);
  const subRgba = exposeRows.map((r) => bgSubRowRgba(cgram, r, colors, transparentZero));
  const subRgb = subRgba.map((rgba) => {
    const rgb: number[] = [];
    for (let i = 0; i < colors; i++) rgb.push((rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!);
    return rgb;
  });
  const tileData = vram.subarray(entry.vramByteOffset, entry.vramByteOffset + entry.sizeBytes);
  const rowCount = entry.format === 'lz16' ? entry.sizeBytes / 512 : undefined;
  const baseLayout = entry.format === 'lz16' ? lz16Layout(rowCount!) : lz2Layout(entry.sizeBytes, bpp);
  const fullPal = new Uint8Array(subRgba.length * colors * 4);
  subRgba.forEach((sp, i) => fullPal.set(sp, i * colors * 4));
  const layout = baseLayout;
  const image = gfxToImage(tileData, layout, fullPal, { tileSub: (t) => tileSub[t] ?? 0 });
  const png = encodeIndexedPng(image);
  // Optional single-image `.aseprite`. It carries the (multi-row) palette IN-FILE, so it OMITS
  // the reference swatch the PNG appends to the right — `perTileSheetAseprite` crops the bare
  // tile grid out of the rendered image. The import (decodeAsepriteImage → imageToGfx with the
  // per-tile palette) stays byte-identical to the PNG's; editing the embedded palette rounds-
  // trips to the master blob via paletteOffsets. OBJ sheets keep transparent index 0.
  const ase = opts.aseprite
    ? perTileSheetAseprite({ image, layout, subRgba, colors, index0Transparent: transparentZero, layerName: `storybook-f${entry.fileId.toString(16)}`, cgramRows: exposeRows, provenance })
    : undefined;
  return {
    file,
    description,
    format: entry.format,
    fileId: entry.fileId,
    bpp,
    sizeBytes: entry.sizeBytes,
    rowCount,
    addr: fileAddr(rom, symbols, entry.format, entry.fileId),
    index0Transparent: transparentZero,
    paletteRow: exposeRows[0] ?? 0,
    cgram,
    perTilePalette: { tileSub, subPalettes: subRgb, rows: exposeRows, paletteAnimated: true },
    png: new Uint8Array(png),
    aseprite: ase?.aseprite,
    paletteOffsets: ase?.paletteOffsets
  };
}

export const WORLD_COUNT = 6;

/** Boot scene descriptors (literal-only gfx + palette programs). */
function bootVariant(): ScreenVariant {
  return { group: '', gfx: { startOffset: 0x68, dpSlots: [] }, palette: { startOffset: 0x40, slots: [] } };
}

/** Storybook scene descriptors — both programs are literal-only. */
export function storybookVariant(): ScreenVariant {
  return { group: '', gfx: { startOffset: 0x79, dpSlots: [] }, palette: { startOffset: 0x50, slots: [] } };
}

// ===========================================================================
// STORYBOOK FIRST-SCENE BG3 LAYOUT (f27) — the editable "as the scene renders it"
// view of the gm$05 cutscene's opening page. The other storybook char sheets export
// as raw per-tile grids (renderStorybookCharFile); f27 (the BG3 decorative frame
// border) instead lays its tiles out the way the FIRST scene places them, so the
// user edits the frame in context. The BG twin of the title logo, but the tilemap is
// the LIVE first-scene tilemap (loaded by the gfx bundle into VRAM at the BG3SC base)
// rather than a static cart table — verified byte-identical to the `storybook-render`
// trace's first-scene capture (sb.f0030/f1000).
//
// The storybook is BG **Mode 1** (BG1/BG2 4bpp, BG3 2bpp), so the per-cell palette
// field reads CGRAM at base 0 (BG3, 2bpp, tight 4-color stride) — NOT the Mode-0
// title-logo BG2→CGRAM-32 case. Cells whose char doesn't land in f27 (the frame's
// interior, where BG1/BG2 illustrations show through in-game) are rendered for context
// but are NOT editable (no f27 tile backs them). Edits to f27 cells slice back to the
// $27 char tiles via saveGfxEdit — a shared char ⇒ one edit repaints every cell that
// reuses it (exactly the logo's model).

const F27_FILE_ID = 0x27;
const STORYBOOK_SCENE_BG3_COLORS = 4; // BG3 2bpp sub-palette size

/** Decode + layout context for the storybook first-scene BG3 view (build once). */
export interface StorybookSceneContext {
  rom: Uint8Array;
  symbols: SymbolMap;
  vram: Uint8Array;
  cgram: Uint8Array;
  regs: SceneRegs;
  /** The loaded f27 char file (VRAM offset + size) — the editable tiles. */
  f27: GfxFileEntry;
  palettes: (Uint32Array | undefined)[];
  /** CGRAM color index → master-palette-blob byte-offset (`-1` = no blob source), from the
   *  scene palette load — lets a palette-color edit round-trip to the blob. */
  provenance: Int32Array;
}

/** Build the storybook scene's decode context: the gfx-bundle VRAM (which includes the
 *  first-scene BG3 tilemap at the BG3SC base + the f27 char tiles), the static palette-$50
 *  CGRAM, and the scene-regs ($24 — BG3 tilemap/char bases, mode, SC size). */
export function buildStorybookSceneContext(rom: Uint8Array, symbols: SymbolMap, gfxOverride?: ReadonlyMap<string, Uint8Array>): StorybookSceneContext {
  const vram = new Uint8Array(0x10000);
  const manifest: GfxFileEntry[] = [];
  loadSceneGfx(rom, symbols, storybookVariant().gfx, vram, manifest, gfxOverride);
  const cgram = new Uint8Array(512);
  const provenance = new Int32Array(256);
  loadScenePalettes(rom, symbols, storybookVariant().palette, cgram, provenance);
  const regs = loadSceneRegsByIndex(rom, symbols, STORYBOOK_SCENE_REGS_INDEX);
  const f27 = manifest.find((e) => e.fileId === F27_FILE_ID);
  if (!f27) throw new Error('storybook scene: f27 (BG3 char) not loaded by the gfx bundle');
  return { rom, symbols, vram, cgram, regs, f27, palettes: new Array(8), provenance };
}

/** BG3 2bpp sub-palette `row` (0..7) as ARGB, opaque index 0 (BG composites it) — cached.
 *  Mode-1 BG3: tight 4-color stride at base 0 (no per-BG offset; see the section note). */
function sceneBg3PalFor(ctx: StorybookSceneContext, row: number): Uint32Array {
  let p = ctx.palettes[row];
  if (!p) {
    p = buildPaletteRow(ctx.cgram, row, false, 'expand', STORYBOOK_SCENE_BG3_COLORS, STORYBOOK_SCENE_BG3_COLORS);
    ctx.palettes[row] = p;
  }
  return p;
}

export interface StorybookSceneCanvas {
  rgba: Uint8Array;
  width: number;
  height: number;
  /** Per cell: its f27 source tile (editable) or `null` (frame interior / other-file
   *  char — rendered for context, not editable). */
  units: (IconUnit | null)[];
  paletteRowsUsed: number[];
  cols: number;
  rows: number;
  /** Every f27-backed cell slices back byte-exact → f27 edits round-trip safely. */
  faithful: boolean;
}

/** Assemble the storybook first scene's BG3 tilemap into an RGBA canvas + per-cell
 *  source map. Reads the tilemap straight from VRAM (the gfx bundle staged the first
 *  scene there); each cell is colored in its BG3 2bpp sub-palette and mapped back to
 *  its f27 tile when the char lands in f27. */
export function renderStorybookScene(ctx: StorybookSceneContext): StorybookSceneCanvas {
  const cols = (ctx.regs.bg3ScSize === 1 || ctx.regs.bg3ScSize === 3) ? 64 : 32;
  const rows = (ctx.regs.bg3ScSize === 2 || ctx.regs.bg3ScSize === 3) ? 64 : 32;
  const width = cols * TILE_PX, height = rows * TILE_PX;
  const rgba = new Uint8Array(width * height * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  const indices = new Uint8Array(64);
  const units: (IconUnit | null)[] = [];
  const rowsUsed = new Set<number>();
  let faithful = true;
  for (let i = 0; i < cols * rows; i++) {
    const word = u16le(ctx.vram, ctx.regs.bg3TilemapAddr + i * 2);
    const char = word & 0x3ff;
    const hflip = (word & 0x4000) !== 0;
    const vflip = (word & 0x8000) !== 0;
    const paletteRow = (word >> 10) & 0x07;
    const cellX = (i % cols) * TILE_PX;
    const cellY = ((i / cols) | 0) * TILE_PX;
    rowsUsed.add(paletteRow);
    const vramByte = (ctx.regs.bg3CharAddr + char * TILE_BYTES_2BPP) & 0xffff;
    const palette = sceneBg3PalFor(ctx, paletteRow);
    if (vramByte + TILE_BYTES_2BPP <= ctx.vram.length) {
      decode2bppTile(ctx.vram, vramByte, hflip, vflip, indices, 0);
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) u32[(cellY + y) * width + (cellX + x)] = palette[indices[y * 8 + x]!]!;
      }
    }
    // Editable only when the char lands in f27 (the frame border); other cells (the
    // interior showing BG1/BG2) are preview-only.
    if (vramByte >= ctx.f27.vramByteOffset && vramByte < ctx.f27.vramByteOffset + ctx.f27.sizeBytes) {
      units.push({
        fileId: ctx.f27.fileId, format: ctx.f27.format, fileTile: (vramByte - ctx.f27.vramByteOffset) / TILE_BYTES_2BPP,
        baseBytes: ctx.vram.subarray(vramByte, vramByte + TILE_BYTES_2BPP),
        cellX, cellY, hflip, vflip, paletteRow
      });
    } else {
      units.push(null);
    }
  }
  // Faithful self-check over the EDITABLE (f27) cells only — interior cells have no f27
  // tile, so they don't gate editability.
  outer: for (const u of units) {
    if (!u) continue;
    const sliced = slice2bppCell(u32, width, u.cellX, u.cellY, u.hflip, u.vflip, sceneBg3PalFor(ctx, u.paletteRow), u.baseBytes, STORYBOOK_SCENE_BG3_COLORS);
    for (let k = 0; k < TILE_BYTES_2BPP; k++) if (sliced[k] !== u.baseBytes[k]) { faithful = false; break outer; }
  }
  return { rgba, width, height, units, paletteRowsUsed: [...rowsUsed].sort((a, b) => a - b), cols, rows, faithful };
}

/** Diff an edited scene canvas vs its base → the changed f27 (2bpp) tiles. Only f27
 *  cells are editable; edits to interior (non-f27) cells are ignored. A `conflict` is
 *  two cells writing the same f27 tile different bytes (last write wins). */
export function diffStorybookSceneTiles(
  ctx: StorybookSceneContext,
  canvas: StorybookSceneCanvas,
  editedRgba: Uint8Array
): { edits: IconTileEdit[]; conflicts: number } {
  const editedU32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, canvas.width * canvas.height);
  const byTile = new Map<string, Uint8Array>();
  let conflicts = 0;
  for (const u of canvas.units) {
    if (!u) continue;
    const sliced = slice2bppCell(editedU32, canvas.width, u.cellX, u.cellY, u.hflip, u.vflip, sceneBg3PalFor(ctx, u.paletteRow), u.baseBytes, STORYBOOK_SCENE_BG3_COLORS);
    let changed = false;
    for (let k = 0; k < TILE_BYTES_2BPP; k++) if (sliced[k] !== u.baseBytes[k]) { changed = true; break; }
    if (!changed) continue;
    const key = `${u.format}/${u.fileId}/${u.fileTile}`;
    const prev = byTile.get(key);
    if (prev) { for (let k = 0; k < TILE_BYTES_2BPP; k++) if (prev[k] !== sliced[k]) { conflicts++; break; } }
    byTile.set(key, sliced);
  }
  const edits: IconTileEdit[] = [];
  for (const [key, bytes] of byTile) {
    const [format, fileId, fileTile] = key.split('/');
    edits.push({ fileId: Number(fileId), format: format as 'lz2' | 'lz16', fileTile: Number(fileTile), bytes });
  }
  return { edits, conflicts };
}

/** Encode the scene canvas to an INDEXED PNG: the assembled BG3 layout with its used
 *  2bpp sub-palette rows (4 colors each) concatenated as the PNG's palette — the colors
 *  ride in the file, so no swatch column is stitched beside the picture. */
export function storybookScenePng(ctx: StorybookSceneContext, canvas: StorybookSceneCanvas): Uint8Array {
  const rows = canvas.paletteRowsUsed.map((row) => sceneBg3PalFor(ctx, row).subarray(0, STORYBOOK_SCENE_BG3_COLORS));
  return canvasIndexedPng(canvas.rgba, canvas.width, canvas.height, rows.length ? rows : [sceneBg3PalFor(ctx, 0).subarray(0, STORYBOOK_SCENE_BG3_COLORS)]);
}

/** The scene as a real Aseprite **tilemap** (tileset of distinct (char, palRow) 2bpp
 *  tiles + the cell grid carrying each word's flip). The flatten reproduces the canvas
 *  byte-exact, so the import path is `decodeAsepriteRegion` → `diffStorybookSceneTiles`
 *  — no swatch, the palette is embedded. */
export function storybookSceneAseprite(ctx: StorybookSceneContext, canvas: StorybookSceneCanvas): { bytes: Uint8Array; paletteOffsets: number[] } {
  const tileIndex = new Map<number, number>(); // (char<<3 | palRow) → aseprite tile index
  const tiles: TilesetTile[] = [];
  const indices = new Uint8Array(64);
  const cells: AsepriteCell[] = [];
  for (let i = 0; i < canvas.cols * canvas.rows; i++) {
    const word = u16le(ctx.vram, ctx.regs.bg3TilemapAddr + i * 2);
    const char = word & 0x3ff, hflip = (word & 0x4000) !== 0, vflip = (word & 0x8000) !== 0, palRow = (word >> 10) & 0x07;
    const key = (char << 3) | palRow;
    let ti = tileIndex.get(key);
    if (ti === undefined) {
      ti = tiles.length + 1; // tile 0 = empty
      tileIndex.set(key, ti);
      const vramByte = (ctx.regs.bg3CharAddr + char * TILE_BYTES_2BPP) & 0xffff;
      decode2bppTile(ctx.vram, vramByte, false, false, indices, 0); // UN-flipped; cell carries flip
      tiles.push({ indices: indices.slice(), paletteRow: palRow }); // BG3 Mode-1: row P at base 0
    }
    cells.push({ tile: ti, hflip, vflip });
  }
  const bytes = tilesAseprite({
    cgram: ctx.cgram, bpp: 2, tileW: TILE_PX, tileH: TILE_PX, tiles, cells,
    tilesAcross: canvas.cols, tilesDown: canvas.rows, index0Transparent: false,
    rowStride: STORYBOOK_SCENE_BG3_COLORS, // BG3 2bpp tight 4-color stride, base 0
    layerName: 'storybook-scene', tilesetName: 'storybook-bg3'
  });
  // Per-palette-entry master-blob offsets (the color write-back map) — SAME args as above.
  const paletteOffsets = tilesetPaletteOffsets({
    tiles, bpp: 2, index0Transparent: false, provenance: ctx.provenance, rowStride: STORYBOOK_SCENE_BG3_COLORS
  });
  return { bytes, paletteOffsets };
}

/** One assembled storybook-scene PNG, shaped for the export manifest. */
export interface StorybookScenePng {
  /** Relative path: `screens/storybook/scene-f27.png`. */
  file: string;
  description: string;
  width: number;
  height: number;
  /** Every f27-backed cell slices back byte-exact (so f27 edits round-trip). */
  faithful: boolean;
  png: Uint8Array;
  /** The same scene as an Aseprite tilemap (built only when requested). */
  aseprite?: Uint8Array;
  /** Per-`.aseprite`-palette-entry master-blob byte-offset (`-1` = transparent/non-blob) —
   *  serialized so the import can write an edited color back to the blob. Aseprite mode. */
  paletteOffsets?: number[];
}

/** Export the storybook's first-scene BG3 frame as an editable tile-layout PNG (or an
 *  Aseprite tilemap when `aseprite`). Edits slice back to the f27 char tiles via
 *  saveGfxEdit (shared char ⇒ one edit repaints every cell reusing it). Color edits to the
 *  embedded palette round-trip to the master blob (via `paletteOffsets`). */
export function exportStorybookScene(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean; gfxOverride?: ReadonlyMap<string, Uint8Array> } = {}): StorybookScenePng {
  const ctx = buildStorybookSceneContext(rom, symbols, opts.gfxOverride);
  const canvas = renderStorybookScene(ctx);
  const ase = opts.aseprite ? storybookSceneAseprite(ctx, canvas) : undefined;
  return {
    file: 'screens/storybook/scene-f27.png',
    description:
      'storybook first scene — the gm$05 cutscene opening page laid out as it renders (BG3 decorative frame, file 0x27 char tiles). Edit the frame tiles in place; a shared char repaints every cell that reuses it. The frame interior (BG1/BG2 illustration) is preview-only. Colors are the static palette-$50 frame; the scene shimmers in-game. Editing the embedded palette writes those colors back to the master palette blob.',
    width: canvas.width,
    height: canvas.height,
    faithful: canvas.faithful,
    png: storybookScenePng(ctx, canvas),
    aseprite: ase?.bytes,
    paletteOffsets: ase?.paletteOffsets
  };
}

/** Title scene descriptors. Gfx via `CODE_load_overworld_gfx` (Y=$4F): DP $10 = $1F
 *  on a NORMAL boot. The cart loads $68 by default but overwrites it with $1F unless
 *  `$011A == $80` or the final-world/high-score flag is set (its own comment has this
 *  backwards; the live title-render trace shows $1F → VRAM word $3400). $68 is the
 *  final-world-unlocked / high-score variant. Palette DP $10/$12/$14 from
 *  `DATA_00BAE2`/`DATA_00BAE6` (X=$00 normal variant), program offset $26. */
export function titleVariant(rom: Uint8Array, symbols: SymbolMap): ScreenVariant {
  const bae2 = u16le(rom, symbols.pc('DATA_00BAE2'));
  const bae6 = u16le(rom, symbols.pc('DATA_00BAE6'));
  return {
    group: '',
    gfx: { startOffset: 0x4f, dpSlots: [0x1f] },
    palette: { startOffset: 0x26, slots: [bae2, (bae2 + 2) & 0xffff, bae6] }
  };
}

/** Map gfx DP slots for `world` (mirrors `CODE_load_world_map_gfx` @ $00:B439). The
 *  cart indexes by `CurrentWorld` = **world×2** (`$021A` holds the world doubled): DP
 *  $10/$11 = the per-world map-tilemap PAIR `DATA_00B3F4[world*2]`,`[world*2+1]` (the
 *  two overworld map halves — w0 = $7C/$7D, levels 1-4 / 5-8 — see
 *  `world-map-terrain.ts`); $12/$13/$14 = the common $74/$75/$4C char; $15..$1C = the
 *  8-byte OBJ-marker set `DATA_00B409[world*8 .. +7]` (the asm does `TYA:ASL:ASL` →
 *  CurrentWorld×4 = world×8). Program offset $A2.
 *
 *  NB the earlier `world` / `world*4` indexing was a bug — it loaded the wrong pair
 *  for worlds 1-5 (latent only because those files were excluded from export). */
export function mapGfx(rom: Uint8Array, symbols: SymbolMap, world: number): SceneGfx {
  const tilesets = symbols.pc('DATA_00B3F4');
  const spritesets = symbols.pc('DATA_00B409');
  const dp: number[] = new Array(13).fill(0);
  dp[0] = rom[tilesets + world * 2]!;
  dp[1] = rom[tilesets + world * 2 + 1]!;
  dp[2] = 0x74;
  dp[3] = 0x75;
  dp[4] = 0x4c;
  for (let i = 0; i < 8; i++) dp[5 + i] = rom[spritesets + world * 8 + i]!;
  return { startOffset: 0xa2, dpSlots: dp };
}

/** The per-world overworld-map tilemap file id for `world` (0-5) and `half` (0 =
 *  levels 1-4, 1 = levels 5-8) — `DATA_00B3F4[world*2 + half]`. The two LZ2 gfx
 *  files whose decompressed bytes are the BG1 map tilemap (see `world-map-terrain.ts`). */
export function mapTilemapFileId(rom: Uint8Array, symbols: SymbolMap, world: number, half: 0 | 1): number {
  return rom[symbols.pc('DATA_00B3F4') + world * 2 + half]!;
}

/** Map palette DP slots for `world` (mirrors `CODE_load_world_map_palettes`): DP
 *  $10 = `DATA_00BB0B`[world]; $12/$14/$16/$18 = `DATA_00BB17`[world*4 + 0..3].
 *  Program offset $6E. Exported so the per-level-icon track (`world-map-level-icons.ts`)
 *  can load the same per-world CGRAM the icons color against. */
export function mapPalette(rom: Uint8Array, symbols: SymbolMap, world: number): ScenePalette {
  const worldPtr = symbols.pc('DATA_00BB0B');
  const subPtr = symbols.pc('DATA_00BB17');
  return {
    startOffset: 0x6e,
    slots: [
      u16le(rom, worldPtr + world * 2),
      u16le(rom, subPtr + world * 8 + 0),
      u16le(rom, subPtr + world * 8 + 2),
      u16le(rom, subPtr + world * 8 + 4),
      u16le(rom, subPtr + world * 8 + 6)
    ]
  };
}

/** Pack a CGRAM palette row into RGBA bytes (the form `gfxToImage` wants). */
function paletteRowRgba(cgram: Uint8Array, row: number, bpp: 2 | 4): Uint8Array {
  const n = bpp === 4 ? 16 : 4;
  const p = buildPaletteRow(cgram, row, false, 'expand', n);
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = p[i]!;
    out[i * 4] = v & 0xff;
    out[i * 4 + 1] = (v >> 8) & 0xff;
    out[i * 4 + 2] = (v >> 16) & 0xff;
    out[i * 4 + 3] = (v >> 24) & 0xff;
  }
  return out;
}

/** Resolve a gfx file's source SNES address (for the manifest, like the level
 *  export's `addr`). */
function fileAddr(rom: Uint8Array, symbols: SymbolMap, format: 'lz2' | 'lz16', fileId: number): number {
  const table = symbols.pc(format === 'lz16' ? 'DATA_lz16_compressed_gfx_ptrs' : 'DATA_lz2_compressed_gfx_ptrs');
  return u24le(rom, table + fileId * 3);
}

/** Extract a `region` (w×h tiles at col x, row y in the file's 16-wide grid) out of
 *  the file's decompressed tile bytes, as a `w`-wide tile block. */
function cropTiles(tileData: Uint8Array, region: TileRegion, tileBytes: number): Uint8Array {
  const out = new Uint8Array(region.w * region.h * tileBytes);
  for (let ry = 0; ry < region.h; ry++) {
    for (let rx = 0; rx < region.w; rx++) {
      const srcTile = (region.y + ry) * 16 + (region.x + rx);
      const src = srcTile * tileBytes;
      if (src + tileBytes > tileData.length) continue;
      out.set(tileData.subarray(src, src + tileBytes), (ry * region.w + rx) * tileBytes);
    }
  }
  return out;
}

/** Render one screen gfx file (deduped at the call site) to a PNG entry. When
 *  `cls.region` is set, only that tile-region is rendered (a `w`-wide grid). */
function renderFile(
  rom: Uint8Array,
  symbols: SymbolMap,
  vram: Uint8Array,
  cgram: Uint8Array,
  entry: GfxFileEntry,
  cls: FileClass,
  file: string,
  description: string,
  opts: { aseprite?: boolean } = {},
  provenance?: Int32Array
): ScreenGfxPng {
  const fullTiles = vram.subarray(entry.vramByteOffset, entry.vramByteOffset + entry.sizeBytes);
  const rowCount = entry.format === 'lz16' ? entry.sizeBytes / 512 : undefined;
  const index0Transparent = cls.paletteRow === SPRITE_PALETTE_ROW;
  const palRgba = paletteRowRgba(cgram, cls.paletteRow, cls.bpp);

  let tileData: Uint8Array;
  let layout: GfxImageLayout;
  if (cls.region) {
    const tileBytes = cls.bpp === 4 ? 32 : 16;
    tileData = cropTiles(fullTiles, cls.region, tileBytes);
    layout = { tilesWide: cls.region.w, tilesTall: cls.region.h, bpp: cls.bpp };
  } else {
    tileData = fullTiles;
    layout = entry.format === 'lz16' ? lz16Layout(rowCount!) : lz2Layout(entry.sizeBytes, cls.bpp);
  }
  const image = gfxToImage(tileData, layout, palRgba);
  const png = encodeIndexedPng(image);
  // A cropped region (the boot logo) → a single-image `.aseprite` (no tilemap): the
  // rendered pixels + the row palette as the indexed palette. The image is
  // opaque (paletteRowRgba index 0 is a real color), matching the PNG render, so the
  // flatten reproduces it and diffGfxFileAseprite round-trips. Region-only by design.
  let aseprite: Uint8Array | undefined;
  let paletteOffsets: number[] | undefined;
  if (opts.aseprite && cls.region) {
    const n = cls.bpp === 4 ? 16 : 4;
    const palU32 = new Uint32Array(n);
    for (let i = 0; i < n; i++) palU32[i] = (palRgba[i * 4]! | (palRgba[i * 4 + 1]! << 8) | (palRgba[i * 4 + 2]! << 16) | (palRgba[i * 4 + 3]! << 24)) >>> 0;
    const rw = cls.region.w * TILE_PX, rh = cls.region.h * TILE_PX;
    const regionRgba = new Uint8Array(rw * rh * 4);
    for (let y = 0; y < rh; y++) regionRgba.set(image.rgba.subarray(y * image.width * 4, (y * image.width + rw) * 4), y * rw * 4);
    aseprite = imageAseprite({ rgba: regionRgba, width: rw, height: rh, palette: palU32, index0Transparent: false, layerName: 'screen-crop' });
    // Color write-back map — the SAME single palette row (opaque, `n` colors at tight stride),
    // so editing the region crop's embedded palette rounds-trips to the master blob.
    if (provenance) paletteOffsets = imagePaletteOffsets({ provenance, rows: [cls.paletteRow], index0Transparent: false, colorsPerRow: n });
  }
  return {
    file,
    description,
    format: entry.format,
    fileId: entry.fileId,
    bpp: cls.bpp,
    sizeBytes: entry.sizeBytes, // always the FULL file (import re-saves the whole blob)
    rowCount,
    addr: fileAddr(rom, symbols, entry.format, entry.fileId),
    index0Transparent,
    region: cls.region,
    paletteRow: cls.paletteRow,
    cgram,
    palette: rgbaToRgbInts(palRgba),
    png: new Uint8Array(png),
    aseprite,
    paletteOffsets
  };
}

const fileTag = (id: number): string => 'f' + id.toString(16).toUpperCase().padStart(2, '0');

/** Load one screen variant's VRAM + CGRAM and return its (deduped) gfx files'
 *  manifest entries + render params, without yet assigning a folder. */
function loadVariant(
  rom: Uint8Array,
  symbols: SymbolMap,
  variant: ScreenVariant,
  descriptor: ScreenDescriptor,
  gfxOverride?: ReadonlyMap<string, Uint8Array>
): { entry: GfxFileEntry; cls: FileClass; vram: Uint8Array; cgram: Uint8Array; provenance: Int32Array }[] {
  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512);
  const provenance = new Int32Array(256); // loadScenePalettes fills it (-1 = no blob source)
  const manifest: GfxFileEntry[] = [];
  // gfxOverride splices live (unbuilt) gfx-file edits into VRAM, so the export's char sheets
  // match the import's `liveTiles` baseline — re-importing an unedited export then reverts
  // nothing (CGRAM gets the palette-overlay treatment ROM-side; see romWithLivePalette).
  loadSceneGfx(rom, symbols, variant.gfx, vram, manifest, gfxOverride);
  loadScenePalettes(rom, symbols, variant.palette, cgram, provenance);
  const seen = new Set<string>();
  const out: { entry: GfxFileEntry; cls: FileClass; vram: Uint8Array; cgram: Uint8Array; provenance: Int32Array }[] = [];
  for (const entry of manifest) {
    const key = `${entry.format}/${entry.fileId}`; // a file loaded into 2 slots (e.g. f73) exports once
    if (seen.has(key)) continue;
    seen.add(key);
    const cls = descriptor.classify(entry);
    if (!cls) continue; // not an editable tile sheet (the map's BG3-tilemap blob)
    out.push({ entry, cls, vram, cgram, provenance });
  }
  return out;
}

/**
 * Export every system screen's gfx files to editable PNG entries (path +
 * description + the PNG itself), ready to drop into the gfx-manifest `entries`
 * list. The map is exported per world with content dedup: a file used by ALL six
 * worlds lands in `screens/map/common/`, otherwise in `screens/map/world-N/` of
 * the lowest world that uses it (its `description` notes the worlds that share
 * it). Boot + title are single-variant under `screens/boot|title/`.
 *
 * `opts.groups` selects which char-sheet groups to emit — `{ system }` = the boot /
 * title / storybook sheets, `{ map }` = the per-world overworld-map sheets — so the
 * Graphics panel's `systemscreens` and `worldmap` tracks can export independently.
 * Omit `groups` for both (the default every other caller / test relies on).
 */
export function exportScreenGfxPngs(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean; gfxOverride?: ReadonlyMap<string, Uint8Array>; groups?: { system?: boolean; map?: boolean } } = {}): ScreenGfxPng[] {
  const out: ScreenGfxPng[] = [];
  // The two screen GROUPS the Graphics panel exports separately (the `systemscreens` vs
  // `worldmap` tracks): `system` = boot/title/storybook char sheets (`screens/{boot,title,
  // storybook}/`); `map` = the per-world overworld-map char sheets (`screens/map/`). No
  // `groups` ⇒ both (the original single-`screens` behaviour every other caller/test wants).
  const wantSystem = opts.groups?.system !== false;
  const wantMap = opts.groups?.map !== false;

  // --- Boot ("Nintendo Presents" logo crop; single variant) -----------------
  // The title screen's raw char sheets (the f1D logo char + f1F / f73 / f74) are NOT
  // exported: the editable title views are the assembled logo / island / scenery (emitted
  // by the gfx-png export driver), so a raw title sheet would only be redundant.
  if (wantSystem) for (const { entry, cls, vram, cgram, provenance } of loadVariant(rom, symbols, bootVariant(), BOOT, opts.gfxOverride)) {
    const file = `screens/${BOOT.id}/${fileTag(entry.fileId)}.png`;
    const crop = cls.region ? ' logo crop' : '';
    const desc = `${BOOT.id} screen${crop} — ${entry.format.toUpperCase()} ${cls.bpp}bpp (file 0x${entry.fileId.toString(16)})`;
    out.push(renderFile(rom, symbols, vram, cgram, entry, cls, file, desc, opts, provenance));
  }

  // --- Storybook (gm$05): narrowed to f88 (raw per-tile char sheet) + f27 (the
  // first-scene BG3 frame, laid out as the scene renders it — see exportStorybookScene,
  // emitted separately by the export driver). f88's per-tile rows come from the
  // `storybook-render` capture (storybook-palette-facts.ts), colored with the static
  // palette-$50 CGRAM. The other storybook sheets (f87/f8A/f4A/f8B) are intentionally
  // not exported. f27 is skipped here so the scene-layout export is its sole view.
  if (wantSystem) for (const { entry, cls, vram, cgram, provenance } of loadVariant(rom, symbols, storybookVariant(), STORYBOOK, opts.gfxOverride)) {
    if (entry.fileId !== 0x88) continue;
    const file = `screens/storybook/${fileTag(entry.fileId)}.png`;
    const desc = `storybook screen char (BG, per-tile palette) — ${entry.format.toUpperCase()} ${cls.bpp}bpp (file 0x${entry.fileId.toString(16)})`;
    out.push(renderStorybookCharFile(rom, symbols, vram, cgram, entry, cls, file, desc, opts, provenance));
  }

  // --- Map (per world, content-deduped) -------------------------------------
  // MUST stay the last section: the `worldmap` track skips everything above by
  // returning here, so any new screen group added later belongs ABOVE this guard.
  if (!wantMap) return out;
  // Per distinct file id: which worlds use it, and a render context (the FIRST
  // using world's VRAM/CGRAM/render-params). The decompressed pixels are
  // world-invariant, but the BG palette ROW is the per-world tint (`mapTintRow`),
  // so a file is previewed in its first-using world's tint (correct for a
  // world-N-only file; for a `common` file that's world 0's real view — the honest
  // single basis for a shared, index-edited blob).
  const worldsOf = new Map<number, number[]>();
  const ctxOf = new Map<number, { entry: GfxFileEntry; cls: FileClass; vram: Uint8Array; cgram: Uint8Array; provenance: Int32Array }>();
  for (let world = 0; world < WORLD_COUNT; world++) {
    const variant: ScreenVariant = { group: `world-${world}`, gfx: mapGfx(rom, symbols, world), palette: mapPalette(rom, symbols, world) };
    for (const f of loadVariant(rom, symbols, variant, mapDescriptor(mapTintRow(rom, symbols, world)), opts.gfxOverride)) {
      const list = worldsOf.get(f.entry.fileId) ?? [];
      list.push(world);
      worldsOf.set(f.entry.fileId, list);
      if (!ctxOf.has(f.entry.fileId)) ctxOf.set(f.entry.fileId, f);
    }
  }
  for (const [fileId, worlds] of worldsOf) {
    const { entry, cls, vram, cgram, provenance } = ctxOf.get(fileId)!;
    const common = worlds.length === WORLD_COUNT;
    const group = common ? 'common' : `world-${worlds[0]}`;
    const file = `screens/map/${group}/${fileTag(fileId)}.png`;
    const worldNote = common
      ? `all worlds${cls.mapBg ? ', shown in world ' + worlds[0] + ' tint' : ''}`
      : `world${worlds.length > 1 ? 's ' + worlds.join(',') : ' ' + worlds[0]}`;
    if (cls.mapBg) {
      // BG1 level-select PANEL char (f74/f75): per-tile palette; SKIP a file the panel
      // tilemap never references (f7C/f7D = the per-world Mode-7 map halves, f4C) — see
      // the file header's "NOT YET EXPORTED" note.
      const tintRow = mapTintRow(rom, symbols, worlds[0]!);
      const desc = `map level-select panel + icons, BG1 (${worldNote}) — ${entry.format.toUpperCase()} 4bpp per-tile palette (file 0x${fileId.toString(16)})`;
      const png = renderMapBgFile(rom, symbols, vram, cgram, entry, tintRow, file, desc, opts, provenance);
      if (png) out.push(png);
      continue;
    }
    const role = cls.paletteRow === SPRITE_PALETTE_ROW ? 'OBJ markers/chrome'
      : cls.bpp === 2 ? 'BG3 decorative ground (menu backdrop), row 0'
      : `pal row ${cls.paletteRow}`;
    const desc = `map screen — ${role} (${worldNote}) — ${entry.format.toUpperCase()} ${cls.bpp}bpp (file 0x${fileId.toString(16)})`;
    out.push(renderFile(rom, symbols, vram, cgram, entry, cls, file, desc));
  }

  return out;
}

// ===========================================================================
// TITLE "Yoshi's Island" LOGO — the editable meta-view of the title's Mode-0 BG2
// logo (`DATA_title_screen_logo_tilemap`, 448 words = 32×14, DMA'd to VRAM word
// $3E40). The logo is BG2 8×8 (BG1 16×16 draws the clouds behind it off the same
// nametable). Each cell references a 2bpp char tile from file `$1D` at the BG12NBA
// char base ($4000 byte / $2000 word, scene-regs $00), with a per-cell 2bpp
// sub-palette field (0..3) read from the BG2 palette region (CGRAM 32.., see
// LOGO_BG2_PALETTE_BASE). This assembles the logo into a 256×112 editable PNG and
// slices edits back to the `$1D` char tiles → `saveGfxEdit` — the BG twin of the
// world-map level-slot icon, for the title (2bpp instead of 4bpp).
//
// NB the logo's CGRAM palette animates at runtime (a ping-pong shimmer); the exported
// colors are one frame. Editing tile INDICES is byte-safe regardless — only the
// on-screen colors animate.
//
// The floating island / sea (Mode-7) IS statically exportable — see the island
// section below (`exportTitleIsland`). (An earlier note here claimed it needed a
// runtime VRAM capture; that was wrong — file $B1 is the island char CPC-packed, so
// no de-interleave or GSU read-back replication is needed; the GSU only unpacks the
// nibbles. Proven byte-exact against the title-render trace's char output.)

const LOGO_TILEMAP_SYM = 'DATA_title_screen_logo_tilemap';
const LOGO_COLS = 32; // the tilemap is 448 words = 32 wide ×
const LOGO_ROWS = 14; //   14 tall, DMA'd contiguously to VRAM word $3E40
const LOGO_CHAR_ADDR = 0x4000; // BG1/BG2 shared char base (BG12NBA=$22 → $2000 words; scene-regs $00)
const TILE_BYTES_2BPP = 16;
const LOGO_COLORS = 4; // 2bpp sub-palette size (a logo tile reads 4 colors)
/** CGRAM stride between logo sub-palette rows = the TIGHT 4-color 2bpp stride
 *  (sub-palette N at base + N*4). The title runs in BG **Mode 0**, where the
 *  hardware resolves a tilemap cell's 3-bit palette field `P` to CGRAM[base + P*4
 *  .. +3] at a fixed 4-color read stride. */
const LOGO_ROW_STRIDE = LOGO_COLORS;
/** The logo is **BG2**, not BG1 (BG2 8×8 draws the "Yoshi's Island" glyphs; BG1
 *  16×16 draws the clouds behind it — both off the same `$3C00` nametable at
 *  different scrolls). In Mode 0 each BG owns 8 sub-palettes: BG1 → CGRAM palette
 *  rows 0..7 (colors 0..31), **BG2 → rows 8..15 (colors 32..63)**. So a logo
 *  field `P` reads CGRAM[32 + P*4] — i.e. CGRAM palette row `8 + P`.
 *
 *  **CORRECTION (proven by the `title-render` trace):** earlier code read field `P`
 *  at base 0 (CGRAM[P*4]) as if the logo were BG1, tinting the black/white logo body
 *  with BG1's island GREEN (field 1 → CGRAM[4..7] = green/grey instead of the real
 *  black + white at CGRAM[36..39]). The live title CGRAM dump (`trace-harness`
 *  scenario `title-render`, BG2 base 32) decodes field 0 = black/cyan/green and field 1
 *  = black-outlined white — the real logo. The prior "stride 16" theory and the
 *  "stride 4 base 0" theory both missed this +32 BG2 base offset. */
const LOGO_BG2_PALETTE_BASE = 8; // first BG2 sub-palette row in Mode 0 (CGRAM color 32)
const LOGO_PX_W = LOGO_COLS * TILE_PX;

/** Decode + palette context for the title logo scene (build once). */
export interface TitleLogoContext {
  rom: Uint8Array;
  symbols: SymbolMap;
  vram: Uint8Array;
  cgram: Uint8Array;
  manifest: GfxFileEntry[];
  palettes: (Uint32Array | undefined)[];
  /** CGRAM color index → master-palette-blob byte-offset (`-1` = no blob source) — lets a
   *  logo BG2 palette-color edit round-trip to the blob. */
  provenance: Int32Array;
}

/** Build the title scene's decode context (its VRAM + CGRAM + gfx manifest), using
 *  the same normal-boot descriptors as the gfx-file export (`titleVariant`). */
export function buildTitleLogoContext(rom: Uint8Array, symbols: SymbolMap, gfxOverride?: ReadonlyMap<string, Uint8Array>): TitleLogoContext {
  const v = titleVariant(rom, symbols);
  const vram = new Uint8Array(0x10000);
  const manifest: GfxFileEntry[] = [];
  loadSceneGfx(rom, symbols, v.gfx, vram, manifest, gfxOverride);
  const cgram = new Uint8Array(512);
  const provenance = new Int32Array(256); // loadScenePalettes fills it (-1 = no blob source)
  loadScenePalettes(rom, symbols, v.palette, cgram, provenance);
  return { rom, symbols, vram, cgram, manifest, palettes: new Array(8), provenance };
}

/** 2bpp sub-palette for logo field `row` (0..7) as ARGB, opaque index 0 (BG
 *  composites it) — cached. Read from the Mode-0 BG2 palette region: field `P` is
 *  CGRAM palette row `8 + P` at the tight 4-color stride (see {@link LOGO_BG2_PALETTE_BASE}). */
function logoPalFor(ctx: TitleLogoContext, row: number): Uint32Array {
  let p = ctx.palettes[row];
  if (!p) {
    p = buildPaletteRow(ctx.cgram, LOGO_BG2_PALETTE_BASE + row, false, 'expand', LOGO_COLORS, LOGO_ROW_STRIDE);
    ctx.palettes[row] = p;
  }
  return p;
}

/** Map a 2bpp char VRAM byte offset → its loaded gfx file + file-relative tile. */
function logoFileForVramByte(
  manifest: GfxFileEntry[],
  vramByte: number
): { fileId: number; format: 'lz2' | 'lz16'; fileTile: number } | null {
  for (const e of manifest) {
    if (vramByte >= e.vramByteOffset && vramByte < e.vramByteOffset + e.sizeBytes) {
      return { fileId: e.fileId, format: e.format, fileTile: (vramByte - e.vramByteOffset) / TILE_BYTES_2BPP };
    }
  }
  return null;
}

/** Slice one 8×8 cell back out of the logo canvas (inverse of the blit), base-aware
 *  (a pixel still showing its base color keeps its base index). Returns 16 bytes. */
/** Slice one 8×8 cell back out of an assembled 2bpp canvas → its 16 tile bytes,
 *  base-aware (a pixel still showing its base color keeps its base index, so a
 *  duplicate-color palette still round-trips an unedited cell byte-exact). The cell
 *  may be flipped on the canvas; the slice un-flips. Shared by the title logo
 *  (`sliceLogoCell`) and the storybook BG3 scene (`sliceSceneF27Cell`). */
function slice2bppCell(
  rgbaU32: Uint32Array,
  canvasW: number,
  cellX: number,
  cellY: number,
  hflip: boolean,
  vflip: boolean,
  palette: Uint32Array,
  baseBytes: Uint8Array,
  colors: number
): Uint8Array {
  const baseIdx = new Uint8Array(64);
  decode2bppTile(baseBytes, 0, false, false, baseIdx, 0);
  const rawIdx = new Uint8Array(64);
  for (let trow = 0; trow < 8; trow++) {
    for (let tcol = 0; tcol < 8; tcol++) {
      const destCol = hflip ? 7 - tcol : tcol;
      const destRow = vflip ? 7 - trow : trow;
      const u = rgbaU32[(cellY + destRow) * canvasW + (cellX + destCol)]!;
      const bIdx = baseIdx[trow * 8 + tcol]!;
      rawIdx[trow * 8 + tcol] = u === palette[bIdx] ? bIdx : nearestPaletteIndex(palette, u, colors);
    }
  }
  const out = new Uint8Array(TILE_BYTES_2BPP);
  encode2bppTile(rawIdx, 0, out, 0);
  return out;
}

function sliceLogoCell(
  rgbaU32: Uint32Array,
  cellX: number,
  cellY: number,
  hflip: boolean,
  vflip: boolean,
  palette: Uint32Array,
  baseBytes: Uint8Array
): Uint8Array {
  return slice2bppCell(rgbaU32, LOGO_PX_W, cellX, cellY, hflip, vflip, palette, baseBytes, LOGO_COLORS);
}

export interface TitleLogoCanvas {
  rgba: Uint8Array;
  width: number;
  height: number;
  units: (IconUnit | null)[];
  paletteRowsUsed: number[];
  /** Every cell maps to a loaded gfx file AND slices back byte-exact → safe to edit. */
  faithful: boolean;
}

/** Assemble the title logo into a 256×112 RGBA canvas + its per-cell source map. */
export function renderTitleLogo(ctx: TitleLogoContext): TitleLogoCanvas {
  const pc = ctx.symbols.pc(LOGO_TILEMAP_SYM);
  const width = LOGO_PX_W;
  const height = LOGO_ROWS * TILE_PX;
  const rgba = new Uint8Array(width * height * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  const indices = new Uint8Array(64);
  const units: (IconUnit | null)[] = [];
  const rowsUsed = new Set<number>();
  let faithful = true;
  for (let i = 0; i < LOGO_COLS * LOGO_ROWS; i++) {
    const word = u16le(ctx.rom, pc + i * 2);
    const char = word & 0x3ff;
    const hflip = (word & 0x4000) !== 0;
    const vflip = (word & 0x8000) !== 0;
    const paletteRow = (word >> 10) & 0x07; // 2bpp Mode-0 sub-palette (logo uses 0..3)
    const cellX = (i % LOGO_COLS) * TILE_PX;
    const cellY = ((i / LOGO_COLS) | 0) * TILE_PX;
    rowsUsed.add(paletteRow);
    const vramByte = (LOGO_CHAR_ADDR + char * TILE_BYTES_2BPP) & 0xffff;
    const palette = logoPalFor(ctx, paletteRow);
    if (vramByte + TILE_BYTES_2BPP <= ctx.vram.length) {
      decode2bppTile(ctx.vram, vramByte, hflip, vflip, indices, 0);
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          u32[(cellY + y) * width + (cellX + x)] = palette[indices[y * 8 + x]!]!;
        }
      }
    }
    const map = logoFileForVramByte(ctx.manifest, vramByte);
    if (!map) { units.push(null); faithful = false; continue; }
    units.push({
      fileId: map.fileId, format: map.format, fileTile: map.fileTile,
      baseBytes: ctx.vram.subarray(vramByte, vramByte + TILE_BYTES_2BPP),
      cellX, cellY, hflip, vflip, paletteRow
    });
  }
  if (faithful) {
    outer: for (const u of units) {
      if (!u) continue;
      const sliced = sliceLogoCell(u32, u.cellX, u.cellY, u.hflip, u.vflip, logoPalFor(ctx, u.paletteRow), u.baseBytes);
      for (let k = 0; k < TILE_BYTES_2BPP; k++) if (sliced[k] !== u.baseBytes[k]) { faithful = false; break outer; }
    }
  }
  return { rgba, width, height, units, paletteRowsUsed: [...rowsUsed].sort((a, b) => a - b), faithful };
}

/** Diff an edited logo canvas vs its base → the changed `$1D` (2bpp) sheet tiles.
 *  A `conflict` is two cells writing the same tile different bytes (last write wins). */
export function diffTitleLogoTiles(
  ctx: TitleLogoContext,
  canvas: TitleLogoCanvas,
  editedRgba: Uint8Array
): { edits: IconTileEdit[]; conflicts: number } {
  const editedU32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, canvas.width * canvas.height);
  const byTile = new Map<string, Uint8Array>();
  let conflicts = 0;
  for (const u of canvas.units) {
    if (!u) continue;
    const sliced = sliceLogoCell(editedU32, u.cellX, u.cellY, u.hflip, u.vflip, logoPalFor(ctx, u.paletteRow), u.baseBytes);
    let changed = false;
    for (let k = 0; k < TILE_BYTES_2BPP; k++) if (sliced[k] !== u.baseBytes[k]) { changed = true; break; }
    if (!changed) continue;
    const key = `${u.format}/${u.fileId}/${u.fileTile}`;
    const prev = byTile.get(key);
    if (prev) { for (let k = 0; k < TILE_BYTES_2BPP; k++) if (prev[k] !== sliced[k]) { conflicts++; break; } }
    byTile.set(key, sliced);
  }
  const edits: IconTileEdit[] = [];
  for (const [key, bytes] of byTile) {
    const [format, fileId, fileTile] = key.split('/');
    edits.push({ fileId: Number(fileId), format: format as 'lz2' | 'lz16', fileTile: Number(fileTile), bytes });
  }
  return { edits, conflicts };
}

/** Encode the logo canvas to an INDEXED PNG: the 256×112 logo with its used 2bpp
 *  sub-palette rows (4 colors each) concatenated as the PNG's own palette. */
export function titleLogoPng(ctx: TitleLogoContext, canvas: TitleLogoCanvas): Uint8Array {
  const rows = canvas.paletteRowsUsed.map((row) => logoPalFor(ctx, row).subarray(0, LOGO_COLORS));
  return canvasIndexedPng(canvas.rgba, canvas.width, canvas.height, rows.length ? rows : [logoPalFor(ctx, 0).subarray(0, LOGO_COLORS)]);
}

/** The title logo as a real Aseprite **tilemap** (the full ROM-ordered char tileset, 2bpp
 *  tiles, + a 32×14 cell grid carrying each word's flip). The flatten reproduces
 *  `renderTitleLogo`'s canvas byte-exact (cell flips re-applied the same way
 *  `decode2bppTile` does), so the import path is `decodeAsepriteRegion` →
 *  `diffTitleLogoTiles` — no swatch, the palette is embedded. */
/** Aseprite tile index → the logo word's `(char, palRow)`. **Tile 0 is Aseprite's mandatory
 *  empty tile** (`null`); the `$1D` CHR file is replicated 1:1 at tiles 1..N in CHR order (tile
 *  `i` = char `0x300 + i − 1`), every char placed or not. (Aseprite reserves tileset index 0 as
 *  the empty tile — `notile = 0`, and `fix_old_tileset` inserts it — so the CHR is 1-indexed; we
 *  can't put a real char at tile 0.) Each char is colored by the palette row it's placed with
 *  (logo chars are 1:1 char→palRow); an unplaced char falls back to the dominant used row. Shared
 *  by the export (`titleLogoAseprite`) AND the combined diff (`diffTitleLogoCombined`). */
export function logoTileMeta(ctx: TitleLogoContext): ({ char: number; palRow: number } | null)[] {
  const pc = ctx.symbols.pc(LOGO_TILEMAP_SYM);
  const usedPal = new Map<number, number>(); // char → the (single) palette row it's placed with
  const palCount = new Map<number, number>(); // palette row → cell count (picks the unused default)
  for (let i = 0; i < LOGO_COLS * LOGO_ROWS; i++) {
    const word = u16le(ctx.rom, pc + i * 2);
    const char = word & 0x3ff, palRow = (word >> 10) & 0x07;
    if (!usedPal.has(char)) usedPal.set(char, palRow);
    palCount.set(palRow, (palCount.get(palRow) ?? 0) + 1);
  }
  // The full char set = every tile of the gfx file(s) the placed chars live in, so unused
  // tiles ride along as placeable art. (char ↔ VRAM byte is `LOGO_CHAR_ADDR + char*16`.)
  const fileChars = new Set<number>();
  for (const char of usedPal.keys()) {
    const vramByte = (LOGO_CHAR_ADDR + char * TILE_BYTES_2BPP) & 0xffff;
    const e = ctx.manifest.find((e) => vramByte >= e.vramByteOffset && vramByte < e.vramByteOffset + e.sizeBytes);
    if (!e || (e.vramByteOffset - LOGO_CHAR_ADDR) % TILE_BYTES_2BPP !== 0) continue;
    const start = (e.vramByteOffset - LOGO_CHAR_ADDR) / TILE_BYTES_2BPP;
    const count = Math.floor(e.sizeBytes / TILE_BYTES_2BPP);
    for (let k = 0; k < count; k++) { const c = start + k; if (c >= 0 && c <= 0x3ff) fileChars.add(c); }
  }
  const defPal = [...palCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  // Tile 0 = Aseprite's mandatory empty tile; the CHR file follows 1:1 at tiles 1..N in char
  // order. Each char colored by its placed palette row (1:1 char→palRow), unplaced chars fall
  // back to the dominant used row.
  const meta: ({ char: number; palRow: number } | null)[] = [null];
  for (const char of [...fileChars].sort((a, b) => a - b)) meta.push({ char, palRow: usedPal.get(char) ?? defPal });
  return meta;
}

/** Pack `logoTileMeta` to a flat `(char<<3)|palRow` per-tile key list (index 0 = empty `-1`)
 *  — the serialized `tileKeys` so the import maps each aseprite tile back to its char. */
export function logoTileKeys(ctx: TitleLogoContext): number[] {
  return logoTileMeta(ctx).map((m) => (m === null ? -1 : (m.char << 3) | m.palRow));
}

/** Inverse of `logoTileKeys`: the per-tile `{char,palRow}` meta from the serialized keys. */
function logoMetaFromKeys(keys: readonly number[]): ({ char: number; palRow: number } | null)[] {
  return keys.map((k) => (k < 0 ? null : { char: (k >> 3) & 0x3ff, palRow: k & 0x07 }));
}

export function titleLogoAseprite(ctx: TitleLogoContext, _canvas: TitleLogoCanvas, keys: readonly number[]): { bytes: Uint8Array; paletteOffsets: number[] } {
  const pc = ctx.symbols.pc(LOGO_TILEMAP_SYM);
  const meta = logoMetaFromKeys(keys);
  const tileIndex = new Map<number, number>(); // char → aseprite tile index (1-based; tile 0 = empty)
  const tiles: TilesetTile[] = [];
  const indices = new Uint8Array(64);
  for (let ti = 1; ti < meta.length; ti++) {
    const { char, palRow } = meta[ti]!;
    tileIndex.set(char, ti);
    const vramByte = (LOGO_CHAR_ADDR + char * TILE_BYTES_2BPP) & 0xffff;
    decode2bppTile(ctx.vram, vramByte, false, false, indices, 0); // UN-flipped; cell carries flip
    // Embed the BG2 colors: field P → CGRAM palette row 8+P (see LOGO_BG2_PALETTE_BASE).
    tiles.push({ indices: indices.slice(), paletteRow: LOGO_BG2_PALETTE_BASE + palRow });
  }
  const cells: AsepriteCell[] = [];
  for (let i = 0; i < LOGO_COLS * LOGO_ROWS; i++) {
    const word = u16le(ctx.rom, pc + i * 2);
    const char = word & 0x3ff, hflip = (word & 0x4000) !== 0, vflip = (word & 0x8000) !== 0;
    cells.push({ tile: tileIndex.get(char) ?? 0, hflip, vflip }); // cell → its char's tile (0 = empty)
  }
  const bytes = tilesAseprite({
    cgram: ctx.cgram, bpp: 2, tileW: TILE_PX, tileH: TILE_PX, tiles, cells,
    tilesAcross: LOGO_COLS, tilesDown: LOGO_ROWS, index0Transparent: false,
    rowStride: LOGO_ROW_STRIDE, // Mode-0 BG2: 2bpp tiles, tight 4-color palette stride (rows 8..15)
    layerName: 'logo', tilesetName: 'logo-tiles'
  });
  // Color write-back map — SAME bpp/index0Transparent/rowStride (8+P rows at stride 4) as above.
  const paletteOffsets = tilesetPaletteOffsets({ tiles, bpp: 2, index0Transparent: false, provenance: ctx.provenance, rowStride: LOGO_ROW_STRIDE });
  return { bytes, paletteOffsets };
}

/** One changed logo tilemap word: the BG word `value` (`vhopppcc cccccccc`) at cell
 *  `offset` (0..447, row-major). Structurally the io's `LogoTilemapEdit`. */
export interface LogoPlacementEdit { offset: number; value: number }

/** The result of a COMBINED logo import — pixel edits + cell repositions together. */
export interface LogoCombinedDiff {
  /** DATA_title_screen_logo_tilemap word edits (cell → new BG word). */
  placement: LogoPlacementEdit[];
  /** $1D char-tile pixel edits (shared char ⇒ one edit may affect several cells). */
  pixels: IconTileEdit[];
  /** Placed cells referencing a NEW/unmapped tile — CHR allocation is out of scope, so
   *  these are skipped (add new logo art via the faithful $1D sheet). */
  skipped: number;
  /** Cells erased to Aseprite's empty tile 0 → resolved to cell 0's backdrop word. Surfaced
   *  so the caller can warn (an erased cell becomes the backdrop, which may look unexpected). */
  erased: number;
  /** numTiles < export ⇒ tiles deleted/reordered; the index→(char,palRow) map is
   *  unreliable. Caller should refuse. */
  removedTiles: boolean;
}

/**
 * Combined title-logo import — **assumes Manual Aseprite tileset mode** (stable tile indices).
 * One edited `.aseprite` carries BOTH pixel edits and cell repositions/flips, resolved by
 * index: a tile `ti`'s pixels → its `$1D` char (`logoTileMeta` gives the char; the 2bpp index
 * is `aseIndex & (LOGO_COLORS-1)`); each cell → the BG word rebuilt from its tile's
 * `(char, palRow)` + the cell's flips (the dest cell's priority bit preserved). The tileset is
 * the `$1D` CHR file at tiles 1..N (tile 0 = Aseprite's empty tile). A cell ERASED to tile 0 →
 * cell 0's authored backdrop word (the only sensible blank), counted in `erased` so the caller
 * can warn. New/unmapped tiles are reported (`skipped`); a smaller tileset than the export is
 * refused (`removedTiles`). The logo palette animates in-game, so the edited indices are
 * byte-safe regardless of the shown frame.
 */
export function diffTitleLogoCombined(ctx: TitleLogoContext, keys: readonly number[], struct: AsepriteStructural): LogoCombinedDiff {
  const meta = logoMetaFromKeys(keys); // the serialized tileKeys (tileset tile → char/palRow)
  const exportTileCount = meta.length;
  const out: LogoCombinedDiff = { placement: [], pixels: [], skipped: 0, erased: 0, removedTiles: false };
  if (struct.numTiles < exportTileCount) { out.removedTiles = true; return out; }
  const pc = ctx.symbols.pc(LOGO_TILEMAP_SYM);
  const TPX = TILE_PX * TILE_PX; // 64

  // PIXELS: each export tile → its $1D char tile (the char bytes are palette-row-agnostic).
  // Tile 0 is the empty tile (meta[0] = null), skipped.
  const byTile = new Map<string, IconTileEdit>();
  const raw = new Uint8Array(TPX);
  for (let ti = 1; ti < exportTileCount; ti++) {
    const m = meta[ti]; if (!m) continue;
    const char = m.char;
    const vramByte = (LOGO_CHAR_ADDR + char * TILE_BYTES_2BPP) & 0xffff;
    const map = logoFileForVramByte(ctx.manifest, vramByte);
    if (!map) continue;
    for (let i = 0; i < TPX; i++) raw[i] = struct.tilePixels[ti * TPX + i]! & (LOGO_COLORS - 1); // local 2bpp index
    const bytes = new Uint8Array(TILE_BYTES_2BPP);
    encode2bppTile(raw, 0, bytes, 0);
    const base = ctx.vram.subarray(vramByte, vramByte + TILE_BYTES_2BPP);
    let changed = false; for (let k = 0; k < TILE_BYTES_2BPP; k++) if (bytes[k] !== base[k]) { changed = true; break; }
    if (changed) byTile.set(`${map.format}/${map.fileId}/${map.fileTile}`, { fileId: map.fileId, format: map.format, fileTile: map.fileTile, bytes });
  }
  out.pixels = [...byTile.values()];

  // PLACEMENT: each non-empty cell → the BG word from its tile's (char, palRow) + the cell
  // flips (the cell's priority bit preserved). A cell ERASED to the empty tile 0 → cell 0's
  // authored backdrop word (the one blank we can pick without guessing), counted in `erased`.
  // A tile beyond the tileset is a new/unmapped tile (skipped).
  const cell0Word = u16le(ctx.rom, pc); // tilemap cell 0 — the authored backdrop word
  for (let i = 0; i < LOGO_COLS * LOGO_ROWS; i++) {
    const cell = struct.cells[i];
    const tile = cell?.tile ?? 0;
    const orig = u16le(ctx.rom, pc + i * 2);
    if (tile === 0) { // erased / empty cell → cell 0's backdrop word
      out.erased++;
      if (cell0Word !== orig) out.placement.push({ offset: i, value: cell0Word });
      continue;
    }
    const m = meta[tile];
    if (!m) { out.skipped++; continue; } // new/unmapped tile (CHR allocation out of scope)
    const word = (m.char & 0x3ff) | ((m.palRow & 7) << 10) | (orig & 0x2000) | (cell?.hflip ? 0x4000 : 0) | (cell?.vflip ? 0x8000 : 0);
    if (word !== orig) out.placement.push({ offset: i, value: word });
  }
  return out;
}

/** One assembled title-logo PNG, shaped for the manifest. */
export interface TitleLogoPng {
  /** Relative path: `screens/title/logo.png`. */
  file: string;
  description: string;
  faithful: boolean;
  width: number;
  height: number;
  png: Uint8Array;
}

/** Export the title's "Yoshi's Island" logo as an assembled, editable PNG. Edits
 *  slice back to the `$1D` char tiles (also the raw `screens/title/f1D.png` sheet —
 *  last write wins on import, like the metatile/bg1-tileset pair). */
export function exportTitleLogo(rom: Uint8Array, symbols: SymbolMap): TitleLogoPng {
  const ctx = buildTitleLogoContext(rom, symbols);
  const canvas = renderTitleLogo(ctx);
  return {
    file: 'screens/title/logo.png',
    description: 'title "Yoshi\'s Island" logo (assembled from the $1D char tiles; palette animates)',
    faithful: canvas.faithful,
    width: canvas.width,
    height: canvas.height,
    png: titleLogoPng(ctx, canvas)
  };
}
