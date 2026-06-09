import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type RefObject
} from 'react'
import type { LevelData, LevelObject, LevelSprite, PaletteEdit } from '../../preload/api'
import { moveToIndex, type LevelAction, type LevelState } from './canvas/level-reducer'
import {
  CELL_PX,
  EXIT_MARKER_HALF_PX,
  INCOMING_HIT_HALF_PX,
  LEVEL_CELLS_H,
  LEVEL_CELLS_W,
  SCREEN_CELLS,
  SPAWN_HIT_HALF_PX,
  exitCenterX,
  exitCenterY,
  makeScreenIndex,
  objectVisualBox,
  screenCol,
  screenRow,
  snapCellDelta
} from './canvas/geometry'
import { MAX_LEVEL_SPRITES, clampCell, clampGroupMove, clampObjectMove, clampObjectResize, clampSpriteMove } from './canvas/limits'
import { formatLevelId, getLevel } from './data/levels'
import type { IncomingExit, LayerVisibility, Selection } from './types'
import { useObjectInfluence } from './hooks/useObjectInfluence'
import { useNeighborDependencies } from './hooks/useNeighborDependencies'
import {
  hitResizeHandle,
  extentFromHandle,
  cursorForHandle,
  type ResizeHandle
} from './canvas/draw/handles'
import { objectSizeMode } from './data/object-record'
import { useObjectPropertyTable } from './hooks/useObjectPropertyTable'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ReorderSlider } from './ReorderSlider'

import {
  applyShiftClick,
  collectEraseHits,
  hitTestAll,
  hitTestExit,
  hitTestIncoming,
  hitTestObject,
  hitTestRect,
  hitTestSpawn,
  hitTestSprite,
  selectionKey,
  spriteHit,
  unionSelections
} from './canvas/hit-test'
import {
  INITIAL_VIEW,
  ZOOM_STEP,
  clientToWorld,
  fitViewForLevel,
  focusViewFor,
  zoomAt,
  type View
} from './canvas/view'
import { useLevelRenderLayers } from './hooks/useLevelRenderLayers'
import { drawScene } from './canvas/draw/scene'

export interface CanvasProps {
  hasAssets: boolean
  selectedLevelRecordId: number | null
  /** Current canvas selection (an array — multi-select is length > 1, objects +
   *  sprites only; exits/incoming/spawn are always single). */
  selection: Selection[]
  onSelect: (sel: Selection[]) => void
  onJumpToLevel: (id: number) => void
  layers: LayerVisibility
  /** Entries from sibling rooms in the current sub-level graph that warp
   *  INTO this level. Filtered by App for the currently-loaded level. */
  incoming: IncomingExit[]
  /** Drag-commit of an incoming marker → edit the SOURCE exit's destX/destY in
   *  its (different) level. App writes that level's overlay (auto-save), marks
   *  the build dirty, refreshes the markers, and records a reversible undo. */
  onMoveIncoming: (incoming: IncomingExit, destX: number, destY: number) => void
  /** Level state lives in App so the toolbar's Save button can read
   *  dirty + dispatch `saved`. Canvas reads `level` and dispatches edit
   *  actions through these props. */
  levelState: LevelState
  dispatchLevel: Dispatch<LevelAction>
  /** Saved overlay edits exist that the last build doesn't include — shows a
   *  "rebuild to refresh" hint in the status bar (render decodes the last-built
   *  ROM; the user rebuilds when they want fresh graphics). */
  needsBuild: boolean
  /** Short label naming the shared bank pool(s) this level's streams live in
   *  (with used/limit bytes) — shown in the status bar. Null while the budget
   *  report is loading or for empty/special slots. See lib/level-blockers
   *  `poolSummary`. */
  poolLabel: string | null
  /** Debug object-finder camera-focus request: jump the view to a cell. The
   *  `nonce` makes a repeat jump to the same cell still fire. App changes
   *  `selectedLevelRecordId` alongside it, so a cross-level jump is handed to the load
   *  effect via `pendingFocusRef`. */
  focusRequest: { levelRecordId: number; x: number; y: number; zoom?: number; nonce: number } | null
  /** Mirror of the live camera (pan/zoom). App reads it to snapshot the view
   *  when navigating away (back/forward history); Canvas writes it on every view
   *  change. A ref so it never re-renders App. */
  cameraRef: RefObject<View>
  /** Back/forward camera restore: set the view to a stored snapshot for
   *  `levelRecordId`. Highest-priority view source on load (overrides spawn/fit);
   *  `nonce` re-fires a repeat restore to the same view. */
  cameraRequest: { levelRecordId: number; view: View; nonce: number } | null
  /** Add-picker armed + Place tool active → a quiet canvas click places the
   *  armed entity at the clicked cell (via onPlaceAt) instead of selecting. */
  placing: boolean
  onPlaceAt: (cellX: number, cellY: number) => void
  /** Erase tool active → a press starts a sweep that deletes every object /
   *  sprite the cursor touches. Gated by the same outline visibility as
   *  selection: objects need `bg1Outlines`, sprites need `spriteOutlines` (only
   *  what's visibly outlined is erasable). The drag accumulates targets locally
   *  and commits one batch `deleteEntities` on release (single undo + re-decode). */
  eraseTool: boolean
  /** Set Spawn tool active → a quiet left click sets / clears the Test Level
   *  spawn override (same toggle as the middle-click shortcut). When true the
   *  selection-drag branches are suppressed so every click targets the spawn. */
  spawnTool: boolean
  /** Paint tool active → left-drag paints a surface height at each cell-corner
   *  column (Shift-drag erases). The drag accumulates locally and commits one
   *  `onPaintStroke` on release, which re-fits the whole curve to std objects. */
  paintTool: boolean
  /** The committed painted curve: cell-corner column → row. Drawn as the paint
   *  overlay (with the live drag merged on top while painting). */
  paintHeights: ReadonlyMap<number, number>
  /** Commit a finished paint gesture: columns set (col→row) and columns erased. */
  onPaintStroke: (set: Array<[number, number]>, erased: number[]) => void
  /** The current Test Level spawn override IN CELL COORDS, already filtered by
   *  App to the displayed level (null when none / set on another level). Drawn
   *  as a Yoshi egg; session-only, never saved to the ROM. */
  testSpawn: { x: number; y: number } | null
  /** Place / move the spawn override to a clicked cell. */
  onSetTestSpawn: (cellX: number, cellY: number) => void
  /** Remove the spawn override (fired when a set/middle click lands on it). */
  onClearTestSpawn: () => void
  /** Live world-map spawn position from the entrance-table draft (useWorldMapEditor)
   *  for the loaded level. When set, the spawn marker draws here instead of the
   *  base `level.spawn`, so an unsaved spawn edit moves the marker live. Null when
   *  the level has no world-map entrance or the draft hasn't loaded. */
  spawnOverride: { x: number; y: number } | null
  /** Commit an absolute spawn cell to the entrance-table document (the marker
   *  drag's release). One undo step; the marker follows via `spawnOverride`. */
  onSpawnCommit: (x: number, y: number) => void
  /** The palette colour-edit DRAFT (usePaletteEditor) — fed to the render layers
   *  as `paletteOverride` so the canvas previews unsaved palette edits live (no
   *  build). See hooks/useLevelRenderLayers. */
  paletteOverride: PaletteEdit[]
  /** Bumped on every successful build — forces the render layers to re-fetch from
   *  the freshly-built ROM (asm/palette edits only reach the pixels via a rebuild,
   *  and nothing else in the render deps changes). See hooks/useLevelRenderLayers. */
  renderRefresh: number
}

/** Mouse movement (px) past which a press becomes a drag, not a click. */
const CLICK_THRESHOLD = 4

/** Max ms between two clicks at the same spot to count as a double-click. */
const DOUBLE_CLICK_MS = 350

/**
 * The "rebuild to refresh" status hint is suppressed for now: the only editable
 * data today (level objects/sprites/exits) renders live via the override path,
 * so no cart rebuild is needed to see edits. Flip this on — scoped to the
 * relevant edits — once we have changes that DO require a rebuild (graphics,
 * palettes, asm/strings). The `needsBuild` plumbing stays wired meanwhile.
 */
const SHOW_REBUILD_HINT = false

