// Shared BG2 / BG3 / backdrop compositing for the editor's static preview.
//
// YI puts BG2/BG3 on the SNES **subscreen** (TS register) and composites them
// onto the main screen via **color math** for most level modes — only the
// mode-`$00` family keeps both on the main screen directly. The editor used to
// gate visibility on the main-screen TM bits alone, so ~39 of 61 catalog levels
// rendered with no background at all (and 1-1's BG2 clouds were missing). This
// module derives the real per-layer visibility (main ∪ sub) and an
// **approximate** color-math compositing descriptor from the level mode's PPU
// registers, then renders the two tilemap layers + the backdrop.
//
// Backing reference: yi-shiny/docs/bg23rendering.md §3-4 +
// renderingpipeline.md §3-4, validated against the per-level runtime captures
// in yi-shiny/trace-harness/scenarios/bg23-render/output/ for every catalog
// mode. The compositing model is documented on `BgLayerDescriptor`
// (snes-framework/scripts/types.ts) and in the plan; key rules:
//
//   - visible: BG2 = (TM∪TS bit1); BG3 = (TM∪TS bit2) && !bg3Disabled. Both
//     also require the mode to actually use BG2/BG3 as tile layers — suppressed
//     for Mode-7 (mode $09, BGMODE mode 7), Kamek cinema (level mode $0A), and
//     for BG3 in BG Mode 2 (mode $03, where BG3 carries per-tile OFFSET data,
//     not pixels).
//   - role/blend: a subscreen-ONLY layer that the cart color-math SUBTRACTS
//     (CGADSUB bit7) is a darkening overlay above BG1 (canvas 'multiply');
//     every other layer is an ordinary background below BG1 over the backdrop
//     ('source-over'). Additive color math is approximated by plain source-over
//     draw order (the subscreen shows through where BG1 is transparent), which
//     avoids the double-bright a 'lighter' blend would add.
//
// This is extracted from the `render:bgLayers` IPC handler so the engine dev
// tools (render-cli / render-snapshot, via render-level-layers.ts) composite
// BG2/BG3 the same way — one source of truth for the model.

import { renderBgLayer, tilemapHasForeground } from './render-bg-layers.ts';
import { loadBg2Tilemap, loadBg3Tilemap } from './load-bg-tilemaps.ts';
import { buildBackdrop, type Backdrop } from './backdrop.ts';
import { loadSceneRegs, bgLayerBpp, type SceneRegs } from './scene-regs.ts';
import type { GfxHeader } from './load-graphics.ts';
import type { PaletteHeader } from './load-palettes.ts';
import type { RenderResult } from './render-gallery.ts';
import type { SymbolMap } from './symbol-map.ts';
import type { BgLayerDescriptor } from '../types.ts';

export interface ComposedBgLayers {
  /** BG2 BACKGROUND plane (priority-0 tiles) rendered to RGBA — drawn behind
   *  BG1. When the layer has foreground tiles this excludes them (they go in
   *  `bg2Front`); otherwise it's the whole layer. */
  bg2: RenderResult;
  /** BG3 background plane (priority-0 tiles). */
  bg3: RenderResult;
  /** BG2 FOREGROUND plane (priority-1 tiles) — drawn ABOVE BG1 (source-over),
   *  or `null` when the layer has no foreground tiles (the common case). The
   *  cart's per-tile priority bit puts these tiles in front of BG1 (e.g. 1-1's
   *  foreground flowers). REQUIRED-but-nullable so every consumer accounts for
   *  it — see research notes / the priority-split investigation. */
  bg2Front: RenderResult | null;
  /** BG3 foreground plane (priority-1 tiles in front of BG1), or `null` when none. */
  bg3Front: RenderResult | null;
  /** BG3 MID plane — priority-1 tiles ABOVE the water line on BG3
   *  screen-designation levels (tileset `$20`/`$22`): drawn IN FRONT of BG2 but
   *  BEHIND BG1 (the water/reflection band the cart's per-scanline TM/TS HDMA
   *  composites on the subscreen). `null` on every non-screen-des level (the BG3
   *  priority split is just deep/front there). REQUIRED-but-nullable. */
  bg3Mid: RenderResult | null;
  /** Per-level backdrop (solid CGRAM[0] color or 24-stop vertical gradient). */
  backdrop: Backdrop;
  /** Compositing descriptor for BG2 (visibility + blend + role). */
  bg2Layer: BgLayerDescriptor;
  /** Compositing descriptor for BG3. */
  bg3Layer: BgLayerDescriptor;
  /** The decoded scene registers (callers forward a subset to the renderer). */
  regs: SceneRegs;
}

