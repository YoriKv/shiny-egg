// BG2 / BG3 layer renderer — Phase 6.
//
// After `load_level_gfx` populates VRAM, the cart's PPU registers point
// BG2/BG3 at tilemap regions inside that VRAM. Each tilemap is a grid of
// 16-bit entries (`vhopppcc cccccccc` — same format as our Map16 sub-
// tiles). We decode the per-level-mode tilemap offsets via
// `scene-regs.ts` and render the layers as flat RGBA bitmaps.
//
// **Tilemap layout** (32×32 entries per "screen", but layers can be
// horizontally or vertically expanded to 64-wide or 64-tall):
//   - SC-size 0: 32×32 entries, 1 screen = 2KB
//   - SC-size 1: 64×32, 2 screens horizontally
//   - SC-size 2: 32×64, 2 screens vertically
//   - SC-size 3: 64×64, 4 screens (2×2)
//
// For YI in-level scenes, BG2 is typically the hills/mid-distance scenery
// and BG3 is the HUD overlay / sky parallax. We render both as separate
// layers; compositing happens renderer-side.
//
// **Important assumption:** char base from $210B/$210C is interpreted as
// "byte address >> 13" (= 8KB units), the canonical SNES PPU format.
// Some emulators / docs use 4KB units instead. If renders look wrong,
// this is the first place to revisit.
//
// **Color depth:** BG3 in mode 1 is 2bpp. BG1/BG2 in mode 1 are 4bpp.
// We pass an explicit `bpp` to the renderer; the caller decides per layer.

import { decode2bppTile, decode4bppTile } from './tile.ts';
import { buildPaletteRow } from './color.ts';
import type { RenderResult } from './render-gallery.ts';

const TILE_PIXELS = 8;
const PIXEL_BYTES = 4;

interface TilemapDims {
  cols: number; // 32 or 64
  rows: number; // 32 or 64
}

/** Diagnostic counters filled by renderBgLayer when `opts.diag` is set. */
export interface BgLayerDiag {
  cells: number;
  subTilesVisited: number;
  subTilesRendered: number;
  subTilesFilteredByVramLen: number;
}

function dimsFromScSize(scSize: number): TilemapDims {
  switch (scSize & 3) {
    case 0: return { cols: 32, rows: 32 };
    case 1: return { cols: 64, rows: 32 };
    case 2: return { cols: 32, rows: 64 };
    default: return { cols: 64, rows: 64 };
  }
}

const SCREEN_BYTES = 0x800; // one 32×32 screen = 1024 entries × 2 bytes

/**
 * Clamp the declared SC dimensions to whatever the cart actually loaded
 * into the tilemap region. YI's BG2 is declared 32×64 even though many
 * levels only fill the top 32×32; without this clamp the renderer iterates
 * the unloaded screen(s) and reads whatever VRAM follows the tilemap as
 * tilemap entries = garbage. Pass `loadedBytes` from
 * `loadBg2Tilemap`/`loadBg3Tilemap` to fix.
 */
function effectiveDims(dims: TilemapDims, loadedBytes: number | undefined): TilemapDims {
  if (loadedBytes === undefined) return dims;
  const screensLoaded = Math.floor(loadedBytes / SCREEN_BYTES);
  if (screensLoaded <= 0) return { cols: 0, rows: 0 };
  // 32×32: 1 screen required — already minimal.
  if (dims.cols === 32 && dims.rows === 32) return dims;
  // 64×32 (left/right halves): drop to 32×32 if only one screen loaded.
  if (dims.cols === 64 && dims.rows === 32) {
    return screensLoaded >= 2 ? dims : { cols: 32, rows: 32 };
  }
  // 32×64 (top/bottom halves): drop to 32×32 if only one screen loaded.
  if (dims.cols === 32 && dims.rows === 64) {
    return screensLoaded >= 2 ? dims : { cols: 32, rows: 32 };
  }
  // 64×64 (4 screens): drop step-by-step.
  if (screensLoaded >= 4) return dims;
  if (screensLoaded >= 2) return { cols: 64, rows: 32 };
  return { cols: 32, rows: 32 };
}

