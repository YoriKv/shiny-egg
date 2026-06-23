// Cart-organized tile inspector. Renders per-level gfx as a list of
// **labeled blocks**, one per chunk-list entry in `scene_gfx_layout` plus
// synthesized blocks for the animated-tile slots populated by
// `loadTileAnimation`.
//
// Aligns with Nintendo's source organization (`source_Ver2/cgx_file/`):
// each compressed gfx file is a named, themed tile sheet (e.g.
// `Map-BG-Big.CGX`, `SFX_MODE_MIZU.DAT`, `KAGE-TERESA-1-NEW.CGX`) that
// the cart loads as one atomic unit. We can't recover the source
// filenames (the cart only sees numeric file IDs), but the chunk-list
// entry IS the cart-level identity — so a block-per-entry layout
// matches the build's natural granularity.
//
// **Sprite rendering** uses a 16-tile-per-row stride (`CELLS_PER_ROW`).
// This matches the SNES OAM tile-layout convention — a 16×16 sprite
// references tiles `(N, N+1, N+16, N+17)`, where the `+16` is the
// implicit next-row stride. Rendering at 16-wide keeps each sprite's
// quadrants adjacent (TL/TR on row 0, BL/BR directly below on row 1).
// We considered subdividing sprite blocks into 8-tile bands to mirror
// Nintendo's `source_Ver2/char/0-7.CGX`-style source-file naming, but
// those file boundaries cut across OAM sprite layouts (an 8-tile band
// splits the top half of every 16×16 sprite from its bottom half), so
// the source-file convention is informational only — not load-bearing
// for the visual layout.

import { decode4bppTile, decode2bppTile } from './tile.ts';
import { bgr15ToImageDataU32, buildPaletteRow } from './color.ts';
import {
  loadLevelGfx,
  type GfxHeader,
  type GfxFileEntry
} from './load-graphics.ts';
import { loadLevelPalettes, bgPaletteBaseRows, type PaletteHeader, type BgPaletteRows } from './load-palettes.ts';
import {
  loadTileAnimation,
  type TileAnimationEntry
} from './load-tile-animation.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { loadBg2Tilemap, loadBg3Tilemap } from './load-bg-tilemaps.ts';
import { type SymbolMap } from './symbol-map.ts';
import { u24le } from './rom-read.ts';
import { encodePng } from './png.ts';
import { gfxToImage, lz16Layout, lz2Layout, type GfxImageLayout } from './gfx-png.ts';
import { gfxFileAseprite } from './gfx-aseprite.ts';
// GfxFileBlock + GfxFilesResult live in `../types.ts` (Node-free, so the
// renderer-facing contract can re-export them); imported for local use and
// re-exported to keep the `snes-framework/render-gfx-files` import path intact.
import type { GfxFileBlock, GfxFilesResult } from '../types.ts';
export type { GfxFileBlock, GfxFilesResult };

const TILE_PIXELS = 8;
const PIXEL_BYTES = 4;
const TILE_BYTES_4BPP = 32;
const TILE_BYTES_2BPP = 16;

/** Conventional sprite VRAM start (matches the `'sprite'` region in
 *  `render:vram`). Sprites in YI sit in the upper 8KB of VRAM. */
const SPRITE_VRAM_START = 0x6000;

/**
 * Palette row to PREVIEW an animated slot with (the Tiles-gallery animated-slot
 * blocks). The always-on universal collectibles — coins / !-switch / !-coin / star,
 * at VRAM byte $2800-$2980 — are coloured from the FIXED universal-object palette
 * (CGRAM rows 1-3: red / gold / green), NOT the level's BG1 palette, so a coin
 * previews gold in every level. Every OTHER (per-tileset) animated band is level
 * terrain (water / lava / torch) tinted by the level's own BG1 palette → the BG1 row.
 * Keyed by VRAM byte offset.
 */
const UNIVERSAL_ANIM_PALETTE_ROW: Record<number, number> = {
  0x2800: 2, // Coins ($1400) — gold
  0x2880: 3, // !-Switch ($1440)
  0x2900: 1, // !-Coin ($1480) — red
  0x2980: 3 // Star ($14C0)
};
const animSlotPaletteRow = (vramByteOffset: number, bg1Row: number): number =>
  UNIVERSAL_ANIM_PALETTE_ROW[vramByteOffset] ?? bg1Row;

interface RenderHeader extends GfxHeader, PaletteHeader {
  animationTileset?: number;
  levelMode?: number;
  /** header[11] animation-palette mode — flags BG3 palette-cycle levels. */
  animationPalette?: number;
}

/** Map dpSlot (0..12 = asm DP $10..$1C) → layer name. */
function dpSlotLayer(slot: number): 'BG1' | 'BG2' | 'BG3' | 'Sprite' {
  if (slot <= 2) return 'BG1';
  if (slot <= 4) return 'BG2';
  if (slot <= 6) return 'BG3';
  return 'Sprite';
}

