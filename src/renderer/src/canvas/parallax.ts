// Parallax math for the Camera Preview overlay — the editor-side reimplementation
// of the cart's BG2/BG3/gradient scroll derivation (yi BG2/BG3 rendering guide §5:
// `CODE_04FD28` → `FXCODE_0993B3`). Pure: no React, no DOM.
//
// In-game each background layer scrolls at a fraction of the camera, set per level
// by BGScrollSetting (header[12]) indexing 8.8-fixed rate tables (DATA_04FB6E /
// FBAE / FBEE / FC2E). The static editor has no camera, so it normally draws BG2/BG3
// bottom-anchored as a simulation. Camera Preview gives it a virtual camera (the
// 256×224 box) and offsets each layer so that, *inside the box*, it shows the same
// slice the cart would at that camera position.
//
// A layer's tilemap origin is drawn at `(camX - HOFS, camY - VOFS)` where HOFS/VOFS
// are the cart's scroll registers — then tiled to fill. Derivation: the box covers
// BG1-world [camX, camX+256]; the cart shows layer-world [HOFS, HOFS+256] there, so
// layer pixel `p` must land at world `camX + (p - HOFS)` = `p + (camX - HOFS)`.

import type { View } from './view'
import { SCREEN_PX } from './geometry'

/** The SNES visible camera, in world pixels (256 wide × 224 tall — NTSC active). */
export const CAMERA_W = 256
export const CAMERA_H = 224

/** Force-blank black bar at the top AND bottom of the screen, in SNES px. The game
 *  blacks scanlines 0–7 (until `irq_1` restores INIDISP at V=$08) and 216–223 (from
 *  `irq_2`'s force-blank at V=$D8) — Bank00 IRQ chain; screenshot-measured 8px each on
 *  the 224-line display (208px play area). Reproduced inside the Camera Preview box. */
export const CAMERA_BAR_PX = 8

/** Camera-position snap (each axis to the 256-px screen grid; the off-axis is free):
 *  - 'v' aligns the left/right edges to screen COLUMNS, anchored at the level's left
 *    edge (cameraX = 0). Pan to switch columns.
 *  - 'h' aligns the camera to screen ROWS anchored at the level floor ($070C, the
 *    camera Y-max) — so the BOTTOM row is exactly where a horizontal level's camera
 *    sits — and pan up to step to higher rows. (Trace-verified: a horizontal level's
 *    camera rests at $070C; rows go up by one screen from there.) */
export type CameraSnap = 'none' | 'h' | 'v'

export function applyCameraSnap(cam: { x: number; y: number }, snap: CameraSnap): { x: number; y: number } {
  if (snap === 'v') return { x: Math.round(cam.x / SCREEN_PX) * SCREEN_PX, y: cam.y }
  if (snap === 'h') {
    // Floor-anchored screen-row grid: k = rows ABOVE the floor (k >= 0 keeps the
    // camera at/above the floor — the camera never scrolls below it in-game).
    const k = Math.max(0, Math.round((LEVEL_FLOOR_CAMERA_Y - cam.y) / SCREEN_PX))
    return { x: cam.x, y: LEVEL_FLOOR_CAMERA_Y - k * SCREEN_PX }
  }
  return cam
}

/** Clamp the camera origin so its 256×224 rect stays inside the level extent
 *  [0, levelW] × [0, levelH] — keeps Camera Preview from showing past the edges.
 *  Applied AFTER the snap, so a snapped X stays on its (256-px) grid at the clamp. */
export function clampCamera(
  cam: { x: number; y: number },
  levelW: number,
  levelH: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(cam.x, levelW - CAMERA_W)),
    y: Math.max(0, Math.min(cam.y, levelH - CAMERA_H))
  }
}

// BG2/BG3 vertical screen anchors from the cart's Y derivation (guide §5.2:
// `LayerN_Y = anchorN - (($070C - camY) * rateY) >> 8`).
const ANCHOR_BG2 = 0x0326
const ANCHOR_BG3 = 0x0126

/**
 * The cart's "level floor" baseline (`$070C`) — a HARDCODED CONSTANT, not a
 * per-level runtime value (guide §5.2): it is an immediate in `FXCODE_0993B3` and
 * re-seeded by the camera-init each load. It is the camera's universal Y-max — the
 * camera never scrolls below it, so the floor sits at the same world-Y for every
 * level (per-level variation is the *ceiling*, set by level height). At
 * `cameraY == $070C` the vertical parallax term is 0 and each layer lands on its
 * anchor ($0326 / $0126). So Y parallax needs only `cameraY` — no per-level derivation.
 */
export const LEVEL_FLOOR_CAMERA_Y = 0x070c

/** Per-level parallax rates — the raw 8.8 words read from the cart rate tables at
 *  `BGScrollSetting * 2` (read engine-side, delivered in BgLayersResult.parallax).
 *  `$0100` = 1:1, `$0080` = ½, `$0040` = ¼, `$0000` = static, `$FFFF` = Y-lock /
 *  X-inverse, `>$0100` = foreground-faster. */
