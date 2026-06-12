// Static enemy-sprite layer renderer (sprite render tier 1, the OAM pixel
// pass). For each level sprite that resolves to a Format-B cel, decode frame 0,
// derive its dynamic OBJ tile base, composite it via `renderSpriteCel`, and blit
// the result into a full-extent RGBA layer at the sprite's pixel position. The
// canvas draws this UNDER the existing vector-glyph overlay (tiers 2-3), which
// stays for sprites without a cel (generators / no-visual command sprites
// $1BA-$1C9) and for selection/hover.
//
// Output sizing mirrors `render-bg1.ts`: the full theoretical level extent
// (16 × 8 screens = 4096 × 2048 px), so the canvas draws it at level-cell
// origin with no offset. Most of the bitmap is alpha=0 (compresses trivially
// in IPC transport).
//
// # Incremental (Tier 2) re-render — mirrors BG1/collision
//
// A sprite edit usually changes ONE sprite, so re-shipping the whole 33.6 MB
// layer is wasteful. Like BG1, we diff at 16×16-cell granularity and ship only
// the changed cells (a `LayerCellPatch`) onto a renderer backing canvas. BG1's
// diff substrate is exact (one Map16 ID per cell); sprites are entities with
// arbitrary footprints, overlap, and z-order, so there's no natural per-cell ID.
// Instead we build a per-cell **content-signature** grid (`buildSpriteCellGrid`):
// each renderable sprite folds a hash of (num, placed x/y, draw index) into every
// cell its footprint covers, in draw order. Within a token chain the header is
// fixed, so a cel's pixels are a pure function of `num` → the signature fully
// determines a cell's rendered pixels. Diffing two signature grids
// (`diffCellGrids`, shared with BG1) yields the changed cells; `renderSpritePatch`
// re-composites just those cells (clipped to 16×16, in draw order = the full
// path's overwrite order → byte-identical). The only cost vs BG1's exact IDs is an
// astronomically unlikely 32-bit hash collision, bounded by full renders on level/
// tileset switch (and proven equal to a full render by render-sprite-patch.test.ts).

import { renderSpriteCel } from './sprite-cel.ts';
import { parityCelVariantIndex, resolveSpriteCel } from './sprite-tile-base.ts';
import { DYNAMIC_BODY_SOURCES } from './sprite-dynamic-gfx.ts';
import { GRID_COLS, GRID_ROWS } from './cell-grid.ts';
import type { GfxFileEntry, GfxHeader } from './load-graphics.ts';
import type { SymbolMap } from './symbol-map.ts';
import type { LevelSprite } from '../types.ts';
import type { Bg1RenderResult, LayerCellPatch, SpriteCelBounds, SpriteLayerResult } from '../types.ts';

const CELL_PX = 16;
const SCREENS_WIDE = 16;
const SCREENS_TALL = 8;
const CELLS_PER_SCREEN_EDGE = 16;
const TOTAL_WIDTH = SCREENS_WIDE * CELLS_PER_SCREEN_EDGE * CELL_PX; // 4096
const TOTAL_HEIGHT = SCREENS_TALL * CELLS_PER_SCREEN_EDGE * CELL_PX; // 2048

export interface RenderSpriteLayerArgs {
  rom: Uint8Array;
  symbols: SymbolMap;
  /** Header gfx fields — only `spriteTileset` is read (for the tile-base
   *  derivation), but the full GfxHeader is accepted for caller convenience. */
  header: Pick<GfxHeader, 'spriteTileset'>;
  /** The level's sprites (`LevelData.sprites`). */
  sprites: readonly LevelSprite[];
  /** Sprite VRAM populated by `loadLevelGfx`. */
  vram: Uint8Array;
  /** CGRAM populated by `loadLevelPalettes` (sprite palettes rows 8..15). */
  cgram: Uint8Array;
  /** `loadLevelGfx`'s manifest for THIS level — used to derive the OBJ name
   *  base. Optional; omit to use the static fallback base. */
  manifest?: GfxFileEntry[];
  /** Allow-set of sprite nums that render a **Format-B** `special_chr` cel.
   *  Built renderer-side from the prebaked `obj-metadata` `cel === 'B'` field
   *  (a ground-truth categorization replacing the old `category` proxy). Omit to
   *  render every resolvable sprite (no gate). */
  celRenderableNums?: ReadonlySet<number>;
  /** Allow-set of sprite nums that render a **Format-A** single tile (items),
   *  from `cel === 'A'`. Rendered AND forced down the Format-A path (so sprites
   *  carrying both a `special_chr` and an `object_data`, e.g. the Key, draw A).
   *  Only consulted when `celRenderableNums` is supplied. */
  formatANums?: ReadonlySet<number>;
  /** The level's sprite-palette id (`LevelHeaderSpritePaletteLo`, header field 8).
   *  Threaded to `resolveSpriteCel` for the Red Coin's level-state-dependent
   *  runtime recolour; harmless to omit. */
  levelSpritePaletteId?: number;
}