/**
 * Render a single BG layer from VRAM tilemap + char-data + CGRAM palette.
 *
 * `bpp` selects 2 or 4 bits-per-pixel tile decode. For mode-1 BG3 pass
 * `bpp=2`; for mode-1 BG1/BG2 pass `bpp=4`.
 *
 * `tileSize` is the per-BG tile-size flag from PPU `$2105` BGMODE bits
 * 4..7 (8 or 16). In 16×16 mode each tilemap entry expands to a 2×2 group
 * of 8×8 sub-tiles at char-offsets `[+0, +1, +16, +17]` (the standard SNES
 * 16×16-tile pattern); hflip/vflip swap the group's layout AND flip each
 * sub-tile individually. For YI levels with `bgmode=$69` (BG2 + BG3 in
 * 16×16 mode), pass `tileSize=16` for those layers — otherwise tiles
 * appear in the right rough positions but shuffled within each 16×16
 * group.
 *
 * Output is RGBA8888 sized to the tilemap's screen dimensions in cells
 * times `tileSize` (32×32 cells × 8 → 256×256 px; × 16 → 512×512 px,
 * etc.). For BG layers that use index-0-transparent semantics (BG3 HUD
 * typically), pass `transparentZero=true` to leave index-0 cells as
 * alpha=0.
 *
 * VRAM accesses wrap at the 64KB boundary (`& 0xFFFF`) to match SNES
 * PPU behavior — high tile indices from a non-zero `charAddr` correctly
 * read from the start of VRAM rather than going out of bounds.
 */