export interface ComposeBgLayersArgs {
  rom: Uint8Array;
  symbols: SymbolMap;
  gfxHeader: GfxHeader;
  palHeader: PaletteHeader;
  levelMode: number;
  /** VRAM already populated by loadLevelGfx (+ loadTileAnimation). The tilemap
   *  loaders write BG2 (byte $7000) / BG3 (byte $6800) into it in place. */
  vram: Uint8Array;
  /** CGRAM already populated by loadLevelPalettes (+ any palette override). */
  cgram: Uint8Array;
  /** Editor live gfx-edit overlay (`format/fileId` → decompressed bytes) so a BG2/BG3
   *  tilemap PLACEMENT edit previews on the canvas without a rebuild — the tilemap is its
   *  own gm$0C load (separate from the CHR `loadLevelGfx` overlay). Omit for the cart. */
  gfxOverride?: ReadonlyMap<string, Uint8Array>;
  /** Live gradient-backdrop override (24 BGR-15 stops) so an unsaved gradient draft
   *  previews without a rebuild — passed straight to `buildBackdrop`. Omit for the cart. */
  gradientOverride?: readonly number[];
}

/**
 * BG3 "screen-designation" water-line split, keyed by **BG3 tileset** (header
 * `$013E`). These tilesets' load-time dispatch (`DATA_bg3_tilemap_table` action
 * byte → `CODE_setup_bg3_screen_des_hdma` / `clouds_mist`, Bank01 `$01:EC7F`)
 * arms a per-scanline HDMA that rewrites TM/TS (`$212C`/`$212D`) at the water
 * line: above it BG3 is pushed to the subscreen (water/reflection BEHIND BG1),
 * below it BG3 stays on the main screen where its priority-1 tiles are in front.
 * So the editor's "priority-1 BG3 → foreground" is right only BELOW this row;
 * priority-1 cells at rows < value render behind BG1 with the rest of BG3.
 *
 * The pre-rendered BG3 tilemap is per-tileset, so the split row is too — both
 * affected catalog levels (1-3 `0x02`, 3-8 Naval Piranha's Castle `0x19`) use
 * tileset `$20` and share row 28 (foreground bank = tilemap rows 28..31).
 * Verified vs the live emulator (the pipe in 1-3 stays solid through the water
 * band, cut only by the lower bushes). `$22` (clouds_mist) has no catalog level.
 */
const BG3_FOREGROUND_MIN_ROW: Readonly<Record<number, number>> = {
  0x20: 28
};

/** Collapse an all-transparent render to `null` so an EMPTY nullable plane
 *  (foreground / mid) costs nothing downstream — no rgba buffer over IPC, no
 *  `createImageBitmap`, no draw call. The renderer treats `null` as "layer
 *  absent". RGBA buffers, so emptiness = every alpha byte is 0. */
function nonEmpty(r: RenderResult | null): RenderResult | null {
  if (!r || r.width === 0 || r.height === 0) return null;
  for (let i = 3; i < r.rgba.length; i += 4) if (r.rgba[i] !== 0) return r;
  return null;
}

/**
 * Load the BG2/BG3 tilemaps into `vram`, render both layers + the backdrop, and
 * derive each layer's approximate-color-math compositing descriptor. `vram` and
 * `cgram` must already hold the level's gfx/animation/palette data; this mutates
 * `vram` in place (tilemap regions only).
 */
