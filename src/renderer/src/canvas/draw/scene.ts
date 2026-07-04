// Pure scene compositor for the level canvas: paints the whole world (BG2/BG3,
// decoded BG1, influence highlight, grid, object/sprite/exit/spawn overlays,
// collision, paint + marquee) onto a 2D context, applying the live drag/resize/
// erase/group/exit/incoming preview overlays. Extracted verbatim from the
// Canvas redraw effect so the 2000-line component doesn't own ~260 lines of
// draw orchestration; the effect now just gathers state into SceneParams and
// calls drawScene. No React — ctx + plain data in.

import type {
    DecodedObjectInfluence,
    LevelData,
    LevelObject,
    LevelSprite,
    RenderImage,
    ScreenExit
} from '../../../../preload/api'
import type {IncomingExit, LayerVisibility, PlacementItem, Selection} from '../../types'
import type {View} from '../view'
import type {SpriteBoundsMap} from '../hit-test'
import {LEVEL_PX_W, LEVEL_PX_H, type ObjectOutlineBox} from '../geometry'
import {linksFor, resolveEntityRef} from '../entity-links'
import {objectSizeMode} from '../../data/object-record'
import {drawScreenGrid} from './grid'
import {drawPaintOverlay} from './paint'
import {drawObjects, drawObjectRenderOutlines} from './objects'
import type {ObjectFootprints} from '../../hooks/useObjectCells'
import {drawDecodedBg1} from './decoded-bg1'
import {drawCollisionLayer} from './collision'
import {drawBgLayers, drawBgOverlays, drawBgForeground, type BgLayerBitmaps, type ParallaxDraw} from './bg-layers'
import {parallaxOffsets, cameraOrigin, applyCameraSnap, clampCamera} from '../parallax'
import {buildBandedGradient} from '../../lib/gradient-banded'
import {drawCameraGradient, drawCameraOverlay, cameraBoxScreenRect, type CameraPreview, type BoxRect} from './camera-preview'
import {drawSpriteGlyphs, drawSpriteOutlines, drawSpriteRenderOutlines} from './sprites'
import {drawEntranceGlyphs} from './entrance-glyphs'
import {drawCommandObjectBadges, drawCommandSpriteBadges} from './command-badges'
import {drawGeneratorBadges} from './generator-badges'
import {drawNeighborIndicators, drawNeighborSelectionOverlay} from './sprite-neighbors'
import {drawBehaviorSelectionOverlay, drawCapWarnings} from './sprite-behavior'
import type {BehaviorProbeMap} from '../../hooks/useBehaviorProbes'
import {drawObjectValidityIndicators, drawSpriteValidityIndicators} from './render-validity'
import type {EntityValidityView} from '../../hooks/useEntityRenderValidity'
import {drawSpriteVariantHints, drawSpritePrize} from './sprite-variant-hints'
import type {NeighborStatusMap} from '../../hooks/useNeighborDependencies'
import {drawLinks} from './links'
import {drawObjectInfluence} from './object-influence'
import {drawResizeHandles, objectResizeHandles} from './handles'
import {drawExits, drawIncomingExits, strokeScreenOutline} from './exits'
import {drawSpawnGlyph, drawSpawnOutline, drawTestSpawnGlyph} from './glyphs'
import {drawPlacementPreview} from './placement-preview'
import {selectionAccent} from './selection'

// Live drag/preview overlays the draw effect shadows (formerly inline useState
// shapes in Canvas.tsx — named here so SceneParams and that state share a type).
export interface MoveOverlay {
    kind: 'object' | 'sprite';
    uid: number;
    dx: number;
    dy: number
}

export interface ResizeOverlay {
    uid: number;
    w: number;
    h: number
}

export interface ErasePreview {
    objUids: Set<number>;
    sprUids: Set<number>
}

export interface GroupMove {
    objUids: Set<number>;
    sprUids: Set<number>;
    dx: number;
    dy: number
}

export interface ExitDrag {
    uid: number;
    screen: number;
    valid: boolean
}

export interface IncomingOverlay {
    key: string;
    x: number;
    y: number
}

export interface Marquee {
    x0: number;
    y0: number;
    x1: number;
    y1: number
}

export interface PaintDrag {
    set: Map<number, number>;
    erased: Set<number>;
    erasing: boolean
}

