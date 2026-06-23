// Draw BG2 / BG3 / backdrop layers (Phase 6).
//
// BG2 + BG3 come back from the engine as pre-rendered RGBA bitmaps sized
// to their respective tilemap dimensions (typically 256×256, 512×256,
// or 512×512). We blit them under BG1 and the object outlines.
//
// **Scale assumption**: each tilemap cell is 8 px wide, so a 32×32 cell
// tilemap is 256×256 source pixels. YI's Map16 cells are 16×16 — that's
// 2:1 with BG tilemap cells. Drawing BG2/BG3 at native 1:1 means they
// span half the canvas width per 32-cell tilemap. The actual on-screen
// alignment depends on per-layer scroll position which we ignore for
// the editor preview; we anchor at (0, 0).

import type { BgLayersResult } from '../../../../preload/api'
import { LEVEL_PX_W, LEVEL_PX_H } from '../geometry'

/** Per-layer approximate-color-math compositing descriptor (visibility + blend
 *  + draw role), derived engine-side. Aliased from the IPC payload so the
 *  renderer never re-declares the shape. */
type BgLayerDescriptor = BgLayersResult['bg2Layer']

/** Cache the most recent BG layers' ImageBitmaps so re-renders don't
 *  re-decode the buffers per frame. Keyed by levelRecordId via the caller. */
export interface BgLayerBitmaps {
  bg2: ImageBitmap
  bg3: ImageBitmap
  /** Foreground (priority-1) planes drawn ABOVE BG1 — null when the layer has
   *  no foreground tiles. Same dimensions as bg2/bg3 (same tilemap extent), so
   *  they reuse bg2Width/Height + bg3Width/Height. */
  bg2Front: ImageBitmap | null
  bg3Front: ImageBitmap | null
  /** Either a CSS color (solid backdrop) or an ImageBitmap of the
   *  1×2048 gradient strip (the renderer tiles it horizontally). */
  backdrop:
    | { kind: 'solid'; css: string }
    | { kind: 'gradient'; bitmap: ImageBitmap; width: number; height: number }
  // Native (un-scaled) dimensions for both layers.
  bg2Width: number
  bg2Height: number
  bg3Width: number
  bg3Height: number
  /** Cart-side compositing descriptors from the IPC payload — Canvas ANDs
   *  `.visible` with the user's layer toggles, and the draw routines honour
   *  `.role` (background vs darkening overlay), `.blend`, and `.alpha`. */
  bg2Layer: BgLayerDescriptor
  bg3Layer: BgLayerDescriptor
}

/**
 * Build `ImageBitmap`s from the IPC payload's RGBA buffers. Returns a
 * promise because `createImageBitmap` is async (decode happens off the
 * main thread).
 */
export async function buildBgLayerBitmaps(
  result: BgLayersResult
): Promise<BgLayerBitmaps> {
  const bg2Img = new ImageData(
    new Uint8ClampedArray(result.bg2.rgba),
    result.bg2.width,
    result.bg2.height
  )
  const bg3Img = new ImageData(
    new Uint8ClampedArray(result.bg3.rgba),
    result.bg3.width,
    result.bg3.height
  )

  const promises: Promise<ImageBitmap>[] = [
    createImageBitmap(bg2Img),
    createImageBitmap(bg3Img)
  ]
  if (result.backdrop.kind === 'gradient') {
    const gradImg = new ImageData(
      new Uint8ClampedArray(result.backdrop.rgba),
      result.backdrop.width,
      result.backdrop.height
    )
    promises.push(createImageBitmap(gradImg))
  }
  const decoded = await Promise.all(promises)
  const bg2 = decoded[0]
  const bg3 = decoded[1]

  // Foreground planes (priority-1 tiles) — null for the ~72% of levels with none.
  const toBitmap = async (
    plane: { rgba: Uint8Array; width: number; height: number } | null
  ): Promise<ImageBitmap | null> =>
    plane && plane.width > 0 && plane.height > 0
      ? createImageBitmap(new ImageData(new Uint8ClampedArray(plane.rgba), plane.width, plane.height))
      : null
  const [bg2Front, bg3Front] = await Promise.all([toBitmap(result.bg2Front), toBitmap(result.bg3Front)])

  let backdrop: BgLayerBitmaps['backdrop']
  if (result.backdrop.kind === 'gradient') {
    backdrop = {
      kind: 'gradient',
      bitmap: decoded[2],
      width: result.backdrop.width,
      height: result.backdrop.height
    }
  } else {
    backdrop = { kind: 'solid', css: result.backdrop.css }
  }

  return {
    bg2,
    bg3,
    bg2Front,
    bg3Front,
    backdrop,
    bg2Width: result.bg2.width,
    bg2Height: result.bg2.height,
    bg3Width: result.bg3.width,
    bg3Height: result.bg3.height,
    bg2Layer: result.bg2Layer,
    bg3Layer: result.bg3Layer
  }
}