export function composeBgLayers(args: ComposeBgLayersArgs): ComposedBgLayers {
  const { rom, symbols, gfxHeader, palHeader, levelMode, vram, cgram, gfxOverride, gradientOverride } = args;

  // BG2 + BG3 tilemaps are separate gm$0C steps from load_level_gfx — they need
  // explicit loads. Both return the byte count actually written, passed to
  // renderBgLayer as `loadedBytes` so it skips the unloaded portion of a partly
  // filled 32×64 / 64×32 region (common: BG2 declared 32×64 but only top 32×32
  // loaded, the bottom screen overlapping bg3CharAddr).
  const bg2LoadedBytes = loadBg2Tilemap(rom, symbols, gfxHeader.bg2Tileset, vram, gfxOverride);
  const bg3Load = loadBg3Tilemap(rom, symbols, gfxHeader.bg3Tileset, vram, gfxOverride);

  const regs = loadSceneRegs(rom, symbols, levelMode);
  const { bg2Layer, bg3Layer } = deriveDescriptors(regs, levelMode, bg3Load.bg3Disabled);

  // Per-tile PRIORITY split (only for background-role layers — a color-math
  // SUBTRACT overlay is a whole-layer darkening pass, not a fg/bg split). With
  // YI's BG3-priority mode, a priority-1 BG2/BG3 tile renders ABOVE BG1 (e.g.
  // 1-1's foreground flowers). We render the layer's priority-0 cells as the
  // background plane (drawn behind BG1) and, only when the layer actually has
  // priority-1 cells, a foreground plane (drawn above BG1). Most levels have no
  // foreground tiles → no extra render, and `bg2`/`bg3` stay byte-identical to
  // the un-split single-plane render. bpp is BGMODE-derived (bgLayerBpp), index-0
  // transparent (cart filler tiles are color-0 so they don't paint a solid rect).
  // BG3 "screen-designation" water-line gate (see BG3_FOREGROUND_MIN_ROW): on
  // these levels priority-1 BG3 ABOVE the water line is behind BG1, so only rows
  // at/below the gate are real foreground. 0 (= no gate) for every other level.
  const bg3FgMinRow = BG3_FOREGROUND_MIN_ROW[gfxHeader.bg3Tileset] ?? 0;
  // screen-designation levels (gate > 0) get the three-plane BG3 split (deep /
  // mid / front); every other level is the plain two-plane (or single) split.
  const bg3Split = bg3Layer.role === 'background' && bg3FgMinRow > 0;
  const bg2HasFg =
    bg2Layer.role === 'background' &&
    tilemapHasForeground(vram, regs.bg2TilemapAddr, bg2LoadedBytes);
  const bg3HasFg =
    bg3Layer.role === 'background' &&
    tilemapHasForeground(vram, regs.bg3TilemapAddr, bg3Load.bytesWritten, bg3FgMinRow);

  const renderBg2 = (priority?: 'low' | 'high'): RenderResult =>
    renderBgLayer(vram, cgram, {
      tilemapAddr: regs.bg2TilemapAddr,
      charAddr: regs.bg2CharAddr,
      scSize: regs.bg2ScSize,
      bpp: bgLayerBpp(regs.bgmodeMode, 'bg2'),
      tileSize: regs.bg2TileSize,
      transparentZero: true,
      loadedBytes: bg2LoadedBytes,
      priority
    });
  const renderBg3 = (priority?: 'low' | 'mid' | 'high'): RenderResult =>
    renderBgLayer(vram, cgram, {
      tilemapAddr: regs.bg3TilemapAddr,
      charAddr: regs.bg3CharAddr,
      scSize: regs.bg3ScSize,
      bpp: bgLayerBpp(regs.bgmodeMode, 'bg3'),
      tileSize: regs.bg3TileSize,
      transparentZero: true,
      loadedBytes: bg3Load.bytesWritten,
      priority,
      foregroundMinRow: bg3FgMinRow
    });

  const bg2 = renderBg2(bg2HasFg ? 'low' : undefined);
  // On a split (screen_des) level `bg3` is the priority-0 deep plane even when
  // there's no separate foreground, since the priority-1 water band moves to bg3Mid.
  const bg3 = renderBg3(bg3HasFg || bg3Split ? 'low' : undefined);
  // Nullable planes collapse to null when empty (all-transparent) so they never
  // ship a buffer / build a bitmap / draw — see nonEmpty.
  const bg2Front = nonEmpty(bg2HasFg ? renderBg2('high') : null);
  const bg3Front = nonEmpty(bg3HasFg ? renderBg3('high') : null);
  const bg3Mid = nonEmpty(bg3Split ? renderBg3('mid') : null);

  const backdrop = buildBackdrop(rom, symbols, cgram, palHeader.bgColor, gradientOverride);

  return { bg2, bg3, bg2Front, bg3Front, bg3Mid, backdrop, bg2Layer, bg3Layer, regs };
}