/** One sprite instance placed in the layer: its composited cel pixels (shared by
 *  `num` — the bitmap is identical for every instance of a num within a level's
 *  gfx, except placement-parity sprites, which share per (num, parity)) plus
 *  where it lands and its z (draw index = position in the sprite list;
 *  later = painted on top). */
interface PlacedSprite {
  num: number;
  /** Position in the level's sprite list — the z-order (overwrite order). */
  drawIndex: number;
  /** Placed bitmap top-left in level pixels (`x*16 - originX`, `y*16 - originY`). */
  baseX: number;
  baseY: number;
  width: number;
  height: number;
  /** The cel's RGBA pixels as u32 (shared per num). `width * height` long. */
  pixels: Uint32Array;
}

/** The resolved sprite render model for one request: every renderable sprite
 *  placed, plus the per-num cel bounds the canvas needs for hit-test/selection.
 *  Built once (`buildSpriteRenderModel`), then consumed by the full composite,
 *  the cell-signature grid, and the patch renderer. */
export interface SpriteRenderModel {
  placed: PlacedSprite[];
  boundsByNum: Map<number, SpriteCelBounds>;
}

/** Per-cell content-signature grid (the sprite diff substrate) + the per-cell
 *  sprite lists the patch renderer composites from. */
export interface SpriteCellGrid {
  /** `GRID_COLS * GRID_ROWS` (256×128) signatures; 0 = no sprite covers the cell. */
  grid: Uint32Array;
  /** cell index (`cy*GRID_COLS + cx`) → sprites covering it, in draw order. */
  cellSprites: Map<number, PlacedSprite[]>;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const fnvStep = (acc: number, x: number): number => Math.imul(acc ^ (x >>> 0), FNV_PRIME) >>> 0;

/** Content hash of one placed sprite: its identity (num), placement (baseX/Y),
 *  and z (drawIndex). Any move/reorder/type change of a sprite alters the hash of
 *  every cell it covers → that cell diffs dirty. */
function placedHash(p: PlacedSprite): number {
  let h = fnvStep(FNV_OFFSET, p.num);
  h = fnvStep(h, p.baseX & 0xffff);
  h = fnvStep(h, p.baseY & 0xffff);
  h = fnvStep(h, p.drawIndex);
  return h;
}

/**
 * Resolve + render every renderable sprite once, producing the placement model.
 * Cel bitmaps are deduped by `num` (identical per num within a level's gfx), so
 * 100 of the same enemy render the cel once. Sprites that gate out / don't resolve
 * are omitted (they fall through to the glyph tier).
 */
export function buildSpriteRenderModel(args: RenderSpriteLayerArgs): SpriteRenderModel {
  const { rom, symbols, header, sprites, vram, cgram, manifest, celRenderableNums, formatANums, levelSpritePaletteId } = args;
  const boundsByNum = new Map<number, SpriteCelBounds>();
  const placed: PlacedSprite[] = [];
  // Cel bitmap per cache key (null = resolved-but-empty / gated out, cached so we
  // don't re-resolve a repeat). The key is normally the num (`preferFormatA` is a
  // pure function of num); placement-parity sprites (the arrow signs — see
  // `parityCelVariantIndex`) resolve a DIFFERENT cel per cell parity, so their
  // key folds the variant index in above the 9-bit num range.
  const celByNum = new Map<number, { pixels: Uint32Array; width: number; height: number; originX: number; originY: number } | null>();

  for (let i = 0; i < sprites.length; i++) {
    const spr = sprites[i]!;
    const preferFormatA = formatANums?.has(spr.num) ?? false;
    if (celRenderableNums) {
      const renderable = celRenderableNums.has(spr.num) || preferFormatA || spr.num in DYNAMIC_BODY_SOURCES;
      if (!renderable) continue;
    }
    const parityIdx = parityCelVariantIndex(spr.num, spr.x, spr.y);
    const celKey = parityIdx === null ? spr.num : spr.num + (parityIdx + 1) * 0x10000;
    let cel = celByNum.get(celKey);
    if (cel === undefined) {
      const resolved = resolveSpriteCel(
        rom, symbols, header, spr.num, manifest, preferFormatA, levelSpritePaletteId,
        parityIdx === null ? undefined : { x: spr.x, y: spr.y }
      );
      if (!resolved) {
        cel = null;
      } else {
        const img = renderSpriteCel(resolved.cel, { vram, cgram, tileBaseBytes: resolved.tileBaseBytes, dynamicBody: resolved.dynamicBody });
        cel = img.width === 0 || img.height === 0
          ? null
          : {
              pixels: new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length >>> 2).slice(),
              width: img.width,
              height: img.height,
              originX: img.originX,
              originY: img.originY
            };
      }
      celByNum.set(celKey, cel);
    }
    if (!cel) continue;
    const prev = boundsByNum.get(spr.num);
    if (!prev) {
      boundsByNum.set(spr.num, { num: spr.num, originX: cel.originX, originY: cel.originY, width: cel.width, height: cel.height });
    } else if (prev.width !== cel.width || prev.height !== cel.height || prev.originX !== cel.originX || prev.originY !== cel.originY) {
      // Parity-variant cels differ per placement (e.g. the arrow sign's vertical
      // 16×24 vs horizontal 24×16 frames) but the canvas hit-test box is per num —
      // grow it to the union of every variant seen, in anchor-relative space.
      const left = Math.max(prev.originX, cel.originX);
      const top = Math.max(prev.originY, cel.originY);
      const right = Math.max(prev.width - prev.originX, cel.width - cel.originX);
      const bottom = Math.max(prev.height - prev.originY, cel.height - cel.originY);
      boundsByNum.set(spr.num, { num: spr.num, originX: left, originY: top, width: left + right, height: top + bottom });
    }
    placed.push({
      num: spr.num,
      drawIndex: i,
      baseX: spr.x * CELL_PX - cel.originX,
      baseY: spr.y * CELL_PX - cel.originY,
      width: cel.width,
      height: cel.height,
      pixels: cel.pixels
    });
  }
  return { placed, boundsByNum };
}