export interface SceneParams {
    size: { w: number; h: number }
    view: View
    level: LevelData | null
    layers: LayerVisibility
    /** Grid line color (rgba string) — see canvas/draw/grid.ts. */
    gridColor: string
    bg1Canvas: HTMLCanvasElement | null
    spriteCanvas: HTMLCanvasElement | null
    collisionCanvas: HTMLCanvasElement | null
    bgLayers: BgLayerBitmaps | null
    spriteBounds: SpriteBoundsMap
    neighborStatus: NeighborStatusMap | null
    /** Probe-derived behavior geometry (chain lengths, march tracks, rail
     *  traces) for the selected-sprite overlay. Null until resolved. */
    behaviorProbes: BehaviorProbeMap | null
    /** Cached enemy thumbnails (num → bitmap) for the generator badges — the
     *  spawned-enemy icon drawn inside each generator/stopper sprite's purple
     *  square. Null until the first fetch resolves (badge draws empty). */
    generatorThumbs: Map<number, RenderImage> | null
    /** Render-validity view for the loaded level (gfx-missing markers on placed
     *  entities). Null until the first fetch resolves — no markers. */
    renderValidity: EntityValidityView | null
    influence: DecodedObjectInfluence | null
    /** Per-uid footprint outline boxes for extended objects (draw/objects.ts
     *  `objectOutlineBoxes`), so their outline matches the tiles they stamp
     *  instead of the meaningless 1×1 nominal box. Empty when none / pre-fetch. */
    objOutlineBoxes: ReadonlyMap<number, ObjectOutlineBox>
    /** Per-uid drawn-tile footprints (useObjectCells) — the exact cells each
     *  object stamps, traced as the selected-object outline in render mode. */
    objectFootprints: ObjectFootprints
    hovered: LevelObject | null
    hoveredSprite: LevelSprite | null
    hoveredSpawn: boolean
    selObjUids: Set<number>
    selSprUids: Set<number>
    primary: Selection | null
    propTable: Uint8Array | null
    incoming: IncomingExit[]
    testSpawn: { x: number; y: number } | null
    /** Live override for the world-map spawn marker — the unsaved entrance-table
     *  draft (useWorldMapEditor). When set, the marker draws here instead of
     *  `level.spawn` (which is the base, extract-time position). */
    spawnOverride: { x: number; y: number } | null
    paintTool: boolean
    paintHeights: ReadonlyMap<number, number>
    moveOverlay: MoveOverlay | null
    resizeOverlay: ResizeOverlay | null
    groupMove: GroupMove | null
    erasePreview: ErasePreview | null
    exitDrag: ExitDrag | null
    incomingOverlay: IncomingOverlay | null
    marquee: Marquee | null
    paintDrag: PaintDrag | null
    /** Armed Place-tool ghost: the picked entity + the cursor cell it follows.
     *  Null unless the Place tool is armed and the cursor is over the level. */
    placementPreview: { item: PlacementItem; x: number; y: number } | null
    /** Camera Preview settings, or null when off. When set, the view zoom is pinned
     *  to `.zoom` (caller-enforced) and BG2/BG3/gradient parallax-align to the virtual
     *  camera box (centred, screen-snapped per `.snap`); `.mask` blacks out the rest. */
    cameraPreview: CameraPreview | null
    /** Render Only: hide every editor annotation drawn on the still-visible Sprites
     *  layer (landmark glyphs, entrance arrows, command / generator badges, the spawn
     *  marker) so only the rendered level shows. The outline / exit / collision overlays
     *  are already suppressed upstream via the effective `layers` (Canvas forces them
     *  off); this flag covers the annotations that share the Sprites layer with the real
     *  sprite pixels — which stay visible — so `layers.sprites` alone can't gate them. */
    renderOnly: boolean
}