export function renderBgLayer(
  vram: Uint8Array,
  cgram: Uint8Array,
  opts: {
    tilemapAddr: number;
    charAddr: number;
    scSize: number;
    bpp: 2 | 4;
    tileSize?: 8 | 16;
    transparentZero?: boolean;
    /** Bytes of tilemap data the cart actually loaded into VRAM at
     *  `tilemapAddr`. When `scSize` declares more screens than were
     *  loaded, the renderer caps to the loaded extent. Defaults to "as
     *  many bytes as scSize implies" if omitted. */
    loadedBytes?: number;
    /** Optional: mutable diagnostic counter. Renderer increments per
     *  sub-tile to tally how many were rendered vs skipped. */
    diag?: BgLayerDiag;
  }
): RenderResult {
  const declared = dimsFromScSize(opts.scSize);
  const dims = effectiveDims(declared, opts.loadedBytes);
  if (dims.cols === 0 || dims.rows === 0) {
    return { rgba: new Uint8Array(0), width: 0, height: 0 };
  }
  const tileSize = opts.tileSize ?? 8;
  const subTilesPerSide = tileSize / TILE_PIXELS; // 1 (8×8) or 2 (16×16)
  const width = dims.cols * tileSize;
  const height = dims.rows * tileSize;
  const rgba = new Uint8Array(width * height * PIXEL_BYTES);
  const transparentZero = opts.transparentZero ?? false;
  if (!transparentZero) {
    // Set all alphas to opaque up front; the per-pixel write only sets RGB.
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 0xff;
  }

  // Pre-build the 8 palette rows (indexed by 3-bit ppp from tilemap entry).
  // CRITICAL: the CGRAM stride per palette row depends on bpp — 4bpp uses
  // 16 colors per row (CGRAM[row*16..]), 2bpp uses 4 colors per row
  // (CGRAM[row*4..]). Using the wrong stride means palRow > 0 tiles fetch
  // colors from the wrong CGRAM region — visible as some tiles having
  // "wrong" colors while others (palRow=0) look correct.
  const palettes: Uint32Array[] = [];
  const colorsPerRow = opts.bpp === 4 ? 16 : 4;
  for (let r = 0; r < 8; r++) {
    palettes.push(buildPaletteRow(cgram, r, transparentZero, 'expand', colorsPerRow));
  }

  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  const indices = new Uint8Array(64);
  const tileBytes = opts.bpp === 4 ? 32 : 16;
  const decode = opts.bpp === 4 ? decode4bppTile : decode2bppTile;

  // Standard SNES tilemap memory layout for 64×32 / 32×64 / 64×64:
  // 32×32 screens are laid out as separate 2KB blocks.
  //   64×32: [left 32×32][right 32×32]
  //   32×64: [top 32×32][bottom 32×32]
  //   64×64: [TL][TR][BL][BR]
  // Each 32×32 screen is 2KB = 1024 entries × 2 bytes.

  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      // Determine which 32×32 screen this cell belongs to.
      const screenCol = col >>> 5;
      const screenRow = row >>> 5;
      let screenIdx: number;
      if (dims.cols === 32 && dims.rows === 32) screenIdx = 0;
      else if (dims.cols === 64 && dims.rows === 32) screenIdx = screenCol;
      else if (dims.cols === 32 && dims.rows === 64) screenIdx = screenRow;
      else screenIdx = (screenRow << 1) | screenCol;

      const screenBase = opts.tilemapAddr + screenIdx * 0x800;
      const innerCol = col & 0x1f;
      const innerRow = row & 0x1f;
      const entryOff = screenBase + (innerRow * 32 + innerCol) * 2;
      if (entryOff + 2 > vram.length) continue;
      const entry = vram[entryOff] | (vram[entryOff + 1] << 8);

      const baseTile = entry & 0x3ff;
      const palRow = (entry >>> 10) & 0x07;
      const hflip = (entry & 0x4000) !== 0;
      const vflip = (entry & 0x8000) !== 0;
      const palette = palettes[palRow];
      if (opts.diag) opts.diag.cells++;

      // Iterate sub-tile positions within the cell. 1×1 grid for 8×8 mode,
      // 2×2 for 16×16. The screen position is fixed by (px, py); the tile
      // index offset within the 16×16 super-tile is `(px ^ hflip) +
      // (py ^ vflip) * 16` — see the SNES PPU 16×16-tile layout.
      const destBaseX = col * tileSize;
      const destBaseY = row * tileSize;
      for (let py = 0; py < subTilesPerSide; py++) {
        for (let px = 0; px < subTilesPerSide; px++) {
          let tileOff: number;
          if (subTilesPerSide === 1) {
            tileOff = 0;
          } else {
            const tx = px ^ (hflip ? 1 : 0);
            const ty = py ^ (vflip ? 1 : 0);
            tileOff = tx + ty * 16;
          }
          const subTileIdx = (baseTile + tileOff) & 0x3ff; // 10-bit tile field
          // PPU VRAM is a 16-bit address space; tile reads wrap at 64KB.
          const tileByteOff = (opts.charAddr + subTileIdx * tileBytes) & 0xffff;
          if (opts.diag) opts.diag.subTilesVisited++;
          // Defensive: skip if the tile would still wrap inside its own decode.
          if (tileByteOff + tileBytes > vram.length) {
            if (opts.diag) opts.diag.subTilesFilteredByVramLen++;
            continue;
          }
          if (opts.diag) opts.diag.subTilesRendered++;

          decode(vram, tileByteOff, hflip, vflip, indices, 0);

          const dxOff = px * TILE_PIXELS;
          const dyOff = py * TILE_PIXELS;
          for (let ty2 = 0; ty2 < TILE_PIXELS; ty2++) {
            const dstRow = (destBaseY + dyOff + ty2) * width + destBaseX + dxOff;
            const srcRow = ty2 * TILE_PIXELS;
            for (let tx2 = 0; tx2 < TILE_PIXELS; tx2++) {
              const idx = indices[srcRow + tx2];
              if (idx === 0 && transparentZero) continue;
              u32[dstRow + tx2] = palette[idx];
            }
          }
        }
      }
    }
  }

  return { rgba, width, height };
}
