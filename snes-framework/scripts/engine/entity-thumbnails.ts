// Picker thumbnails (§B5): render each catalog entry to a small bitmap under
// one level's header, so the Add picker shows what an entity would actually
// look like in the current level — the render-validity signal made visible.
//
// Objects: decode the candidate ALONE in a synthetic one-object level (the
// same probe semantics entity-render-validity.ts validated — no neighbours,
// fixed position, metadata default size) and blit exactly the cells it
// stamped via the bg1 cell renderer (`renderBg1Patch`), cropped to the
// stamped bounding box and clamped to THUMB_MAX_CELLS² cells.
//
// Sprites: the static sprite-cel pipeline (`resolveSpriteCel` at the
// parity-0 / no-placement variant + `renderSpriteCel`). The cel gate mirrors
// `render:spriteLayer`'s (metadata `cel` A/B sets + the dynamic-body table);
// ungated nums and unresolvable cels yield null — the glyph tier has no
// faithful bitmap, and the picker shows the text-only row.
//
// One thumbnailer per gfx-header tuple: gfx/palette/Map16/scene-regs loaded
// once, then per-entry renders are cheap. Two VRAM buffers on purpose — the
// BG side needs the tile-animation overlay, the OBJ side must NOT have it
// (tile animation overwrites sprite-region slots; same split as
// buildLevelVramCgram's `animate` flag).

import { decodeLevelFromLevelData } from './object-decode/index.ts';
import { loadMap16Tables } from './map16.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { loadLevelGfx, type GfxHeader } from './load-graphics.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import { renderBg1Patch } from './render-bg1.ts';
import { resolveCellGrid, GRID_COLS, GRID_ROWS } from './cell-grid.ts';
import { resolveSpriteCel } from './sprite-tile-base.ts';
import { renderSpriteCel } from './sprite-cel.ts';
import { DYNAMIC_BODY_SOURCES } from './sprite-dynamic-gfx.ts';
import type { SymbolMap } from './symbol-map.ts';
import type { GfxFileEntry, LevelData, LevelObject } from '../types.ts';

const CELL_PX = 16;
/** Clamp huge objects to their top-left N×N stamped cells — a thumbnail, not
 *  a render. 6 cells = 96 px, comfortably above the picker's display size. */
const THUMB_MAX_CELLS = 6;

export interface ThumbImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface EntityThumbnailerArgs {
  rom: Uint8Array;
  symbols: SymbolMap;
  workRoot: string;
  /** Header + serializer donor — same contract as createValidityProbe. */
  donor: LevelData;
  isWorld6: boolean;
  /** The metadata cel gates, mirroring `render:spriteLayer`'s request fields
   *  (`cel === 'B'` / `cel === 'A'` nums). Sprites outside the gate (and the
   *  dynamic-body table) are glyph-tier → null thumbnails. */
  celRenderableNums: ReadonlySet<number>;
  formatANums: ReadonlySet<number>;
}

export interface EntityThumbnailer {
  /** PPU mode-7 arena — no normal BG1, object thumbnails not meaningful. */
  mode7: boolean;
  /** Bitmap of the candidate's stamped cells, or null (stamps nothing /
   *  decode failed / mode-7). */
  objectThumb(kind: 'std' | 'ext', id: number, w: number, h: number): ThumbImage | null;
  /** Bitmap of the sprite's frame-0 cel, or null (glyph tier). */
  spriteThumb(num: number): ThumbImage | null;
}

