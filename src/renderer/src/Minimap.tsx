// Collapsible minimap overlay for the level canvas. Sits in the top-left
// corner, shows a half-transparent BG1-only render of the whole level, and
// pans the main camera when clicked/dragged. The pixel draw lives in the pure
// canvas/draw/minimap module; this owns the React state, persistence, and
// pointer handling.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { View } from './canvas/view'
import { drawMinimap } from './canvas/draw/minimap'
import { persistedState } from './lib/persisted-state'

/** Logical width of the minimap box; height follows the level's aspect ratio. */
const MAP_W = 220
/** Opacity of the level render — the requested "half transparent" look. */
const MAP_ALPHA = 0.55

// Collapsed/expanded preference persists like the other renderer UI prefs.
const collapsedStore = persistedState<boolean>('shinyEgg.minimap.v1', false)

export interface MinimapProps {
  /** Full-extent BG1 backing canvas, or null when no level is rendered. */
  bg1Canvas: HTMLCanvasElement | null
  /** Bumps whenever the BG1 CONTENT changes — incremental patches keep the same
   *  canvas element identity, so this is what tells the minimap to repaint. */
  renderVersion: number
  /** Current main-canvas camera (drives the visible-region rectangle). */
  view: View
  /** Main-canvas viewport size in canvas pixels. */
  viewportSize: { w: number; h: number }
  /** Pan the main camera so this level world-pixel sits at the viewport centre. */
  onNavigate: (worldX: number, worldY: number) => void
}

export function Minimap({
  bg1Canvas,
  renderVersion,
  view,
  viewportSize,
  onNavigate
}: MinimapProps): JSX.Element | null {
  const [collapsed, setCollapsed] = useState<boolean>(() => collapsedStore.load())
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef(false)

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      collapsedStore.save(next)
      return next
    })
  }, [])

  const mapW = MAP_W
  const mapH =
    bg1Canvas && bg1Canvas.width > 0
      ? Math.round((MAP_W * bg1Canvas.height) / bg1Canvas.width)
      : Math.round(MAP_W / 2)

  // Repaint whenever the level render, camera, viewport, or box size changes.
  useEffect(() => {
    if (collapsed || !bg1Canvas) return
    const cv = canvasElRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const bw = Math.round(mapW * dpr)
    const bh = Math.round(mapH * dpr)
    if (cv.width !== bw) cv.width = bw
    if (cv.height !== bh) cv.height = bh
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawMinimap(ctx, {
      bg1Canvas,
      view,
      viewportSize,
      width: mapW,
      height: mapH,
      alpha: MAP_ALPHA
    })
  }, [bg1Canvas, renderVersion, view, viewportSize, collapsed, mapW, mapH])

  // minimap px → world px, then ask the parent to centre the camera there.
  const navTo = useCallback(
    (clientX: number, clientY: number) => {
      const cv = canvasElRef.current
      if (!cv || !bg1Canvas) return
      const r = cv.getBoundingClientRect()
      onNavigate(
        ((clientX - r.left) / mapW) * bg1Canvas.width,
        ((clientY - r.top) / mapH) * bg1Canvas.height
      )
    },
    [bg1Canvas, mapW, mapH, onNavigate]
  )

  if (!bg1Canvas) return null

  return (
    // Stop mouse events from bubbling to the canvas's pan/place/hover handlers;
    // the inner canvas uses pointer events (a separate event stream) for nav.
    <div
      className={'se-minimap' + (collapsed ? ' is-collapsed' : '')}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className="se-minimap__bar"
        onClick={toggle}
        title={collapsed ? 'Show minimap' : 'Collapse minimap'}
      >
        <span className="se-minimap__title">Map</span>
        <span className="se-minimap__toggle">{collapsed ? '▢' : '–'}</span>
      </div>
      {!collapsed && (
        <canvas
          ref={canvasElRef}
          className="se-minimap__canvas"
          style={{ width: mapW, height: mapH }}
          onPointerDown={(e) => {
            draggingRef.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            navTo(e.clientX, e.clientY)
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) navTo(e.clientX, e.clientY)
          }}
          onPointerUp={(e) => {
            draggingRef.current = false
            e.currentTarget.releasePointerCapture(e.pointerId)
          }}
        />
      )}
    </div>
  )
}
