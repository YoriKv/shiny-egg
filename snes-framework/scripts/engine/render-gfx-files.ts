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
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import {
  loadTileAnimation,
  type TileAnimationEntry
} from './load-tile-animation.ts';
import { loadSceneRegs } from './scene-regs.ts';
import type { SymbolMap } from './symbol-map.ts';
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

interface RenderHeader extends GfxHeader, PaletteHeader {
  animationTileset?: number;
  levelMode?: number;
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
 * flag is the only runtime check — so future shiny-egg work that
 * adds files should keep BG1/BG3 as LZ2 and BG2/Sprite as LZ16. */
function inferRenderParams(
  entry: GfxFileEntry,
  bg3CharAddr: number
): { bpp: 2 | 4; paletteRow: number; layer: string } {
  if (entry.dpSlot !== undefined) {
    const layer = dpSlotLayer(entry.dpSlot);
    if (layer === 'BG3') return { bpp: 2, paletteRow: 0, layer: 'BG3' };
    if (layer === 'Sprite') return { bpp: 4, paletteRow: 8, layer: 'Sprite' };
    return { bpp: 4, paletteRow: 0, layer };
  }
  if (
    bg3CharAddr > 0 &&
    entry.vramByteOffset >= bg3CharAddr &&
    entry.vramByteOffset < bg3CharAddr + 0x2000
  ) {
    return { bpp: 2, paletteRow: 0, layer: 'BG3' };
  }
  if (entry.vramByteOffset >= SPRITE_VRAM_START) {
    // LZ format breaks the BG1-vs-sprite tie in upper VRAM.
    if (entry.format === 'lz2') {
      return { bpp: 4, paletteRow: 0, layer: 'BG1' };
    }
    return { bpp: 4, paletteRow: 8, layer: 'Sprite' };
  }
  return { bpp: 4, paletteRow: 0, layer: 'BG1/BG2' };
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
    const params = inferRenderParams(entry, regs.bg3CharAddr);
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
  // Each is 4 tiles (0x80 bytes at 4bpp). Rendered at BG1 palette row 0
  // since these tiles are referenced by BG1 cells.
  const animPalette = getPalette(0, 4);
  for (const entry of animManifest) {
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
        `${tileCount} tiles · 4bpp pal 0 · init_tileset_animation`,
      bpp: 4,
      paletteRow: 0,
      vramByteOffset: entry.vramByteOffset,
      tileCount,
      rgba: rendered.rgba,
      width: rendered.width,
      height: rendered.height
    });
  }

  return { blocks };
}
