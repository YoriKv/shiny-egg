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

import { renderBgLayer } from './render-bg-layers.ts';
import { loadBg2Tilemap, loadBg3Tilemap } from './load-bg-tilemaps.ts';
import { buildBackdrop, type Backdrop } from './backdrop.ts';
import { loadSceneRegs, type SceneRegs } from './scene-regs.ts';
import type { GfxHeader } from './load-graphics.ts';
import type { PaletteHeader } from './load-palettes.ts';
import type { RenderResult } from './render-gallery.ts';
import type { SymbolMap } from './symbol-map.ts';
import type { BgLayerDescriptor } from '../types.ts';

export interface ComposedBgLayers {
  /** BG2 tilemap rendered to RGBA (sized to its tilemap extent). */
  bg2: RenderResult;
  /** BG3 tilemap rendered to RGBA. */
  bg3: RenderResult;
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
}

/**
 * Load the BG2/BG3 tilemaps into `vram`, render both layers + the backdrop, and
 * derive each layer's approximate-color-math compositing descriptor. `vram` and
 * `cgram` must already hold the level's gfx/animation/palette data; this mutates
 * `vram` in place (tilemap regions only).
 */
export function composeBgLayers(args: ComposeBgLayersArgs): ComposedBgLayers {
  const { rom, symbols, gfxHeader, palHeader, levelMode, vram, cgram } = args;

  // BG2 + BG3 tilemaps are separate gm$0C steps from load_level_gfx — they need
  // explicit loads. Both return the byte count actually written, passed to
  // renderBgLayer as `loadedBytes` so it skips the unloaded portion of a partly
  // filled 32×64 / 64×32 region (common: BG2 declared 32×64 but only top 32×32
  // loaded, the bottom screen overlapping bg3CharAddr).
  const bg2LoadedBytes = loadBg2Tilemap(rom, symbols, gfxHeader.bg2Tileset, vram);
  const bg3Load = loadBg3Tilemap(rom, symbols, gfxHeader.bg3Tileset, vram);

  const regs = loadSceneRegs(rom, symbols, levelMode);

  // BG2: 4bpp (mode 1/2), color-index-0 transparent so the cart's filler tiles
  // (e.g. tile $EE in 1-2's BG2, all color-0) don't paint a solid rectangle.
  const bg2 = renderBgLayer(vram, cgram, {
    tilemapAddr: regs.bg2TilemapAddr,
    charAddr: regs.bg2CharAddr,
    scSize: regs.bg2ScSize,
    bpp: 4,
    tileSize: regs.bg2TileSize,
    transparentZero: true,
    loadedBytes: bg2LoadedBytes
  });
  // BG3: 2bpp in mode 1; index-0 transparent. tileSize per BGMODE.
  const bg3 = renderBgLayer(vram, cgram, {
    tilemapAddr: regs.bg3TilemapAddr,
    charAddr: regs.bg3CharAddr,
    scSize: regs.bg3ScSize,
    bpp: 2,
    tileSize: regs.bg3TileSize,
    transparentZero: true,
    loadedBytes: bg3Load.bytesWritten
  });

  const backdrop = buildBackdrop(rom, symbols, cgram, palHeader.bgColor);

  const { bg2Layer, bg3Layer } = deriveDescriptors(regs, levelMode, bg3Load.bg3Disabled);

  return { bg2, bg3, backdrop, bg2Layer, bg3Layer, regs };
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
  //  - level mode $0A (Kamek cinema): gm$0C bypasses the normal tilemap loaders
  //    (load_levelmode_0A_gfx) → our loaded tilemaps are garbage. Suppress both.
  //  - BGMODE mode 7 (level mode $09, Raphael): Mode-7, BG2/BG3 off.
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