/** Pick bit depth + palette row defaults from layer + VRAM range.
 *
 * **Classification approach.** YI's chunk list mixes indirect entries
 * (whose layer is unambiguous from `dpSlot`) with literal entries that
 * can be BG1/BG2 helper sheets, BG3 helpers, or sprite tiles. We use:
 *
 *   1. If dpSlot is set: trust it — DP $10-$12 BG1, $13-$14 BG2,
 *      $15-$16 BG3, $17-$1C sprite.
 *   2. Else if vramByteOffset is inside the BG3 char-base 8KB window:
 *      label as BG3 (2bpp).
 *   3. Else if vramByteOffset >= `SPRITE_VRAM_START` ($6000): break
 *      the tie on **LZ format**, because Nintendo's convention is
 *      LZ2 for BG1/BG3 and LZ16 for BG2/Sprite (verified empirically
 *      across all V1.0 tilesets: 100% LZ2-for-BG1+BG3, 100%
 *      LZ16-for-BG2, ~90% LZ16-for-sprite). A literal LZ2 in upper
 *      VRAM is almost certainly appended BG1; LZ16 is almost
 *      certainly sprite.
 *   4. Else: label as BG1/BG2 (4bpp pal 0).
 *
 * **Forward-compatibility note**: this rule treats the LZ-format
 * convention as authoritative. A modded ROM that violates it (e.g.
 * recompresses a BG1 file as LZ16) will get mislabeled. The cart
 * itself doesn't enforce the convention — the chunk-list bit-15
 * flag is the only runtime check — so future work that
 * adds files should keep BG1/BG3 as LZ2 and BG2/Sprite as LZ16. */
function inferRenderParams(
  entry: GfxFileEntry,
  bg3CharAddr: number,
  bgRows: BgPaletteRows
): { bpp: 2 | 4; paletteRow: number; layer: string } {
  // Non-sprite paletteRow = the layer's REAL CGRAM row (bgPaletteBaseRows), not 0
  // — row 0 holds the backdrop + BG3, so BG1/BG2 sheets coloured at row 0 show
  // the wrong palette. (The per-tile renderer reads the row per cell; a
  // paletteless file preview has to pick the layer's base row.)
  if (entry.dpSlot !== undefined) {
    const layer = dpSlotLayer(entry.dpSlot);
    if (layer === 'BG3') return { bpp: 2, paletteRow: bgRows.bg3, layer: 'BG3' };
    if (layer === 'Sprite') return { bpp: 4, paletteRow: 8, layer: 'Sprite' };
    return { bpp: 4, paletteRow: layer === 'BG2' ? bgRows.bg2 : bgRows.bg1, layer };
  }
  if (
    bg3CharAddr > 0 &&
    entry.vramByteOffset >= bg3CharAddr &&
    entry.vramByteOffset < bg3CharAddr + 0x2000
  ) {
    return { bpp: 2, paletteRow: bgRows.bg3, layer: 'BG3' };
  }
  if (entry.vramByteOffset >= SPRITE_VRAM_START) {
    // LZ format breaks the BG1-vs-sprite tie in upper VRAM.
    if (entry.format === 'lz2') {
      return { bpp: 4, paletteRow: bgRows.bg1, layer: 'BG1' };
    }
    return { bpp: 4, paletteRow: 8, layer: 'Sprite' };
  }
  return { bpp: 4, paletteRow: bgRows.bg1, layer: 'BG1/BG2' };
}

function bytesPerTile(bpp: 2 | 4): number {
  return bpp === 4 ? TILE_BYTES_4BPP : TILE_BYTES_2BPP;
}

function colorsPerRow(bpp: 2 | 4): number {
  return bpp === 4 ? 16 : 4;
}

/** Render a contiguous VRAM byte range as a tile grid, returning RGBA +
 *  dimensions. The grid is `cellsPerRow` tiles wide; partial rows pad
 *  with the background fill color. */
function renderTileGrid(
  vram: Uint8Array,
  palette: Uint32Array,
  vramByteOffset: number,
  tileCount: number,
  bpp: 2 | 4,
  cellsPerRow: number,
  bgU32: number
): { rgba: Uint8Array; width: number; height: number } {
  const bpt = bytesPerTile(bpp);
  const rows = Math.max(1, Math.ceil(tileCount / cellsPerRow));
  const width = cellsPerRow * TILE_PIXELS;
  const height = rows * TILE_PIXELS;
  const rgba = new Uint8Array(width * height * PIXEL_BYTES);

  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  u32.fill(bgU32);

  const indices = new Uint8Array(64);
  for (let i = 0; i < tileCount; i++) {
    const tileOff = vramByteOffset + i * bpt;
    if (tileOff + bpt > vram.length) break;
    if (bpp === 4) {
      decode4bppTile(vram, tileOff, false, false, indices, 0);
    } else {
      decode2bppTile(vram, tileOff, false, false, indices, 0);
    }
    const col = i % cellsPerRow;
    const row = Math.floor(i / cellsPerRow);
    const dx = col * TILE_PIXELS;
    const dy = row * TILE_PIXELS;
    for (let r = 0; r < TILE_PIXELS; r++) {
      const dstRow = (dy + r) * width + dx;
      const srcRow = r * TILE_PIXELS;
      for (let c = 0; c < TILE_PIXELS; c++) {
        u32[dstRow + c] = palette[indices[srcRow + c]];
      }
    }
  }

  return { rgba, width, height };
}