export function Canvas({
  hasAssets,
  selectedLevelRecordId,
  selection,
  onSelect,
  onJumpToLevel,
  layers,
  incoming,
  onMoveIncoming,
  levelState,
  dispatchLevel,
  needsBuild,
  poolLabel,
  focusRequest,
  cameraRef,
  cameraRequest,
  placing,
  onPlaceAt,
  eraseTool,
  spawnTool,
  paintTool,
  paintHeights,
  onPaintStroke,
  spawnOverride,
  onSpawnCommit,
  testSpawn,
  onSetTestSpawn,
  onClearTestSpawn,
  paletteOverride,
  renderRefresh
}: CanvasProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const level = levelState.level
  // Selection derivations. `primary` (the sole element when exactly one thing is
  // selected; null while multi) drives the single-entity interactions — move /
  // resize / links / context-menu / arrow nudge. The uid sets drive the draw
  // highlight, so a multi-select lights up every selected object/sprite.
  const primary = selection.length === 1 ? selection[0]! : null
  const selObjUids = useMemo(
    () => new Set(selection.flatMap((s) => (s.kind === 'object' ? [s.uid] : []))),
    [selection]
  )
  const selSprUids = useMemo(
    () => new Set(selection.flatMap((s) => (s.kind === 'sprite' ? [s.uid] : []))),
    [selection]
  )
  // Live reorder PREVIEW (reorder slider): the entity moved to its pending
  // stream position, fed to the render layers WITHOUT committing — so the draw
  // order updates while dragging but the undo step lands once, on release. The
  // index is throttled by the slider, so a continuous drag re-decodes at most
  // once per window. `moveToIndex` returns the same slice ref when nothing moved,
  // preserving structural sharing: an object preview re-fetches only bg1 +
  // collision (header/sprites slices untouched); a sprite preview only the
  // sprite layer.
  const [previewReorder, setPreviewReorder] = useState<{
    kind: 'object' | 'sprite'
    uid: number
    index: number
  } | null>(null)
  const renderLevel = useMemo(() => {
    if (!level || !previewReorder) return level
    if (previewReorder.kind === 'object') {
      const objects = moveToIndex(level.objects, previewReorder.uid, previewReorder.index)
      return objects === level.objects ? level : { ...level, objects }
    }
    const sprites = moveToIndex(level.sprites, previewReorder.uid, previewReorder.index)
    return sprites === level.sprites ? level : { ...level, sprites }
  }, [level, previewReorder])

  // Per-level render layers (bg1 / sprite / bg2-3 / collision) — RGBA results +
  // ready-to-draw ImageBitmaps, re-fetched on every level/edit. Fed `renderLevel`
  // so the reorder preview shows live. See hooks/useLevelRenderLayers.
  const {
    bg1Canvas,
    spriteCanvas,
    spriteBounds,
    bgLayers,
    collisionCanvas,
    renderVersion
  } = useLevelRenderLayers(renderLevel, paletteOverride, renderRefresh)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Hover preview — objects show a chartreuse box; cel-backed sprites a
  // size-matched chartreuse box, marker/flag sprites a chartreuse ring.
  // Exits don't have a hover state (the cyan diamond is already prominent
  // enough; adding more visual noise around it doesn't help recognition).
  const [hovered, setHovered] = useState<LevelObject | null>(null)
  // CSS cursor when hovering a resize handle on the selected object (e.g.
  // `nwse-resize`); null otherwise → the className-based cursor applies.
  const [resizeCursor, setResizeCursor] = useState<string | null>(null)
  const [hoveredSprite, setHoveredSprite] = useState<LevelSprite | null>(null)
  // Exit / spawn / incoming hover is boolean only — they don't get a visual
  // hover state, but we still want the cursor to flip to `pointer`.
  const [hoveredExit, setHoveredExit] = useState<boolean>(false)
  const [hoveredSpawn, setHoveredSpawn] = useState<boolean>(false)
  const [hoveredIncoming, setHoveredIncoming] = useState<boolean>(false)
  // Cursor cell (level x/y) for the bottom-right coordinate readout. Null when
  // the cursor is off the canvas or outside the level extent.
  const [cursorCell, setCursorCell] = useState<{ x: number; y: number } | null>(null)

  // Press state — kept in a ref so mousemove doesn't re-render. `moved`
  // flips to true once the press passes CLICK_THRESHOLD; that gates both
  // pan-vs-click classification and the actual view update.
  //
  // Drag modes: `pan` (default — moves the camera), `moveObj` (press inside a
  // selected object's box → translate it), and `moveSprite` (press on a
  // selected sprite → translate it). The mousedown handler picks the mode; the
  // mousemove + mouseup handlers dispatch by `kind`.
  type DragState =
    | {
        kind: 'pan'
        startX: number
        startY: number
        basePan: { x: number; y: number }
        moved: boolean
      }
    | {
        kind: 'moveObj'
        startX: number
        startY: number
        objUid: number
        moved: boolean
      }
    | {
        kind: 'moveSprite'
        startX: number
        startY: number
        sprUid: number
        moved: boolean
      }
    | {
        kind: 'moveExit'
        startX: number
        startY: number
        exitUid: number
        moved: boolean
      }
    | {
        kind: 'resizeObj'
        startX: number
        startY: number
        objUid: number
        handle: ResizeHandle
        moved: boolean
      }
    | {
        // Drag an incoming marker → move where a sibling room's exit lands the
        // player in THIS level. Identity is the source (level, screen) pair;
        // base is the current landing cell. Commit edits the source exit.
        kind: 'moveIncoming'
        startX: number
        startY: number
        sourceLevelRecordId: number
        sourceScreenIndex: number
        baseX: number
        baseY: number
        moved: boolean
      }
    | {
        // Drag the world-map spawn marker → move where Yoshi enters the level
        // from the overworld. Base is the spawn cell at grab time; commit edits
        // the entrance-table document (NOT the level reducer — same shape as
        // moveIncoming). Preview rides a Canvas-local overlay; release commits.
        kind: 'moveSpawn'
        startX: number
        startY: number
        baseX: number
        baseY: number
        moved: boolean
      }
    | {
        // Erase sweep: accumulate every object/sprite uid the cursor passes over
        // (objUids/sprUids mutated in place across mousemoves — authoritative for
        // the commit) and batch-delete on release. A plain click works too: the
        // press point is collected up front. `erasePreview` mirrors these sets so
        // the marked entities visibly vanish before the commit.
        kind: 'erase'
        startX: number
        startY: number
        objUids: Set<number>
        sprUids: Set<number>
        moved: boolean
      }
    | {
        // Paint sweep: accumulate a height per cell-corner column the cursor passes
        // (set) or, with Alt, columns to clear (erased). `paintDrag` mirrors them so
        // the overlay updates live; on release one `onPaintStroke` re-fits the curve.
        kind: 'paint'
        startX: number
        startY: number
        set: Map<number, number>
        erased: Set<number>
        erasing: boolean
        lastCol: number | null
        moved: boolean
      }
    | {
        // Shift-drag marquee (box-select). Below the threshold it's a shift-click
        // (toggle / add-next-in-stack); past it, every object/sprite intersecting
        // the box is unioned into the selection on release.
        kind: 'marquee'
        startX: number
        startY: number
        moved: boolean
      }
    | {
        // Multi-select drag-to-move: a press on any selected entity translates the
        // WHOLE group by one shared, group-clamped delta. Commit on release is a
        // single `moveEntities` (one undo step + one re-decode). Below the
        // threshold it falls through to a quiet click (collapse to single-select).
        kind: 'moveGroup'
        startX: number
        startY: number
        objUids: Set<number>
        sprUids: Set<number>
        moved: boolean
      }
  const dragRef = useRef<DragState | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  // Live preview of an in-progress object-move drag. Stored in state (not
  // a ref) so the draw effect re-runs as the cell delta changes. `null`
  // outside of a moveObj drag.
  const [moveOverlay, setMoveOverlay] = useState<{
    kind: 'object' | 'sprite'
    uid: number
    dx: number
    dy: number
  } | null>(null)
  // Live preview of an in-progress object-resize drag — the pending signed
  // extents. `null` outside a resizeObj drag.
  const [resizeOverlay, setResizeOverlay] = useState<{
    uid: number
    w: number
    h: number
  } | null>(null)
  // Erase-tool live preview: object/sprite uids the current sweep has marked for
  // deletion. Drives the draw effect to hide them before commit. `null` outside
  // an erase drag.
  const [erasePreview, setErasePreview] = useState<{
    objUids: Set<number>
    sprUids: Set<number>
  } | null>(null)
  // Paint-tool live stroke: columns set/erased so far this drag (mirrors the
  // drag ref). Drives the overlay to show the in-progress curve. `null` when not
  // painting; the committed curve is `paintHeights` (a prop).
  const [paintDrag, setPaintDrag] = useState<{
    set: Map<number, number>
    erased: Set<number>
    erasing: boolean
  } | null>(null)
  // Live shift-drag marquee box in WORLD pixels (normalized). Drives the draw
  // effect to show the selection rectangle; `null` outside a marquee drag. The
  // committed selection is computed in onUp from the drag's start/end client
  // points (not this state), so there's no read-after-set race.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  )
  // Live multi-select move overlay: the group's uid sets + the current shared
  // cell delta. Drives the draw effect to shadow every member at its pending
  // position; `null` outside a moveGroup drag. The commit re-derives the delta in
  // onUp from the same inputs, so preview == commit.
  const [groupMove, setGroupMove] = useState<{
    objUids: Set<number>
    sprUids: Set<number>
    dx: number
    dy: number
  } | null>(null)
  // Live spawn-marker drag preview: the pending spawn cell. Drives the draw
  // effect to move the marker; `null` outside a moveSpawn drag. Commit on release
  // reads this back (preview == commit), then calls onSpawnCommit.
  const [spawnDragOverlay, setSpawnDragOverlay] = useState<{ x: number; y: number } | null>(null)
  // Object-drag cell-highlight: per-cell provenance (footprint/neighbour/buried)
  // for the dragged object(s) at their pending position — single move/resize OR a
  // multi-select group move (one decode for the whole group). Null otherwise.
  const influence = useObjectInfluence(level, moveOverlay, resizeOverlay, groupMove)
  // Per-sprite neighbour-dependency status (rail/slime/pair/pipe etc.) for the
  // always-on error badge + selected-sprite overlay. Rides the Sprite-Editing
  // layer; recomputed per edit-commit (see the hook).
  const neighborStatus = useNeighborDependencies(level, layers.spriteOutlines)
  // Right-click context menu — anchored at viewport coords, acting on the hit
  // object/sprite/exit. `null` when closed.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    kind: 'object' | 'sprite' | 'exit'
    uid: number
  } | null>(null)
  // Stream-index slider popover (context-menu "Change paint order…"). Seeded
  // with the entity's current position; throttles its reorder dispatches so a
  // continuous slide re-renders the level once per window, not per tick.
  const [reorderPopover, setReorderPopover] = useState<{
    x: number
    y: number
    kind: 'object' | 'sprite'
    uid: number
    index: number
    max: number
  } | null>(null)
  // The cart's standard-object property table → each object's `sizeMode`, which
  // gates which resize handles exist. Cached singleton; null until first fetch
  // (→ permissive 'wh' so handles aren't wrongly hidden before it loads).
  const propTable = useObjectPropertyTable()
  // Live preview of an exit screen-drag: the target screen + whether the drop
  // is legal (free screen, or the exit's own). `null` outside a moveExit drag.
  const [exitDrag, setExitDrag] = useState<{
    uid: number
    screen: number
    valid: boolean
  } | null>(null)
  // Live preview of an in-progress incoming-marker drag: the dragged marker's
  // target landing cell. `key` = `${sourceLevelRecordId}:${sourceScreenIndex}` (matches
  // the marker identity). `null` outside a moveIncoming drag.
  const [incomingOverlay, setIncomingOverlay] = useState<{
    key: string
    x: number
    y: number
  } | null>(null)
  // Live refs so the global mouseup handler can read current values.
  const levelRef = useRef(level)
  levelRef.current = level
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const viewRef = useRef(view)
  viewRef.current = view
  const sizeRef = useRef(size)
  sizeRef.current = size
  const incomingRef = useRef(incoming)
  incomingRef.current = incoming
  const spriteBoundsRef = useRef(spriteBounds)
  spriteBoundsRef.current = spriteBounds
  const moveOverlayRef = useRef(moveOverlay)
  moveOverlayRef.current = moveOverlay
  const resizeOverlayRef = useRef(resizeOverlay)
  resizeOverlayRef.current = resizeOverlay
  const exitDragRef = useRef(exitDrag)
  exitDragRef.current = exitDrag
  const incomingOverlayRef = useRef(incomingOverlay)
  incomingOverlayRef.current = incomingOverlay
  const onMoveIncomingRef = useRef(onMoveIncoming)
  onMoveIncomingRef.current = onMoveIncoming
  const spawnDragOverlayRef = useRef(spawnDragOverlay)
  spawnDragOverlayRef.current = spawnDragOverlay
  const spawnOverrideRef = useRef(spawnOverride)
  spawnOverrideRef.current = spawnOverride
  const onSpawnCommitRef = useRef(onSpawnCommit)
  onSpawnCommitRef.current = onSpawnCommit
  const onPaintStrokeRef = useRef(onPaintStroke)
  onPaintStrokeRef.current = onPaintStroke
  const placingRef = useRef(placing)
  placingRef.current = placing
  const onPlaceAtRef = useRef(onPlaceAt)
  onPlaceAtRef.current = onPlaceAt
  const spawnToolRef = useRef(spawnTool)
  spawnToolRef.current = spawnTool
  const testSpawnRef = useRef(testSpawn)
  testSpawnRef.current = testSpawn
  const onSetTestSpawnRef = useRef(onSetTestSpawn)
  onSetTestSpawnRef.current = onSetTestSpawn
  const onClearTestSpawnRef = useRef(onClearTestSpawn)
  onClearTestSpawnRef.current = onClearTestSpawn

  // Set / clear the per-session Test Level spawn override at a client point.
  // A click landing on the existing egg marker removes it; anywhere else (re)places
  // it at that cell. Ref-backed so both the Set Spawn tool's left-click (in the
  // mouseup handler) and the middle-click shortcut (in onMouseDown) share one
  // implementation without stale-closure or dep churn.
  const toggleTestSpawnAt = useCallback((clientX: number, clientY: number): void => {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const v = viewRef.current
    const { x: wx, y: wy } = clientToWorld(v, clientX - rect.left, clientY - rect.top)
    const mark = testSpawnRef.current
    if (mark) {
      const mx = (mark.x + 0.5) * CELL_PX
      const my = (mark.y + 0.5) * CELL_PX
      if (Math.abs(wx - mx) <= SPAWN_HIT_HALF_PX && Math.abs(wy - my) <= SPAWN_HIT_HALF_PX) {
        onClearTestSpawnRef.current()
        return
      }
    }
    onSetTestSpawnRef.current(
      Math.max(0, Math.min(255, Math.floor(wx / CELL_PX))),
      Math.max(0, Math.min(127, Math.floor(wy / CELL_PX)))
    )
  }, [])
  const toggleTestSpawnRef = useRef(toggleTestSpawnAt)
  toggleTestSpawnRef.current = toggleTestSpawnAt

  // When the user double-clicks a warp exit, stash the destination cell so
  // the load effect can pan the new level to center on the entry point
  // instead of using the default fit-to-objects view. The ref is the
  // hand-off channel between the click handler and the async level loader.
  const pendingFocusRef = useRef<{
    levelRecordId: number
    x: number
    y: number
    /** Optional zoom override (object-finder jumps zoom in); default 1. */
    zoom?: number
  } | null>(null)

  // Back/forward restore: a full camera snapshot to apply once `levelRecordId` loads.
  // Highest priority in the load effect (overrides spawn/fit). Hand-off channel
  // between the cameraRequest effect and the async loader, like pendingFocusRef.
  const pendingCameraRef = useRef<{ levelRecordId: number; view: View } | null>(null)

  // Mirror the live camera up to App (for navigate-away snapshots) without
  // re-rendering it — App holds the ref.
  useEffect(() => {
    cameraRef.current = view
  }, [view, cameraRef])

  // Cycle state: when a click lands on a stack of multiple selectables, each
  // subsequent click at the same spot advances through the stack. The `key`
  // is a stable hash of the hits list; a click at a different overlap resets
  // the cycle to position 0.
  const cycleRef = useRef<{ key: string; index: number } | null>(null)

  // Click history for double-click detection. We don't use the browser's
  // native `dblclick` event because it fires AFTER both mouseups — by then
  // our single-click cycle has already advanced. Instead we time-check in
  // the mouseup handler and short-circuit the cycle if it's a double.
  const lastClickRef = useRef<{ x: number; y: number; time: number } | null>(null)

  // Reset view + load level (parse .bin for outlines) whenever the
  // selected level changes. BizHawk is NOT auto-told to load the same
  // level — user requests that explicitly via the BizHawk menu's
  // "Load Level" button. This keeps EmuHawk paused/quiet by default.
  useEffect(() => {
    setHovered(null)
    setHoveredSprite(null)
    setHoveredExit(false)
    setHoveredSpawn(false)
    setHoveredIncoming(false)
    setCursorCell(null)
    onSelect([])
    cycleRef.current = null
    setMoveOverlay(null)
    setGroupMove(null)
    if (selectedLevelRecordId === null) {
      dispatchLevel({ type: 'load', data: null })
      setLoadError(null)
      setView(INITIAL_VIEW)
      return
    }
    let cancelled = false
    setLoadError(null)
    window.shinyEgg.editor
      .loadResource({ kind: 'level', recordId: selectedLevelRecordId })
      .then((data) => {
        if (cancelled) return
        dispatchLevel({ type: 'load', data })
        // View-anchor priority on level load:
        //   0. Back/forward restore — the stored camera for this exact view,
        //      beats everything (the user is replaying their trail).
        //   1. Exit-jump / finder destination (set by the dbl-click / finder) —
        //      most specific intent otherwise.
        //   2. World-map spawn flag — "you start here" for direct dropdown picks.
        //   3. Bounding-box fit — fallback for sub-rooms with no spawn.
        const restore = pendingCameraRef.current
        const focus = pendingFocusRef.current
        const playable = !data.empty && !data.special
        if (restore && restore.levelRecordId === data.recordId) {
          setView(restore.view)
        } else if (focus && focus.levelRecordId === data.recordId && playable) {
          setView(focusViewFor(focus.x, focus.y, sizeRef.current, focus.zoom))
        } else if (playable && data.spawn) {
          setView(focusViewFor(data.spawn.x, data.spawn.y, sizeRef.current))
        } else {
          setView(fitViewForLevel(data))
        }
        pendingFocusRef.current = null
        pendingCameraRef.current = null
      })
      .catch((err: Error) => {
        if (!cancelled) {
          dispatchLevel({ type: 'load', data: null })
          setLoadError(err.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedLevelRecordId, onSelect])

  // Debug object-finder focus: jump the camera to a requested cell. If that
  // level is already loaded, focus now; otherwise hand off via pendingFocusRef
  // (App changed selectedLevelRecordId in the same tick, so the load effect applies
  // it). Mirrors the warp-jump path in jumpToLevelAt.
  useEffect(() => {
    if (!focusRequest) return
    if (levelRef.current && levelRef.current.recordId === focusRequest.levelRecordId) {
      setView(focusViewFor(focusRequest.x, focusRequest.y, sizeRef.current, focusRequest.zoom))
    } else {
      pendingFocusRef.current = {
        levelRecordId: focusRequest.levelRecordId,
        x: focusRequest.x,
        y: focusRequest.y,
        zoom: focusRequest.zoom
      }
    }
  }, [focusRequest])

  // Back/forward camera restore: apply the stored view now if that level is
  // already loaded, else hand it to the load effect (App changed selectedLevelRecordId
  // in the same tick). Mirrors the focusRequest path.
  useEffect(() => {
    if (!cameraRequest) return
    if (levelRef.current && levelRef.current.recordId === cameraRequest.levelRecordId) {
      setView(cameraRequest.view)
    } else {
      pendingCameraRef.current = { levelRecordId: cameraRequest.levelRecordId, view: cameraRequest.view }
    }
  }, [cameraRequest])

  // Track wrapper size so the canvas backing store stays crisp at any DPR.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = (): void => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Render loop: redraws on view/level/size change.
  useEffect(() => {
    drawScene(canvasRef.current, {
      size, view, level, layers, bg1Canvas, spriteCanvas, collisionCanvas, bgLayers,
      spriteBounds, neighborStatus, influence, hovered, hoveredSprite, hoveredSpawn, selObjUids, selSprUids, primary, propTable,
      incoming, testSpawn, spawnOverride: spawnDragOverlay ?? spawnOverride, paintTool, paintHeights, moveOverlay, resizeOverlay, groupMove, erasePreview,
      exitDrag, incomingOverlay, marquee, paintDrag
    })
  }, [
    view,
    level,
    bg1Canvas,
    spriteCanvas,
    spriteBounds,
    bgLayers,
    collisionCanvas,
    renderVersion,
    hovered,
    hoveredSprite,
    hoveredSpawn,
    primary,
    selObjUids,
    selSprUids,
    moveOverlay,
    resizeOverlay,
    influence,
    neighborStatus,
    exitDrag,
    incomingOverlay,
    propTable,
    size,
    layers,
    incoming,
    testSpawn,
    spawnOverride,
    spawnDragOverlay,
    erasePreview,
    marquee,
    groupMove,
    paintTool,
    paintHeights,
    paintDrag
  ])

  /**
   * Common "follow this connection" path. If the destination is the same
   * level we're already viewing (self-loop / "incoming from this room
   * itself" edge case), apply the camera move directly because the load
   * effect won't re-fire. Otherwise hand off via pendingFocusRef so the
   * load effect applies focus once the level finishes loading.
   */
  const jumpToLevelAt = useCallback(
    (destLevelRecordId: number, x: number, y: number): void => {
      if (levelRef.current && levelRef.current.recordId === destLevelRecordId) {
        setView(focusViewFor(x, y, sizeRef.current))
      } else {
        pendingFocusRef.current = { levelRecordId: destLevelRecordId, x, y }
        onJumpToLevel(destLevelRecordId)
      }
    },
    [onJumpToLevel]
  )

  // NOTE: this pointer-interaction machinery (DragState, onMouseDown, the
  // window-level mousemove/mouseup effect, the live-preview overlays) stays in
  // the component on purpose — a `useCanvasDrag` hook would be line-relocation,
  // not decoupling. The ~18 mirror refs (levelRef/viewRef/sizeRef/…) are SHARED
  // with the hover handler + toggleTestSpawnAt, and onMouseDown bundles press
  // classification + the click-cycle selection + double-click detection (not
  // just "drag start"), so a hook would need ~18 params + 5 shared refs and
  // return ~7 values with the coupling intact. Any change here needs a real
  // in-app smoke test of drag / resize / selection-cycle / double-click —
  // typecheck won't catch logic regressions in this test-free code.
  // Mouse events. Left-press classification:
  //   1. Cursor on the currently-selected object's outline → `moveObj`
  //      drag (translates the object).
  //   2. Otherwise → `pan` drag (camera). Past the click threshold it
  //      pans the view; below the threshold mouseup treats it as a
  //      click-to-select.
  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // Middle-click: set / clear the Test Level spawn override anywhere,
      // regardless of the active tool. preventDefault stops the OS autoscroll
      // cursor. Left button continues into the select / drag / pan logic.
      if (e.button === 1) {
        e.preventDefault()
        toggleTestSpawnRef.current(e.clientX, e.clientY)
        return
      }
      if (e.button !== 0) return
      // Erase tool: a left press starts a delete-sweep. Collect whatever sits
      // under the press point now (so a plain click with no drag still erases),
      // then accumulate more as the cursor moves; commit on release. Returns
      // early — erase never falls through to selection-move / pan.
      if (eraseTool) {
        const objUids = new Set<number>()
        const sprUids = new Set<number>()
        const wrap = wrapRef.current
        if (wrap) {
          const rect = wrap.getBoundingClientRect()
          const hit = collectEraseHits(
            level,
            view,
            layers,
            incomingRef.current,
            spriteBoundsRef.current,
            rect,
            e.clientX,
            e.clientY
          )
          hit.objUids.forEach((u) => objUids.add(u))
          hit.sprUids.forEach((u) => sprUids.add(u))
        }
        dragRef.current = {
          kind: 'erase',
          startX: e.clientX,
          startY: e.clientY,
          objUids,
          sprUids,
          moved: false
        }
        setErasePreview({ objUids: new Set(objUids), sprUids: new Set(sprUids) })
        setIsPanning(true)
        return
      }
      // Paint tool: a left press starts a surface-height sweep at cell corners.
      // Shift = erase columns. Set the column under the press now; accumulate more
      // on move; commit (one re-fit) on release. Returns early (so Shift here never
      // falls through to the marquee box-select below).
      if (paintTool) {
        const erasing = e.shiftKey
        const set = new Map<number, number>()
        const erased = new Set<number>()
        let lastCol: number | null = null
        const wrap = wrapRef.current
        if (wrap) {
          const rect = wrap.getBoundingClientRect()
          const col = Math.max(0, Math.min(255, Math.round((e.clientX - rect.left - view.panX) / view.zoom / CELL_PX)))
          const row = Math.max(0, Math.min(127, Math.round((e.clientY - rect.top - view.panY) / view.zoom / CELL_PX)))
          if (erasing) erased.add(col)
          else set.set(col, row)
          lastCol = col
        }
        dragRef.current = { kind: 'paint', startX: e.clientX, startY: e.clientY, set, erased, erasing, lastCol, moved: false }
        setPaintDrag({ set: new Map(set), erased: new Set(erased), erasing })
        setIsPanning(true)
        return
      }
      // Shift (in Select mode): start a marquee box-select. Below the click
      // threshold it resolves to a shift-click (toggle / add-next-in-stack) in
      // the mouseup handler; past it, the box's contents union into the selection.
      // Returns early so shift never moves a selection or pans.
      if (e.shiftKey && !placing && !spawnTool) {
        dragRef.current = { kind: 'marquee', startX: e.clientX, startY: e.clientY, moved: false }
        setIsPanning(true)
        return
      }
      // Multi-select drag-to-move: a (non-shift) press that lands on ANY selected
      // object/sprite drags the whole group. A press elsewhere falls through to
      // pan; a quiet (no-drag) press collapses to single-select in mouseup.
      if (!placing && !spawnTool && selection.length > 1 && level) {
        const wrap = wrapRef.current
        if (wrap) {
          const rect = wrap.getBoundingClientRect()
          const onSelected = hitTestAll(
            level, view, layers, incomingRef.current, rect, e.clientX, e.clientY, spriteBoundsRef.current
          ).some(
            (h) =>
              (h.kind === 'object' && selObjUids.has(h.uid)) ||
              (h.kind === 'sprite' && selSprUids.has(h.uid))
          )
          if (onSelected) {
            dragRef.current = {
              kind: 'moveGroup',
              startX: e.clientX,
              startY: e.clientY,
              objUids: selObjUids,
              sprUids: selSprUids,
              moved: false
            }
            setIsPanning(true)
            return
          }
        }
      }
      // Drag-move when the press lands on the (single) selected object's box or
      // the selected sprite's marker. Exit / spawn selections fall through to pan.
      // The Set Spawn tool (like Place) suppresses the drag branches so every
      // quiet click targets the spawn override instead of moving a selection.
      const sel = primary
      if (!placing && !spawnTool && sel && sel.kind === 'object' && level) {
        const o = level.objects.find((obj) => obj.uid === sel.uid)
        const wrap = wrapRef.current
        if (o && wrap) {
          const rect = wrap.getBoundingClientRect()
          const { x: wx, y: wy } = clientToWorld(view, e.clientX - rect.left, e.clientY - rect.top)
          // Resize handles take precedence over the move-box — they sit on the
          // box edges/corner. Gated by the object's sizeMode (extended objects
          // have no W/H → no handles → falls through to move).
          const handle = hitResizeHandle(
            o,
            objectSizeMode(o.num, o.exnum, propTable),
            wx,
            wy,
            view.zoom
          )
          if (handle) {
            dragRef.current = {
              kind: 'resizeObj',
              startX: e.clientX,
              startY: e.clientY,
              objUid: o.uid!,
              handle,
              moved: false
            }
            setIsPanning(true)
            return
          }
          // Move-grab box mirrors draw's box (objectVisualBox): a size-0 axis is
          // 1/4 tile. Shared with the hit-test so grab area == click hit-box.
          const b = objectVisualBox(o)
          if (wx >= b.x0 && wx < b.x0 + b.w && wy >= b.y0 && wy < b.y0 + b.h) {
            dragRef.current = {
              kind: 'moveObj',
              startX: e.clientX,
              startY: e.clientY,
              objUid: o.uid!,
              moved: false
            }
            setIsPanning(true)
            return
          }
        }
      }
      if (!placing && !spawnTool && sel && sel.kind === 'sprite' && level) {
        const s = level.sprites.find((spr) => spr.uid === sel.uid)
        const wrap = wrapRef.current
        if (s && wrap) {
          const rect = wrap.getBoundingClientRect()
          const { x: wx, y: wy } = clientToWorld(view, e.clientX - rect.left, e.clientY - rect.top)
          // Grab anywhere on the sprite's hit region (cel box for cel-backed
          // sprites, marker square otherwise) — matches hitTestSprite.
          if (spriteHit(s, wx, wy, spriteBounds)) {
            dragRef.current = {
              kind: 'moveSprite',
              startX: e.clientX,
              startY: e.clientY,
              sprUid: s.uid!,
              moved: false
            }
            setIsPanning(true)
            return
          }
        }
      }
      if (!placing && sel && sel.kind === 'exit' && level) {
        const exit = level.exits.find((ex) => ex.uid === sel.uid)
        const wrap = wrapRef.current
        if (exit && wrap) {
          const rect = wrap.getBoundingClientRect()
          const { x: wx, y: wy } = clientToWorld(view, e.clientX - rect.left, e.clientY - rect.top)
          const cx = exitCenterX(exit.screenIndex)
          const cy = exitCenterY(exit.screenIndex)
          if (Math.abs(wx - cx) <= EXIT_MARKER_HALF_PX && Math.abs(wy - cy) <= EXIT_MARKER_HALF_PX) {
            dragRef.current = {
              kind: 'moveExit',
              startX: e.clientX,
              startY: e.clientY,
              exitUid: exit.uid!,
              moved: false
            }
            setIsPanning(true)
            return
          }
        }
      }
      if (!placing && sel && sel.kind === 'incoming') {
        // Drag the selected incoming marker — match it in the live array by its
        // (source level, source screen) identity so we grab it where it's drawn.
        const key = `${sel.incoming.sourceLevelRecordId}:${sel.incoming.sourceScreenIndex}`
        const inc = incomingRef.current.find(
          (i) => `${i.sourceLevelRecordId}:${i.sourceScreenIndex}` === key
        )
        const wrap = wrapRef.current
        if (inc && wrap) {
          const rect = wrap.getBoundingClientRect()
          const { x: wx, y: wy } = clientToWorld(view, e.clientX - rect.left, e.clientY - rect.top)
          const mx = (inc.destX + 0.5) * CELL_PX
          const my = (inc.destY + 0.5) * CELL_PX
          if (Math.abs(wx - mx) <= INCOMING_HIT_HALF_PX && Math.abs(wy - my) <= INCOMING_HIT_HALF_PX) {
            dragRef.current = {
              kind: 'moveIncoming',
              startX: e.clientX,
              startY: e.clientY,
              sourceLevelRecordId: inc.sourceLevelRecordId,
              sourceScreenIndex: inc.sourceScreenIndex,
              baseX: inc.destX,
              baseY: inc.destY,
              moved: false
            }
            setIsPanning(true)
            return
          }
        }
      }
      // Drag the world-map spawn marker (when selected). Grab at its EFFECTIVE
      // position (the entrance-table draft overrides the base), so a moved-then-
      // regrabbed marker still hits. Commit goes to the entrance-table document on
      // release (moveIncoming shape). Suppressed under Place / Set-Spawn tools.
      if (!placing && !spawnTool && sel && sel.kind === 'spawn' && level) {
        const eff = spawnOverride ?? level.spawn
        const wrap = wrapRef.current
        if (eff && wrap) {
          const rect = wrap.getBoundingClientRect()
          if (hitTestSpawn(level, view, layers, rect, e.clientX, e.clientY, eff)) {
            dragRef.current = {
              kind: 'moveSpawn',
              startX: e.clientX,
              startY: e.clientY,
              baseX: eff.x,
              baseY: eff.y,
              moved: false
            }
            setIsPanning(true)
            return
          }
        }
      }
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        basePan: { x: view.panX, y: view.panY },
        moved: false
      }
      setIsPanning(true)
    },
    [view.panX, view.panY, view.zoom, primary, selection, selObjUids, selSprUids, level, placing, spawnTool, eraseTool, paintTool, layers, propTable, spawnOverride]
  )

  useEffect(() => {
    if (!isPanning) return
    const wrap = wrapRef.current
    // Pan updates are coalesced to one per animation frame. A high-Hz mouse
    // fires mousemove far more often than the display refreshes, and each pan
    // setView re-runs the full canvas redraw; rAF collapses a burst of moves to
    // the latest position — at most one redraw per frame. Other drag kinds
    // already self-throttle (cell-snapped overlay state behind equality guards),
    // so only pan needs this. These locals are scoped to this effect run, i.e.
    // one drag session (isPanning gates the effect).
    let panFrame = 0
    let panTarget: { x: number; y: number } | null = null
    const applyPan = (): void => {
      panFrame = 0
      if (!panTarget) return
      const { x, y } = panTarget
      setView((v) => ({ ...v, panX: x, panY: y }))
    }
    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (!d.moved && (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD)) {
        d.moved = true
      }
      if (!d.moved) return
      if (d.kind === 'pan') {
        // Stash the latest target; apply at most once per frame (see applyPan).
        panTarget = { x: d.basePan.x + dx, y: d.basePan.y + dy }
        if (!panFrame) panFrame = requestAnimationFrame(applyPan)
      } else if (d.kind === 'moveObj') {
        // Snap pixel delta to integer cells via current zoom, then clamp to the
        // level's bounds so the preview never crosses the boundary. The commit
        // reads this clamped overlay back, so release == dispatched.
        let { cellDx, cellDy } = snapCellDelta(dx, dy, viewRef.current.zoom)
        const dragObj = levelRef.current?.objects.find((o) => o.uid === d.objUid)
        if (dragObj) {
          const c = clampObjectMove(dragObj, cellDx, cellDy)
          cellDx = c.dx
          cellDy = c.dy
        }
        setMoveOverlay((cur) =>
          cur && cur.kind === 'object' && cur.uid === d.objUid && cur.dx === cellDx && cur.dy === cellDy
            ? cur
            : { kind: 'object', uid: d.objUid, dx: cellDx, dy: cellDy }
        )
      } else if (d.kind === 'moveSprite') {
        // moveSprite — same snap + clamp against the sprite's point bounds.
        let { cellDx, cellDy } = snapCellDelta(dx, dy, viewRef.current.zoom)
        const dragSpr = levelRef.current?.sprites.find((s) => s.uid === d.sprUid)
        if (dragSpr) {
          const c = clampSpriteMove(dragSpr, cellDx, cellDy)
          cellDx = c.dx
          cellDy = c.dy
        }
        setMoveOverlay((cur) =>
          cur && cur.kind === 'sprite' && cur.uid === d.sprUid && cur.dx === cellDx && cur.dy === cellDy
            ? cur
            : { kind: 'sprite', uid: d.sprUid, dx: cellDx, dy: cellDy }
        )
      } else if (d.kind === 'resizeObj') {
        // resizeObj — drag the free edge/corner to a grid line; the anchor stays
        // fixed so crossing it flips the extent's sign (negative size). Clamp to
        // bounds; the commit reads this overlay back so release == dispatched.
        if (!wrap) return
        const rect = wrap.getBoundingClientRect()
        const { x: wx, y: wy } = clientToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top)
        const o = levelRef.current?.objects.find((obj) => obj.uid === d.objUid)
        if (!o) return
        const ext = extentFromHandle(o, d.handle, wx, wy)
        const c = clampObjectResize(o, ext.w, ext.h)
        setResizeOverlay((cur) =>
          cur && cur.uid === d.objUid && cur.w === c.w && cur.h === c.h
            ? cur
            : { uid: d.objUid, w: c.w, h: c.h }
        )
      } else if (d.kind === 'moveExit') {
        // moveExit — snap to the screen under the cursor; valid unless another
        // exit already occupies it (one exit per screen).
        if (!wrap) return
        const rect = wrap.getBoundingClientRect()
        const { x: wx, y: wy } = clientToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top)
        const col = Math.max(0, Math.min(15, Math.floor(wx / (SCREEN_CELLS * CELL_PX))))
        const row = Math.max(0, Math.min(7, Math.floor(wy / (SCREEN_CELLS * CELL_PX))))
        const screen = makeScreenIndex(col, row)
        const occupied = (levelRef.current?.exits ?? []).some(
          (x) => x.uid !== d.exitUid && x.screenIndex === screen
        )
        setExitDrag((cur) =>
          cur && cur.uid === d.exitUid && cur.screen === screen && cur.valid === !occupied
            ? cur
            : { uid: d.exitUid, screen, valid: !occupied }
        )
      } else if (d.kind === 'moveIncoming') {
        // moveIncoming — snap the landing cell to the grid, clamped to the
        // level extent (x 0..255, y 0..127). Commit reads this overlay back.
        const { cellDx, cellDy } = snapCellDelta(dx, dy, viewRef.current.zoom)
        const { x: nx, y: ny } = clampCell(d.baseX + cellDx, d.baseY + cellDy)
        const key = `${d.sourceLevelRecordId}:${d.sourceScreenIndex}`
        setIncomingOverlay((cur) =>
          cur && cur.key === key && cur.x === nx && cur.y === ny
            ? cur
            : { key, x: nx, y: ny }
        )
      } else if (d.kind === 'moveSpawn') {
        // moveSpawn — snap the spawn cell to the grid, clamped to the level extent
        // (x 0..255, y 0..127). Commit reads this overlay back on release.
        const { cellDx, cellDy } = snapCellDelta(dx, dy, viewRef.current.zoom)
        const { x: nx, y: ny } = clampCell(d.baseX + cellDx, d.baseY + cellDy)
        setSpawnDragOverlay((cur) => (cur && cur.x === nx && cur.y === ny ? cur : { x: nx, y: ny }))
      } else if (d.kind === 'erase') {
        // Sweep: add whatever the cursor is now over to the kill set. Mutate the
        // drag's sets in place (authoritative for the commit) and mirror them to
        // erasePreview when they grow, so the marked entities vanish from view.
        if (!wrap) return
        const rect = wrap.getBoundingClientRect()
        const hit = collectEraseHits(
          levelRef.current,
          viewRef.current,
          layers,
          incomingRef.current,
          spriteBoundsRef.current,
          rect,
          e.clientX,
          e.clientY
        )
        let added = false
        for (const u of hit.objUids) if (!d.objUids.has(u)) { d.objUids.add(u); added = true }
        for (const u of hit.sprUids) if (!d.sprUids.has(u)) { d.sprUids.add(u); added = true }
        if (added) setErasePreview({ objUids: new Set(d.objUids), sprUids: new Set(d.sprUids) })
      } else if (d.kind === 'paint') {
        // Sample the cell-corner column under the cursor; interpolate columns
        // between the last sample and now so a fast drag paints no gaps. Mutate
        // the drag's set/erased in place; mirror to paintDrag for the overlay.
        if (!wrap) return
        const rect = wrap.getBoundingClientRect()
        const v = viewRef.current
        const curCol = Math.max(0, Math.min(255, Math.round((e.clientX - rect.left - v.panX) / v.zoom / CELL_PX)))
        const curRow = Math.max(0, Math.min(127, Math.round((e.clientY - rect.top - v.panY) / v.zoom / CELL_PX)))
        const from = d.lastCol == null ? curCol : d.lastCol
        const fromRow = d.lastCol == null ? curRow : d.set.get(d.lastCol) ?? curRow
        const lo = Math.min(from, curCol), hi = Math.max(from, curCol)
        let changed = false
        for (let c = lo; c <= hi; c++) {
          if (d.erasing) {
            if (!d.erased.has(c)) { d.erased.add(c); d.set.delete(c); changed = true }
          } else {
            const t = from === curCol ? 1 : (c - from) / (curCol - from)
            const r = Math.round(fromRow + (curRow - fromRow) * t)
            if (d.set.get(c) !== r || d.erased.has(c)) { d.set.set(c, r); d.erased.delete(c); changed = true }
          }
        }
        d.lastCol = curCol
        d.moved = true
        if (changed) setPaintDrag({ set: new Map(d.set), erased: new Set(d.erased), erasing: d.erasing })
      } else if (d.kind === 'marquee') {
        // Update the live box (world px). The committed selection is computed in
        // onUp from the start/end client points, so this is draw-only.
        if (!wrap) return
        const rect = wrap.getBoundingClientRect()
        const { x: x0, y: y0 } = clientToWorld(viewRef.current, d.startX - rect.left, d.startY - rect.top)
        const { x: x1, y: y1 } = clientToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top)
        setMarquee((cur) =>
          cur && cur.x0 === x0 && cur.y0 === y0 && cur.x1 === x1 && cur.y1 === y1
            ? cur
            : { x0, y0, x1, y1 }
        )
      } else if (d.kind === 'moveGroup') {
        // Snap the pixel delta to integer cells, then clamp the WHOLE group
        // rigidly so it can't shear at a boundary. onUp re-derives the same delta.
        const { cellDx, cellDy } = snapCellDelta(dx, dy, viewRef.current.zoom)
        const lvl = levelRef.current
        const objs = lvl ? lvl.objects.filter((o) => o.uid != null && d.objUids.has(o.uid)) : []
        const sprs = lvl ? lvl.sprites.filter((s) => s.uid != null && d.sprUids.has(s.uid)) : []
        const c = clampGroupMove(objs, sprs, cellDx, cellDy)
        setGroupMove((cur) =>
          cur && cur.dx === c.dx && cur.dy === c.dy
            ? cur
            : { objUids: d.objUids, sprUids: d.sprUids, dx: c.dx, dy: c.dy }
        )
      }
    }
    // Tear down a finished drag/click: clear the pending-drag ref + pan flag and
    // every preview overlay (only the active one is set — the rest are no-ops).
    const endDrag = (): void => {
      dragRef.current = null
      setIsPanning(false)
      setMoveOverlay(null)
      setGroupMove(null)
      setResizeOverlay(null)
      setExitDrag(null)
      setIncomingOverlay(null)
      setSpawnDragOverlay(null)
      setPaintDrag(null)
      setErasePreview(null)
      setMarquee(null)
    }
    const onUp = (e: MouseEvent): void => {
      // Flush any pending pan frame so release lands exactly on the last cursor
      // position rather than dropping the final move to a cancelled rAF.
      if (panFrame) {
        cancelAnimationFrame(panFrame)
        applyPan()
      }
      const d = dragRef.current
      // moveObj drag commit: dispatch the edit. Mousemove already snapped
      // the cell delta to the overlay; read it back so the committed
      // value matches what the user saw on release.
      if (d && d.kind === 'moveObj' && d.moved) {
        const overlay = moveOverlayRef.current
        if (
          overlay &&
          overlay.kind === 'object' &&
          overlay.uid === d.objUid &&
          (overlay.dx !== 0 || overlay.dy !== 0)
        ) {
          dispatchLevel({ type: 'moveObject', uid: d.objUid, dx: overlay.dx, dy: overlay.dy })
          // Selection is uid-based, so the highlight + properties panel follow
          // the moved entity automatically — no re-push needed.
        }
        endDrag()
        return
      }
      if (d && d.kind === 'moveSprite' && d.moved) {
        const overlay = moveOverlayRef.current
        if (
          overlay &&
          overlay.kind === 'sprite' &&
          overlay.uid === d.sprUid &&
          (overlay.dx !== 0 || overlay.dy !== 0)
        ) {
          dispatchLevel({ type: 'moveSprite', uid: d.sprUid, dx: overlay.dx, dy: overlay.dy })
        }
        endDrag()
        return
      }
      if (d && d.kind === 'moveGroup' && d.moved) {
        // Re-derive the shared, group-clamped delta from the final cursor
        // position (same inputs as the overlay → commit matches the preview) and
        // commit one batched moveEntities. Selection is uid-based, so it follows.
        const { cellDx, cellDy } = snapCellDelta(e.clientX - d.startX, e.clientY - d.startY, viewRef.current.zoom)
        const lvl = levelRef.current
        const objs = lvl ? lvl.objects.filter((o) => o.uid != null && d.objUids.has(o.uid)) : []
        const sprs = lvl ? lvl.sprites.filter((s) => s.uid != null && d.sprUids.has(s.uid)) : []
        const c = clampGroupMove(objs, sprs, cellDx, cellDy)
        if (c.dx !== 0 || c.dy !== 0) {
          dispatchLevel({
            type: 'moveEntities',
            objectUids: [...d.objUids],
            spriteUids: [...d.sprUids],
            dx: c.dx,
            dy: c.dy
          })
        }
        endDrag()
        return
      }
      if (d && d.kind === 'resizeObj' && d.moved) {
        // Commit the previewed extents (mousemove already clamped them). Patch
        // only the axis this handle controls so a single-axis (edge) resize
        // leaves the locked dimension exactly as-is (including a legitimate
        // size-0 axis).
        const ov = resizeOverlayRef.current
        if (ov && ov.uid === d.objUid) {
          const patch =
            d.handle === 'edgeW'
              ? { w: ov.w }
              : d.handle === 'edgeH'
                ? { h: ov.h }
                : { w: ov.w, h: ov.h }
          dispatchLevel({ type: 'setObjectFields', uid: d.objUid, patch })
        }
        endDrag()
        return
      }
      if (d && d.kind === 'moveExit' && d.moved) {
        const od = exitDragRef.current
        const orig = levelRef.current?.exits.find((x) => x.uid === d.exitUid)?.screenIndex
        if (od && od.uid === d.exitUid && od.valid && od.screen !== orig) {
          dispatchLevel({ type: 'setExitFields', uid: d.exitUid, patch: { screenIndex: od.screen } })
        }
        endDrag()
        return
      }
      if (d && d.kind === 'moveIncoming' && d.moved) {
        // Commit the cross-level dest edit (App writes the source level's
        // overlay + records a reversible undo). Skip a same-cell drop.
        const ov = incomingOverlayRef.current
        const key = `${d.sourceLevelRecordId}:${d.sourceScreenIndex}`
        if (ov && ov.key === key && (ov.x !== d.baseX || ov.y !== d.baseY)) {
          const inc = incomingRef.current.find(
            (i) => `${i.sourceLevelRecordId}:${i.sourceScreenIndex}` === key
          )
          if (inc) onMoveIncomingRef.current(inc, ov.x, ov.y)
        }
        endDrag()
        return
      }
      if (d && d.kind === 'moveSpawn' && d.moved) {
        // Commit the spawn edit to the entrance-table document (App records one
        // undo step; the marker follows via spawnOverride). Skip a same-cell drop.
        const ov = spawnDragOverlayRef.current
        if (ov && (ov.x !== d.baseX || ov.y !== d.baseY)) {
          onSpawnCommitRef.current(ov.x, ov.y)
        }
        endDrag()
        return
      }
      // Paint sweep commit: hand the painted/erased columns to App, which merges
      // them into the curve and re-fits to std objects (one undo + re-decode).
      if (d && d.kind === 'paint') {
        const set = [...d.set.entries()]
        const erased = [...d.erased]
        if (set.length > 0 || erased.length > 0) onPaintStrokeRef.current(set, erased)
        endDrag()
        return
      }
      // Erase sweep commit: one batch delete of every uid the sweep marked
      // (accumulated in onMouseDown + onMove). Covers a plain click (press point
      // collected up front) and a drag alike — one commit = a single undo step +
      // one render re-decode.
      if (d && d.kind === 'erase') {
        const objectUids = [...d.objUids]
        const spriteUids = [...d.sprUids]
        if (objectUids.length > 0 || spriteUids.length > 0) {
          dispatchLevel({ type: 'deleteEntities', objectUids, spriteUids })
          // Drop just the erased entities from the selection (keep the rest).
          const next = selectionRef.current.filter(
            (s) =>
              !((s.kind === 'object' && d.objUids.has(s.uid)) ||
                (s.kind === 'sprite' && d.sprUids.has(s.uid)))
          )
          if (next.length !== selectionRef.current.length) onSelect(next)
        }
        endDrag()
        return
      }
      // Marquee / shift-click commit. A box-select (moved) unions the contained
      // objects/sprites into the selection; a quiet shift-click toggles or adds
      // the next hit in the stack (multi-select is object/sprite only, so the
      // base drops any single exit/incoming/spawn first).
      if (d && d.kind === 'marquee') {
        if (wrap) {
          const rect = wrap.getBoundingClientRect()
          const base = selectionRef.current.filter(
            (s) => s.kind === 'object' || s.kind === 'sprite'
          )
          if (d.moved) {
            const found = hitTestRect(
              levelRef.current, viewRef.current, layers, rect,
              d.startX, d.startY, e.clientX, e.clientY, spriteBoundsRef.current
            )
            onSelect(unionSelections(base, found))
          } else {
            const hits = hitTestAll(
              levelRef.current, viewRef.current, layers, incomingRef.current, rect,
              e.clientX, e.clientY, spriteBoundsRef.current
            ).filter((h) => h.kind === 'object' || h.kind === 'sprite')
            onSelect(applyShiftClick(base, hits))
          }
        }
        cycleRef.current = null
        lastClickRef.current = null
        endDrag()
        return
      }
      // Quiet press = click. Build the hit stack, classify single vs double,
      // and either jump (double-click on warp exit) or cycle the selection.
      // A `moveObj` press that never crossed the drag threshold falls
      // through here too — clicking inside a selected object should
      // still cycle to the next selectable in the stack at that point.
      if (d && !d.moved && wrap) {
        const rect = wrap.getBoundingClientRect()
        // Set Spawn tool: a quiet left click sets / clears the spawn override
        // (same toggle as the middle-click shortcut). Takes precedence over
        // selection so the click never also picks an entity.
        if (spawnToolRef.current) {
          toggleTestSpawnRef.current(e.clientX, e.clientY)
          lastClickRef.current = null
          endDrag()
          return
        }
        // Place mode: a quiet click drops the armed entity at the cell.
        if (placingRef.current) {
          const { x: wx, y: wy } = clientToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top)
          onPlaceAtRef.current(
            Math.max(0, Math.min(255, Math.floor(wx / CELL_PX))),
            Math.max(0, Math.min(127, Math.floor(wy / CELL_PX)))
          )
          lastClickRef.current = null
          endDrag()
          return
        }
        const hits = hitTestAll(
          levelRef.current,
          viewRef.current,
          layers,
          incomingRef.current,
          rect,
          e.clientX,
          e.clientY,
          spriteBoundsRef.current,
          spawnOverrideRef.current ?? levelRef.current?.spawn
        )
        const now = Date.now()
        const lc = lastClickRef.current
        const isDouble =
          !!lc &&
          now - lc.time < DOUBLE_CLICK_MS &&
          Math.abs(e.clientX - lc.x) <= CLICK_THRESHOLD &&
          Math.abs(e.clientY - lc.y) <= CLICK_THRESHOLD

        if (isDouble) {
          // Double-click → "follow the connection". Prioritize outgoing
          // warp exits (the natural in-game flow); fall back to incoming
          // markers (editor-only reverse navigation — "go to the room that
          // points here"). Selection stays put — only the camera moves.
          const exitHit = hits.find((h) => h.kind === 'exit')
          const exit =
            exitHit?.kind === 'exit'
              ? levelRef.current?.exits.find((e) => e.uid === exitHit.uid)
              : undefined
          if (exit && exit.variant === 'warp') {
            jumpToLevelAt(exit.destLevelRecordId, exit.destX, exit.destY)
            lastClickRef.current = null
            endDrag()
            return
          }
          const incHit = hits.find(
            (h): h is { kind: 'incoming'; incoming: IncomingExit } =>
              h.kind === 'incoming'
          )
          if (incHit) {
            // Source exit lives at the screen-center of its sourceScreenIndex.
            // Convert to cell coords for focusViewFor (which adds the half-cell
            // bias internally), so we land on the diamond marker.
            const idx = incHit.incoming.sourceScreenIndex
            const col = screenCol(idx)
            const row = screenRow(idx)
            jumpToLevelAt(incHit.incoming.sourceLevelRecordId, col * 16 + 7.5, row * 16 + 7.5)
            lastClickRef.current = null
            endDrag()
            return
          }
        }

        if (hits.length === 0) {
          onSelect([])
          cycleRef.current = null
        } else {
          // Plain click → single-select, cycling through the stack on repeat.
          const key = hits.map(selectionKey).join('|')
          const prev = cycleRef.current
          const nextIndex = prev && prev.key === key ? (prev.index + 1) % hits.length : 0
          cycleRef.current = { key, index: nextIndex }
          onSelect([hits[nextIndex]!])
        }
        lastClickRef.current = { x: e.clientX, y: e.clientY, time: now }
      }
      endDrag()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (panFrame) cancelAnimationFrame(panFrame)
    }
  }, [isPanning, layers, onSelect, jumpToLevelAt])

  // Wheel zoom is attached via addEventListener with passive:false so we can
  // preventDefault and stop the page from scrolling/zooming under us. React's
  // synthetic onWheel binds as passive in React 17+, which makes
  // preventDefault a no-op and logs a console warning.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const handler = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      setView((v) => zoomAt(v, cx, cy, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
    }
    wrap.addEventListener('wheel', handler, { passive: false })
    return () => wrap.removeEventListener('wheel', handler)
  }, [])

  // Hover detection while not dragging. Object + sprite hovers are tracked
  // independently so both can highlight simultaneously when stacked.
  const onMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (isPanning) return
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
      const lvl = levelRef.current
      const v = viewRef.current
      setHovered(hitTestObject(lvl, v, layers, rect, e.clientX, e.clientY))
      setHoveredSprite(hitTestSprite(lvl, v, layers, rect, e.clientX, e.clientY, spriteBoundsRef.current))
      setHoveredExit(hitTestExit(lvl, v, layers, rect, e.clientX, e.clientY))
      setHoveredSpawn(
        hitTestSpawn(lvl, v, layers, rect, e.clientX, e.clientY, spawnOverrideRef.current ?? lvl?.spawn)
      )
      setHoveredIncoming(
        hitTestIncoming(lvl, v, layers, incomingRef.current, rect, e.clientX, e.clientY)
      )
      // Cursor level cell for the bottom-right readout — null when off-grid.
      const { x: cwx, y: cwy } = clientToWorld(v, e.clientX - rect.left, e.clientY - rect.top)
      const ccx = Math.floor(cwx / CELL_PX)
      const ccy = Math.floor(cwy / CELL_PX)
      setCursorCell(
        lvl && ccx >= 0 && ccx < LEVEL_CELLS_W && ccy >= 0 && ccy < LEVEL_CELLS_H
          ? { x: ccx, y: ccy }
          : null
      )
      // Resize-handle hover → cursor hint (single selected object only).
      let rc: string | null = null
      if (primary?.kind === 'object' && lvl) {
        const o = lvl.objects.find((ob) => ob.uid === primary.uid)
        if (o) {
          const { x: wx, y: wy } = clientToWorld(v, e.clientX - rect.left, e.clientY - rect.top)
          const handle = hitResizeHandle(o, objectSizeMode(o.num, o.exnum, propTable), wx, wy, v.zoom)
          if (handle) rc = cursorForHandle(handle, o)
        }
      }
      setResizeCursor(rc)
    },
    [isPanning, layers, primary, propTable]
  )

  // Right-click → select the hit object/sprite/exit and open the context menu at
  // the cursor. Empty space closes any open menu.
  const onContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      const wrap = wrapRef.current
      if (!wrap || !levelRef.current) return
      const rect = wrap.getBoundingClientRect()
      const hits = hitTestAll(
        levelRef.current,
        viewRef.current,
        layers,
        incomingRef.current,
        rect,
        e.clientX,
        e.clientY,
        spriteBoundsRef.current
      )
      const hit = hits.find(
        (h) => h.kind === 'object' || h.kind === 'sprite' || h.kind === 'exit'
      )
      if (!hit || (hit.kind !== 'object' && hit.kind !== 'sprite' && hit.kind !== 'exit')) {
        setCtxMenu(null)
        return
      }
      onSelect([{ kind: hit.kind, uid: hit.uid } as Selection])
      setCtxMenu({ x: e.clientX, y: e.clientY, kind: hit.kind, uid: hit.uid })
    },
    [layers, onSelect]
  )

  // Context-menu items for the targeted entity. Duplicate + Delete for all;
  // objects + sprites also get reorder (stream index = paint / overlap order).
  const buildCtxItems = (
    kind: 'object' | 'sprite' | 'exit',
    uid: number,
    x: number,
    y: number
  ): ContextMenuItem[] => {
    const openReorder = (k: 'object' | 'sprite'): void => {
      const list = (k === 'object' ? levelState.level?.objects : levelState.level?.sprites) ?? []
      const i = list.findIndex((e) => e.uid === uid)
      if (i >= 0) setReorderPopover({ x, y, kind: k, uid, index: i, max: list.length - 1 })
    }
    const items: ContextMenuItem[] = [
      {
        label: 'Duplicate',
        shortcut: 'Ctrl+D',
        onClick: () => {
          const newUid = levelState.nextUid
          if (kind === 'object') dispatchLevel({ type: 'duplicateObject', uid })
          else if (kind === 'sprite') dispatchLevel({ type: 'duplicateSprite', uid })
          else dispatchLevel({ type: 'duplicateExit', uid })
          onSelect([{ kind, uid: newUid } as Selection])
        }
      }
    ]
    if (kind === 'object') {
      const objs = levelState.level?.objects ?? []
      const idx = objs.findIndex((o) => o.uid === uid)
      items.push(
        {
          label: 'Update index',
          disabled: objs.length < 2,
          onClick: () => openReorder('object')
        },
        {
          label: 'Bring forward',
          shortcut: '+',
          disabled: idx < 0 || idx >= objs.length - 1,
          onClick: () => dispatchLevel({ type: 'reorderObject', uid, delta: 1 })
        },
        {
          label: 'Send back',
          shortcut: '-',
          disabled: idx <= 0,
          onClick: () => dispatchLevel({ type: 'reorderObject', uid, delta: -1 })
        }
      )
    } else if (kind === 'sprite') {
      const sprs = levelState.level?.sprites ?? []
      const idx = sprs.findIndex((s) => s.uid === uid)
      items.push(
        {
          label: 'Update index',
          disabled: sprs.length < 2,
          onClick: () => openReorder('sprite')
        },
        {
          label: 'Bring forward',
          shortcut: '+',
          disabled: idx < 0 || idx >= sprs.length - 1,
          onClick: () => dispatchLevel({ type: 'reorderSprite', uid, delta: 1 })
        },
        {
          label: 'Send back',
          shortcut: '-',
          disabled: idx <= 0,
          onClick: () => dispatchLevel({ type: 'reorderSprite', uid, delta: -1 })
        }
      )
    }
    items.push({
      label: 'Delete',
      shortcut: 'Del',
      onClick: () => {
        if (kind === 'object') dispatchLevel({ type: 'deleteObject', uid })
        else if (kind === 'sprite') dispatchLevel({ type: 'deleteSprite', uid })
        else dispatchLevel({ type: 'deleteExit', uid })
        onSelect([])
      }
    })
    return items
  }

  const resetView = useCallback(
    () => setView(fitViewForLevel(level)),
    [level]
  )

  const levelInfo =
    selectedLevelRecordId !== null ? getLevel(selectedLevelRecordId) : undefined
  const status = buildStatusLine(levelInfo, level, loadError, hasAssets, poolLabel, selectedLevelRecordId)

  // Bottom-right readout: cursor level cell, OR — while shift-dragging a marquee —
  // the box's end corner + its width/height in cells (the selection-size measure).
  let coordsText: string | null = null
  if (marquee) {
    const end = clampCell(Math.floor(marquee.x1 / CELL_PX), Math.floor(marquee.y1 / CELL_PX))
    const w = Math.round(Math.abs(marquee.x1 - marquee.x0) / CELL_PX)
    const h = Math.round(Math.abs(marquee.y1 - marquee.y0) / CELL_PX)
    coordsText = `x ${end.x}  ·  y ${end.y}  ·  w ${w}  ·  h ${h}`
  } else if (cursorCell) {
    coordsText = `x ${cursorCell.x}  ·  y ${cursorCell.y}`
  }

  return (
    <div
      ref={wrapRef}
      className={
        'se-canvas' +
        (placing ? ' is-placing' : '') +
        (isPanning ? ' is-panning' : '') +
        (eraseTool ? ' is-erasing' : '') +
        (paintTool ? ' is-painting' : '') +
        (marquee ? ' is-marquee' : '') +
        (!isPanning &&
        (hovered || hoveredSprite || hoveredExit || hoveredSpawn || hoveredIncoming)
          ? ' is-pickable'
          : '')
      }
      style={resizeCursor ? { cursor: resizeCursor } : undefined}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onContextMenu={onContextMenu}
      onMouseLeave={() => {
        setHovered(null)
        setHoveredSprite(null)
        setHoveredExit(false)
        setHoveredSpawn(false)
        setHoveredIncoming(false)
        setResizeCursor(null)
        setCursorCell(null)
      }}
    >
      <canvas ref={canvasRef} className="se-canvas__el" />
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildCtxItems(ctxMenu.kind, ctxMenu.uid, ctxMenu.x, ctxMenu.y)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {reorderPopover && (
        <ReorderSlider
          x={reorderPopover.x}
          y={reorderPopover.y}
          kind={reorderPopover.kind}
          uid={reorderPopover.uid}
          index={reorderPopover.index}
          max={reorderPopover.max}
          onPreview={(kind, uid, index) => setPreviewReorder({ kind, uid, index })}
          onCommit={(kind, uid, index) => {
            dispatchLevel(
              kind === 'object'
                ? { type: 'setObjectIndex', uid, index }
                : { type: 'setSpriteIndex', uid, index }
            )
            setPreviewReorder(null)
          }}
          onClose={() => setReorderPopover(null)}
        />
      )}

      {/* Empty / loading / error overlays — drawn over the canvas, not on it */}
      {!level && !loadError && <CanvasEmpty hasAssets={hasAssets} />}
      {loadError && <CanvasMessage tone="error">{loadError}</CanvasMessage>}
      {level?.empty && (
        <CanvasMessage tone="dim">
          No level data: the asm pointer references no extracted .bin file
          for this slot (either an unbacked slot in the framework, or both
          .bins were empty placeholders).
        </CanvasMessage>
      )}
      {level?.special && (
        <CanvasMessage tone="dim">
          {levelInfo?.name ?? 'Level'} is hardcoded in the game engine; not
          parsed from the standard level format.
        </CanvasMessage>
      )}

      {/* Bottom-left status strip */}
      <div className="se-canvas__status">
        {status}
        {SHOW_REBUILD_HINT && needsBuild && (
          <span className="se-canvas__status-warn"> · rebuild to refresh</span>
        )}
      </div>

      {/* Bottom-right cursor coords / marquee size readout */}
      {level && !level.empty && !level.special && coordsText && (
        <div className="se-canvas__coords">{coordsText}</div>
      )}

      {/* Top-right reset button (shows once panned or zoomed) */}
      {(view.panX !== INITIAL_VIEW.panX ||
        view.panY !== INITIAL_VIEW.panY ||
        view.zoom !== INITIAL_VIEW.zoom) && (
        <button
          type="button"
          className="se-canvas__reset"
          onClick={resetView}
          title="Reset view"
        >
          Reset view
        </button>
      )}
    </div>
  )
}

