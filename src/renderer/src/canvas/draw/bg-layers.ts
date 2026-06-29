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
import type { LayerOffset } from '../parallax'

/** Per-layer approximate-color-math compositing descriptor (visibility + blend
 *  + draw role), derived engine-side. Aliased from the IPC payload so the
 *  renderer never re-declares the shape. */
type BgLayerDescriptor = BgLayersResult['bg2Layer']

/** Camera-Preview parallax draw params: per-layer world-px draw offsets + the
 *  visible world rect to tile over. When present, BG2/BG3 are positioned at their
 *  parallax offset and tiled on BOTH axes (the in-game tilemap wraps) instead of
 *  bottom-anchored, so they align inside the camera box. */
export interface ParallaxDraw {
  bg2: LayerOffset
  bg3: LayerOffset
  cover: { x0: number; y0: number; x1: number; y1: number }
}

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
  /** BG3 MID plane (priority-1 water band) on screen-designation levels — drawn
   *  IN FRONT of BG2 but BEHIND BG1 (between `drawBgLayers` and BG1). Same
   *  dimensions as bg3 (same tilemap). Null on every non-screen-des level. */
  bg3Mid: ImageBitmap | null
  /** Either a CSS color (solid backdrop) or an ImageBitmap of the
   *  1×2048 gradient strip (the renderer tiles it horizontally). */
  backdrop:
    | { kind: 'solid'; css: string }
    | { kind: 'gradient'; bitmap: ImageBitmap; width: number; height: number; stops: number[] }
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
  /** BG2/BG3 parallax rates (raw 8.8) — for the Camera Preview overlay. */
  parallax: BgLayersResult['parallax']
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
  const [bg2Front, bg3Front, bg3Mid] = await Promise.all([
    toBitmap(result.bg2Front),
    toBitmap(result.bg3Front),
    toBitmap(result.bg3Mid)
  ])

  let backdrop: BgLayerBitmaps['backdrop']
  if (result.backdrop.kind === 'gradient') {
    backdrop = {
      kind: 'gradient',
      bitmap: decoded[2],
      width: result.backdrop.width,
      height: result.backdrop.height,
      stops: result.backdrop.stops
    }
  } else {
    backdrop = { kind: 'solid', css: result.backdrop.css }
  }

  return {
    bg2,
    bg3,
    bg2Front,
    bg3Front,
    bg3Mid,
    backdrop,
    bg2Width: result.bg2.width,
    bg2Height: result.bg2.height,
    bg3Width: result.bg3.width,
    bg3Height: result.bg3.height,
    bg2Layer: result.bg2Layer,
    bg3Layer: result.bg3Layer,
    parallax: result.parallax
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
  which: { bg2: boolean; bg3: boolean; backdrop: boolean },
  parallax?: ParallaxDraw | null
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
    } else if (!parallax) {
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
    // Camera Preview (parallax) gradient is drawn screen-relative by the scene so
    // it shows the full ramp + camY/8 scroll inside the box — skip the strip here.
  }

  // 2. BG3 (furthest back), then 3. BG2 (mid). Normally both are bottom-anchored
  //    and tiled horizontally only (no gameplay camera). Under Camera Preview the
  //    virtual camera drives BG3VOFS/BG2VOFS, so each is positioned at its parallax
  //    offset and tiled on both axes. Filler rows YI pads its BG2 tilemap with are
  //    color-0 → alpha=0 upstream, so only real scenery shows. Skip a layer here if
  //    it's actually a darkening OVERLAY (drawn above BG1 by drawBgOverlays).
  if (which.bg3 && layers.bg3 && layers.bg3Layer.role === 'background') {
    if (parallax) drawBgTiled(ctx, layers.bg3, layers.bg3Width, layers.bg3Height, parallax.bg3, parallax.cover, layers.bg3Layer.blend, layers.bg3Layer.alpha)
    else drawBgLayerStrip(ctx, layers.bg3, layers.bg3Width, layers.bg3Height, layers.bg3Layer)
  }
  if (which.bg2 && layers.bg2 && layers.bg2Layer.role === 'background') {
    if (parallax) drawBgTiled(ctx, layers.bg2, layers.bg2Width, layers.bg2Height, parallax.bg2, parallax.cover, layers.bg2Layer.blend, layers.bg2Layer.alpha)
    else drawBgLayerStrip(ctx, layers.bg2, layers.bg2Width, layers.bg2Height, layers.bg2Layer)
  }
  // 3b. BG3 MID plane (screen-designation water band) — priority-1 BG3 the cart's
  //     per-scanline TM/TS HDMA keeps IN FRONT of BG2 but BEHIND BG1. Drawn here
  //     (after BG2, before Canvas draws BG1) with a plain source-over. Null on every
  //     non-screen-des level → no-op. Positioned like BG3 (same tilemap extent).
  if (which.bg3 && layers.bg3Mid && layers.bg3Layer.visible) {
    if (parallax) drawBgTiled(ctx, layers.bg3Mid, layers.bg3Width, layers.bg3Height, parallax.bg3, parallax.cover, 'source-over', 1)
    else drawBgStripAtBottom(ctx, layers.bg3Mid, layers.bg3Width, layers.bg3Height, LEVEL_W, LEVEL_H)
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
  which: { bg2: boolean; bg3: boolean },
  parallax?: ParallaxDraw | null
): void {
  ctx.save()
  if (which.bg3 && layers.bg3 && layers.bg3Layer.role === 'overlay') {
    if (parallax) drawBgTiled(ctx, layers.bg3, layers.bg3Width, layers.bg3Height, parallax.bg3, parallax.cover, layers.bg3Layer.blend, layers.bg3Layer.alpha)
    else drawBgLayerStrip(ctx, layers.bg3, layers.bg3Width, layers.bg3Height, layers.bg3Layer)
  }
  if (which.bg2 && layers.bg2 && layers.bg2Layer.role === 'overlay') {
    if (parallax) drawBgTiled(ctx, layers.bg2, layers.bg2Width, layers.bg2Height, parallax.bg2, parallax.cover, layers.bg2Layer.blend, layers.bg2Layer.alpha)
    else drawBgLayerStrip(ctx, layers.bg2, layers.bg2Width, layers.bg2Height, layers.bg2Layer)
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
  which: { bg2: boolean; bg3: boolean },
  parallax?: ParallaxDraw | null
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  if (which.bg2 && layers.bg2Front && layers.bg2Layer.visible) {
    if (parallax) drawBgTiled(ctx, layers.bg2Front, layers.bg2Width, layers.bg2Height, parallax.bg2, parallax.cover, 'source-over', 1)
    else drawBgStripAtBottom(ctx, layers.bg2Front, layers.bg2Width, layers.bg2Height, LEVEL_W, LEVEL_H)
  }
  if (which.bg3 && layers.bg3Front && layers.bg3Layer.visible) {
    if (parallax) drawBgTiled(ctx, layers.bg3Front, layers.bg3Width, layers.bg3Height, parallax.bg3, parallax.cover, 'source-over', 1)
    else drawBgStripAtBottom(ctx, layers.bg3Front, layers.bg3Width, layers.bg3Height, LEVEL_W, LEVEL_H)
  }
  ctx.restore()
}

/** Position + tile one BG layer at a parallax world offset, covering the visible
 *  world rect on BOTH axes (the in-game tilemap wraps), with the given color-math
 *  blend + alpha. The Camera-Preview twin of `drawBgStripAtBottom`. */
function drawBgTiled(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  bw: number,
  bh: number,
  off: LayerOffset,
  cover: ParallaxDraw['cover'],
  blend: GlobalCompositeOperation,
  alpha: number
): void {
  if (bw <= 0 || bh <= 0) return
  ctx.save()
  ctx.globalCompositeOperation = blend
  ctx.globalAlpha = alpha
  ctx.translate(off.x, off.y)
  // World [cover.x0, x1] maps to bitmap-local [cover.x0 - off.x, …]; snap the first
  // tile back to the wrap grid so tiling stays aligned regardless of the offset.
  const x0 = Math.floor((cover.x0 - off.x) / bw) * bw
  const y0 = Math.floor((cover.y0 - off.y) / bh) * bh
  const xEnd = cover.x1 - off.x
  const yEnd = cover.y1 - off.y
  for (let x = x0; x < xEnd; x += bw) {
    for (let y = y0; y < yEnd; y += bh) {
      ctx.drawImage(bitmap, x, y)
    }
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