export function createEntityThumbnailer(args: EntityThumbnailerArgs): EntityThumbnailer {
  const { rom, symbols, workRoot, donor, celRenderableNums, formatANums } = args;
  const h = donor.header;
  const gfxHeader: GfxHeader = {
    bg1Tileset: h[1] ?? 0,
    bg2Tileset: h[3] ?? 0,
    bg3Tileset: h[5] ?? 0,
    spriteTileset: h[7] ?? 0,
    isWorld6: args.isWorld6
  };
  const palHeader: PaletteHeader = {
    bgColor: h[0] ?? 0,
    bg1Palette: h[2] ?? 0,
    bg2Palette: h[4] ?? 0,
    bg3Palette: h[6] ?? 0,
    spritePalette: h[8] ?? 0,
    yoshiColor: 0,
    isWorld6: args.isWorld6,
    levelMode: h[9] ?? 0
  };
  const manifest: GfxFileEntry[] = [];
  const vramBg = new Uint8Array(0x10000);
  loadLevelGfx(rom, symbols, gfxHeader, vramBg, manifest);
  // OBJ-side VRAM = the pre-animation copy (see the file header).
  const vramObj = vramBg.slice();
  loadTileAnimation(
    rom,
    symbols,
    { animationTileset: h[10] ?? 0, bg1Tileset: gfxHeader.bg1Tileset, levelMode: h[9] ?? 0 },
    vramBg
  );
  const cgram = new Uint8Array(512);
  loadLevelPalettes(rom, symbols, palHeader, cgram, new Int32Array(256));
  const map16Tables = loadMap16Tables(rom, symbols);
  const regs = loadSceneRegs(rom, symbols, h[9] ?? 0);
  const mode7 = (regs.bgmode & 7) === 7;

  const objectThumb = (
    kind: 'std' | 'ext',
    id: number,
    w0: number,
    h0: number
  ): ThumbImage | null => {
    if (mode7) return null;
    const obj: LevelObject = {
      index: 0,
      num: kind === 'std' ? id : 0,
      exnum: kind === 'ext' ? id : undefined,
      x: 24,
      y: 64,
      w: Math.max(1, w0),
      h: Math.max(1, h0),
      raw: []
    };
    let decoded;
    try {
      decoded = decodeLevelFromLevelData({
        rom, symbols, workRoot,
        levelData: { ...donor, objects: [obj], sprites: [], exits: [] }
      });
    } catch {
      return null;
    }
    if (!decoded || decoded.stats.aborted) return null;

    // Bounding box of the stamped cells.
    const grid = resolveCellGrid(decoded.state.levelDataBuffer, decoded.state.screenPageMap);
    let minX = GRID_COLS, minY = GRID_ROWS, maxX = -1, maxY = -1;
    for (let cy = 0; cy < GRID_ROWS; cy++) {
      for (let cx = 0; cx < GRID_COLS; cx++) {
        if (grid[cy * GRID_COLS + cx] === 0) continue;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
    }
    if (maxX < 0) return null; // stamps nothing (command / no-visual)
    maxX = Math.min(maxX, minX + THUMB_MAX_CELLS - 1);
    maxY = Math.min(maxY, minY + THUMB_MAX_CELLS - 1);
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;

    const coords = new Int32Array(bw * bh * 2);
    let n = 0;
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        coords[n * 2] = cx;
        coords[n * 2 + 1] = cy;
        n++;
      }
    }
    const patch = renderBg1Patch(
      {
        vram: vramBg,
        cgram,
        map16Tables,
        levelDataBuffer: decoded.state.levelDataBuffer,
        screenPageMap: decoded.state.screenPageMap,
        bg1CharAddr: regs.bg1CharAddr
      },
      coords
    );

    // Assemble the per-cell blocks (coords order) into one bbox bitmap.
    const width = bw * CELL_PX;
    const height = bh * CELL_PX;
    const rgba = new Uint8Array(width * height * 4);
    const cellBytes = CELL_PX * CELL_PX * 4;
    const rowBytes = CELL_PX * 4;
    for (let i = 0; i < n; i++) {
      const dx = (coords[i * 2] - minX) * CELL_PX;
      const dy = (coords[i * 2 + 1] - minY) * CELL_PX;
      for (let row = 0; row < CELL_PX; row++) {
        const src = i * cellBytes + row * rowBytes;
        const dst = ((dy + row) * width + dx) * 4;
        rgba.set(patch.rgba.subarray(src, src + rowBytes), dst);
      }
    }
    return { rgba, width, height };
  };

  const spriteThumb = (num: number): ThumbImage | null => {
    const preferFormatA = formatANums.has(num);
    const renderable =
      celRenderableNums.has(num) || preferFormatA || num in DYNAMIC_BODY_SOURCES;
    if (!renderable) return null;
    let resolved;
    try {
      resolved = resolveSpriteCel(
        rom, symbols, gfxHeader, num, manifest, preferFormatA, palHeader.spritePalette
      );
    } catch {
      return null;
    }
    if (!resolved) return null;
    const img = renderSpriteCel(resolved.cel, {
      vram: vramObj,
      cgram,
      tileBaseBytes: resolved.tileBaseBytes,
      dynamicBody: resolved.dynamicBody
    });
    if (img.width <= 0 || img.height <= 0) return null;
    // All-transparent cel ⇒ no thumbnail (an empty box would read as a bug).
    let opaque = false;
    for (let i = 3; i < img.rgba.length; i += 4) {
      if (img.rgba[i] !== 0) { opaque = true; break; }
    }
    if (!opaque) return null;
    return { rgba: img.rgba, width: img.width, height: img.height };
  };

  return { mode7, objectThumb, spriteThumb };
}