export interface ParallaxRates {
  bg2X: number
  bg2Y: number
  bg3X: number
  bg3Y: number
}

/** BG horizontal scroll register: `HOFS = (camX * rate) >> 8` (8.8 fixed point). */
function hofs(camX: number, rate: number): number {
  return (camX * rate) >> 8
}

/** BG vertical scroll register: `VOFS = anchor - (($070C - camY) * rate) >> 8`, with
 *  the cart's special case `rate == $FFFF` ⇒ `VOFS = camY` (lock 1:1 to camera).
 *  `rate == $0000` falls out of the formula as `VOFS = anchor` (Y locked to screen). */
function vofs(camY: number, rate: number, anchor: number, floor: number): number {
  if (rate === 0xffff) return camY
  return anchor - (((floor - camY) * rate) >> 8)
}

export interface LayerOffset {
  x: number
  y: number
}

export interface ParallaxOffsets {
  bg2: LayerOffset
  bg3: LayerOffset
  /** Gradient screen-top read index, in scanlines: `camY >> 3` (the sky scrolls at
   *  ⅛ the camera-Y rate — guide §5.4). The box's top row shows this gradient entry. */
  gradientScroll: number
}

/**
 * World-space draw offsets that align BG2/BG3 (and the gradient) inside the camera
 * box at camera `(camX, camY)`. See the module header for the `cam - scrollReg`
 * derivation. Offsets are world pixels; the caller tiles each layer to fill.
 */
export function parallaxOffsets(
  camX: number,
  camY: number,
  rates: ParallaxRates,
  floor: number = LEVEL_FLOOR_CAMERA_Y
): ParallaxOffsets {
  return {
    bg2: {
      x: camX - hofs(camX, rates.bg2X),
      y: camY - vofs(camY, rates.bg2Y, ANCHOR_BG2, floor)
    },
    bg3: {
      x: camX - hofs(camX, rates.bg3X),
      y: camY - vofs(camY, rates.bg3Y, ANCHOR_BG3, floor)
    },
    gradientScroll: camY >> 3
  }
}

/**
 * The camera box's top-left in WORLD pixels for the centered-box model: the box is
 * fixed at the viewport centre and the user pans the level under it. Zoom is pinned
 * to the selected 1×–4× in Camera Preview, and inverting the full view transform
 * keeps this correct at any of them. Rounded to whole world pixels (pixel-accurate).
 */
export function cameraOrigin(view: View, size: { w: number; h: number }): { x: number; y: number } {
  // World point at the viewport centre (zoom-aware), minus half the camera box.
  const cx = (size.w / 2 - view.panX) / view.zoom
  const cy = (size.h / 2 - view.panY) / view.zoom
  return { x: Math.round(cx - CAMERA_W / 2), y: Math.round(cy - CAMERA_H / 2) }
}

/**
 * Clamp a view's pan so the Camera Preview camera can't be panned past the level
 * edges — the pan-lock counterpart to clampCamera (which only clamps the drawn box,
 * letting the level keep scrolling under a stuck box). Returns panX/panY clamped so
 * the 256×224 camera stays inside [0, levelW-256] × [0, levelH-224]; an axis already
 * in bounds is returned unchanged. `levelW/levelH` are the fixed editor grid extent
 * (LEVEL_PX_W × LEVEL_PX_H), same as the box clamp.
 *
 * Clamp in PAN space, NOT by correcting the rounded cameraOrigin: invert the
 * (unrounded) camera→pan relation to get the pan range that keeps the camera in the
 * level, then clamp panX/panY to it with a plain 1D clamp. From cameraOrigin,
 * camera.x = (size.w/2 - panX)/zoom - CAMERA_W/2 — falling in panX — so:
 *   camera.x = 0            ⇒ panX = panXMax (camera at the LEFT edge)
 *   camera.x = levelW-256   ⇒ panX = panXMin (camera at the RIGHT edge)
 * Deriving the correction from the rounded origin instead makes the held pan wobble
 * ±1px frame-to-frame (origin steady, pan not) as consecutive drag targets round
 * across the .5 boundary — a visible jitter of the level under the box.
 */
export function clampPanToCamera(
  view: View,
  size: { w: number; h: number },
  levelW: number,
  levelH: number
): { panX: number; panY: number } {
  const panXMax = size.w / 2 - (view.zoom * CAMERA_W) / 2
  const panXMin = size.w / 2 - view.zoom * (levelW - CAMERA_W / 2)
  const panYMax = size.h / 2 - (view.zoom * CAMERA_H) / 2
  const panYMin = size.h / 2 - view.zoom * (levelH - CAMERA_H / 2)
  return {
    panX: Math.max(panXMin, Math.min(view.panX, panXMax)),
    panY: Math.max(panYMin, Math.min(view.panY, panYMax))
  }
}
