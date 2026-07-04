// Door glyphs for the warp-exit markers: an "exit" door (arrow leaving) for
// outgoing screen exits and an "entry" door (arrow entering) for the incoming
// "you land here" markers. Both come from a 512×512 SVG whose art is a single
// white silhouette on a black backdrop; we keep only the white path and fill it
// in the marker's state color (so cyan/amber/selection-lime still encode
// exit/incoming/selected), over a dark rounded chip for contrast on busy tiles.
//
// The entry door's source SVG mirrors the same drawing horizontally (its arrow
// points the other way); we reproduce that mirror at draw time rather than
// carrying a second, pre-flipped path.

/** White silhouette path from exit-door.svg (viewBox 0 0 512 512, identity transform). */
const EXIT_D =
  'M217 28.098v455.804l142-42.597V70.697zm159.938 26.88.062 2.327V87h16V55zM119 55v117.27h18V73h62V55zm258 50v16h16v-16zm0 34v236h16V139zm-240 58.727V233H41v46h96v35.273L195.273 256zM244 232c6.627 0 12 10.745 12 24s-5.373 24-12 24-12-10.745-12-24 5.373-24 12-24zM137 339.73h-18V448h18zM377 393v14h16v-14zm0 32v23h16v-23zM32 471v18h167v-18zm290.652 0-60 18H480v-18z'

/** White silhouette path from entry-door.svg. The source SVG applies
 *  `translate(512,0) scale(-1,1)` (a horizontal mirror about x=256); we apply
 *  that at draw time (see `drawDoorIcon`), so this is the un-mirrored path. */
const ENTRY_D =
  'M217 28.098v455.804l142-42.597V70.697zM119 55v160h18V73h62V55zm257.98.03.02 2.275V87h16V55zM377 105v16h16v-16zm0 34v236h16V139zm-276.564 58.727L42.162 256l58.274 58.273V279h96v-46h-96zM244 232c6.627 0 12 10.745 12 24s-5.373 24-12 24-12-10.745-12-24 5.373-24 12-24zm-125 65v151h18V297zm258 96v14h16v-14zm0 32v23h16v-23zM32 471v18h167v-18zm290.652 0-60 18H480v-18z'

export type DoorKind = 'exit' | 'entry'

// Path2D construction needs the browser DOM, so build lazily + cache (keeps the
// module importable from the node-env renderer tests, which never draw).
let exitPath: Path2D | null = null
let entryPath: Path2D | null = null
function doorPath(kind: DoorKind): Path2D {
  if (kind === 'exit') return (exitPath ??= new Path2D(EXIT_D))
  return (entryPath ??= new Path2D(ENTRY_D))
}

/**
 * Draw a door glyph centered at world px `(cx, cy)`. `r` is the chip's half-
 * extent in world px (kept ≈ the marker's hit half-extent so what you see is
 * what you click); the door silhouette is inset within it. `color` tints both
 * the door and the chip border; `selected` thickens that border. The `entry`
 * door is mirrored horizontally to match its source SVG.
 */
export function drawDoorIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  kind: DoorKind,
  color: string,
  zoom: number,
  selected: boolean
): void {
  // Contrast chip — a dark rounded square behind the door so it reads over any
  // tile, mirroring the old diamond's fill + colored border.
  ctx.beginPath()
  ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.32)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
  ctx.fill()
  ctx.lineWidth = (selected ? 2.5 : 1.5) / zoom
  ctx.strokeStyle = color
  ctx.stroke()

  // Door silhouette, scaled from the 512-box to fit inside the chip, centered on
  // (cx, cy). The entry door is mirrored horizontally: `scale(-1,1)` before the
  // centering translate flips it about the box center (x=256), reproducing the
  // source SVG's `translate(512,0) scale(-1,1)`.
  const size = r * 1.55
  const s = size / 512
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(s, s)
  if (kind === 'entry') ctx.scale(-1, 1)
  ctx.translate(-256, -256)
  ctx.fillStyle = color
  ctx.fill(doorPath(kind))
  ctx.restore()
}
