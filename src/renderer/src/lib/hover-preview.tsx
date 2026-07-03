// A magnified hover popout of a row's thumbnail, pinned along the host panel's
// LEFT edge and vertically tracking the cursor — shared by the Place panel's
// entry list and the Graphics panel's YY-CHR sheet browser, so the two behave
// identically. The bitmap is integer-zoomed to fill the `fit` box for a crisp
// look. Portaled to <body> so it escapes the list's `overflow` clip and the
// floating-window z-stack; `pointer-events:none` (see `.se-hover-preview`) so it
// never intercepts the click on the row under the cursor.

import { useEffect, useRef, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { blitRgba } from './blit'

const PREVIEW_GAP = 8 // panel-to-popup gap (px)
const PREVIEW_CHROME = 10 // border (1) + padding (4), both sides — matches the CSS

/** Any blit-ready RGBA bitmap (RenderImage, YychrThumbnail, …). */
export interface HoverPreviewImage {
  rgba: ArrayLike<number>
  width: number
  height: number
}

/** Largest integer zoom that fits the bitmap inside the `fit` box (≥1× so a
 *  bitmap already larger than the box still shows, just un-zoomed). */
function previewScale(img: HoverPreviewImage, fit: number): number {
  return Math.max(1, Math.min(8, Math.floor(fit / Math.max(img.width, img.height))))
}

export function HoverPreview({
  img,
  y,
  panel,
  fit
}: {
  img: HoverPreviewImage
  /** Cursor Y — the popup vertically centres on the hovered row. */
  y: number
  /** The host panel's frame rect (`.se-window`), measured at hover time so it
   *  tracks drag/resize. Null only if the frame can't be found. */
  panel: DOMRect | null
  /** Target box (px) the bitmap is integer-zoomed to fill. */
  fit: number
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    blitRgba(ref.current, img)
  }, [img])

  const scale = previewScale(img, fit)
  const w = img.width * scale + PREVIEW_CHROME
  const h = img.height * scale + PREVIEW_CHROME
  // Pinned to the panel's LEFT edge: the popup's right edge sits PREVIEW_GAP px
  // outside it. Stays on the left as long as at least HALF the popup fits there
  // (the clamp below pulls it fully on-screen, partially overlapping the panel —
  // harmless, it's pointer-events:none); flips to the panel's right edge only
  // below that. Vertically centred on the cursor's row.
  const panelLeft = panel?.left ?? 0
  const panelRight = panel?.right ?? window.innerWidth
  let left = panelLeft - PREVIEW_GAP - w
  if (left < 4 - w / 2) left = panelRight + PREVIEW_GAP
  left = Math.max(4, Math.min(left, window.innerWidth - w - 4))
  const top = Math.max(4, Math.min(y - h / 2, window.innerHeight - h - 4))

  return createPortal(
    <div className="se-hover-preview" style={{ left, top }}>
      <canvas ref={ref} style={{ width: img.width * scale, height: img.height * scale }} />
    </div>,
    document.body
  )
}
