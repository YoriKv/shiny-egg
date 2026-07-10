// Yoshi-path section at the bottom of a World Map panel world page — the visual
// editor for the Bank17 path tables: the world's 8 Yoshi dot positions plus
// each level's walk checkpoints, dragged (or arrow-key nudged) over a live
// 512×256 overworld render (render.worldMapTerrain — the same composite the
// M1TE Maps tab thumbnails, served straight from the built ROM, no export
// needed). Lines connect each dot through its level's checkpoints to the next
// dot: solid = the walked checkpoint chain, dashed = the hop onto the next dot.
// Coordinates are overworld PIXELS (the same space the cart words hold), so a
// marker overlays at exactly its word value. The editing document lives at App
// level (useWorldMapPathsEditor) — this section is stateless beyond selection.

import { useEffect, useRef, useState, type JSX } from 'react'
import {
  activeCheckpoints,
  clampPathX,
  clampPathY,
  pathPointAt,
  withPoint,
  type PathPointRef,
  type WorldMapPathsEditorApi
} from '../edit-session/useWorldMapPathsEditor'
import type { WorldMapPathsModel } from '../../../preload/api'
import { blitRgba } from '../lib/blit'
import { hex0x } from '../lib/hex'
import { NumberField } from './field-widgets'

const MAP_W = 512
const MAP_H = 256

const sameRef = (a: PathPointRef | null, b: PathPointRef): boolean =>
  a !== null &&
  a.kind === b.kind &&
  a.world === b.world &&
  (a.kind === 'dot'
    ? a.dot === (b as { dot: number }).dot
    : a.level === (b as { level: number }).level && a.k === (b as { k: number }).k)

/** The polyline a level's clear-walk follows: its dot → active checkpoints
 *  (walked), then the hop onto the next dot (`to`, absent for the last dot). */
function levelSegments(
  m: WorldMapPathsModel,
  world: number,
  level: number
): { walked: { x: number; y: number }[]; to: { x: number; y: number } | null } {
  const dot = m.dots[world]?.[level]
  const walked = dot ? [dot, ...activeCheckpoints(m, world, level)] : []
  return { walked, to: m.dots[world]?.[level + 1] ?? null }
}

const fmtPts = (pts: { x: number; y: number }[]): string => pts.map((p) => `${p.x},${p.y}`).join(' ')