/**
 * Derive the BG2/BG3 compositing descriptors from the decoded scene registers.
 * Exported for unit testing against the per-mode capture table.
 */
export function deriveDescriptors(
  regs: SceneRegs,
  levelMode: number,
  bg3Disabled: boolean
): { bg2Layer: BgLayerDescriptor; bg3Layer: BgLayerDescriptor } {
  // Modes with no normal BG2/BG3 tile layers at all.
  //  - level mode $0A (Kamek cinema, only level $6B): the gm$0C convergence
  //    (Bank01 CODE_01B118) SKIPS both load_bg2_tilemap and load_bg3_tilemap for
  //    modes $09 and $0A, so the cart never loads standard BG2/BG3 tilemaps here
  //    — we load the header-driven ones unconditionally, so suppress them. (For
  //    $6B this is moot anyway: its BG2 renders fully empty / 0% opaque and its
  //    real cinema backdrop comes from a GSU path we don't model.)
  //  - BGMODE mode 7 (level mode $09, Raphael; only sub-room $CB, not in the
  //    playable catalog): Mode-7, BG2/BG3 off (BG1 itself renders ~empty).
  const isCinemaMode = levelMode === 0x0a;
  const isMode7 = regs.bgmodeMode === 7;
  // BG3 is a real pixel layer only in BG Mode 0/1. In BG Mode 2 (level mode
  // $03, the offset-per-tile "3D rock" effect) BG3 carries per-tile column
  // offsets, not pixels — its BG2 IS a normal background, but BG3 must stay off.
  const bg3IsTileLayer = regs.bgmodeMode === 0 || regs.bgmodeMode === 1;

  const bg2Visible = !isCinemaMode && !isMode7 && (regs.bg2Enable || regs.bg2SubEnable);
  const bg3Visible =
    !isCinemaMode && !isMode7 && bg3IsTileLayer && (regs.bg3Enable || regs.bg3SubEnable) && !bg3Disabled;

  return {
    bg2Layer: descriptorFor(bg2Visible, regs.bg2Enable, regs.bg2SubEnable, regs),
    bg3Layer: descriptorFor(bg3Visible, regs.bg3Enable, regs.bg3SubEnable, regs)
  };
}

function descriptorFor(
  visible: boolean,
  mainEnable: boolean,
  subEnable: boolean,
  regs: SceneRegs
): BgLayerDescriptor {
  // A subscreen-ONLY layer the cart color-math SUBTRACTS is a darkening overlay
  // above BG1 (cave shadow). Everything else — main-screen layers and additive
  // subscreen layers — is an ordinary background drawn below BG1.
  const onSubOnly = subEnable && !mainEnable;
  const isSubtractOverlay = onSubOnly && regs.colorMathSubtract;
  const role: BgLayerDescriptor['role'] = isSubtractOverlay ? 'overlay' : 'background';
  return {
    visible,
    role,
    blend: isSubtractOverlay ? 'multiply' : 'source-over',
    // Half-result color math (CGADSUB bit6) is only applied to subtract
    // overlays — additive backgrounds stay opaque so the common, visible case
    // reads cleanly. (The only half-bit mode, $0D, is not in the V1.0 catalog.)
    alpha: isSubtractOverlay && regs.colorMathHalf ? 0.5 : 1
  };
}
