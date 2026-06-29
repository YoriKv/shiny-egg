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
import { applyAnimatedPalette } from './load-anim-palette.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import { loadSceneRegs, bgLayerBpp } from './scene-regs.ts';
import { composeBgLayers } from './bg-layers-compose.ts';
import { loadMap16Tables } from './map16.ts';
import { buildBg1Bands } from './bg1-band-gfx.ts';
import { renderBg1 } from './render-bg1.ts';
import { renderSpriteLayer, buildSpriteRenderModel, compositeSpriteFull, type SpriteRenderModel } from './render-sprite-layer.ts';
import { spriteRequiredFile } from './sprite-tile-base.ts';
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
  /** BG2 / BG3 BACKGROUND planes (priority-0 tiles) rendered to RGBA. Rendered
   *  via the same `composeBgLayers` the IPC path uses. */
  bg2: LayerImage;
  bg3: LayerImage;
  /** BG2 / BG3 FOREGROUND planes (priority-1 tiles, drawn above BG1), or `null`
   *  when the layer has no foreground tiles. Required-but-nullable so the
   *  render-parity + import-verify gates always account for them. */
  bg2Front: LayerImage | null;
  bg3Front: LayerImage | null;
  /** BG3 MID plane (priority-1 water band, in front of BG2 / behind BG1) on BG3
   *  screen-designation levels (tileset `$20`/`$22`); `null` otherwise. See
   *  `composeBgLayers` `bg3Mid`. Required-but-nullable for the gates. */
  bg3Mid: LayerImage | null;
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
    isWorld6: isWorld6RecordDeep(workRoot, levelRecordId),
    levelMode: h[9] ?? 0
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
  level: LevelData,
  /** Optional captured cart-PRNG sequence (cart caller PC → bytes, from the
   *  `level-rng` trace) to reproduce a specific live entry's random-tile
   *  variants. The cart PRNG is stateless (HCounter+VCounter), so there is no
   *  seed — only a captured per-call sequence can match a given playthrough. */
  prngReplayBySite?: Record<number, readonly number[]>,
  /** Optional minted spriteset (6 gfx file IDs) overriding the header's stock
   *  `DATA_spriteset_files[header[7]]` — for rendering a level whose sprites no
   *  stock spriteset covers (see `mintSpriteset`). Threaded into BOTH the VRAM
   *  load and the per-sprite tile-base slot lookup so they stay consistent. */
  spritesetOverride?: readonly number[]
): RenderedLevelLayers | null {
  if (level.empty || level.special || level.header.length < 15) return null;
  const h = level.header;
  const recordId = level.recordId;
  const gfxHeader = gfxHeaderFromLevel(h, workRoot, recordId);
  if (spritesetOverride) gfxHeader.spritesetOverride = spritesetOverride;
  const palHeader = paletteHeaderFromLevel(h, workRoot, recordId);

  const decoded = decodeLevelFromLevelData({ rom, symbols, workRoot, levelData: level, prngReplayBySite });
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
  // Overlay the cart's phase-0 per-frame animated palette (gm0F) — the colors
  // the level actually shows in-level on its animated CGRAM rows.
  applyAnimatedPalette(rom, cgram, h);

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
    bg1Bpp: bgLayerBpp(regs.bgmodeMode, 'bg1'),
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
  //
  // This ordering is for independence, NOT correctness: renderBg1 composites
  // from the Map16 buffer directly and never reads a VRAM tilemap, so loading
  // the BG2/BG3 tilemaps before renderBg1 changes 0 BG1 cells (verified across
  // all 218 records, including the boss rooms where bg1CharAddr=$E000 sits a
  // wrap away from the tilemap regions). There is no char-wrap-into-tilemap path.
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
    bg2Front: composedBg.bg2Front,
    bg3Front: composedBg.bg3Front,
    bg3Mid: composedBg.bg3Mid,
    sprite: sprite ?? null,
    collision
  };
}

/**
 * Render a level's SPRITE layer across MULTIPLE spritesets (`resolveLevelSpritesetPasses`)
 * so EVERY sprite renders with its own gfx even when the level needs more than the 6 VRAM
 * slots (the >6 hardware-overflow levels). Each pass loads a different spriteset and builds
 * the render model; each sprite's bitmap is taken from the FIRST pass whose set loads its
 * required file, then all are composited like the single-pass layer.
 *
 * Gallery / diagnostic use ONLY — the live cart can't load all these files at once, so this
 * is NOT a faithful single-VRAM view; the editor uses `renderLevelLayers` (one spriteset).
 * Returns null for empty / short-header levels (mirrors `renderLevelLayers`).
 */
export function renderLevelSpriteLayerMultiPass(
  rom: Uint8Array,
  symbols: SymbolMap,
  workRoot: string,
  level: LevelData,
  passes: readonly (readonly number[])[],
  extraRequiredFiles?: ReadonlyMap<number, readonly number[]> // composite body files; see resolveLevelSpriteset
): LayerImage | null {
  if (level.empty || level.special || level.header.length < 15 || passes.length === 0) return null;
  const h = level.header;
  const gfxHeader = gfxHeaderFromLevel(h, workRoot, level.recordId);
  const palHeader = paletteHeaderFromLevel(h, workRoot, level.recordId);
  const cgram = new Uint8Array(512); // palette is spriteset-independent → load once
  loadLevelPalettes(rom, symbols, palHeader, cgram);
  applyAnimatedPalette(rom, cgram, h);
  // One render model per pass: a sprite's bitmap is correct iff its file is in that pass's set.
  const models = passes.map((files) => {
    const header = { ...gfxHeader, spritesetOverride: [...files] };
    const vram = new Uint8Array(0x10000);
    const manifest: GfxFileEntry[] = [];
    loadLevelGfx(rom, symbols, header, vram, manifest);
    loadTileAnimation(rom, symbols, { animationTileset: h[10] ?? 0, bg1Tileset: gfxHeader.bg1Tileset, levelMode: h[9] ?? 0 }, vram);
    return buildSpriteRenderModel({ rom, symbols, header, sprites: level.sprites, vram, cgram, manifest, levelSpritePaletteId: h[8] });
  });
  // Each sprite (by draw index) ← its bitmap from the FIRST pass whose set loads its file.
  const byIndex = models.map((m) => new Map(m.placed.map((p) => [p.drawIndex, p])));
  const placed: SpriteRenderModel['placed'] = [];
  for (let i = 0; i < level.sprites.length; i++) {
    const f = spriteRequiredFile(rom, symbols, level.sprites[i]!.num);
    const ex = extraRequiredFiles?.get(level.sprites[i]!.num);
    let pass = 0;
    if (f != null || (ex && ex.length)) {
      // A composite (e.g. a para-Koopa) only renders right where ALL its files are loaded,
      // so draw it from the first pass holding its full set; fall back to the first pass
      // with its primary file. (No extras ⇒ this is exactly the old single-file lookup.)
      const needed: number[] = f != null ? [f] : [];
      if (ex) needed.push(...ex);
      let idx = passes.findIndex((files) => needed.every((nf) => files.includes(nf)));
      if (idx < 0 && f != null) idx = passes.findIndex((files) => files.includes(f));
      if (idx >= 0) pass = idx;
    }
    const p = byIndex[pass]!.get(i);
    if (p) placed.push(p);
  }
  placed.sort((a, b) => a.drawIndex - b.drawIndex); // restore global z-order
  return compositeSpriteFull({ placed, boundsByNum: models[0]!.boundsByNum });
}