// Level extent in world pixels — single-sourced from geometry (4096 × 2048).
const LEVEL_W = LEVEL_PX_W
const LEVEL_H = LEVEL_PX_H

/**
 * Draw the backdrop + the BACKGROUND-role BG2/BG3 layers (those that sit
 * BEHIND BG1), tiled across the level extent. BG layers loop as the camera
 * scrolls in-game; for the static preview we tile each layer's bitmap and
 * bottom-anchor it (per-layer parallax scroll is ignored — there is no
 * gameplay camera). The `*Layer` descriptors decide each layer's blend +
 * whether it's a background here or a darkening overlay drawn later by
 * `drawBgOverlays` (above BG1).
 *
 * `which` gates each sub-layer independently (user toggle ∧ cart visibility):
 * the backdrop (COLDATA fill / gradient) is the gameplay sky, BG3 is the deep
 * parallax, BG2 the mid-distance scenery.
 */
export function drawBgLayers(
  ctx: CanvasRenderingContext2D,
  layers: BgLayerBitmaps,
  which: { bg2: boolean; bg3: boolean; backdrop: boolean }
): void {
  ctx.save()

  // 1. Backdrop fill behind everything. Toggles independently of BG2/BG3.
  //   - Solid form: flat CSS fill (header BG color < $10).
  //   - Gradient form: tile the 1×2048 strip horizontally across the
  //     level width. The strip is the full max level height; if the level
  //     is shorter the bottom band just isn't visible.
  if (which.backdrop) {
    if (layers.backdrop.kind === 'solid') {
      ctx.fillStyle = layers.backdrop.css
      ctx.fillRect(0, 0, LEVEL_W, LEVEL_H)
    } else {
      const grad = layers.backdrop
      // The gradient is a 1px-wide vertical strip (varies by Y only) — stretch
      // it across the full width in ONE drawImage blit. We deliberately avoid
      // createPattern + full-extent fillRect: a bitmap-pattern fill under the
      // world (pan/zoom) transform makes Chromium cache a rasterized tile PER
      // TRANSFORM, accumulating GPU memory every frame and PERMANENTLY degrading
      // all canvas rendering (persists after BG2/3 off / level change; invisible
      // to the JS heap — measured: 0.4ms→67ms/frame over a pan). drawImage is a
      // plain blit with no such per-transform cache.
      ctx.drawImage(grad.bitmap, 0, 0, grad.width, grad.height, 0, 0, LEVEL_W, grad.height)
    }
  }

  // 2. BG3 (furthest back), then 3. BG2 (mid). Both bottom-anchored and tiled
  //    horizontally only — their real Y is camera-driven (BG3VOFS/BG2VOFS), so
  //    any static anchor is a simulation; matching the two keeps the parallax
  //    surfaces consistent. Filler rows YI pads its BG2 tilemap with (e.g. tile
  //    $EE in 1-2) are color-0 → alpha=0 upstream, so only real scenery shows.
  //    Skip a layer here if it's actually a darkening OVERLAY (drawn above BG1
  //    by drawBgOverlays instead).
  if (which.bg3 && layers.bg3 && layers.bg3Layer.role === 'background') {
    drawBgLayerStrip(ctx, layers.bg3, layers.bg3Width, layers.bg3Height, layers.bg3Layer)
  }
  if (which.bg2 && layers.bg2 && layers.bg2Layer.role === 'background') {
    drawBgLayerStrip(ctx, layers.bg2, layers.bg2Width, layers.bg2Height, layers.bg2Layer)
  }

  ctx.restore()
}

