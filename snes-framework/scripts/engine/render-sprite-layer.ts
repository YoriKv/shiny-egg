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
import { parityCelVariantIndex, resolveSpriteCel, SPRITE_RENDER_ALIAS } from './sprite-tile-base.ts';
import { DYNAMIC_BODY_SOURCES } from './sprite-dynamic-gfx.ts';
import { SYNTHESIZED_CELS } from './sprite-synth-cel.ts';
import { CUSTOM_SPRITE_RENDERERS, type CustomSpriteRenderer } from './sprite-custom-render.ts';
import { CEL_B_NUMS, FORMAT_A_NUMS, SETTLED_PALETTE_ROW, REST_FRAME } from './sprite-render-facts.ts';
import { parityIndex, HIDDEN_REVEAL, SPRITE_PARITY_PALETTE } from './sprite-parity.ts';
import { GRID_COLS, GRID_ROWS } from './cell-grid.ts';
import type { GfxFileEntry, GfxHeader } from './load-graphics.ts';
import type { SymbolMap } from './symbol-map.ts';
import type { LevelSprite } from '../types.ts';
import type { Bg1RenderResult, LayerCellPatch, SpriteCelBounds, SpriteLayerResult } from '../types.ts';

// Sprites that render their OWN cel but only become visible under a runtime condition the editor
// can't show — drawn at 50% opacity (like the HIDDEN_REVEAL targets) so the placement reads as
// "conditionally here". $098 End-Transformation Block only appears while Yoshi is morphed; $059
// Stationary Super Star only shows its star conditionally (spawns/parks the drawn star vs the
// super-star pickup state — shared Main with $088).
const CONDITIONAL_HALF_OPACITY: ReadonlySet<number> = new Set([0x098, 0x059]);

/**
 * Per-sprite ANCHOR shift applied at placement: the sprite's Init routine moves its world position
 * away from the placed-cell anchor before the first frame draws, so the static render (which pins the
 * cel/body to the cell) lands in the wrong spot without this. `{dx,dy}` is the *world* delta the Init
 * adds (px, +y = down); we subtract it from the cel origin so the bitmap — and the hit-test bounds,
 * which share that origin — both shift by `(dx,dy)`. DERIVE each entry from the Init's position
 * stores, never by eyeballing.
 *
 *   $157 Wall Lakitu (`init_lakitu_wall` $07:C2D6): X (`$70E2`) is read-only (its bit-4 picks the
 *   wall side); Y (`$7182`) gets `ADC #$000B` → spawns 11 px BELOW the placed cell. (`Bank07.asm:8392`.)
 */
const INIT_ANCHOR_OFFSET: Readonly<Partial<Record<number, { dx: number; dy: number }>>> = {
  0x157: { dx: 0, dy: 11 }
};

const CELL_PX = 16;
const SCREENS_WIDE = 16;
const SCREENS_TALL = 8;
const CELLS_PER_SCREEN_EDGE = 16;
const TOTAL_WIDTH = SCREENS_WIDE * CELLS_PER_SCREEN_EDGE * CELL_PX; // 4096
const TOTAL_HEIGHT = SCREENS_TALL * CELLS_PER_SCREEN_EDGE * CELL_PX; // 2048

