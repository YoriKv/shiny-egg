// IPC handlers for the engine renderers (Phase 2.5). Loads the built ROM
// + symbol map once at first request, caches them for subsequent renders.
// Re-reads when the file's mtime changes (so a rebuild during the session
// invalidates the cache automatically).
//
// All renderers return RGBA byte arrays the renderer can shove straight
// into a canvas ImageData.

import { ipcMain } from 'electron'
import {
  renderMap16Cells,
  renderMap16Gallery,
  renderVramGrid
} from 'snes-framework/render-gallery'
import { levelMap16Usage } from 'snes-framework/level-tile-usage'
import {
  renderGfxFiles,
  type GfxFilesResult
} from 'snes-framework/render-gfx-files'
import { loadMessageFont, renderSpecialGlyphImages } from 'snes-framework/msg-font'
import { encodePng } from 'snes-framework/png'
import {
  decodeLevelFromLevelData,
  loadObjectPropertyTable,
  resolveProvenanceCells
} from 'snes-framework/object-decode'
import { composeBgLayers } from 'snes-framework/bg-layers-compose'
import { renderBg1, renderBg1Patch } from 'snes-framework/render-bg1'
import {
  buildSpriteRenderModel,
  buildSpriteCellGrid,
  compositeSpriteFull,
  renderSpritePatch
} from 'snes-framework/render-sprite-layer'

import { renderCollisionLayer, renderCollisionPatch } from 'snes-framework/render-collision'
import { resolveCellGrid, diffCellGrids } from 'snes-framework/cell-grid'
import { loadSceneRegs, bgLayerBpp } from 'snes-framework/scene-regs'
import { loadSpritesetFileIds, type GfxFileEntry } from 'snes-framework/load-graphics'
import { bestStockSpriteset } from 'snes-framework/sprite-tile-base'
import { hex0x } from 'snes-framework/hex'
import { loadLevel } from 'snes-framework/level'
import { frameworkWorkRoot, overlayRoot } from '../framework-paths'
import { getCurrentProjectId } from '../projects'
import type {
  Bg1LayerResponse,
  BgLayersResult,
  CollisionLayerResponse,
  CollisionTableResult,
  DecodedLevelLayout,
  DecodedObjectInfluence,
  DecodedPalette,
  EntityRenderValidity,
  EntityValidityRequest,
  MessageGlyphPreview,
  PickerThumbnails,
  PickerThumbnailsRequest,
  FitSurfaceRequest,
  FitSpritesetResult,
  FitTileset,
  LevelRenderRequest,
  LevelTileUsage,
  ObjectInfluenceRequest,
  RenderGfxFilesArgs,
  RenderImage,
  RenderMap16Args,
  RenderVramArgs,
  SpriteLayerResponse
} from '../../shared/ipc-types'
import { fitHeightProfile, fitMetadata } from 'snes-framework/surface-fit'
import type { LevelObject } from 'snes-framework/types'
import { loadRomAndSymbols } from '../render/rom-cache'
import { gfxLiveEdits, gfxLiveRevision } from '../gfx-live-cache'
import {
  resolveLevel,
  decodeForRequest,
  getBg1Context,
  getCollisionData,
  gridCacheGet,
  gridCachePut,
  spriteGridCacheGet,
  spriteGridCachePut,
  decodeInputKey,
  spriteInputKey,
  influenceClass,
  cssFromBgr15,
  renderHeaderFromLevel,
  isWorld6,
  buildLevelCgram,
  buildLevelVramCgram,
  changerSpriteSig,
  getEntityCatalog,
  getPickerThumbnails,
  logMap16Diagnostics,
  PATCH_CELL_THRESHOLD,
} from '../render/render-core'

// ── Electron/app glue ─────────────────────────────────────────────────────────
// render-core takes its cart-resident inputs (rom / symbols / workRoot /
// overlayRoot) explicitly; these resolve them from the active project + build so
// render-core stays electron-free.

