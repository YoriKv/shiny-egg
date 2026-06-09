// Shared RGBA→canvas blit. The engine returns thumbnails / tile sheets as raw
// RGBA buffers (in IPC payloads); panels paint them with putImageData. This is
// the one place that sizes the canvas to the bitmap, wraps the buffer in the
// Uint8ClampedArray ImageData requires, and blits — so every inspector view
// (Tiles' Map16 grid + Files blocks, future RGBA previews) does it identically.

/** Blit an RGBA bitmap into `canvas`, sizing the canvas to match the source.
 *  No-op when the canvas (or its 2D context) is unavailable. The source RGBA is
 *  copied into a fresh `Uint8ClampedArray` because `ImageData` requires one and
 *  the IPC payload arrives as a plain buffer. */
export function blitRgba(
  canvas: HTMLCanvasElement | null,
  src: { rgba: ArrayLike<number>; width: number; height: number }
): void {
  if (!canvas) return
  canvas.width = src.width
  canvas.height = src.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const clamped = new Uint8ClampedArray(src.width * src.height * 4)
  clamped.set(src.rgba)
  ctx.putImageData(new ImageData(clamped, src.width, src.height), 0, 0)
}