function CanvasEmpty({ hasAssets }: { hasAssets: boolean }): JSX.Element {
  return (
    <div className="se-canvas__empty">
      <p className="se-canvas__hint">
        {hasAssets
          ? 'Pick a level from the menu bar to begin.'
          : 'Extract assets from a reference cart to begin.'}
      </p>
    </div>
  )
}

function CanvasMessage({
  children,
  tone
}: {
  children: React.ReactNode
  tone: 'dim' | 'error'
}): JSX.Element {
  return (
    <div className={`se-canvas__message is-${tone}`}>{children}</div>
  )
}

function buildStatusLine(
  levelInfo: ReturnType<typeof getLevel>,
  level: LevelData | null,
  loadError: string | null,
  hasAssets: boolean,
  poolLabel: string | null,
  selectedLevelRecordId: number | null
): string {
  if (loadError) return `error · ${loadError}`
  if (selectedLevelRecordId === null) return hasAssets ? 'no level selected' : 'no assets extracted'
  // Slot label: the catalog slot ("1-3") for a playable level; the record id
  // ("0x3D") for a warp-reached sub-room (not in the catalog, so getLevel →
  // undefined — which used to fall through to "no level selected").
  const slot = levelInfo?.slot ?? formatLevelId(selectedLevelRecordId)
  if (!level) return `loading ${slot}…`
  if (level.empty) return `${slot} · empty slot`
  if (level.special) return `${slot} · hardcoded level`
  // Sprite count carries its engine limit (current/max) — the level-data
  // sprite cap is the 255-entry stage-ID space (see canvas/limits.ts). Flag
  // an over-limit count so a level that won't track all its sprites is
  // visible at a glance.
  const spriteCount = level.sprites.length
  const spriteToken =
    spriteCount > MAX_LEVEL_SPRITES
      ? `${spriteCount} / ${MAX_LEVEL_SPRITES} sprites (over limit!)`
      : `${spriteCount} / ${MAX_LEVEL_SPRITES} sprites`
  // The shared-pool label (which bank pool this level's streams draw on +
  // used/limit bytes) appears once the budget report loads; omitted otherwise.
  const poolToken = poolLabel ? `  ·  ${poolLabel}` : ''
  return (
    `${slot}  ·  ${level.objects.length} objects  ·  ` +
    `${spriteToken}  ·  ${level.exits.length} exits${poolToken}`
  )
}