export interface RenderSpriteLayerArgs {
  rom: Uint8Array;
  symbols: SymbolMap;
  /** Header gfx fields — `spriteTileset` (tile-base derivation) plus `levelMode`
   *  (read by the donut-lift Map16-stamp custom renderers for the BG1 char base)
   *  and `spritesetOverride` (a minted spriteset, threaded into the tile-base slot
   *  lookup so it matches the VRAM `loadLevelGfx` loaded); the full GfxHeader is
   *  accepted for caller convenience. */
  header: Pick<GfxHeader, 'spriteTileset' | 'levelMode' | 'spritesetOverride'>;
  /** The level's sprites (`LevelData.sprites`). */
  sprites: readonly LevelSprite[];
  /** Sprite VRAM populated by `loadLevelGfx`. */
  vram: Uint8Array;
  /** CGRAM populated by `loadLevelPalettes` (sprite palettes rows 8..15). */
  cgram: Uint8Array;
  /** `loadLevelGfx`'s manifest for THIS level — used to derive the OBJ name
   *  base. Optional; omit to use the static fallback base. */
  manifest?: GfxFileEntry[];
  /** The level's sprite-palette id (`LevelHeaderSpritePaletteLo`, header field 8).
   *  Threaded to `resolveSpriteCel` for the Red Coin's level-state-dependent
   *  runtime recolour; harmless to omit. */
  levelSpritePaletteId?: number;
  // NB: the per-sprite cel-format gate (Format-A/B), settled palette row (SP4) and rest frame
  // (SP3) are asm-fixed render facts now OWNED by the engine — see sprite-render-facts.ts. They
  // are read directly below, no longer threaded in from the renderer.
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
  const { rom, symbols, header, sprites, vram, cgram, manifest, levelSpritePaletteId } = args;
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
    // Hidden-until-interaction sprites (e.g. $0B5 Hidden Winged Cloud) have no cel of their
    // own and render nothing statically. When the placed sprite isn't otherwise renderable,
    // fall back to the asm-defined REVEALED target (chosen by spawn-cell parity) drawn at 50%
    // opacity, so the editor shows what's hidden there rather than a blank cell.
    const baseRenderable = CEL_B_NUMS.has(spr.num) || FORMAT_A_NUMS.has(spr.num) || spr.num in DYNAMIC_BODY_SOURCES || spr.num in SYNTHESIZED_CELS || spr.num in CUSTOM_SPRITE_RENDERERS;
    let renderNum = spr.num;
    let revealed = false;
    if (!baseRenderable) {
      const targets = HIDDEN_REVEAL[spr.num];
      if (!targets) continue;
      renderNum = targets[parityIndex(spr.x, spr.y)]!;
      revealed = true;
    }
    // Render-as alias ($034 Roger's Pot → $0DA flower pot): borrow the alias id's whole cel render
    // (chr cel, facts, tile base, $7042). The cache key + custom-renderer lookup stay on spr.num, so
    // no collision with the real alias sprite.
    if (!revealed) renderNum = SPRITE_RENDER_ALIAS.get(spr.num) ?? renderNum;
    const preferFormatA = FORMAT_A_NUMS.has(renderNum);
    // A revealed target renders through the normal cel path (never a custom renderer).
    const customRenderer: CustomSpriteRenderer | undefined = revealed ? undefined : CUSTOM_SPRITE_RENDERERS[spr.num];
    const parityIdx = parityCelVariantIndex(renderNum, spr.x, spr.y);
    // Some sprites pick their PALETTE (not a different cel) from spawn-cell parity — the shy-guy
    // family ($01E/$133/$124/$192), stilt/fat/woozy guy, Mock-Up, Piscatory Pete (SPRITE_PARITY_
    // PALETTE). Like cel-variant parity these vary per placed cell, so they need placement passed
    // to the resolver AND a parity-keyed cache slot — else every instance reuses one cached colour
    // (the $01E Shy Guy bug: it always rendered parity-0 green regardless of cell).
    const palParityIdx = SPRITE_PARITY_PALETTE[renderNum] !== undefined ? parityIndex(spr.x, spr.y) : null;
    const parityKeyIdx = parityIdx ?? palParityIdx;
    // Cel cache key: revealed cels get a high bit so the 50%-opacity bitmap never collides
    // with the same target sprite's full-opacity cel placed directly elsewhere.
    const celKey = revealed ? renderNum + 0x800000
      : customRenderer ? spr.num + (spr.x & 1) * 0x10000
      : parityKeyIdx === null ? spr.num : spr.num + (parityKeyIdx + 1) * 0x10000;
    let cel = celByNum.get(celKey);
    if (cel === undefined) {
      if (customRenderer) {
        const rs = customRenderer({ rom, symbols, vram, cgram, cellX: spr.x, cellY: spr.y, header, manifest, levelSpritePaletteId });
        cel = !rs || rs.width === 0 || rs.height === 0
          ? null
          : { pixels: new Uint32Array(rs.rgba.buffer, rs.rgba.byteOffset, rs.rgba.length >>> 2).slice(), width: rs.width, height: rs.height, originX: rs.originX, originY: rs.originY };
        celByNum.set(celKey, cel);
        if (!cel) continue;
        // (fall through to the blit below)
      } else {
      const resolved = resolveSpriteCel(
        rom, symbols, header, renderNum, manifest, preferFormatA, levelSpritePaletteId,
        parityKeyIdx !== null || revealed ? { x: spr.x, y: spr.y } : undefined,
        SETTLED_PALETTE_ROW.get(renderNum),
        REST_FRAME.get(renderNum)
      );
      if (!resolved) {
        cel = null;
      } else {
        const img = renderSpriteCel(resolved.cel, { vram, cgram, tileBaseBytes: resolved.tileBaseBytes, dynamicBody: resolved.dynamicBody });
        if (img.width === 0 || img.height === 0) {
          cel = null;
        } else {
          const pixels = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length >>> 2).slice();
          // Revealed (hidden-until-interaction) targets AND conditionally-visible sprites (e.g.
          // $098, only shown when morphed) render at 50% opacity — halve each pixel's alpha byte
          // (ARGB high byte) so the placement reads as "hidden / conditionally here".
          if (revealed || CONDITIONAL_HALF_OPACITY.has(spr.num)) for (let p = 0; p < pixels.length; p++) pixels[p] = (pixels[p]! & 0x00ffffff) | (((pixels[p]! >>> 25) & 0x7f) << 24);
          cel = { pixels, width: img.width, height: img.height, originX: img.originX, originY: img.originY };
        }
      }
      celByNum.set(celKey, cel);
      }
    }
    if (!cel) continue;
    // Init-time anchor shift (e.g. $157 Wall Lakitu spawns +11 px down): subtract the world delta
    // from the origin so placement AND the shared hit-test bounds move together. Keyed on spr.num
    // (the placed sprite whose Init runs), not renderNum, so an alias/reveal target doesn't borrow it.
    const initOff = INIT_ANCHOR_OFFSET[spr.num];
    const originX = cel.originX - (initOff?.dx ?? 0);
    const originY = cel.originY - (initOff?.dy ?? 0);
    const prev = boundsByNum.get(spr.num);
    if (!prev) {
      boundsByNum.set(spr.num, { num: spr.num, originX, originY, width: cel.width, height: cel.height });
    } else if (prev.width !== cel.width || prev.height !== cel.height || prev.originX !== originX || prev.originY !== originY) {
      // Parity-variant cels differ per placement (e.g. the arrow sign's vertical
      // 16×24 vs horizontal 24×16 frames) but the canvas hit-test box is per num —
      // grow it to the union of every variant seen, in anchor-relative space.
      const left = Math.max(prev.originX, originX);
      const top = Math.max(prev.originY, originY);
      const right = Math.max(prev.width - prev.originX, cel.width - originX);
      const bottom = Math.max(prev.height - prev.originY, cel.height - originY);
      boundsByNum.set(spr.num, { num: spr.num, originX: left, originY: top, width: left + right, height: top + bottom });
    }
    placed.push({
      num: spr.num,
      drawIndex: i,
      baseX: spr.x * CELL_PX - originX,
      baseY: spr.y * CELL_PX - originY,
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