const hex = (n: number, w = 4): string =>
  '$' + n.toString(16).padStart(w, '0');

/**
 * Run the engine's gfx + tile-animation loaders and produce a structured
 * Files-mode result: one block per chunk-list entry (sprite-region
 * entries get a `sprite-sheet` kind so they can style differently),
 * plus four synthesized blocks for the animated coin / !-switch /
 * !-coin / star slots.
 */
export function renderGfxFiles(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: RenderHeader,
  opts: {
    cellsPerRow?: number;
    /** Which sprite palette row to apply to sprite-sheet blocks (0..7,
     *  i.e. CGRAM rows 8..15). Default 0. The cart picks per-sprite
     *  via OAM attribute; there's no "right" row at the file-level, so
     *  this is a user-facing default. */
    spritePaletteRow?: number;
  } = {}
): GfxFilesResult {
  const cellsPerRow = opts.cellsPerRow ?? 16;
  const spritePaletteRow = Math.max(0, Math.min(7, opts.spritePaletteRow ?? 0));

  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512);

  const gfxManifest: GfxFileEntry[] = [];
  const animManifest: TileAnimationEntry[] = [];

  loadLevelGfx(rom, symbols, header, vram, gfxManifest);
  loadTileAnimation(
    rom,
    symbols,
    {
      animationTileset: header.animationTileset ?? 0,
      bg1Tileset: header.bg1Tileset,
      levelMode: header.levelMode ?? 0
    },
    vram,
    animManifest
  );
  loadLevelPalettes(rom, symbols, header, cgram);

  // Scene-regs lookup tells us where BG3 char data lives — needed for
  // the "is this entry BG3?" classification for literal chunk bytes.
  const regs = loadSceneRegs(rom, symbols, header.levelMode ?? 0);
  // The CGRAM row each BG layer's palette actually loads into (BG1 row 4, BG2
  // row 6, BG3 row 0 in the stock program) — so each sheet previews in its own
  // colours instead of row 0.
  const bgRows = bgPaletteBaseRows(rom, symbols, header.levelMode ?? 0);

  const bgU32 = bgr15ToImageDataU32(0x0000);
  const blocks: GfxFileBlock[] = [];

  // Cache palette rows we've built so each block reuses them.
  const paletteCache = new Map<string, Uint32Array>();
  const getPalette = (paletteRow: number, bpp: 2 | 4): Uint32Array => {
    const key = `${bpp}/${paletteRow}`;
    let pal = paletteCache.get(key);
    if (!pal) {
      pal = buildPaletteRow(cgram, paletteRow, false, 'expand', colorsPerRow(bpp));
      paletteCache.set(key, pal);
    }
    return pal;
  };

  // --- Chunk-list entries ----------------------------------------------------
  for (const entry of gfxManifest) {
    const params = inferRenderParams(entry, regs.bg3CharAddr, bgRows);
    const bpt = bytesPerTile(params.bpp);
    const totalTiles = Math.floor(entry.sizeBytes / bpt);
    const isSprite = params.layer === 'Sprite';
    // Sprite blocks use the user-selected palette row; the classifier's
    // default (8 = first sprite palette) is overridden by the caller's
    // pick. BG blocks ignore the override and use the classifier's row.
    const renderPaletteRow = isSprite ? 8 + spritePaletteRow : params.paletteRow;
    const palette = getPalette(renderPaletteRow, params.bpp);

    const rendered = renderTileGrid(
      vram,
      palette,
      entry.vramByteOffset,
      totalTiles,
      params.bpp,
      cellsPerRow,
      bgU32
    );
    const slotNote =
      entry.dpSlot !== undefined ? ` (DP $${(0x10 + entry.dpSlot).toString(16)})` : '';
    // Sprite blocks include the tile-index range in the label for
    // cross-referencing OAM patterns (sprite IDs use 10-bit indices off
    // sprite VRAM). The grid is 16 tiles wide so a 16×16 sprite's
    // (TL, TR, BL, BR) quadrants stay adjacent: TL+TR on row N,
    // BL+BR directly below on row N+1 (matches the SNES OAM stride).
    let label: string;
    let sublabel: string;
    if (isSprite) {
      const firstTileIdx = Math.floor(entry.vramByteOffset / TILE_BYTES_4BPP);
      const lastTileIdx = firstTileIdx + totalTiles - 1;
      label = `File ${hex(entry.fileId, 2)} → Sprite${slotNote} · tiles ${hex(firstTileIdx, 2)}-${hex(lastTileIdx, 2)}`;
      sublabel =
        `VRAM ${hex(entry.vramByteOffset)}-${hex(entry.vramByteOffset + entry.sizeBytes - 1)} · ` +
        `${entry.format.toUpperCase()} · ${totalTiles} tiles · 4bpp sprite pal ${spritePaletteRow}`;
    } else {
      label = `File ${hex(entry.fileId, 2)} → ${params.layer}${slotNote}`;
      sublabel =
        `VRAM ${hex(entry.vramByteOffset)}-${hex(entry.vramByteOffset + entry.sizeBytes - 1)} · ` +
        `${entry.format.toUpperCase()} · ${totalTiles} tiles · ${params.bpp}bpp pal ${params.paletteRow}`;
    }
    blocks.push({
      kind: isSprite ? 'sprite-sheet' : 'cgx-file',
      label,
      sublabel,
      bpp: params.bpp,
      paletteRow: renderPaletteRow,
      srcPC: entry.srcPC,
      vramByteOffset: entry.vramByteOffset,
      tileCount: totalTiles,
      rgba: rendered.rgba,
      width: rendered.width,
      height: rendered.height
    });
  }

  // --- Animated-slot blocks --------------------------------------------------
  // Each is 4 tiles (0x80 bytes at 4bpp). The universal collectibles (coins/
  // !-blocks/star) preview with the fixed universal-object palette; per-tileset
  // terrain bands use the BG1 row (animSlotPaletteRow).
  for (const entry of animManifest) {
    const animRow = animSlotPaletteRow(entry.vramByteOffset, bgRows.bg1);
    const animPalette = getPalette(animRow, 4);
    const tileCount = Math.floor(entry.sizeBytes / TILE_BYTES_4BPP);
    const rendered = renderTileGrid(
      vram,
      animPalette,
      entry.vramByteOffset,
      tileCount,
      4,
      Math.min(cellsPerRow, tileCount),
      bgU32
    );
    const wordAddr = entry.vramByteOffset >>> 1;
    blocks.push({
      kind: 'animated',
      label: `Animated · ${entry.label}`,
      sublabel:
        `VRAM ${hex(entry.vramByteOffset)} (word ${hex(wordAddr)}) · ` +
        `${tileCount} tiles · 4bpp pal ${animRow} · init_tileset_animation`,
      bpp: 4,
      paletteRow: animRow,
      vramByteOffset: entry.vramByteOffset,
      tileCount,
      rgba: rendered.rgba,
      width: rendered.width,
      height: rendered.height
    });
  }

  return { blocks };
}