/**
 * Build the per-cell content-signature grid + per-cell sprite lists from a model.
 * A cell's signature folds (in draw order) the hash of every sprite whose
 * footprint covers it, seeded nonzero on first touch so a covered cell is ~never
 * 0 (the "no sprite" sentinel the diff treats as a cleared cell).
 */
export function buildSpriteCellGrid(model: SpriteRenderModel): SpriteCellGrid {
  const grid = new Uint32Array(GRID_COLS * GRID_ROWS);
  const cellSprites = new Map<number, PlacedSprite[]>();
  for (const p of model.placed) {
    const cx0 = Math.max(0, p.baseX >> 4);
    const cy0 = Math.max(0, p.baseY >> 4);
    const cx1 = Math.min(GRID_COLS - 1, (p.baseX + p.width - 1) >> 4);
    const cy1 = Math.min(GRID_ROWS - 1, (p.baseY + p.height - 1) >> 4);
    if (cx1 < cx0 || cy1 < cy0) continue; // fully off-grid
    const h = placedHash(p);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ci = cy * GRID_COLS + cx;
        grid[ci] = fnvStep(grid[ci] === 0 ? FNV_OFFSET : grid[ci]!, h);
        let list = cellSprites.get(ci);
        if (!list) { list = []; cellSprites.set(ci, list); }
        list.push(p);
      }
    }
  }
  return { grid, cellSprites };
}

