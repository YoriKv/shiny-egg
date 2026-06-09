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
import { type CollisionEntry } from 'snes-framework/collision'
import { renderCollisionLayer, renderCollisionPatch } from 'snes-framework/render-collision'
import { resolveCellGrid, diffCellGrids } from 'snes-framework/cell-grid'
import { loadSceneRegs } from 'snes-framework/scene-regs'
import { loadLevelGfx, type GfxFileEntry } from 'snes-framework/load-graphics'
import { loadLevel } from 'snes-framework/level'
import { frameworkWorkRoot, overlayRoot } from '../framework-paths'
import { getCurrentProjectId } from '../projects'
import type {
  Bg1LayerResponse,
  BgLayersResult,
  CollisionLayerResponse,
  DecodedLevelLayout,
  DecodedObjectInfluence,
  DecodedPalette,
  FitSurfaceRequest,
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
  gfxHeaderFromLevel,
  renderHeaderFromLevel,
  isWorld6,
  buildLevelCgram,
  buildLevelVramCgram,
  changerSpriteSig,
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
        if (region === 'bg1') {
          vramByteOffset = regs.bg1CharAddr
          bpp = 4
          defaultTileCount = 512
        } else if (region === 'bg2') {
          vramByteOffset = regs.bg2CharAddr
          bpp = 4
          defaultTileCount = 512
        } else if (region === 'bg3') {
          vramByteOffset = regs.bg3CharAddr
          bpp = 2
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

  // Palette-colour editing (§B10): CGRAM + per-entry provenance (the blob word
  // that backs each swatch) + the overlay's current edits. CGRAM is patched with
  // the pending edits via provenance, so the panel's swatches reflect unbuilt
  // edits live (the in-level layers still need a rebuild — asm edits).
  ipcMain.handle(
    'render:editablePalette',
    async (_event, req: LevelRenderRequest): Promise<DecodedPalette | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      // BASE CGRAM + provenance only — the panel applies the live draft on top
      // (and the canvas previews it via paletteOverride). The saved overlay is a
      // build-time concern, not a render-time one.
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
  // destination, format, and size. Runs the real gfx loader but discards the
  // pixels — only the manifest collector is kept. `override` ⇒ tracks live
  // header edits; isWorld6 resolves correctly via gfxHeaderFromLevel.
  ipcMain.handle(
    'render:gfxManifest',
    async (_event, req: LevelRenderRequest): Promise<GfxFileEntry[] | null> => {
      const ctx = loadLevelContext(req)
      if (!ctx) return null
      const { rom, symbols, level } = ctx
      const gfxHeader = gfxHeaderFromLevel(level.header, req.levelRecordId, frameworkWorkRoot())
      const vram = new Uint8Array(0x10000)
      const manifest: GfxFileEntry[] = []
      loadLevelGfx(rom, symbols, gfxHeader, vram, manifest)
      return manifest
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
        { animate: true, paletteEdits: req.paletteOverride }
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
        cgram
      })
      const { bg2, bg3, bg2Layer, bg3Layer, regs } = composed
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
      const c = getBg1Context(rom, symbols, level, levelRecordId, req.paletteOverride, frameworkWorkRoot())

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
        bg1CharAddr: c.bg1CharAddr, bands: c.bands, bandAxis: c.bandAxis
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
        { animate: false, paletteEdits: req.paletteOverride }
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
        celRenderableNums: req.celRenderableNums ? new Set(req.celRenderableNums) : undefined,
        formatANums: req.formatANums ? new Set(req.formatANums) : undefined,
        levelSpritePaletteId: palHeader.spritePalette
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
    async (): Promise<CollisionEntry[]> => {
      const { rom, symbols } = loadRomAndSymbols()
      return getCollisionData(rom, symbols).table
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