/**
 * Where a gfx file sits in the scene's asset composition (graphicsassets.md §12)
 * — the "usage" the exporter groups PNGs by (category folder) and names them
 * after. Derived purely from cart data: the chunk-list `dpSlot` (indirect
 * per-tileset entries) plus the fixed-file VRAM atlas for literals.
 *
 *   - `bg1-tileset` — the 3 BG1 char files (DP $10-$12). These ARE the object/
 *     terrain tiles: every std/ext object's pixels come from here (§4).
 *   - `bg2` / `bg3` — the 2 BG2 (DP $13-$14) / 2 BG3 (DP $15-$16) char files.
 *   - `sprites` — `tier:'spriteset'` = one of the 6 per-level spriteset files
 *     (DP $17-$1C, `slot` 0-5); `tier:'global'` = an always-loaded common sheet
 *     (files $72/$19 at VRAM $8000/$F000).
 *   - `hud` — the fixed HUD / font / status sheets ($12/$76/$4F).
 *   - `other` — anything the classifier can't place (shouldn't occur for stock
 *     scenes; kept so a modded layout still exports somewhere).
 */
export interface GfxRole {
  category: 'bg1-tileset' | 'bg2' | 'bg3' | 'sprites' | 'hud' | 'other';
  /** Sprite tier (sprites only). */
  tier?: 'global' | 'spriteset';
  /** File index within its group: bg1 0..2, bg2 0..1, bg3 0..1, spriteset 0..5.
   *  Undefined for literal global/hud sheets (not a per-tileset slot). */
  slot?: number;
}

/** VRAM byte offsets of the two always-loaded global sprite sheets ($72/$19). */
const GLOBAL_SPRITE_VRAM = new Set([0x8000, 0xf000]);
/** VRAM byte offsets of the fixed HUD / font / status sheets ($12/$76/$4F). */
const HUD_VRAM = new Set([0x2400, 0x2a00, 0xc000]);

/**
 * Classify a chunk-list entry into its asset-composition role. Indirect entries
 * carry an unambiguous `dpSlot` (which per-tileset table they came from);
 * literals are placed by their fixed VRAM destination + inferred layer.
 */