/**
 * Draw the OVERLAY-role BG2/BG3 layers — subscreen layers the cart's color math
 * SUBTRACTS from the foreground (cave-shadow BG3). These go ABOVE BG1 with a
 * darkening blend (`'multiply'`), so Canvas calls this AFTER drawing BG1. Most
 * levels have no overlay layers, in which case this is a no-op.
 */
export function drawBgOverlays(
  ctx: CanvasRenderingContext2D,
  layers: BgLayerBitmaps,
  which: { bg2: boolean; bg3: boolean }
): void {
  ctx.save()
  if (which.bg3 && layers.bg3 && layers.bg3Layer.role === 'overlay') {
    drawBgLayerStrip(ctx, layers.bg3, layers.bg3Width, layers.bg3Height, layers.bg3Layer)
  }
  if (which.bg2 && layers.bg2 && layers.bg2Layer.role === 'overlay') {
    drawBgLayerStrip(ctx, layers.bg2, layers.bg2Width, layers.bg2Height, layers.bg2Layer)
  }
  ctx.restore()
}

/**
 * Draw the FOREGROUND (priority-1) BG2/BG3 planes — tiles the cart's per-tile
 * priority bit places ABOVE BG1 (e.g. 1-1's foreground flowers/bushes). Canvas
 * calls this AFTER BG1, with a normal `source-over` blend. Order: BG2 foreground
 * then BG3 foreground on top (BG3.1 is the topmost SNES plane). Each plane is
 * null for the ~72% of levels with no foreground tiles → no-op. A layer's
 * foreground is visible iff the layer itself is (same `.visible`).
 */
export function drawBgForeground(
  ctx: CanvasRenderingContext2D,
  layers: BgLayerBitmaps,
  which: { bg2: boolean; bg3: boolean }
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  if (which.bg2 && layers.bg2Front && layers.bg2Layer.visible) {
    drawBgStripAtBottom(ctx, layers.bg2Front, layers.bg2Width, layers.bg2Height, LEVEL_W, LEVEL_H)
  }
  if (which.bg3 && layers.bg3Front && layers.bg3Layer.visible) {
    drawBgStripAtBottom(ctx, layers.bg3Front, layers.bg3Width, layers.bg3Height, LEVEL_W, LEVEL_H)
  }
  ctx.restore()
}

/** Bottom-anchor + tile one BG layer, applying its approximate-color-math
 *  blend (`globalCompositeOperation`) + `globalAlpha`. */
function drawBgLayerStrip(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  bitmapW: number,
  bitmapH: number,
  desc: BgLayerDescriptor
): void {
  ctx.save()
  ctx.globalCompositeOperation = desc.blend
  ctx.globalAlpha = desc.alpha
  drawBgStripAtBottom(ctx, bitmap, bitmapW, bitmapH, LEVEL_W, LEVEL_H)
  ctx.restore()
}

/** Draw `bitmap` along the bottom edge of the level extent, tiling
 *  horizontally (no vertical repeat). The bitmap's top edge lands at
 *  `levelH - bitmapHeight`. */
function drawBgStripAtBottom(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  bitmapW: number,
  bitmapH: number,
  levelW: number,
  levelH: number
): void {
  const y = levelH - bitmapH
  // Tile horizontally with drawImage (a direct GPU blit) — NOT createPattern +
  // fillRect. A bitmap-pattern fill of the full extent under the world (pan/
  // zoom) transform makes Chromium cache a rasterized tile per transform, which
  // leaks GPU memory every frame and permanently degrades rendering (see the
  // gradient draw in drawBgLayers). ~levelW/bitmapW blits (≈8) — same path/cost
  // as the bg1/sprite backing-canvas draws.
  ctx.save()
  ctx.translate(0, y)
  for (let x = 0; x < levelW; x += bitmapW) {
    ctx.drawImage(bitmap, x, 0)
  }
  ctx.restore()
}
