import { CELL_PX } from '../geometry'

/**
 * Draw the paint tool's surface overlay: a dot at each painted cell-corner height
 * plus the slope lines the fitter interpolates between consecutive corners — the
 * editable curve the user is drawing, above the decoded BG1 (the fitted result).
 *
 * `heights` maps cell-corner column → row. Coordinates are in world pixels (the
 * ctx already carries pan/zoom). `pending` columns (the live, not-yet-committed
 * stroke) draw brighter; `erasing` columns draw in the erase color. Lines stay a
 * constant screen thickness regardless of zoom.
 */
export function drawPaintOverlay(
  ctx: CanvasRenderingContext2D,
  heights: ReadonlyMap<number, number>,
  zoom: number,
  pending: ReadonlySet<number> | null,
  erasing: boolean
): void {
  if (heights.size === 0) return;
  const cols = [...heights.keys()].sort((a, b) => a - b);
  ctx.save();

  // slope lines between corners (the interpolated curve)
  ctx.strokeStyle = 'rgba(255, 211, 77, 0.85)';
  ctx.lineWidth = 2 / zoom;
  ctx.beginPath();
  cols.forEach((c, i) => {
    const x = c * CELL_PX, y = heights.get(c)! * CELL_PX;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // a dot at each painted corner
  const r = 2.5 / zoom;
  for (const c of cols) {
    const x = c * CELL_PX, y = heights.get(c)! * CELL_PX;
    ctx.fillStyle = erasing && pending?.has(c) ? '#f87171' : pending?.has(c) ? '#fff3c4' : '#ffd34d';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