function classifyGfxRole(entry: GfxFileEntry, layer: string): GfxRole {
  if (entry.dpSlot !== undefined) {
    const s = entry.dpSlot;
    if (s <= 2) return { category: 'bg1-tileset', slot: s };
    if (s <= 4) return { category: 'bg2', slot: s - 3 };
    if (s <= 6) return { category: 'bg3', slot: s - 5 };
    return { category: 'sprites', tier: 'spriteset', slot: s - 7 };
  }
  if (GLOBAL_SPRITE_VRAM.has(entry.vramByteOffset)) return { category: 'sprites', tier: 'global' };
  if (HUD_VRAM.has(entry.vramByteOffset)) return { category: 'hud' };
  if (layer === 'Sprite') return { category: 'sprites', tier: 'global' };
  if (layer === 'BG3') return { category: 'bg3' };
  if (layer === 'BG1') return { category: 'bg1-tileset' };
  return { category: 'other' };
}

/** Per-tile palette fidelity for a BG2/BG3 file, carried on the export entry (and
 *  copied into the gfx manifest) so import decodes each tile against its OWN
 *  palette row — see gfx-png.ts. A global swatch can't disambiguate the rows (they
 *  share colours at different positions); decode must be per-tile. Used for both
 *  BG3 (2bpp, 4-colour rows) and BG2 (4bpp, 16-colour rows). */
export interface PerTilePalette {
  /** Per file-tile palette index (0..subPalettes.length-1); 0 = the layer's
   *  primary row, used for tiles the tilemap never references. */
  tileSub: number[];
  /** The palette rows the tiles use, as RGB ints (0xRRGGBB) — 4 colours each for
   *  2bpp BG3, 16 for 4bpp BG2; index 0 = the transparent key. The layer's loaded
   *  block comes first (BG3 rows 0-3, BG2 rows 6-7), then any extra rows the
   *  tilemap references. */
  subPalettes: number[][];
  /** This level runs a per-frame palette animation that recolours THIS layer's
   *  rows (header field 11) — the exported colours are one frame of a cycle.
   *  Editing tile indices stays byte-safe; only the displayed colours animate. */
  paletteAnimated: boolean;
}

export interface GfxPngEntry {
  fileId: number;
  format: 'lz2' | 'lz16';
  bpp: 2 | 4;
  /** Asset-composition role — the category folder + slot the exporter names by. */
  role: GfxRole;
  /** Decompressed byte length — for lz2 truncation + layout on import. */
  sizeBytes: number;
  /** lz16 tile-rows (`sizeBytes / 512`); undefined for lz2. */
  rowCount?: number;
  /** SNES address of the blob (for a `GFX_<addr>.png` filename). */
  addr: number;
  /** Index 0 was rendered transparent (sprite + BG2/BG3 gfx) — import needs this
   *  to treat transparent pixels as unchanged only where the base was index 0. */
  index0Transparent: boolean;
  /** Present for BG2/BG3 files: per-tile palette fidelity (the swatch is a
   *  reference grid; import decodes per-tile via this, not the swatch). */
  perTilePalette?: PerTilePalette;
  png: Uint8Array;
  /** Present when `opts.format === 'aseprite'`: the file's tiles as an indexed
   *  Aseprite tileset (sheet-grid tilemap). The single render palette row colours
   *  every tile (BG2/BG3 per-tile fidelity stays PNG-only). */
  aseprite?: Uint8Array;
}

/** SC-size → tilemap dimensions (cells), matching render-bg-layers. */
function bgTilemapDims(scSize: number): { cols: number; rows: number } {
  switch (scSize & 3) {
    case 0: return { cols: 32, rows: 32 };
    case 1: return { cols: 64, rows: 32 };
    case 2: return { cols: 32, rows: 64 };
    default: return { cols: 64, rows: 64 };
  }
}

/** Which 32×32 screen block a cell falls in (standard SNES tilemap layout). */
function bgScreenIndex(d: { cols: number; rows: number }, row: number, col: number): number {
  if (d.cols === 64 && d.rows === 32) return col >>> 5;
  if (d.cols === 32 && d.rows === 64) return row >>> 5;
  if (d.cols === 64 && d.rows === 64) return ((row >>> 5) << 1) | (col >>> 5);
  return 0;
}

/** Animation-palette modes (header field 11) verified NOT to recolour a given BG
 *  layer's palette rows, from the Bank01 `DATA_animation_palette_ptr` handlers'
 *  CGRAM destinations. Any OTHER non-zero mode is conservatively assumed to
 *  (possibly) recolour it — so we never claim "static" for an animated palette.
 *   - BG3 (CGRAM 0-15): mode 1→row4, modes 3/4→row7 miss it.
 *   - BG2 (CGRAM 96-127 = rows 6/7): mode 1→row4 and the BG3-region modes
 *     {2,5,9,13,15,19} miss it; modes 3/4 DO cycle row 7. */
