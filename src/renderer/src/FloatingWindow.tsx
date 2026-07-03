import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu } from './ContextMenu'
import { HelpDialog } from './HelpDialog'

export interface FloatingWindowSize {
  width: number
  height: number
}

export interface FloatingWindowProps {
  title: string
  initialPos: { x: number; y: number }
  /** Initial width — also the post-drag fallback when no size was persisted. */
  width?: number
  /** If set, the window starts at this height (resize enabled either way). */
  initialHeight?: number
  /** Minimum drag-resize floor. Defaults to (180, 120). */
  minSize?: FloatingWindowSize
  zIndex: number
  onFocus: () => void
  onClose: () => void
  /** Fires once at the end of a drag with the window's final position. */
  onPositionCommit?: (pos: { x: number; y: number }) => void
  /** Fires once at the end of a resize with the window's final size. */
  onSizeCommit?: (size: FloatingWindowSize) => void
  /** Bumped when the owner resets this window's layout: re-syncs the local
   *  drag/resize state to the (just-reset) initialPos/width/initialHeight
   *  WITHOUT remounting — a remount would drop the panel body's state. */
  resetRev?: number
  /** When set, right-clicking the title bar offers "Reset Size & Position"
   *  (the owner restores the defaults, then bumps `resetRev`). */
  onResetLayout?: () => void
  /** Optional help content. When set, a (?) button appears next to the title
   *  and opens a panel-specific HelpDialog. */
  help?: ReactNode
  children: ReactNode
}

const DEFAULT_MIN: FloatingWindowSize = { width: 180, height: 120 }

export function FloatingWindow({
  title,
  initialPos,
  width = 260,
  initialHeight,
  minSize = DEFAULT_MIN,
  zIndex,
  onFocus,
  onClose,
  onPositionCommit,
  onSizeCommit,
  resetRev,
  onResetLayout,
  help,
  children
}: FloatingWindowProps): JSX.Element {
  const [pos, setPos] = useState(initialPos)
  const [helpOpen, setHelpOpen] = useState(false)
  // The title bar's right-click menu ("Reset Size & Position"), at cursor coords.
  const [barMenu, setBarMenu] = useState<{ x: number; y: number } | null>(null)
  // `size === null` means "auto-height" (body content drives the height,
  // pre-resize state). Once the user drags the corner we commit to an
  // explicit pixel size and stop auto-sizing.
  const [size, setSize] = useState<FloatingWindowSize | null>(
    initialHeight != null ? { width, height: initialHeight } : null
  )
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const parentOffset = useRef({ x: 0, y: 0 })
  const resizeAnchor = useRef({ startW: 0, startH: 0, startX: 0, startY: 0 })
  const posRef = useRef(pos)
  posRef.current = pos
  const sizeRef = useRef<FloatingWindowSize | null>(size)
  sizeRef.current = size

  // "Reset Size & Position": the owner has already restored the default
  // initialPos/width/initialHeight; a bumped resetRev re-syncs the local
  // drag/resize state to them (deliberately NOT keyed on the props themselves —
  // they also change on every ordinary drag/resize commit).
  useEffect(() => {
    if (resetRev === undefined) return
    setPos(initialPos)
    setSize(initialHeight != null ? { width, height: initialHeight } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetRev])

  // --- drag --------------------------------------------------------------
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent): void => {
      const x = Math.max(0, e.clientX - dragOffset.current.x - parentOffset.current.x)
      const y = Math.max(0, e.clientY - dragOffset.current.y - parentOffset.current.y)
      setPos({ x, y })
    }
    const onUp = (): void => {
      setDragging(false)
      onPositionCommit?.(posRef.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, onPositionCommit])

  // --- resize ------------------------------------------------------------
  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent): void => {
      const dw = e.clientX - resizeAnchor.current.startX
      const dh = e.clientY - resizeAnchor.current.startY
      const w = Math.max(minSize.width, resizeAnchor.current.startW + dw)
      const h = Math.max(minSize.height, resizeAnchor.current.startH + dh)
      setSize({ width: w, height: h })
    }
    const onUp = (): void => {
      setResizing(false)
      if (sizeRef.current) onSizeCommit?.(sizeRef.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing, onSizeCommit, minSize.width, minSize.height])

  const beginDrag = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return // right-click = the bar's context menu, not a drag
      if ((e.target as HTMLElement).closest('.se-window__close, .se-window__help')) return
      onFocus()
      const windowEl = e.currentTarget.parentElement as HTMLDivElement
      const rect = windowEl.getBoundingClientRect()
      const parentEl = (windowEl.offsetParent as HTMLElement | null) ?? null
      const parentRect = parentEl
        ? parentEl.getBoundingClientRect()
        : { left: 0, top: 0 }
      dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      parentOffset.current = { x: parentRect.left, y: parentRect.top }
      setDragging(true)
    },
    [onFocus]
  )

  const beginResize = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      onFocus()
      const windowEl = e.currentTarget.parentElement as HTMLDivElement
      const rect = windowEl.getBoundingClientRect()
      resizeAnchor.current = {
        startW: rect.width,
        startH: rect.height,
        startX: e.clientX,
        startY: e.clientY
      }
      // Lock in current dimensions as the resize starting point. Subsequent
      // mousemove handler updates from this baseline.
      setSize({ width: rect.width, height: rect.height })
      setResizing(true)
    },
    [onFocus]
  )

  const cssWidth = size?.width ?? width
  const cssHeight = size?.height // undefined → auto

  return (
    <>
      <div
        className={`se-window${dragging ? ' is-dragging' : ''}${resizing ? ' is-resizing' : ''}`}
        style={{ left: pos.x, top: pos.y, width: cssWidth, height: cssHeight, zIndex }}
        onMouseDown={onFocus}
      >
        <div
          className="se-window__bar"
          onMouseDown={beginDrag}
          onContextMenu={(e) => {
            if (!onResetLayout) return
            e.preventDefault()
            setBarMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          <div className="se-window__titlegroup">
            <span className="se-window__title">{title}</span>
            {help != null && (
              <button
                className="se-window__help"
                onClick={() => setHelpOpen(true)}
                title={`${title} help`}
                type="button"
              >
                <svg viewBox="0 0 16 16">
                  <text
                    x="8"
                    y="8.5"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="12"
                    fontWeight="700"
                    fill="currentColor"
                  >
                    ?
                  </text>
                </svg>
              </button>
            )}
          </div>
          <button
            className="se-window__close"
            onClick={onClose}
            title={`Close ${title}`}
            type="button"
          >
            <svg viewBox="0 0 12 12" width="10" height="10">
              <path
                d="M2 2 L10 10 M10 2 L2 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="square"
                fill="none"
              />
            </svg>
          </button>
        </div>
        <div className="se-window__body">{children}</div>
        <div
          className="se-window__resize"
          onMouseDown={beginResize}
          title="Drag to resize"
        />
      </div>
      {help != null && (
        <HelpDialog open={helpOpen} title={`${title} — Help`} onClose={() => setHelpOpen(false)}>
          {help}
        </HelpDialog>
      )}
      {barMenu != null &&
        onResetLayout != null &&
        // Portaled to <body>: a fixed menu inside the window would be trapped in
        // its stacking context, so another (higher-z) window could overlay it.
        createPortal(
          <ContextMenu
            x={barMenu.x}
            y={barMenu.y}
            items={[{ label: 'Reset Size & Position', onClick: onResetLayout }]}
            onClose={() => setBarMenu(null)}
          />,
          document.body
        )}
    </>
  )
}