/** Blit one placed sprite's overlapping 16×16 window into a cell scratch buffer
 *  (transparent pixels skipped, opaque overwrite — same rule as the full path). */
function blitIntoCell(p: PlacedSprite, cellPx0: number, cellPy0: number, scratch: Uint32Array): void {
  const sx0 = cellPx0 - p.baseX; // sprite-local x at the cell's left edge
  const sy0 = cellPy0 - p.baseY;
  for (let yy = 0; yy < CELL_PX; yy++) {
    const sy = sy0 + yy;
    if (sy < 0 || sy >= p.height) continue;
    const srcRow = sy * p.width;
    const dstRow = yy * CELL_PX;
    for (let xx = 0; xx < CELL_PX; xx++) {
      const sx = sx0 + xx;
      if (sx < 0 || sx >= p.width) continue;
      const px = p.pixels[srcRow + sx]!;
      if ((px & 0xff000000) === 0) continue; // transparent
      scratch[dstRow + xx] = px;
    }
  }
}

/**
 * Composite ONLY the given changed cells into a sparse `LayerCellPatch`. Each cell
 * is rebuilt from the sprites covering it (in draw order), so the patched backing
 * canvas is byte-identical to a full render of the same state.
 */
export function renderSpritePatch(model: SpriteRenderModel, cellGrid: SpriteCellGrid, coords: Int32Array): LayerCellPatch {
  void model;
  const n = coords.length >>> 1;
  const cellBytes = CELL_PX * CELL_PX * 4;
  const rgba = new Uint8Array(n * cellBytes);
  const scratch = new Uint32Array(CELL_PX * CELL_PX);
  const scratchBytes = new Uint8Array(scratch.buffer);
  for (let i = 0; i < n; i++) {
    const cx = coords[i * 2]!;
    const cy = coords[i * 2 + 1]!;
    scratch.fill(0);
    const list = cellGrid.cellSprites.get(cy * GRID_COLS + cx);
    if (list) {
      const cellPx0 = cx * CELL_PX;
      const cellPy0 = cy * CELL_PX;
      for (const p of list) blitIntoCell(p, cellPx0, cellPy0, scratch);
    }
    rgba.set(scratchBytes, i * cellBytes);
  }
  return { cellPx: CELL_PX, width: TOTAL_WIDTH, height: TOTAL_HEIGHT, coords, rgba };
}

/** Composite the whole model into a full-extent RGBA layer (first load / level /
 *  tileset / changer change, or a too-large diff). */
export function compositeSpriteFull(model: SpriteRenderModel): Bg1RenderResult {
  const rgba = new Uint8Array(TOTAL_WIDTH * TOTAL_HEIGHT * 4);
  const outU32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  for (const p of model.placed) {
    for (let y = 0; y < p.height; y++) {
      const dy = p.baseY + y;
      if (dy < 0 || dy >= TOTAL_HEIGHT) continue;
      const srcRow = y * p.width;
      const dstRow = dy * TOTAL_WIDTH;
      for (let x = 0; x < p.width; x++) {
        const sp = p.pixels[srcRow + x]!;
        if ((sp & 0xff000000) === 0) continue; // transparent
        const dx = p.baseX + x;
        if (dx < 0 || dx >= TOTAL_WIDTH) continue;
        outU32[dstRow + dx] = sp;
      }
    }
  }
  return { rgba, width: TOTAL_WIDTH, height: TOTAL_HEIGHT };
}

/**
 * Composite the level's Format-B sprites into a full-extent RGBA layer + per-num
 * bounds — the non-incremental path, kept for the shared `render-level-layers`
 * orchestration (render-cli / render-snapshot). The IPC handler uses the
 * model/grid/patch pieces directly for incremental re-render.
 */
export function renderSpriteLayer(args: RenderSpriteLayerArgs): SpriteLayerResult {
  const model = buildSpriteRenderModel(args);
  const full = compositeSpriteFull(model);
  return { ...full, bounds: [...model.boundsByNum.values()] };
}