const NON_BG_ANIM_MODES: Record<'BG2' | 'BG3', Set<number>> = {
  BG3: new Set([1, 3, 4]),
  BG2: new Set([1, 2, 5, 9, 13, 15, 19])
};
const bgPaletteAnimated = (layer: 'BG2' | 'BG3', mode: number): boolean =>
  mode !== 0 && !NON_BG_ANIM_MODES[layer].has(mode);

/** Re-throw the programmer-error classes (a missing import → `ReferenceError`, a
 *  bad property access → `TypeError`) so a bug surfaces loudly instead of being
 *  swallowed by a defensive `catch`; returns for genuine runtime/data errors so a
 *  caller can fall back. (A missing-import `ReferenceError` once silently degraded
 *  BG2 fidelity to "all base row" — this keeps that loud.) */
function rethrowIfBug(e: unknown): void {
  if (e instanceof ReferenceError || e instanceof TypeError) throw e;
}

/** Per-tile palette context for one BG layer (computed once per export). */
interface PerTilePaletteCtx {
  /** VRAM byte address of a char tile → index into subPalettes (its dominant row). */
  subByVramByte: Map<number, number>;
  /** Exposed rows as RGBA (index 0 alpha 0 = transparent) for rendering. */
  subPalettesRgba: Uint8Array[];
  /** Same rows as RGB ints, for the manifest + per-tile import decode. */
  subPalettesRgb: number[][];
  /** Tile stride in VRAM bytes (16 for 2bpp, 32 for 4bpp); the export keys lookups
   *  by `vramByteOffset + t * tileBytes`. */
  tileBytes: number;
  paletteAnimated: boolean;
}

interface BgLayerConfig {
  name: 'BG2' | 'BG3';
  bpp: 2 | 4;
  /** Rows always exposed first (the layer's loaded block, so index 0 = primary
   *  row): BG3 = [0,1,2,3] (CGRAM 0-15), BG2 = [6,7] (CGRAM 96-127). */
  baseRows: number[];
}

/**
 * Resolve, per char tile, which CGRAM palette row a BG2/BG3 layer draws it with
 * (the dominant `palRow` across the tilemap cells using it), plus those rows'
 * colours from the already-loaded CGRAM. This lets the export colour each tile in
 * its real row (not all in the base row) and the import decode each tile against
 * its own row. Snapshot of the static palette load — `paletteAnimated` flags
 * levels whose colours then cycle.
 */
