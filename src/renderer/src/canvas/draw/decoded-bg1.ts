// Decoded BG1 / sprite layer — draws a pre-composited full-extent layer source
// at level-cell coordinates.
//
// The source is a 4096×2048 backing canvas (BG1, maintained incrementally by
// `useLevelRenderLayers` — full repaints + sparse cell patches) or an
// ImageBitmap (the sprite layer,
// still a full RGBA render). Each 16×16 cell is the rasterised output of
// `decodeMap16(buffer[cell]) → 4 sub-tiles → VRAM pixels`; unstamped cells are
// alpha=0 so the underlying backdrop + BG2/BG3 show through, and the object
// outline overlay drawn on top still indicates where unstamped objects sit.

/** Draw a full-extent layer source at level-cell coordinates. Caller is
 *  responsible for any view transform (zoom/pan) on the ctx before invoking. */
export function drawDecodedBg1(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource
): void {
  ctx.drawImage(source, 0, 0)
}