/** `world` is the panel's 1-based world number; the model + cart are 0-based. */
export function WorldMapPathsSection({
  world,
  editor
}: {
  world: number
  editor: WorldMapPathsEditorApi
}): JSX.Element {
  const w = world - 1
  const { model } = editor
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // `dx`/`dy` = marker-center − grab-point offset, applied to every move so the
  // marker doesn't jump to the cursor (and a click-release without motion
  // commits the exact original position — a no-op). `rect` is the overlay's
  // bounding box captured at grab (the pointer is captured, so it can't change
  // mid-drag) — no per-frame getBoundingClientRect.
  const dragRef = useRef<{
    ref: PathPointRef
    before: WorldMapPathsModel
    dx: number
    dy: number
    rect: DOMRect
  } | null>(null)
  // The dragged point's pending position — SECTION-LOCAL state, so a drag frame
  // re-renders only this section's SVG, never the document/App (the document is
  // committed once, on release — the same commit-on-mouseup contract as the
  // level editor's drag outline). Rendering overlays it via `withPoint`.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<PathPointRef | null>(null)
  const [previewMissing, setPreviewMissing] = useState(false)

  // The terrain preview — cart-static per world, so one fetch per world switch.
  useEffect(() => {
    let alive = true
    setSelection(null)
    void window.shinyEgg.render.worldMapTerrain(w).then((img) => {
      if (!alive) return
      if (img) blitRgba(canvasRef.current, img)
      setPreviewMissing(!img)
    })
    return () => {
      alive = false
    }
  }, [w])

  if (!model) return <></>

  // The rendered model: the draft plus the in-flight drag's pending position.
  const displayModel =
    dragRef.current && dragPos ? withPoint(model, dragRef.current.ref, dragPos.x, dragPos.y) : model

  const mapPoint = (
    rect: DOMRect,
    e: { clientX: number; clientY: number }
  ): { x: number; y: number } => {
    if (rect.width === 0) return { x: 0, y: 0 }
    return {
      x: ((e.clientX - rect.left) * MAP_W) / rect.width,
      y: ((e.clientY - rect.top) * MAP_H) / rect.height
    }
  }

  const startDrag = (ref: PathPointRef) => (e: React.PointerEvent<SVGElement>) => {
    const before = editor.read()
    const p = before && pathPointAt(before, ref)
    const rect = svgRef.current?.getBoundingClientRect()
    if (!before || !p || !rect) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    e.stopPropagation() // the svg root's pointerdown clears the selection
    const grab = mapPoint(rect, e)
    dragRef.current = { ref, before, dx: p.x - grab.x, dy: p.y - grab.y, rect }
    setSelection(ref)
    // preventScroll: focus() would otherwise scroll the wrap into view inside
    // the panel's overflow:auto body — a visible jump when the panel had lost
    // focus (the marker being clicked is evidently already in view).
    wrapRef.current?.focus({ preventScroll: true })
  }
  // Captured pointer events retarget to the grabbed marker and BUBBLE, so the
  // svg root's move/up handlers below see the whole drag — the markers carry
  // only pointerdown.
  const moveDrag = (e: React.PointerEvent<SVGElement>): void => {
    const d = dragRef.current
    if (!d) return
    const { x, y } = mapPoint(d.rect, e)
    setDragPos({ x: clampPathX(x + d.dx), y: clampPathY(y + d.dy) })
  }
  const endDrag = (e: React.PointerEvent<SVGElement>): void => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    setDragPos(null)
    const { x, y } = mapPoint(d.rect, e)
    editor.commitPointFrom(d.before, d.ref, x + d.dx, y + d.dy)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!selection) return
    const cur = pathPointAt(model, selection)
    if (!cur) return
    const step = e.shiftKey ? 8 : 1
    let dx = 0
    let dy = 0
    if (e.key === 'ArrowLeft') dx = -step
    else if (e.key === 'ArrowRight') dx = step
    else if (e.key === 'ArrowUp') dy = -step
    else if (e.key === 'ArrowDown') dy = step
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.kind === 'ckpt') {
      editor.removeCheckpoint(selection.world, selection.level, selection.k)
      setSelection(null)
      e.preventDefault()
      return
    } else return
    editor.commitPoint(selection, cur.x + dx, cur.y + dy)
    e.preventDefault()
  }

  // The level whose checkpoint chain the selection addresses (a dot's outgoing
  // walk is its own level), for the add/remove buttons.
  const selLevel = selection === null ? null : selection.kind === 'dot' ? selection.dot : selection.level
  const selActive = selLevel === null ? 0 : activeCheckpoints(model, w, selLevel).length
  const selPoint = selection ? pathPointAt(displayModel, selection) : null
  const selLabel =
    selection === null || selLevel === null
      ? null
      : selection.kind === 'dot'
        ? `${world}-${selLevel + 1} dot`
        : `${world}-${selLevel + 1} checkpoint ${selection.k + 1}`

  return (
    <>
      <div className="se-worldmap__subhead">Yoshi path</div>
      <p className="se-worldmap__note">
        Where each level's Yoshi sits on the map (numbered dots) and the checkpoints Yoshi walks
        through after a clear (diamonds) — solid line = walked, dashed = the hop to the next dot.
        Drag a marker or nudge it with the arrow keys (Shift = 8&nbsp;px); Delete removes a
        selected checkpoint. Stock coordinates stay within X 0x20–0x1D0, Y 0x74–0xC0. Keep every
        dot's X <em>even</em> — the stock scroll engine never settles on an odd camera target, so
        an odd dot X makes the map scroll loop forever — or add the prepackaged World Map Scroll
        Fix patch (Patches panel), which removes the constraint. To edit the map graphics
        themselves, use the Graphics panel (M1TE Maps tab).
      </p>
      <div className="se-wmpath" ref={wrapRef} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="se-wmpath__stage">
          <canvas ref={canvasRef} className="se-wmpath__map" width={MAP_W} height={MAP_H} />
          {previewMissing && (
            <div className="se-wmpath__nomap">no map render — build the ROM (Test Level) first</div>
          )}
          <svg
            ref={svgRef}
            className="se-wmpath__overlay"
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerDown={() => setSelection(null)}
          >
            {/* Path lines, under the markers: per level, dot → checkpoints (solid)
                then → next dot (dashed). Each drawn twice — a dark underlay so the
                line reads on both bright and dark terrain. */}
            {displayModel.dots[w]?.map((_, l) => {
              const { walked, to } = levelSegments(displayModel, w, l)
              if (walked.length === 0) return null
              const last = walked[walked.length - 1]!
              return (
                <g key={`seg${l}`}>
                  {walked.length > 1 && (
                    <>
                      <polyline className="se-wmpath__line-under" points={fmtPts(walked)} />
                      <polyline className="se-wmpath__line" points={fmtPts(walked)} />
                    </>
                  )}
                  {to && (
                    <>
                      <line className="se-wmpath__line-under is-hop" x1={last.x} y1={last.y} x2={to.x} y2={to.y} />
                      <line className="se-wmpath__line is-hop" x1={last.x} y1={last.y} x2={to.x} y2={to.y} />
                    </>
                  )}
                </g>
              )
            })}
            {/* Checkpoint markers (small diamonds), then dots on top. */}
            {displayModel.checkpoints[w]?.map((level, l) =>
              activeCheckpoints(displayModel, w, l).map((p, k) => {
                const ref: PathPointRef = { kind: 'ckpt', world: w, level: l, k }
                return (
                  <rect
                    key={`c${l}-${k}`}
                    className={`se-wmpath__ckpt${sameRef(selection, ref) ? ' is-sel' : ''}`}
                    x={-4}
                    y={-4}
                    width={8}
                    height={8}
                    transform={`translate(${p.x} ${p.y}) rotate(45)`}
                    onPointerDown={startDrag(ref)}
                  >
                    <title>{`${world}-${l + 1} checkpoint ${k + 1} · ${hex0x(p.x, 4)}, ${hex0x(p.y, 4)}`}</title>
                  </rect>
                )
              })
            )}
            {displayModel.dots[w]?.map((p, d) => {
              const ref: PathPointRef = { kind: 'dot', world: w, dot: d }
              return (
                <g
                  key={`d${d}`}
                  className={`se-wmpath__dot${sameRef(selection, ref) ? ' is-sel' : ''}`}
                  transform={`translate(${p.x} ${p.y})`}
                  onPointerDown={startDrag(ref)}
                >
                  <title>{`${world}-${d + 1} Yoshi dot · ${hex0x(p.x, 4)}, ${hex0x(p.y, 4)}`}</title>
                  <circle r={7} />
                  <text y={3.5}>{d + 1}</text>
                </g>
              )
            })}
          </svg>
        </div>
      </div>
      <div className="se-wmpath__info">
        {selection && selPoint && selLevel !== null ? (
          <>
            <span className="se-wmpath__sel">{selLabel}</span>
            <label className="se-worldmap__cell" title="X in overworld pixels (0–511)">
              <span className="se-worldmap__cell-label">X</span>
              <span className="se-meta se-props__hexprefix">0x</span>
              <NumberField
                value={selPoint.x}
                min={0}
                max={511}
                hex
                onCommit={(v) => editor.commitPoint(selection, v, selPoint.y)}
              />
            </label>
            <label className="se-worldmap__cell" title="Y in overworld pixels (0–255)">
              <span className="se-worldmap__cell-label">Y</span>
              <span className="se-meta se-props__hexprefix">0x</span>
              <NumberField
                value={selPoint.y}
                min={0}
                max={255}
                hex
                onCommit={(v) => editor.commitPoint(selection, selPoint.x, v)}
              />
            </label>
            <button
              type="button"
              className="se-worldmap__rowbtn"
              title={`Add a walk checkpoint after ${world}-${selLevel + 1} (4 max per level)`}
              disabled={selActive >= 4}
              onClick={() => {
                const ref = editor.addCheckpoint(w, selLevel)
                if (ref) setSelection(ref)
              }}
            >
              + checkpoint
            </button>
            {selection.kind === 'ckpt' && (
              <button
                type="button"
                className="se-worldmap__rowbtn"
                title="Remove this checkpoint (later ones shift up)"
                onClick={() => {
                  editor.removeCheckpoint(selection.world, selection.level, selection.k)
                  setSelection(null)
                }}
              >
                − remove
              </button>
            )}
          </>
        ) : (
          <span className="se-meta-xs">click a marker to select it</span>
        )}
      </div>
    </>
  )
}