function computePerTilePalette(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: RenderHeader,
  cgram: Uint8Array,
  cfg: BgLayerConfig
): PerTilePaletteCtx {
  const levelMode = header.levelMode ?? 0;
  const regs = loadSceneRegs(rom, symbols, levelMode);
  const colorsPerRow = cfg.bpp === 4 ? 16 : 4;
  const tileBytes = cfg.bpp === 4 ? 32 : 16;
  const scratch = new Uint8Array(0x10000);

  // Layer-specific tilemap source + "is this a real tile layer here?" gate.
  let tilemapAddr: number, charAddr: number, scSize: number, tileSize: number;
  let bytesWritten = 0;
  let isTileLayer = false;
  if (cfg.name === 'BG3') {
    let load: { bytesWritten: number; emptyFilled: boolean; bg3Disabled: boolean } | null = null;
    // Tolerate a malformed tilemap (fall back to no per-tile data) but re-throw a
    // programmer bug (a missing import → ReferenceError, etc.) so it surfaces
    // instead of silently degrading to "all base row".
    try { load = loadBg3Tilemap(rom, symbols, header.bg3Tileset, scratch); } catch (e) { rethrowIfBug(e); load = null; }
    bytesWritten = load?.bytesWritten ?? 0;
    isTileLayer = !!load && !load.bg3Disabled && !load.emptyFilled &&
      (regs.bgmodeMode === 0 || regs.bgmodeMode === 1);
    tilemapAddr = regs.bg3TilemapAddr; charAddr = regs.bg3CharAddr;
    scSize = regs.bg3ScSize; tileSize = regs.bg3TileSize;
  } else {
    try { bytesWritten = loadBg2Tilemap(rom, symbols, header.bg2Tileset, scratch); } catch (e) { rethrowIfBug(e); bytesWritten = 0; }
    isTileLayer = bytesWritten > 0 && regs.bgmodeMode !== 7 && levelMode !== 0x0a;
    tilemapAddr = regs.bg2TilemapAddr; charAddr = regs.bg2CharAddr;
    scSize = regs.bg2ScSize; tileSize = regs.bg2TileSize;
  }

  // Walk the tilemap → per char tile, count the palette rows that draw it.
  const counts = new Map<number, Map<number, number>>(); // vramByte → row → count
  const usedRows = new Set<number>();
  if (isTileLayer) {
    const dims = bgTilemapDims(scSize);
    const screensLoaded = Math.floor(bytesWritten / 0x800);
    // In 16×16 BG-tile mode each cell draws FOUR char tiles (base + {0,1,16,17}),
    // all sharing the cell's palette row. Assign the row to all four — recording
    // only `base` leaves +1 (the next sheet column) / +16 / +17 on the base row
    // (the "every other column wrong" bug). 8×8 mode = base only.
    const subTileOffsets = tileSize === 16 ? [0, 1, 16, 17] : [0];
    for (let row = 0; row < dims.rows; row++) {
      for (let col = 0; col < dims.cols; col++) {
        const screenIdx = bgScreenIndex(dims, row, col);
        if (screenIdx >= screensLoaded) continue;
        const off = tilemapAddr + screenIdx * 0x800 + ((row & 0x1f) * 32 + (col & 0x1f)) * 2;
        if (off + 2 > scratch.length) continue;
        const entry = scratch[off]! | (scratch[off + 1]! << 8);
        const baseTile = entry & 0x3ff;
        if (baseTile === 0) continue; // skip blank filler cells
        const palRow = (entry >>> 10) & 0x07;
        usedRows.add(palRow);
        for (const so of subTileOffsets) {
          const charTile = (baseTile + so) & 0x3ff; // 10-bit, matches renderBgLayer
          const vramByte = (charAddr + charTile * tileBytes) & 0xffff;
          const m = counts.get(vramByte) ?? new Map<number, number>();
          m.set(palRow, (m.get(palRow) ?? 0) + 1);
          counts.set(vramByte, m);
        }
      }
    }
  }

  // Exposed rows = the layer's loaded block first (index 0 = primary row), then
  // any extra rows the tilemap references.
  const extra = [...usedRows].filter((r) => !cfg.baseRows.includes(r)).sort((a, b) => a - b);
  const exposeRows = [...cfg.baseRows, ...extra];
  const rowIndex = new Map(exposeRows.map((r, i) => [r, i]));

  // Build each exposed row from CGRAM (index 0 transparent — BG2/BG3 hide it).
  const subPalettesRgba: Uint8Array[] = [];
  const subPalettesRgb: number[][] = [];
  for (const r of exposeRows) {
    const p = buildPaletteRow(cgram, r, true, 'expand', colorsPerRow);
    const rgba = new Uint8Array(colorsPerRow * 4);
    const rgb: number[] = [];
    for (let i = 0; i < colorsPerRow; i++) {
      const v = p[i]!;
      rgba[i * 4] = v & 0xff;
      rgba[i * 4 + 1] = (v >> 8) & 0xff;
      rgba[i * 4 + 2] = (v >> 16) & 0xff;
      rgba[i * 4 + 3] = (v >>> 24) & 0xff;
      rgb.push((rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!);
    }
    subPalettesRgba.push(rgba);
    subPalettesRgb.push(rgb);
  }

  // Dominant row per referenced tile → its index into subPalettes.
  const subByVramByte = new Map<number, number>();
  for (const [vb, m] of counts) {
    let bestRow = cfg.baseRows[0]!;
    let bestN = -1;
    for (const [r, n] of m) if (n > bestN) { bestRow = r; bestN = n; }
    subByVramByte.set(vb, rowIndex.get(bestRow) ?? 0);
  }

  return {
    subByVramByte,
    subPalettesRgba,
    subPalettesRgb,
    tileBytes,
    paletteAnimated: bgPaletteAnimated(cfg.name, header.animationPalette ?? 0)
  };
}

/**
 * Render every chunk-list gfx file used by `header`'s scene to a PNG — the tiles
 * coloured by the level's real palette (index 0 transparent for sprites) plus a
 * self-describing swatch (see `gfx-png.ts`). Deduped by (format, fileId) so a
 * file loaded into multiple slots exports once. Animated tiles are skipped (they
 * aren't single saveGfxEdit-able blobs). The companion import is
 * `imageToGfx(decodePng(png), layout)` → `saveGfxEdit`.
 */
export function exportLevelGfxPngs(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: RenderHeader,
  opts: { spritePaletteRow?: number; gfxOverride?: ReadonlyMap<string, Uint8Array>; format?: 'png' | 'aseprite' } = {}
): GfxPngEntry[] {
  const spritePaletteRow = Math.max(0, Math.min(7, opts.spritePaletteRow ?? 0));
  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512);
  const gfxManifest: GfxFileEntry[] = [];
  loadLevelGfx(rom, symbols, header, vram, gfxManifest, opts.gfxOverride);
  loadLevelPalettes(rom, symbols, header, cgram);
  const regs = loadSceneRegs(rom, symbols, header.levelMode ?? 0);
  const bgRows = bgPaletteBaseRows(rom, symbols, header.levelMode ?? 0);
  // When exporting Aseprite, build each file's tiles as an indexed tileset coloured
  // in its single render row (round-trip-safe; BG2/BG3 per-tile colour is PNG-only).
  const makeAse = opts.format === 'aseprite'
    ? (tileData: Uint8Array, bpp: 2 | 4, row: number, t0: boolean): Uint8Array =>
        gfxFileAseprite({ cgram, bpp, tileData, paletteRowPerTile: () => row, index0Transparent: t0 })
    : null;
  const lz2Table = symbols.pc('DATA_lz2_compressed_gfx_ptrs');
  const lz16Table = symbols.pc('DATA_lz16_compressed_gfx_ptrs');

  const out: GfxPngEntry[] = [];
  const seen = new Set<string>();
  // Per-tile-palette contexts, computed once per layer and reused across its files.
  let bg3Ctx: PerTilePaletteCtx | null = null;
  let bg2Ctx: PerTilePaletteCtx | null = null;
  for (const entry of gfxManifest) {
    const key = `${entry.format}/${entry.fileId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const params = inferRenderParams(entry, regs.bg3CharAddr, bgRows);
    const isSprite = params.layer === 'Sprite';
    const tileData = vram.subarray(entry.vramByteOffset, entry.vramByteOffset + entry.sizeBytes);
    const rowCount = entry.format === 'lz16' ? entry.sizeBytes / 512 : undefined; // 16 tiles × 32B
    const addr = u24le(rom, (entry.format === 'lz16' ? lz16Table : lz2Table) + entry.fileId * 3);
    const baseLayout = entry.format === 'lz16' ? lz16Layout(rowCount!) : lz2Layout(entry.sizeBytes, params.bpp);

    // BG2/BG3 → per-tile palette fidelity: colour each tile in the palette row its
    // tilemap cells use (not all in the layer's base row), with a reference swatch
    // of the exposed rows. Import decodes per-tile (a global swatch can't
    // disambiguate rows that share colours). BG3 = 2bpp/4-colour, BG2 = 4bpp/16.
    const perTile =
      params.layer === 'BG3'
        ? (bg3Ctx ??= computePerTilePalette(rom, symbols, header, cgram, {
            name: 'BG3', bpp: 2, baseRows: [bgRows.bg3, bgRows.bg3 + 1, bgRows.bg3 + 2, bgRows.bg3 + 3]
          }))
        : params.layer === 'BG2'
          ? (bg2Ctx ??= computePerTilePalette(rom, symbols, header, cgram, {
              name: 'BG2', bpp: 4, baseRows: [bgRows.bg2, bgRows.bg2 + 1]
            }))
          : null;

    if (perTile) {
      const cpr = colorsPerRow(params.bpp);
      const tileCount = Math.ceil(entry.sizeBytes / perTile.tileBytes);
      const tileSub: number[] = [];
      for (let t = 0; t < tileCount; t++) {
        const vramByte = (entry.vramByteOffset + t * perTile.tileBytes) & 0xffff;
        tileSub.push(perTile.subByVramByte.get(vramByte) ?? 0);
      }
      const swatch = new Uint8Array(perTile.subPalettesRgba.length * cpr * 4);
      perTile.subPalettesRgba.forEach((sp, i) => swatch.set(sp, i * cpr * 4));
      const layout: GfxImageLayout = { ...baseLayout, swatchColors: perTile.subPalettesRgba.length * cpr };
      const png = encodePng(
        gfxToImage(tileData, layout, swatch, {
          tilePaletteRgba: (t) => perTile.subPalettesRgba[tileSub[t] ?? 0]!
        })
      );
      out.push({
        fileId: entry.fileId,
        format: entry.format,
        bpp: params.bpp,
        role: classifyGfxRole(entry, params.layer),
        sizeBytes: entry.sizeBytes,
        rowCount,
        addr,
        index0Transparent: true,
        perTilePalette: { tileSub, subPalettes: perTile.subPalettesRgb, paletteAnimated: perTile.paletteAnimated },
        png: new Uint8Array(png),
        aseprite: makeAse ? makeAse(tileData, params.bpp, params.paletteRow, true) : undefined
      });
      continue;
    }

    const paletteRow = isSprite ? 8 + spritePaletteRow : params.paletteRow;
    const pal32 = buildPaletteRow(cgram, paletteRow, isSprite, 'expand', colorsPerRow(params.bpp));
    const palRgba = new Uint8Array(pal32.length * 4);
    for (let i = 0; i < pal32.length; i++) {
      const v = pal32[i]!;
      palRgba[i * 4] = v & 0xff;
      palRgba[i * 4 + 1] = (v >> 8) & 0xff;
      palRgba[i * 4 + 2] = (v >> 16) & 0xff;
      palRgba[i * 4 + 3] = (v >> 24) & 0xff;
    }
    const png = encodePng(gfxToImage(tileData, baseLayout, palRgba));
    out.push({
      fileId: entry.fileId,
      format: entry.format,
      bpp: params.bpp,
      role: classifyGfxRole(entry, params.layer),
      sizeBytes: entry.sizeBytes,
      rowCount,
      addr,
      index0Transparent: isSprite,
      png: new Uint8Array(png),
      aseprite: makeAse ? makeAse(tileData, params.bpp, paletteRow, isSprite) : undefined
    });
  }
  return out;
}
