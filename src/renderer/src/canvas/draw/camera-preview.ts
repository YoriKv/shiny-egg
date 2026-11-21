// Camera Preview overlay — the virtual-camera box, the optional black mask outside
// it, and the screen-relative sky gradient. The box represents the camera's world
// rect (256×224 SNES px at the selected 1×–4× zoom, possibly screen-snapped); the
// gradient and outline use CSS pixels. The mask uses whole backing-canvas pixels.

import { CAMERA_W, CAMERA_H, CAMERA_BAR_PX, type CameraSnap } from '../parallax'
import type { View } from '../view'
import { GRADIENT_RAMP_HEIGHT } from '../../lib/gradient-banded'

/** Camera Preview settings (the checkbox is on/off; these are the popup options). */
export interface CameraPreview {
  /** Black-mask everything outside the camera box. */
  mask: boolean
  /** Display zoom: 1–4 (the editor view zoom is pinned to this while on). */
  zoom: number
  /** Snap the camera to the screen grid on one axis (or not). */
  snap: CameraSnap
}

export interface BoxRect {
  x: number
  y: number
  w: number
  h: number
}

/** The camera box's rect in CSS px, from its world origin + the view transform
 *  (`screen = pan + world*zoom`). */
export function cameraBoxScreenRect(cam: { x: number; y: number }, view: View): BoxRect {
  return {
    x: cam.x * view.zoom + view.panX,
    y: cam.y * view.zoom + view.panY,
    w: CAMERA_W * view.zoom,
    h: CAMERA_H * view.zoom
  }
}

/**
 * Fill the viewport with the screen-relative sky gradient (behind the layers). Each
 * banded-ramp entry occupies `zoom` CSS rows; the box's top row shows entry `scroll`
 * (the camY/8 window) and rows above/below extend (clamped) for context. Runs are
 * batched into one fillRect per band so a pan stays cheap.
 */
export function drawCameraGradient(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  size: { w: number; h: number },
  box: BoxRect,
  ramp: Uint8Array,
  scroll: number,
  zoom: number
): void {
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const H = Math.ceil(size.h)
  const entryAt = (sy: number): number => {
    const e = scroll + Math.floor((sy - box.y) / zoom)
    return e < 0 ? 0 : e >= GRADIENT_RAMP_HEIGHT ? GRADIENT_RAMP_HEIGHT - 1 : e
  }
  const fill = (y0: number, y1: number, e: number): void => {
    ctx.fillStyle = `rgb(${ramp[e * 3]}, ${ramp[e * 3 + 1]}, ${ramp[e * 3 + 2]})`
    ctx.fillRect(0, y0, size.w, y1 - y0)
  }
  let runStart = 0
  let runEntry = -1
  for (let sy = 0; sy < H; sy++) {
    const e = entryAt(sy)
    if (e !== runEntry) {
      if (runEntry >= 0) fill(runStart, sy, runEntry)
      runStart = sy
      runEntry = e
    }
  }
  if (runEntry >= 0) fill(runStart, H, runEntry)
  ctx.restore()
}

/** Draw the camera frame and black bars, with an optional mask outside the frame. */
export function drawCameraOverlay(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  box: BoxRect,
  mask: boolean
): void {
  ctx.save()
  // The game blanks the top and bottom 8 SNES px of the 224px camera.
  const bar = (box.h / CAMERA_H) * CAMERA_BAR_PX
  ctx.fillStyle = '#000'
  if (mask) {
    // Mask everything around the playable area, including the black bars. Use
    // whole backing pixels so fractional CSS coordinates cannot leave seams.
    ctx.resetTransform()
    const { width, height } = ctx.canvas
    const x0 = Math.max(0, Math.ceil(box.x * dpr))
    const y0 = Math.max(0, Math.ceil((box.y + bar) * dpr))
    const x1 = Math.min(width, Math.floor((box.x + box.w) * dpr))
    const y1 = Math.min(height, Math.floor((box.y + box.h - bar) * dpr))
    if (x0 >= x1 || y0 >= y1) {
      ctx.fillRect(0, 0, width, height)
    } else {
      ctx.fillRect(0, 0, width, y0)
      ctx.fillRect(0, y1, width, height - y1)
      ctx.fillRect(0, y0, x0, y1 - y0)
      ctx.fillRect(x1, y0, width - x1, y1 - y0)
    }
  } else {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillRect(box.x, box.y, box.w, bar)
    ctx.fillRect(box.x, box.y + box.h - bar, box.w, bar)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.strokeStyle = 'rgba(255, 210, 64, 0.95)'
  ctx.lineWidth = 2
  ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2)
  ctx.restore()
}
