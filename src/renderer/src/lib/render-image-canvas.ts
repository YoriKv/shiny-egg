import type { RenderImage } from '../../../preload/api'

// RGBA RenderImage bitmaps (from render.pickerThumbnails) are stable objects —
// the memoized thumbnail hooks reuse the same object across redraws — so we cache
// the one-time RGBA→<canvas> conversion keyed by the image itself (WeakMap, so it
// auto-evicts when the image is dropped). The canvas redraw needs a canvas/bitmap
// source because `drawImage` honours the world transform and can SCALE, whereas
// `putImageData` ignores the transform and can't scale. Without this every redraw
// (hover, drag) would re-rasterise every thumbnail.
const canvasCache = new WeakMap<RenderImage, HTMLCanvasElement>()

/** A `<canvas>` holding `img`'s pixels — built once per image, then cached. */
export function renderImageToCanvas(img: RenderImage): HTMLCanvasElement {
  const cached = canvasCache.get(img)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (ctx && img.width > 0 && img.height > 0) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0)
  }
  canvasCache.set(img, canvas)
  return canvas
}