/** Current project's overlay root, or undefined when none is active. */
function currentOverlayRoot(): string | undefined {
  const id = getCurrentProjectId()
  return id ? overlayRoot(id) : undefined
}

/** Load the built ROM + symbols and resolve the requested level (override or
 *  disk), returning null for the empty / special / short-header slots no level
 *  renderer can handle. The preamble every level-scoped handler shares. */
function loadLevelContext(req: LevelRenderRequest) {
  const { rom, symbols } = loadRomAndSymbols()
  const level = resolveLevel(req, frameworkWorkRoot(), currentOverlayRoot())
  if (level.empty || level.special || level.header.length < 15) return null
  return { rom, symbols, level }
}

export function registerRenderIpc(): void {
  // Special markup-glyph previews for the Message-Text keyboard — decoded from
  // the static 1bpp message font in the extract (no ROM/symbols needed). Each is
  // a PNG data URL of the glyph's font cell(s), white-on-transparent.
  ipcMain.handle('render:messageFontGlyphs', async (): Promise<MessageGlyphPreview[]> => {
    const font = loadMessageFont(frameworkWorkRoot())
    return renderSpecialGlyphImages(font).map((g) => ({
      token: g.token,
      dataUrl:
        'data:image/png;base64,' +
        encodePng({ width: g.width, height: g.height, rgba: g.rgba }).toString('base64')
    }))
  })

  ipcMain.handle(
    'render:map16',
    async (_event, args: RenderMap16Args): Promise<RenderImage> => {
      const { rom, symbols } = loadRomAndSymbols()
      const header = args.header
      return renderMap16Gallery(rom, symbols, header, {
        firstId: args.firstId,
        cellCount: args.cellCount,
        cellsPerRow: args.cellsPerRow
      })
    }
  )

  ipcMain.handle(
    'render:vram',
    async (_event, args: RenderVramArgs): Promise<RenderImage> => {
      const { rom, symbols } = loadRomAndSymbols()
      const header = args.header
      const region = args.region ?? 'all'

      // Resolve region → (offset, bpp, default tileCount, default palette).
      // For named layer regions we consult scene-regs to find the char base
      // for this level's mode; that lets BG2/BG3 tabs follow per-level
      // tile-data placement automatically. Sprite tiles aren't in
      // scene-regs ($2101 OBSEL isn't part of the layout table); we use
      // YI's conventional $6000 sprite VRAM region.
      let vramByteOffset = 0
      let bpp: 2 | 4 = 4
      let defaultTileCount = 2048
      let defaultPaletteRow = 0
      if (typeof region === 'object') {
        vramByteOffset = region.vramByteOffset
        bpp = region.bpp
        defaultTileCount = region.tileCount ?? 256
      } else if (region !== 'all') {
        const levelMode = header.levelMode ?? 0
        const regs = loadSceneRegs(rom, symbols, levelMode)
        // bpp follows the scene's BG mode (2bpp in BG Mode 0 / level mode $0A),
        // NOT a per-layer constant — see bgLayerBpp. Hardcoding 4 here rendered
        // $6B's BG1/BG2 tile tabs jumbled (the same bug the canvas had).
        if (region === 'bg1') {
          vramByteOffset = regs.bg1CharAddr
          bpp = bgLayerBpp(regs.bgmodeMode, 'bg1')
          defaultTileCount = 512
        } else if (region === 'bg2') {
          vramByteOffset = regs.bg2CharAddr
          bpp = bgLayerBpp(regs.bgmodeMode, 'bg2')
          defaultTileCount = 512
        } else if (region === 'bg3') {
          vramByteOffset = regs.bg3CharAddr
          bpp = bgLayerBpp(regs.bgmodeMode, 'bg3')
          defaultTileCount = 1024
        } else if (region === 'sprite') {
          vramByteOffset = 0x6000
          bpp = 4
          defaultTileCount = 512
          // Sprite palettes live in CGRAM rows 8-15 (bytes 256-511).
          defaultPaletteRow = 8
        }
      }

      return renderVramGrid(rom, symbols, header, {
        vramByteOffset,
        bpp,
        tileCount: args.tileCount ?? defaultTileCount,
        paletteRow: args.paletteRow ?? defaultPaletteRow,
        cellsPerRow: args.cellsPerRow
      })
    }
  )

  ipcMain.handle(
    'render:cgram',
    async (_event, req: LevelRenderRequest): Promise<Uint8Array | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      return buildLevelCgram(
        rom, symbols, level, req.levelRecordId, frameworkWorkRoot(), req.paletteOverride
      ).cgram
    }
  )

  // Palette-colour editing (§B10): PRISTINE base CGRAM + per-entry provenance (the
  // blob word that backs each swatch). The panel overlays its live colour draft for
  // the swatches; the canvas previews the same draft via `paletteOverride` (both are
  // BASE ⊕ draft — see `resourcePaletteToBase`), so palette edits (incl. resets)
  // show live without a rebuild. Test Level / Launch bake them into the .sfc.
  ipcMain.handle(
    'render:editablePalette',
    async (_event, req: LevelRenderRequest): Promise<DecodedPalette | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      // No draft passed: returns the PRISTINE base CGRAM + provenance; the panel
      // applies the live draft on top (the saved overlay is a build-time concern).
      return buildLevelCgram(rom, symbols, level, req.levelRecordId, frameworkWorkRoot())
    }
  )

  ipcMain.handle(
    'render:gfxFiles',
    async (_event, args: RenderGfxFilesArgs): Promise<GfxFilesResult> => {
      const { rom, symbols } = loadRomAndSymbols()
      const header = args.header
      return renderGfxFiles(rom, symbols, header, {
        cellsPerRow: args.cellsPerRow,
        spritePaletteRow: args.spritePaletteRow
      })
    }
  )

  // The level's gfx-file manifest (the Tiles "Header" tab): which compressed
  // files scene_gfx_layout loads into VRAM, with their layer (dpSlot), VRAM
  // destination, format, and size. Served from the shared VRAM/CGRAM cache
  // (same key the spriteLayer handler uses, so the two share one build) —
  // tile animation doesn't touch the manifest, so animate:false is exact.
  // `override` ⇒ tracks live header edits; isWorld6 resolves inside the build.
  ipcMain.handle(
    'render:gfxManifest',
    async (_event, req: LevelRenderRequest): Promise<GfxFileEntry[] | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      return buildLevelVramCgram(
        rom, symbols, level, req.levelRecordId, frameworkWorkRoot(),
        { animate: false, paletteEdits: req.paletteOverride, gfxOverride: gfxLiveEdits(), gfxRevision: gfxLiveRevision() }
      ).manifest
    }
  )

  ipcMain.handle(
    'render:bgLayers',
    async (_event, req: LevelRenderRequest): Promise<BgLayersResult | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      const levelMode = level.header[9] ?? 0
      // VRAM (gfx + animated-tile overlay) + CGRAM (+ live palette draft) + the
      // resolved gfx/palette headers composeBgLayers needs.
      const { vram, cgram, gfxHeader, palHeader } = buildLevelVramCgram(
        rom, symbols, level, req.levelRecordId, frameworkWorkRoot(),
        { animate: true, paletteEdits: req.paletteOverride, gfxOverride: gfxLiveEdits(), gfxRevision: gfxLiveRevision() }
      )

      // BG2/BG3 tilemap load + render + backdrop + the approximate-color-math
      // per-layer compositing descriptors (visibility honours main ∪ subscreen
      // membership + add/subtract/half, not just the main-screen TM bit). The
      // whole model lives in composeBgLayers so the engine dev tools
      // (render-cli / render-snapshot) composite BG2/BG3 identically.
      const composed = composeBgLayers({
        rom,
        symbols,
        gfxHeader,
        palHeader,
        levelMode,
        vram,
        cgram,
        // Live overlay so a BG2/BG3 tilemap PLACEMENT import previews without a rebuild
        // (CHR edits already preview via buildLevelVramCgram's gfxOverride; the tilemap is
        // a separate load, so it needs the same seam).
        gfxOverride: gfxLiveEdits()
      })
      const { bg2, bg3, bg2Front, bg3Front, bg2Layer, bg3Layer, regs } = composed
      const backdrop: BgLayersResult['backdrop'] =
        composed.backdrop.kind === 'solid'
          ? { kind: 'solid', css: cssFromBgr15(composed.backdrop.color15) }
          : {
              kind: 'gradient',
              rgba: composed.backdrop.rgba,
              width: composed.backdrop.width,
              height: composed.backdrop.height
            }

      return {
        bg2,
        bg3,
        bg2Front,
        bg3Front,
        backdrop,
        levelMode,
        bg2Layer,
        bg3Layer,
        regs: {
          bg2TilemapAddr: regs.bg2TilemapAddr,
          bg3TilemapAddr: regs.bg3TilemapAddr,
          bg2CharAddr: regs.bg2CharAddr,
          bg3CharAddr: regs.bg3CharAddr
        }
      }
    }
  )

  ipcMain.handle(
    'render:bg1Layer',
    async (_event, req: LevelRenderRequest): Promise<Bg1LayerResponse | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      const levelRecordId = req.levelRecordId
      const h = level.header
      // Per-tileset render context (VRAM/CGRAM/Map16 tables/char base/bands) —
      // cached across object edits (only the decoded buffer below changes).
      const c = getBg1Context(rom, symbols, level, levelRecordId, req.paletteOverride, frameworkWorkRoot(), gfxLiveEdits(), gfxLiveRevision())

      // Run the object decoder to get the Map16 ID buffer + page map (cached;
      // the collision handler reuses this same decode for one edit).
      const decoded = decodeForRequest(rom, symbols, req, frameworkWorkRoot(), currentOverlayRoot())
      if (!decoded) return null

      logMap16Diagnostics({
        rom, symbols, levelRecordId, header: h, bg1CharAddr: c.bg1CharAddr,
        gfxManifest: c.manifest, vram: c.vram, map16Tables: c.map16Tables,
        levelDataBuffer: decoded.state.levelDataBuffer,
        screenPageMap: decoded.state.screenPageMap
      })

      const renderArgs = {
        vram: c.vram, cgram: c.cgram, map16Tables: c.map16Tables,
        levelDataBuffer: decoded.state.levelDataBuffer,
        screenPageMap: decoded.state.screenPageMap,
        bg1CharAddr: c.bg1CharAddr, bg1Bpp: c.bg1Bpp, bands: c.bands, bandAxis: c.bandAxis
      }
      const newGrid = resolveCellGrid(decoded.state.levelDataBuffer, decoded.state.screenPageMap)
      const token = decodeInputKey(level)
      const headerKey = h.join(',')
      const changerSig = changerSpriteSig(level.sprites)

      // Incremental patch when the renderer's base grid is known AND its render
      // context matches: bg1 pixels depend on (Map16 id, tileset/palette/band),
      // so a header/changer change invalidates a Map16-only diff → full render.
      let response: Bg1LayerResponse | null = null
      if (req.override && req.baseToken) {
        const base = gridCacheGet(req.baseToken)
        if (base && base.symbols === symbols && base.recordId === levelRecordId &&
            base.headerKey === headerKey && base.changerSig === changerSig) {
          const coords = diffCellGrids(base.grid, newGrid)
          if ((coords.length >>> 1) <= PATCH_CELL_THRESHOLD) {
            response = { mode: 'patch', token, patch: renderBg1Patch(renderArgs, coords) }
          }
        }
      }
      if (!response) response = { mode: 'full', token, full: renderBg1(renderArgs) }

      gridCachePut(token, { grid: newGrid, recordId: levelRecordId, headerKey, changerSig, symbols })
      return response
    }
  )

  ipcMain.handle(
    'render:spriteLayer',
    async (_event, req: LevelRenderRequest): Promise<SpriteLayerResponse | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      // Sprite tiles + palettes ride the same per-level VRAM/CGRAM the BG1 path
      // builds (sprite-tileset gfx at the OBJ name base + sprite palette rows
      // CGRAM 8..15); the sprite layer does NOT animate tile VRAM.
      const { vram, cgram, manifest: gfxManifest, gfxHeader, palHeader } = buildLevelVramCgram(
        rom, symbols, level, req.levelRecordId, frameworkWorkRoot(),
        { animate: false, paletteEdits: req.paletteOverride, gfxOverride: gfxLiveEdits(), gfxRevision: gfxLiveRevision() }
      )

      // Resolve every renderable sprite once, then build the content-signature
      // grid (the diff substrate). Both the full composite and a patch reuse it.
      const model = buildSpriteRenderModel({
        rom,
        symbols,
        header: gfxHeader,
        sprites: level.sprites,
        vram,
        cgram,
        manifest: gfxManifest,
        levelSpritePaletteId: palHeader.spritePalette
        // (cel-format gate / settled palette / rest frame are engine-owned now — sprite-render-facts.ts)
      })
      const cellGrid = buildSpriteCellGrid(model)
      const bounds = [...model.boundsByNum.values()]
      const token = spriteInputKey(level)
      const headerKey = level.header.join(',')

      // Incremental patch when the renderer's base grid is known AND its render
      // context matches (same cart + level + tileset/palette). Sprite cel pixels
      // depend on the header gfx, so a header change invalidates a signature-only
      // diff → full render. (A palette-only change is handled renderer-side by
      // dropping baseToken, since the signature grid is palette-independent.)
      let response: SpriteLayerResponse | null = null
      if (req.override && req.baseToken) {
        const base = spriteGridCacheGet(req.baseToken)
        if (base && base.symbols === symbols && base.recordId === req.levelRecordId && base.headerKey === headerKey) {
          const coords = diffCellGrids(base.grid, cellGrid.grid)
          if ((coords.length >>> 1) <= PATCH_CELL_THRESHOLD) {
            response = { mode: 'patch', token, bounds, patch: renderSpritePatch(model, cellGrid, coords) }
          }
        }
      }
      if (!response) response = { mode: 'full', token, bounds, full: compositeSpriteFull(model) }

      spriteGridCachePut(token, { grid: cellGrid.grid, recordId: req.levelRecordId, headerKey, symbols })
      return response
    }
  )

  ipcMain.handle(
    'render:collisionTable',
    async (): Promise<CollisionTableResult> => {
      const { rom, symbols } = loadRomAndSymbols()
      const { table, pipeEntryBits } = getCollisionData(rom, symbols)
      return { table, pipeEntryBits }
    }
  )

  ipcMain.handle(
    'render:objectPropertyTable',
    async (): Promise<Uint8Array> => {
      const { rom, symbols } = loadRomAndSymbols()
      return loadObjectPropertyTable(rom, symbols)
    }
  )

  ipcMain.handle(
    'render:collisionLayer',
    async (_event, req: LevelRenderRequest): Promise<CollisionLayerResponse | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      const levelRecordId = req.levelRecordId
      const decoded = decodeForRequest(rom, symbols, req, frameworkWorkRoot(), currentOverlayRoot())
      if (!decoded) return null
      // Table + slope panels are cart-global (rom-only) — cached across calls.
      // The render's hot path is the per-cell blit, which reuses cached 16×16
      // cells across all tiles of the same Map16 page.
      const { table: collisionTable, panels: slopePanels } = getCollisionData(rom, symbols)

      const renderArgs = {
        collisionTable,
        slopePanels,
        levelDataBuffer: decoded.state.levelDataBuffer,
        screenPageMap: decoded.state.screenPageMap
      }
      const newGrid = resolveCellGrid(decoded.state.levelDataBuffer, decoded.state.screenPageMap)
      const token = decodeInputKey(level)

      // Collision pixels depend ONLY on the resolved grid (page → collision
      // table) — tileset/palette-independent — so the patch gate is just
      // same-level + same-cart (no header/changer gate; the grid diff already
      // captures every decode change, including those from a header edit).
      let response: CollisionLayerResponse | null = null
      if (req.override && req.baseToken) {
        const base = gridCacheGet(req.baseToken)
        if (base && base.symbols === symbols && base.recordId === levelRecordId) {
          const coords = diffCellGrids(base.grid, newGrid)
          if ((coords.length >>> 1) <= PATCH_CELL_THRESHOLD) {
            response = { mode: 'patch', token, patch: renderCollisionPatch(renderArgs, coords) }
          }
        }
      }
      if (!response) {
        const result = renderCollisionLayer(renderArgs)
        response = {
          mode: 'full',
          token,
          full: {
            rgba: result.rgba,
            width: result.width,
            height: result.height,
            uniquePagesRendered: result.uniquePagesRendered
          }
        }
      }

      gridCachePut(token, {
        grid: newGrid,
        recordId: levelRecordId,
        headerKey: level.header.join(','),
        changerSig: changerSpriteSig(level.sprites),
        symbols
      })
      return response
    }
  )

  ipcMain.handle(
    'render:decodeLevelLayout',
    async (_event, req: LevelRenderRequest): Promise<DecodedLevelLayout | null> => {
      const { rom, symbols } = loadRomAndSymbols()
      const result = decodeForRequest(rom, symbols, req, frameworkWorkRoot(), currentOverlayRoot())
      if (!result) return null
      const { state, stats, source } = result
      return {
        levelDataBuffer: state.levelDataBuffer,
        screenPageMap: state.screenPageMap,
        pageCount: state.pageCount,
        objectsParsed: stats.objectsParsed,
        unregisteredObjects: stats.unregisteredObjects,
        exitsParsed: stats.exitsParsed,
        aborted: stats.aborted,
        overflowed: stats.overflowed,
        source
      }
    }
  )

  // Forward fit of a painted height curve → std objects (the paint tool). The
  // base level is the selected tileset's representative level (for footprint
  // probing in the right theme); the emitted objects are added to the edited
  // level by the renderer. Falls back to the edited level when the tileset has
  // no fit-metadata entry (→ floors only).
  ipcMain.handle(
    'render:fitSurface',
    async (_event, req: FitSurfaceRequest): Promise<LevelObject[]> => {
      const { rom, symbols } = loadRomAndSymbols()
      const workRoot = frameworkWorkRoot()
      const overlay = currentOverlayRoot()
      const meta = fitMetadata().tilesets.find((t) => t.tileset === req.tileset)
      const recordId = meta ? parseInt(meta.baseLevel, 16) : req.levelRecordId
      const base = loadLevel({ workRoot, levelRecordId: recordId, overlayRoot: overlay })
      return fitHeightProfile({ rom, symbols, workRoot }, base, req.corners, req.baseline)
    }
  )

  // Paintable tilesets (those with fit-metadata) for the paint panel's selector.
  ipcMain.handle('render:fitTilesets', async (): Promise<FitTileset[]> =>
    fitMetadata().tilesets.map((t) => ({ tileset: t.tileset, name: t.name }))
  )

  // "Fit sprite tileset to sprites": pick the stock spriteset (header[7]) that
  // best covers the given placed sprites' gfx files. Authoritative (reads the
  // cart sprite-gfx-file table), so it's complete where obj-metadata isn't.
  ipcMain.handle(
    'render:fitSpriteset',
    async (_e, spriteNums: number[]): Promise<FitSpritesetResult> => {
      const { rom, symbols } = loadRomAndSymbols()
      return bestStockSpriteset(rom, symbols, spriteNums.map((num) => ({ num })))
    }
  )

  ipcMain.handle(
    'render:objectInfluence',
    async (_event, req: ObjectInfluenceRequest): Promise<DecodedObjectInfluence | null> => {
      const { rom, symbols } = loadRomAndSymbols()
      // Fresh provenance decode of the override. Intentionally bypasses
      // `decodeForRequest`'s plain-decode cache (which carries no provenance)
      // and does NOT populate it — otherwise a target-armed result could leak
      // into a later bg1/collision request. The decode is otherwise identical
      // to the edit path, so the recorded footprint matches what those layers
      // render. (Sprite-driven mid-level tileset/palette changes don't affect
      // object decode, so the classification is band-independent.)
      const decoded = decodeLevelFromLevelData({
        rom,
        symbols,
        workRoot: frameworkWorkRoot(),
        levelData: req.override,
        provenanceTargets: req.targetIndices
      })
      if (!decoded) return null
      const cells = resolveProvenanceCells(decoded.state).map((c) => ({
        x: c.x,
        y: c.y,
        cls: influenceClass(c.neighbor, c.buried),
        mid: c.mid
      }))
      return { cells }
    }
  )

  // Picker render-validity — the unified picker-catalog pass: per std/ext-object
  // verdicts (probe-decoded alone under this level's header — engine
  // entity-render-validity.ts) plus the level's 6 variable spriteset file ids
  // for the renderer-local sprite check. Returns the verdicts NOW and, off the
  // critical path, warms the picker thumbnail caches from the SAME decodes (so
  // each object decodes once, not once here + once on picker open). Fires on
  // every level load via Canvas's useEntityRenderValidity, so the picker's first
  // open is a thumbnail cache hit. `spriteNums` (the full sprite catalog) lets
  // the warm cover the sprite tab too; absent ⇒ objects only. Override-aware so
  // HeaderPanel edits are honoured; the verdict matrix is cached per gfx-header
  // tuple in render-core (~16 keys ever).
  ipcMain.handle(
    'render:entityRenderValidity',
    async (_event, req: EntityValidityRequest): Promise<EntityRenderValidity | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      const verdicts = getEntityCatalog(
        rom, symbols, level, req.levelRecordId, frameworkWorkRoot(), req.candidates, req.spriteNums ?? []
      )
      const spritesetFiles = loadSpritesetFileIds(rom, symbols, level.header[7] ?? 0)
        .map((f) => hex0x(f, 2))
      return { ...verdicts, spritesetFiles }
    }
  )

  // Picker thumbnails (§B5): per-catalog-entry bitmaps under this level's
  // header — objects probe-decoded alone + their stamped cells blitted,
  // sprites via the static cel pipeline. Cached per header tuple in
  // render-core. One tab per call (candidates XOR spriteNums).
  ipcMain.handle(
    'render:pickerThumbnails',
    async (_event, req: PickerThumbnailsRequest): Promise<PickerThumbnails | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      return getPickerThumbnails(
        rom, symbols, level, req.levelRecordId, frameworkWorkRoot(), req
      )
    }
  )

  // The level's distinct Map16 blocks + coverage/palette health (Tiles "Used"
  // view). Decodes the level (override-aware, so it tracks live edits) and
  // renders a composite thumbnail of exactly those blocks, row-major in usage
  // order, so the panel positions each block's badges from its index.
  ipcMain.handle(
    'render:levelTileUsage',
    async (_event, req: LevelRenderRequest): Promise<LevelTileUsage | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      const decoded = decodeForRequest(rom, symbols, req, frameworkWorkRoot(), currentOverlayRoot())
      if (!decoded) return null
      const usage = levelMap16Usage(rom, symbols, {
        header: level.header,
        isWorld6: isWorld6(req.levelRecordId, frameworkWorkRoot()),
        levelDataBuffer: decoded.state.levelDataBuffer,
        screenPageMap: decoded.state.screenPageMap
      })
      const renderHeader = renderHeaderFromLevel(level.header, req.levelRecordId, frameworkWorkRoot())
      const cellsPerRow = 16
      const image = renderMap16Cells(
        rom, symbols, renderHeader, usage.blocks.map((b) => b.id), { cellsPerRow }
      )
      return { ...usage, image, cellsPerRow, cellPx: 16 }
    }
  )
}
