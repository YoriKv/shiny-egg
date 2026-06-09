// Collision overlay layer — draws the rasterised collision metadata.
//
// The source is a 4096×2048 backing canvas maintained incrementally by
// `useLevelRenderLayers` (full repaints + sparse cell patches). Each Map16-page
// (high byte of tile ID)
// has its own 16×16 collision tile, blitted into every cell that references the
// page. Solid surfaces (AL/MD/WT/MG/TN) render a uniform red fill; slope tiles
// render a per-pixel red surface triangle; exit triggers — pipe mouths (`pipe`
// tag) and doors (DR/BD bit) — render green ("Yoshi warps here"); collectibles
// (coins — overlap, no physics) render yellow. Cells without collision-worthy
// metadata are alpha=0 so BG1 graphics underneath show through.

/** Draw the pre-rendered collision overlay at level-cell coordinates. Caller
 *  manages the view transform on the ctx. */
export function drawCollisionLayer(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource
): void {
  ctx.drawImage(source, 0, 0)
}
