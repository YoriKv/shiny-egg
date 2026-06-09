// Monospace label metrics + the shared id/name-label chip drawer.
//
// Every label the canvas draws (object / sprite / exit / spawn ids + names) is
// rendered in JetBrains Mono — and the `monospace` fallback the canvas uses
// before the webfont loads is monospace too — so EVERY glyph advances by the
// same width. That makes a label's pixel width exactly `label.length × advance`,
// with no need to `measureText` each label.
//
// Measuring one glyph per draw pass and multiplying replaces what used to be a
// per-entity `ctx.measureText(label)` call inside the draw loops. That per-label
// measure was one of the hotter costs in a zoomed-in pan redraw (the whole draw
// effect re-runs on every view change) — a perf trace put `measureText` at ~60ms
// over the capture. Collapsing it to one measurement per pass removes that.
//
// Call AFTER `ctx.font` is set (the advance depends on the font size, which the
// draws derive from `zoom`) and ONCE per pass; reuse the returned advance for
// every label in the loop.
export function monoAdvance(ctx: CanvasRenderingContext2D): number {
  return ctx.measureText('0').width
}

/**
 * Set up the canvas for drawing entity id/name labels and return the per-glyph
 * advance to reuse for the whole pass. Sets the zoom-scaled JetBrains Mono font
 * and `top` baseline, then measures one glyph (see `monoAdvance`). Call once per
 * draw pass, then pass the returned advance to each `drawIdLabel` call. */
export function beginIdLabels(ctx: CanvasRenderingContext2D, zoom: number): number {
  ctx.font = `${10 / zoom}px 'JetBrains Mono', monospace`
  ctx.textBaseline = 'top'
  return monoAdvance(ctx)
}

/**
 * Draw one entity id/name label as a black chip with white text, top-left at
 * `(x0, y0)` in world pixels. The black backing keeps the text legible over any
 * tiles. `adv` is the per-glyph advance from `beginIdLabels` (the font must
 * already be set). Shared by the object / sprite outline labels and the
 * world-map spawn label so all three read identically. */
export function drawIdLabel(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  label: string,
  zoom: number,
  adv: number
): void {
  const padX = 2 / zoom
  const padY = 1 / zoom
  const labelW = label.length * adv + padX * 2
  const labelH = 12 / zoom
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.fillRect(x0, y0, labelW, labelH)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.fillText(label, x0 + padX, y0 + padY)
}