/** Paint the full scene. `canvas` may be null (effect runs before mount). */
export function drawScene(canvas: HTMLCanvasElement | null, p: SceneParams): void {
    const {
        size,
        view,
        level,
        layers,
        gridColor,
        bg1Canvas,
        spriteCanvas,
        collisionCanvas,
        bgLayers,
        spriteBounds,
        neighborStatus,
        behaviorProbes,
        generatorThumbs,
        renderValidity,
        influence,
        objOutlineBoxes,
        objectFootprints,
        hovered,
        hoveredSprite,
        hoveredSpawn,
        selObjUids,
        selSprUids,
        primary,
        propTable,
        incoming,
        testSpawn,
        spawnOverride,
        paintTool,
        paintHeights,
        moveOverlay,
        resizeOverlay,
        groupMove,
        erasePreview,
        exitDrag,
        incomingOverlay,
        marquee,
        paintDrag,
        placementPreview,
        cameraPreview,
        renderOnly
    } = p
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    // Only resize the backing store when it actually changed — assigning
    // canvas.width/height reallocates and clears it, so doing it on every
    // redraw (hover, selection, drag overlays) is wasted work. clearRect +
    // setTransform below run each draw regardless.
    const cw = Math.max(1, size.w * dpr)
    const ch = Math.max(1, size.h * dpr)
    if (canvas.width !== cw) canvas.width = cw
    if (canvas.height !== ch) canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Pixel art — disable the Canvas2D bilinear filter so drawImage
    // and pattern fills use nearest-neighbour when the world transform
    // scales them up. Combined with `image-rendering: pixelated` on
    // the canvas element (App.css), this keeps every SNES pixel as a
    // crisp square at any zoom level.
    ctx.imageSmoothingEnabled = false

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Background already set via CSS; clear in case of leftover pixels.
    ctx.clearRect(0, 0, size.w, size.h)

    // Pannable / zoomable world transform.
    ctx.translate(view.panX, view.panY)
    ctx.scale(view.zoom, view.zoom)

    if (level && !level.empty && !level.special) {
        // During an in-progress moveObj drag, render the dragged object at
        // its pending position. We don't mutate `level` (the IPC re-fetch
        // is gated on real commits via the reducer) — just build display
        // shadows for the duration of the drag.
        let drawObjs = level.objects
        let drawSprs = level.sprites
        if (moveOverlay && moveOverlay.kind === 'object') {
            const idx = level.objects.findIndex((o) => o.uid === moveOverlay.uid)
            if (idx >= 0) {
                const o = level.objects[idx]!
                drawObjs = level.objects.slice()
                drawObjs[idx] = {...o, x: o.x + moveOverlay.dx, y: o.y + moveOverlay.dy}
            }
        } else if (moveOverlay && moveOverlay.kind === 'sprite') {
            const idx = level.sprites.findIndex((s) => s.uid === moveOverlay.uid)
            if (idx >= 0) {
                const s = level.sprites[idx]!
                drawSprs = level.sprites.slice()
                drawSprs[idx] = {...s, x: s.x + moveOverlay.dx, y: s.y + moveOverlay.dy}
            }
        }
        // Resize preview (mutually exclusive with a move drag): redraw the
        // dragged object at its pending extents.
        if (resizeOverlay) {
            const idx = level.objects.findIndex((o) => o.uid === resizeOverlay.uid)
            if (idx >= 0) {
                const o = level.objects[idx]!
                drawObjs = level.objects.slice()
                drawObjs[idx] = {...o, w: resizeOverlay.w, h: resizeOverlay.h}
            }
        }
        // Multi-select move preview: shadow every selected member at its pending
        // position (shared delta). Mutually exclusive with the single moveOverlay.
        if (groupMove && (groupMove.dx !== 0 || groupMove.dy !== 0)) {
            if (groupMove.objUids.size > 0) {
                drawObjs = drawObjs.map((o) =>
                    o.uid != null && groupMove.objUids.has(o.uid)
                        ? {...o, x: o.x + groupMove.dx, y: o.y + groupMove.dy}
                        : o
                )
            }
            if (groupMove.sprUids.size > 0) {
                drawSprs = drawSprs.map((s) =>
                    s.uid != null && groupMove.sprUids.has(s.uid)
                        ? {...s, x: s.x + groupMove.dx, y: s.y + groupMove.dy}
                        : s
                )
            }
        }
        // Erase-tool preview: hide the objects/sprites the current sweep has
        // marked, so the canvas shows the post-delete result before the commit.
        // (The decoded BG1/sprite bitmaps only refresh on the commit re-decode —
        // same as a move drag; the vanishing outline is the live signal.)
        if (erasePreview) {
            if (erasePreview.objUids.size > 0) {
                drawObjs = drawObjs.filter((o) => !erasePreview.objUids.has(o.uid!))
            }
            if (erasePreview.sprUids.size > 0) {
                drawSprs = drawSprs.filter((s) => !erasePreview.sprUids.has(s.uid!))
            }
        }

        // Phase 6: BG2/BG3/backdrop go below everything else. Each PPU
        // layer + the COLDATA backdrop fill gate independently. The user's
        // toggle ANDs with the cart's compositing descriptor `.visible` (which
        // honours main ∪ subscreen membership + later hides like BG3 action-byte
        // $FF), so layers the cart itself hides stay hidden even when the user
        // has the toggle on. Backdrop has no cart-side hide flag.
        const bgLayerBg2 = !!bgLayers && layers.bg2 && bgLayers.bg2Layer.visible
        const bgLayerBg3 = !!bgLayers && layers.bg3 && bgLayers.bg3Layer.visible
        // Camera Preview: a virtual 256×224 camera centred in the viewport (snapped
        // to the screen grid per cameraPreview.snap), pinned at the chosen 1×–4× zoom.
        // Derive the BG2/BG3/gradient parallax from where it sits over the level
        // (canvas/parallax.ts) and remember the box's screen rect for the gradient +
        // overlay. `parallax` re-offsets + both-axis-tiles BG2/BG3; null = normal draw.
        let parallax: ParallaxDraw | null = null
        let camGradientScroll: number | null = null
        let camBox: BoxRect | null = null
        if (cameraPreview) {
            // Snap, then clamp the 256×224 camera inside the level extent so the
            // preview never shows past the edges (clamp last keeps a snapped X on grid).
            const cam = clampCamera(
                applyCameraSnap(cameraOrigin(view, size), cameraPreview.snap),
                LEVEL_PX_W,
                LEVEL_PX_H
            )
            camBox = cameraBoxScreenRect(cam, view)
            if (bgLayers) {
                const off = parallaxOffsets(cam.x, cam.y, bgLayers.parallax)
                const x0 = -view.panX / view.zoom
                const y0 = -view.panY / view.zoom
                parallax = {
                    bg2: off.bg2,
                    bg3: off.bg3,
                    cover: { x0, y0, x1: x0 + size.w / view.zoom, y1: y0 + size.h / view.zoom }
                }
                if (bgLayers.backdrop.kind === 'gradient') camGradientScroll = off.gradientScroll
            }
        }
        if (bgLayers) {
            const backdrop = layers.backdrop
            // Screen-relative sky gradient for Camera Preview — the full 24-keyframe
            // ramp scrolled by camY/8 inside the box (the level-stretched strip would
            // show a near-flat slice). Drawn first, behind the BG layers.
            if (backdrop && camGradientScroll !== null && camBox && bgLayers.backdrop.kind === 'gradient') {
                drawCameraGradient(
                    ctx, dpr, size, camBox,
                    buildBandedGradient(bgLayers.backdrop.stops), camGradientScroll, view.zoom
                )
            }
            if (bgLayerBg2 || bgLayerBg3 || backdrop) {
                drawBgLayers(ctx, bgLayers, {bg2: bgLayerBg2, bg3: bgLayerBg3, backdrop}, parallax)
            }
        }
        // Phase 6.2: decoded BG1 layer goes on top of BG2/BG3, under outlines.
        // Renders Map16-cell tiles from the engine's render:bg1Layer IPC.
        // Cells without a real Bank13 stamp handler stay alpha=0; the
        // object outline overlay on top still indicates where they sit.
        if (bg1Canvas && layers.bg1) {
            drawDecodedBg1(ctx, bg1Canvas)
        }
        // Phase 6.3a: BG2/BG3 FOREGROUND planes — priority-1 tiles the cart draws
        // ABOVE BG1 (e.g. 1-1's foreground flowers). Source-over, above BG1 and
        // below the darkening overlay + sprites. Null planes (most levels) no-op.
        if (bgLayers && (bgLayerBg2 || bgLayerBg3)) {
            drawBgForeground(ctx, bgLayers, {bg2: bgLayerBg2, bg3: bgLayerBg3}, parallax)
        }
        // Phase 6.3: BG2/BG3 darkening OVERLAYS — subscreen layers the cart's
        // color math subtracts from the foreground (e.g. mode-$0E cave-shadow
        // BG3). These composite ABOVE BG1 (multiply blend); a no-op for the
        // common modes whose BG2/BG3 are plain backgrounds.
        if (bgLayers && (bgLayerBg2 || bgLayerBg3)) {
            drawBgOverlays(ctx, bgLayers, {bg2: bgLayerBg2, bg3: bgLayerBg3}, parallax)
        }
        // Object-drag cell-highlight — above BG1, below the screen grid + outlines
        // so those stay readable on top of the translucent tint. Drag-only (the
        // hook returns null otherwise); empty when the object stamps no tiles.
        if (influence && influence.cells.length > 0) {
            drawObjectInfluence(ctx, influence)
        }
        if (layers.grid !== 'off') {
            drawScreenGrid(ctx, view.zoom, layers.grid, gridColor)
        }
        // Object outlines — 3-state `bg1Outlines` (OutlineMode). 'detailed' draws
        // the full blueprint (per-object box + hex-id label); 'render' shows only
        // the SELECTED object as an alternating dashed trace of its stamped tiles.
        // BOTH editing modes keep the guiding overlays (gfx-missing badge, resize
        // handles, command badge) — only the box+label differ; 'off' draws nothing
        // (and hit-test.ts disables selection).
        if (layers.bg1Outlines !== 'off') {
            if (layers.bg1Outlines === 'detailed') {
                drawObjects(ctx, drawObjs, hovered, selObjUids, view.zoom, layers, objOutlineBoxes)
            } else {
                drawObjectRenderOutlines(
                    ctx, drawObjs, selObjUids, objectFootprints, level.objects, view.zoom
                )
            }
            // Gfx-missing markers (render-validity) ride the same layer as the
            // outlines they annotate.
            if (renderValidity) {
                drawObjectValidityIndicators(ctx, drawObjs, renderValidity, view.zoom, objOutlineBoxes)
            }
            // Resize handles only for a SINGLE selected object (resize is single-only),
            // and only in 'detailed' mode — the render outline traces tiles, not the
            // w/h box the handles pull against, so they'd read as detached there.
            // Drawn from `drawObjs` so they track the live resize preview.
            if (layers.bg1Outlines === 'detailed' && primary?.kind === 'object') {
                const so = drawObjs.find((o) => o.uid === primary.uid)
                if (so) {
                    const sm = objectSizeMode(so.num, so.exnum, propTable)
                    drawResizeHandles(ctx, objectResizeHandles(so, sm), view.zoom)
                }
            }
            // Command objects (Transparent tile, Scroll stopper, Tile eraser, …) render no/clear
            // tiles — mark them with the same half-transparent command-abbreviation badge.
            drawCommandObjectBadges(ctx, drawObjs)
        }
        // Selection-linkage line goes UNDER the marker glyphs so the line's
        // endpoints tuck neatly into each glyph; the line is visible in the
        // empty middle of the connection.
        // Association links (exit ↔ pipe/door, and future special relations) —
        // drawn under the marker glyphs so endpoints tuck into each entity.
        // Suppressed mid object/sprite drag to avoid a stale line.
        if (layers.exits && !moveOverlay && !exitDrag) {
            // Links are a single-selection affordance (resolveEntityRef → one entity).
            const ref = resolveEntityRef(primary, level)
            if (ref) drawLinks(ctx, linksFor(ref, level), view.zoom)
        }
        // Sprite GRAPHICS (gated on `sprites`): tier-1 OAM cel pixels (full-extent
        // RGBA from render:spriteLayer; sprites without a Format-B cel are absent)
        // plus the tier-2 landmark glyphs (Goal / Boss Door / checkpoint flags).
        if (spriteCanvas && layers.sprites) {
            drawDecodedBg1(ctx, spriteCanvas)
        }
        // Editor annotations that ride the Sprites layer: landmark glyphs (goal /
        // boss door / checkpoint), entrance arrows, command / generator badges, and
        // the spawn marker. They're stand-ins for entities the sprite-cel render
        // can't draw, so Render Only hides them (unlike the real pixels above) for a
        // clean look — gated on `spriteAnnotations`, not bare `layers.sprites`.
        const spriteAnnotations = layers.sprites && !renderOnly
        if (spriteAnnotations) drawSpriteGlyphs(ctx, drawSprs, view.zoom)
        // Entrance / teleport sprites have no in-game cel — draw their stand-in arrow /
        // portal glyph here on the same Sprites graphics layer (entrance-glyphs.ts).
        if (spriteAnnotations) drawEntranceGlyphs(ctx, drawSprs)
        // Command sprites (Graphic/Palette Changer, auto-scroll, …) have no cel either —
        // mark them with a half-transparent command-abbreviation badge (command-badges.ts).
        if (spriteAnnotations) drawCommandSpriteBadges(ctx, drawSprs)
        // Generator sprites — purple square with the spawned enemy's (cached) thumbnail,
        // plus a red X for stoppers (generator-badges.ts).
        if (spriteAnnotations) drawGeneratorBadges(ctx, drawSprs, generatorThumbs)
        // Spawn flag rides the Sprites layer (grouped with the goal / checkpoint
        // landmark glyphs); its selectable outline rides Sprite Editing below.
        // The world-map draft overrides the base spawn so an unsaved edit moves
        // the marker live.
        const spawn = spawnOverride ?? level.spawn
        if (spriteAnnotations && spawn) {
            drawSpawnGlyph(ctx, spawn.x, spawn.y, view.zoom)
        }
        // Sprite OUTLINE overlay — 3-state `spriteOutlines` (OutlineMode), mirroring
        // the object outlines. 'detailed' = box + hex-id over every sprite; 'render'
        // = only the SELECTED sprite as an alternating dashed box. BOTH keep the
        // variant hints + gfx-missing badges — only the box+label differ; 'off' =
        // nothing (hit-test.ts disables selection).
        if (layers.spriteOutlines !== 'off') {
            if (layers.spriteOutlines === 'detailed') {
                drawSpriteOutlines(ctx, drawSprs, hoveredSprite, selSprUids, view.zoom, spriteBounds)
            } else {
                drawSpriteRenderOutlines(ctx, drawSprs, selSprUids, view.zoom, spriteBounds)
            }
            // Position-derived variant badges (e.g. pinwheel spin direction from X-cell parity).
            drawSpriteVariantHints(ctx, drawSprs, view.zoom, spriteBounds)
            // Gfx-missing markers — after the variant hints so the error badge
            // wins the top-right corner over the Winged-Cloud prize hint.
            if (renderValidity) {
                drawSpriteValidityIndicators(ctx, drawSprs, renderValidity, spriteBounds, view.zoom)
            }
        }
        // Behavior-extent visuals (Sprite-Editing layer): always-on cap warnings
        // (amber n/max badge when the engine's instance cap is exceeded), plus the
        // selected sprite's trigger-zone / patrol-extent / orbit / runtime-snap
        // geometry. Drawn BEFORE the neighbour visuals so a red error badge and
        // the neighbour target markers win their corners/cells.
        if (layers.spriteOutlines !== 'off') {
            drawCapWarnings(ctx, drawSprs, view.zoom, spriteBounds)
            if (primary?.kind === 'sprite' && !moveOverlay && !groupMove) {
                const spr = drawSprs.find((s) => s.uid === primary.uid)
                if (spr) drawBehaviorSelectionOverlay(ctx, spr, view.zoom, behaviorProbes?.get(primary.uid))
            }
        }
        // Neighbour-dependency visuals ride the Sprite-Editing layer: an always-on
        // red "!" badge on any sprite with an unmet enforce dependency, plus a
        // satisfied/missing target overlay for the selected sprite.
        if (layers.spriteOutlines !== 'off' && neighborStatus) {
            drawNeighborIndicators(ctx, drawSprs, neighborStatus, spriteBounds, view.zoom)
            // Selection overlay (target boxes + connectors) is a static affordance —
            // suppress it while dragging a sprite, where the connector would chase the
            // cursor toward a target that hasn't moved (not meaningful).
            if (primary?.kind === 'sprite' && !moveOverlay && !groupMove) {
                const results = neighborStatus.get(primary.uid)
                const spr = drawSprs.find((s) => s.uid === primary.uid)
                if (results && spr) drawNeighborSelectionOverlay(ctx, spr, results, view.zoom)
            }
        }
        // Prize: full-tile icon on the cell above each SELECTED prize-bearing sprite (its contents).
        if (layers.spriteOutlines !== 'off' && !moveOverlay && !groupMove) {
            drawSpritePrize(ctx, drawSprs, selSprUids, view.zoom)
        }
        // Spawn's sprite-style selectable outline (Sprite Editing layer). Drawn in
        // both editing modes ('detailed' + 'render') since it's hover/select-gated
        // already; only 'off' (which also disables its hit-test) hides it.
        if (layers.spriteOutlines !== 'off' && spawn) {
            drawSpawnOutline(
                ctx, spawn.x, spawn.y, hoveredSpawn, primary?.kind === 'spawn', view.zoom
            )
        }
        if (layers.exits) {
            // During an exit screen-drag, render the dragged exit at its target
            // screen (and warn in red when that screen is already occupied).
            let drawExitsArr = level.exits
            if (exitDrag) {
                const idx = level.exits.findIndex((e) => e.uid === exitDrag.uid)
                if (idx >= 0) {
                    drawExitsArr = level.exits.slice()
                    drawExitsArr[idx] = {...level.exits[idx]!, screenIndex: exitDrag.screen} as ScreenExit
                }
            }
            drawExits(ctx, drawExitsArr, primary, view.zoom)
            if (exitDrag && !exitDrag.valid) {
                // Same rect geometry as the per-exit screen outline drawExits just
                // traced for the dragged exit, at the selected width — so the red
                // warning paints exactly over the state-colored outline beneath.
                strokeScreenOutline(ctx, exitDrag.screen, 'rgba(248, 113, 113, 0.9)', 2.5, view.zoom)
            }
            // During an incoming-marker drag, render it at its pending cell.
            let drawIncomingArr = incoming
            if (incomingOverlay) {
                const idx = incoming.findIndex(
                    (i) => `${i.sourceLevelRecordId}:${i.sourceScreenIndex}` === incomingOverlay.key
                )
                if (idx >= 0) {
                    drawIncomingArr = incoming.slice()
                    drawIncomingArr[idx] = {
                        ...incoming[idx]!,
                        destX: incomingOverlay.x,
                        destY: incomingOverlay.y
                    }
                }
            }
            drawIncomingExits(ctx, drawIncomingArr, primary, view.zoom)
        }
        // Test Level spawn override ("Set Spawn"): an editor-only overlay drawn
        // above the level layers regardless of layer toggles, so the user always
        // sees where the next Test Level boot will drop Yoshi. App passes a
        // non-null testSpawn only when it belongs to the displayed level.
        if (testSpawn) {
            drawTestSpawnGlyph(ctx, testSpawn.x, testSpawn.y, view.zoom)
        }
        // Collision overlay renders LAST so it's visually on top of every
        // other layer (BG1, grid, outlines, sprites, exits, spawn glyph).
        // The semi-transparent fills + per-pixel slope lines stay readable
        // on top of any combination of foreground elements.
        if (collisionCanvas && layers.collision) {
            drawCollisionLayer(ctx, collisionCanvas)
        }
        // Paint tool overlay: the editable surface curve (committed heights merged
        // with the live drag), drawn above everything while the paint tool is active
        // so the user sees what they're drawing over the fitted result.
        if (paintTool) {
            const merged = new Map(paintHeights)
            if (paintDrag) {
                for (const [c, r] of paintDrag.set) merged.set(c, r)
                for (const c of paintDrag.erased) merged.delete(c)
            }
            drawPaintOverlay(ctx, merged, view.zoom, paintDrag ? new Set([...paintDrag.set.keys(), ...paintDrag.erased]) : null, paintDrag?.erasing ?? false)
        }
        // Armed Place-tool ghost — a cursor-following preview of the entity about
        // to be placed, on top of the level content so it's unmistakable. Nothing
        // is committed until the click; this is purely a display shadow.
        if (placementPreview) {
            drawPlacementPreview(
                ctx, placementPreview.item, placementPreview.x, placementPreview.y, view.zoom, spriteBounds
            )
        }
        // Shift-drag marquee box on top of everything — a transient selection UI
        // overlay (dashed chartreuse with a faint fill).
        if (marquee) {
            const mx = Math.min(marquee.x0, marquee.x1)
            const my = Math.min(marquee.y0, marquee.y1)
            const mw = Math.abs(marquee.x1 - marquee.x0)
            const mh = Math.abs(marquee.y1 - marquee.y0)
            ctx.save()
            ctx.fillStyle = selectionAccent(0.12)
            ctx.fillRect(mx, my, mw, mh)
            ctx.lineWidth = 1 / view.zoom
            ctx.setLineDash([4 / view.zoom, 3 / view.zoom])
            ctx.strokeStyle = selectionAccent(0.95)
            ctx.strokeRect(mx, my, mw, mh)
            ctx.restore()
        }

        // Camera Preview box (+ optional black mask) — a screen-space overlay on top
        // of everything, at the camera box's screen rect.
        if (cameraPreview && camBox) {
            drawCameraOverlay(ctx, dpr, size, camBox, cameraPreview.mask)
        }
    }
}
