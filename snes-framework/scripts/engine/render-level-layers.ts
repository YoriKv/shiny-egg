// Shared "decode a level + render its layers" orchestration for the engine-side
// dev tools (render-snapshot hashes the outputs; render-cli writes them as PNGs).
// This mirrors the gfx/header/band wiring in src/main/ipc/render.ts but is kept
// separate from the live editor path (no caching, no overlay) — it always
// renders the BASE level against the built V1.0 ROM.
//
// Extracted from render-snapshot.ts so the orchestration lives in one place
// instead of being duplicated per dev tool.

import { isWorld6RecordDeep } from '../level.ts';
import { decodeLevelFromLevelData } from './object-decode/index.ts';
import { loadLevelGfx, type GfxFileEntry, type GfxHeader } from './load-graphics.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { composeBgLayers } from './bg-layers-compose.ts';
import { loadMap16Tables } from './map16.ts';
import { buildBg1Bands } from './bg1-band-gfx.ts';
import { renderBg1 } from './render-bg1.ts';
import { renderSpriteLayer } from './render-sprite-layer.ts';
import { loadCollisionTable, loadSlopePanels } from './collision.ts';
import { renderCollisionLayer } from './render-collision.ts';
import type { SymbolMap } from './symbol-map.ts';
import type { LevelData } from '../types.ts';

/** Structural RGBA image — the render results are all assignable to this. */
export interface LayerImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface RenderedLevelLayers {
  /** Decoded Map16 buffer + page map (the object-decode output). */
  decode: { levelDataBuffer: Uint8Array; screenPageMap: Uint8Array };
  bg1: LayerImage;
  /** BG2 / BG3 parallax tilemaps rendered to RGBA (pre-composite — the
   *  per-layer color-math blend/role is a canvas concern, not hashed here).
   *  Rendered via the same `composeBgLayers` the IPC path uses, so render-cli
   *  can emit them as PNGs and render-snapshot can hash them. */
  bg2: LayerImage;
  bg3: LayerImage;
  /** Null only if the sprite renderer declines (kept for caller parity). */
  sprite: LayerImage | null;
  collision: LayerImage;
}

export function gfxHeaderFromLevel(
  h: readonly number[],
  workRoot: string,
  levelRecordId: number
): GfxHeader {
  return {
    bg1Tileset: h[1] ?? 0,
    bg2Tileset: h[3] ?? 0,
    bg3Tileset: h[5] ?? 0,
    spriteTileset: h[7] ?? 0,
    isWorld6: isWorld6RecordDeep(workRoot, levelRecordId)
  };
}

export function paletteHeaderFromLevel(
  h: readonly number[],
  workRoot: string,
  levelRecordId: number
): PaletteHeader {
  return {
    bgColor: h[0] ?? 0,
    bg1Palette: h[2] ?? 0,
    bg2Palette: h[4] ?? 0,
    bg3Palette: h[6] ?? 0,
    spritePalette: h[8] ?? 0,
    yoshiColor: 0,
    isWorld6: isWorld6RecordDeep(workRoot, levelRecordId),
    levelMode: h[9] ?? 0
  };
}

/**
 * Decode `level` and render its bg1 / sprite / collision layers against the
 * given ROM + symbols. Returns null for empty / special / short-header slots
 * (nothing to render). Renders the BASE level via `decodeLevelFromLevelData`,
 * so it's independent of any project overlay.
 */
export function renderLevelLayers(
  rom: Uint8Array,
  symbols: SymbolMap,
  workRoot: string,
  level: LevelData
): RenderedLevelLayers | null {
  if (level.empty || level.special || level.header.length < 15) return null;
  const h = level.header;
  const recordId = level.recordId;
  const gfxHeader = gfxHeaderFromLevel(h, workRoot, recordId);
  const palHeader = paletteHeaderFromLevel(h, workRoot, recordId);

  const decoded = decodeLevelFromLevelData({ rom, symbols, workRoot, levelData: level });
  if (!decoded) return null;
  const { levelDataBuffer, screenPageMap } = decoded.state;

  // Shared gfx + palette VRAM/CGRAM (bg1 + sprite read both).
  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512);
  const manifest: GfxFileEntry[] = [];
  loadLevelGfx(rom, symbols, gfxHeader, vram, manifest);
  loadTileAnimation(
    rom,
    symbols,
    { animationTileset: h[10] ?? 0, bg1Tileset: gfxHeader.bg1Tileset, levelMode: h[9] ?? 0 },
    vram
  );
  loadLevelPalettes(rom, symbols, palHeader, cgram);

  const regs = loadSceneRegs(rom, symbols, h[9] ?? 0);
  const map16Tables = loadMap16Tables(rom, symbols);
  const bands = buildBg1Bands({
    rom,
    symbols,
    sprites: level.sprites,
    gfx: gfxHeader,
    palette: palHeader,
    animationTileset: h[10] ?? 0,
    levelMode: h[9] ?? 0
  });
  const bg1 = renderBg1({
    vram,
    cgram,
    map16Tables,
    levelDataBuffer,
    screenPageMap,
    bg1CharAddr: regs.bg1CharAddr,
    bands: bands?.bands,
    bandAxis: bands?.bandAxis
  });
  const sprite = renderSpriteLayer({
    rom,
    symbols,
    header: gfxHeader,
    sprites: level.sprites,
    vram,
    cgram,
    manifest
  });
  const collision = renderCollisionLayer({
    collisionTable: loadCollisionTable(rom, symbols),
    slopePanels: loadSlopePanels(rom, symbols),
    levelDataBuffer,
    screenPageMap
  });

  // BG2/BG3 parallax tilemaps — same compositing path the live editor uses
  // (load tilemaps into VRAM, render both layers). Run LAST: composeBgLayers
  // writes the BG2/BG3 tilemap entries into `vram` ($3400/$3800), and here the
  // single `vram` is shared with bg1/sprite above (the IPC path gives each
  // handler its own VRAM), so we render those first to keep them independent.
  const composedBg = composeBgLayers({
    rom,
    symbols,
    gfxHeader,
    palHeader,
    levelMode: h[9] ?? 0,
    vram,
    cgram
  });

  return {
    decode: { levelDataBuffer, screenPageMap },
    bg1,
    bg2: composedBg.bg2,
    bg3: composedBg.bg3,
    sprite: sprite ?? null,
    collision
  };
}
