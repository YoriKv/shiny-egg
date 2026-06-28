import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ShinyEggAPI } from './api'
import type {
  Bg1LayerResponse,
  BgLayersResult,
  BizhawkWarp,
  CartIdentification,
  CaptureAtResult,
  CollisionLayerResponse,
  CollisionTableResult,
  DecodedLevelLayout,
  DecodedObjectInfluence,
  DecodedPalette,
  EntityRenderValidity,
  EntityValidityRequest,
  FindInstanceKind,
  FitSpritesetResult,
  FitSurfaceRequest,
  FitTileset,
  FrameworkExtractArgs,
  LevelRenderRequest,
  LevelTileUsage,
  LocateBizhawkResult,
  LocateAsepriteResult,
  AsepriteInfo,
  ObjectInfluenceRequest,
  ObjectInstance,
  PaletteCatalog,
  PaletteLiveResult,
  PickerThumbnails,
  PickerThumbnailsRequest,
  PatchAuthoringPaths,
  PatchImportResult,
  PatchMutationResult,
  PatchPoolSettings,
  PatchPreview,
  PatchSummary,
  OverlayDriftReport,
  OverlayUpgradeResult,
  PrepackagedPatch,
  ProjectBackupResult,
  ProjectDeleteResult,
  ProjectExportResult,
  ProjectInfo,
  ProjectRenameResult,
  ProjectSummary,
  RenameProjectArgs,
  RenderGfxFilesArgs,
  RenderHeaderRequest,
  ExportGfxOptions,
  ExportGfxResult,
  GfxEditEntry,
  GfxFileRole,
  Map16BlockPreview,
  Map16SubTileEdit,
  ImportGraphicsResult,
  BgRegionExportArgs,
  BgRegionExportResult,
  M1ExportFile,
  BgRegionImportResult,
  CreatableSlot,
  CreateLevelResult,
  RelocationState,
  RemovableVanillaLevels,
  RemovalPreviewResult,
  RemovedLevelEntry,
  RemoveLevelsResult,
  RestoreLevelsResult,
  MessageGlyphPreview,
  RenderImage,
  RenderMap16Args,
  GbaImportApplyResult,
  GbaImportApplySelection,
  GbaImportReport,
  RenderVramArgs,
  ResetGfxEditResult,
  ResetLevelResult,
  RomImportApplyResult,
  RomImportReport,
  RomImportSelection,
  SaveGfxEditResult,
  SetExitDestResult,
  SetExitEntranceResult,
  Settings,
  SpriteLayerResponse,
  SpriteProperty,
  SpritePropertiesRequest,
  TestInventory
} from '../shared/ipc-types'
import type { GfxFilesResult } from 'snes-framework/render-gfx-files'

import type { BuildResult } from 'snes-framework/build'
import type { ExtractResult } from 'snes-framework/extract'
import type { ExtractFreshness, ExtractionState } from 'snes-framework/state'
import type {
  EditableResource,
  GfxFileEntry,
  LevelData,
  GradientEdit,
  LevelDecodeSignals,
  LevelObject,
  LevelsCatalog,
  LevelValidationInput,
  PaletteEdit,
  PoolBudgetReport,
  PoolOverview,
  SaveResourceResult
} from 'snes-framework/types'

const api = {
  // Resolve an absolute path for a File the renderer received via
  // drag-and-drop or a file <input>. webUtils.getPathForFile is the
  // Electron-supported replacement for the removed File.path property.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  identifyCart: (cartPath: string): Promise<CartIdentification> =>
    ipcRenderer.invoke('framework:identifyCart', cartPath),

  getExtractionState: (): Promise<ExtractionState | null> =>
    ipcRenderer.invoke('framework:state'),

  /** Out-of-date-extract check (stale levels.json etc.) — see
   *  snes-framework/state checkExtractFreshness. */
  getExtractFreshness: (): Promise<ExtractFreshness> =>
    ipcRenderer.invoke('framework:extractFreshness'),

  extract: (args: FrameworkExtractArgs): Promise<ExtractResult> =>
    ipcRenderer.invoke('framework:extract', args),

  build: (): Promise<BuildResult> => ipcRenderer.invoke('framework:build'),

  setUnsavedChanges: (unsaved: boolean): void =>
    ipcRenderer.send('app:set-unsaved-changes', unsaved),

  /** App version (from package.json) — shown in the About dialog. */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  /**
   * Cart-derived level-dropdown catalog (world groups + per-slot names,
   * sourced from Bank51.asm at extract time). Null if no extraction has
   * happened yet — the renderer falls back to its bundled static catalog.
   */
  getLevelsCatalog: (): Promise<LevelsCatalog | null> =>
    ipcRenderer.invoke('levels:catalog'),

  /**
   * Phase 2.5 visual proof — live tile + Map16 rendering off the built ROM
   * via the engine pipeline (load-graphics → VRAM, load-palettes → CGRAM,
   * tile/color/map16 decoders). Result is RGBA8888 the renderer can shove
   * straight into a canvas ImageData.
   */
  render: {
    map16Gallery: (args: RenderMap16Args): Promise<RenderImage> =>
      ipcRenderer.invoke('render:map16', args),
    vramGrid: (args: RenderVramArgs): Promise<RenderImage> =>
      ipcRenderer.invoke('render:vram', args),
    /** PNG previews (data URLs) of the special markup glyphs — the Message-Text
     *  keyboard's button icons, decoded from the static 1bpp message font. */
    messageFontGlyphs: (): Promise<MessageGlyphPreview[]> =>
      ipcRenderer.invoke('render:messageFontGlyphs'),
    /** Render the level's gfx files as a list of labeled blocks — one per
     *  scene_gfx_layout entry, sprite-region entries subdivided into
     *  8-tile bands, plus synthesized blocks for the animated coin /
     *  !-switch / !-coin / star slots. */
    gfxFiles: (args: RenderGfxFilesArgs): Promise<GfxFilesResult> =>
      ipcRenderer.invoke('render:gfxFiles', args),
    /** The level's gfx-file manifest (file id, layer, VRAM offset, format,
     *  size) — manifest only, no pixels. Backs the Tiles "Header" tab. */
    gfxManifest: (req: LevelRenderRequest): Promise<GfxFileEntry[] | null> =>
      ipcRenderer.invoke('render:gfxManifest', req),
    /** Live 512-byte CGRAM (256 × u16 LE BGR-15) for the given level,
     *  produced by running the cart's palette interpreter against the
     *  level's header. Null for empty/special level slots. When `override`
     *  is supplied (e.g. live editor preview), the override's header is
     *  used instead of reading from disk. */
    cgram: (req: LevelRenderRequest): Promise<Uint8Array | null> =>
      ipcRenderer.invoke('render:cgram', req),
    /** Palette-colour editing: live CGRAM (overlay-patched) + per-entry blob
     *  provenance + the project's current palette edits. Null for empty/special
     *  slots. */
    editablePalette: (req: LevelRenderRequest): Promise<DecodedPalette | null> =>
      ipcRenderer.invoke('render:editablePalette', req),
    /** Whole-game palette catalog (the "All Palettes" tab) — every selectable
     *  master-blob palette by pointer table + by scene. Cart-static; null when
     *  the built ROM/symbols are unavailable. */
    paletteCatalog: (): Promise<PaletteCatalog | null> =>
      ipcRenderer.invoke('render:paletteCatalog'),
    /** Run the object decoder on a level and return the stamped Map16
     *  buffer plus per-screen page mapping. Null for empty / special-case
     *  records (e.g. 0x38, the engine-driven intro-cutscene level). Pass
     *  `override` to decode an edited `LevelData` instead of the on-disk
     *  `.bin`. */
    decodeLevelLayout: (
      req: LevelRenderRequest
    ): Promise<DecodedLevelLayout | null> =>
      ipcRenderer.invoke('render:decodeLevelLayout', req),
    /** Paint tool — forward-fit a painted height curve to std objects. */
    fitSurface: (req: FitSurfaceRequest): Promise<LevelObject[]> =>
      ipcRenderer.invoke('render:fitSurface', req),
    /** Paintable tilesets (those with fit-metadata) for the paint panel selector. */
    fitTilesets: (): Promise<FitTileset[]> => ipcRenderer.invoke('render:fitTilesets'),
    /** Best-covering stock sprite tileset (header[7]) for the given placed sprites. */
    fitSpriteset: (spriteNums: number[]): Promise<FitSpritesetResult> =>
      ipcRenderer.invoke('render:fitSpriteset', spriteNums),
    /** The level's distinct Map16 blocks with usage count, VRAM coverage
     *  health (loaded / anim / miss), and palette rows, plus a composite
     *  thumbnail of those blocks — the Tiles "Used in this level" view. Pass
     *  `override` so it tracks live edits. Null for empty / special slots. */
    levelTileUsage: (
      req: LevelRenderRequest
    ): Promise<LevelTileUsage | null> =>
      ipcRenderer.invoke('render:levelTileUsage', req),
    /** Object-drag cell-highlight: per-cell provenance classes for one object
     *  decoded from `override` at its pending position. Drag-transient. */
    objectInfluence: (
      req: ObjectInfluenceRequest
    ): Promise<DecodedObjectInfluence | null> =>
      ipcRenderer.invoke('render:objectInfluence', req),
    /** Picker render-validity: per std/ext-object verdicts under this level's
     *  header (each candidate probe-decoded alone, main-side, cached per
     *  gfx-header tuple) + the level's 6 variable spriteset file ids for the
     *  renderer-local sprite check. Pass `override` so live header edits are
     *  honoured. Null for empty/special slots. */
    entityRenderValidity: (
      req: EntityValidityRequest
    ): Promise<EntityRenderValidity | null> =>
      ipcRenderer.invoke('render:entityRenderValidity', req),
    /** Picker thumbnails (§B5): per-catalog-entry bitmaps under this level's
     *  header. One tab per call — `candidates` (objects) or `spriteNums` (+
     *  cel-gate sets). Absent key = no faithful bitmap (text-only row). Cached
     *  main-side per header tuple. Null for empty/special slots. */
    pickerThumbnails: (
      req: PickerThumbnailsRequest
    ): Promise<PickerThumbnails | null> =>
      ipcRenderer.invoke('render:pickerThumbnails', req),
    /** Render BG2 + BG3 + backdrop for a level. Returns RGBA bitmaps the
     *  canvas can draw under the BG1 layer. Null for empty / special
     *  level slots. Header-driven; pass `override` to reflect edited
     *  header values. */
    bgLayers: (req: LevelRenderRequest): Promise<BgLayersResult | null> =>
      ipcRenderer.invoke('render:bgLayers', req),
    /** Render BG1 as Map16-cell tiles for the level. Returns a full
     *  4096×2048 RGBA bitmap with alpha=0 for unstamped cells.
     *  As Bank13 stamp handlers come online more cells fill in. Pass
     *  `override` for live edit preview. */
    bg1Layer: (req: LevelRenderRequest): Promise<Bg1LayerResponse | null> =>
      ipcRenderer.invoke('render:bg1Layer', req),
    /** Render the static enemy-sprite layer (tier-1 OAM pixel pass): a
     *  full-extent RGBA bitmap with each Format-B-cel sprite composited at
     *  its placed position. Sprites without a cel are absent (the vector
     *  glyph overlay draws those). Null for empty / special level slots.
     *  Pass `override` for live edit preview. */
    spriteLayer: (req: LevelRenderRequest): Promise<SpriteLayerResponse | null> =>
      ipcRenderer.invoke('render:spriteLayer', req),
    /** Render the collision overlay (per-page collision metadata from
     *  `bg_type_table` rasterised over every stamped cell). Returns a
     *  full-extent RGBA bitmap with category-colored fills and
     *  per-pixel slope surface lines. Null for empty / special level
     *  slots. Pass `override` for live edit preview. */
    collisionLayer: (req: LevelRenderRequest): Promise<CollisionLayerResponse | null> =>
      ipcRenderer.invoke('render:collisionLayer', req),
    /** The full decoded 168-entry collision (`bg_type_table`) plus the
     *  per-tile pipe-entry bits (`DATA_0AEBBC`) for the current cart.
     *  Independent of level — cache once at the App level and reuse across
     *  selections. ~5 KB struct vs the ~33 MB `collisionLayer` bitmap. */
    collisionTable: (): Promise<CollisionTableResult> =>
      ipcRenderer.invoke('render:collisionTable'),
    /** The 256-byte standard-object property table (low 2 bits = size-encoding
     *  flag). Per-cart static; cache once renderer-side. Drives which W/H the
     *  Properties panel + resize handles expose. */
    objectPropertyTable: (): Promise<Uint8Array> =>
      ipcRenderer.invoke('render:objectPropertyTable')
  },

  onFrameworkProgress: (cb: (msg: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on('framework:progress', handler)
    return () => ipcRenderer.off('framework:progress', handler)
  },

  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke('settings:set', patch)
  },

  // Per-project lifecycle. The current project is persisted in settings
  // (lastProjectId) and reopened on launch; `ensureCurrent` auto-creates the
  // default `new-shiny-00` when none exists.
  projects: {
    list: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
    ensureCurrent: (): Promise<ProjectSummary> =>
      ipcRenderer.invoke('project:ensureCurrent'),
    create: (): Promise<ProjectSummary> => ipcRenderer.invoke('project:create'),
    switch: (id: string): Promise<ProjectSummary> =>
      ipcRenderer.invoke('project:switch', id),
    info: (id: string): Promise<ProjectInfo> =>
      ipcRenderer.invoke('project:info', id),
    rename: (id: string, newName: string): Promise<ProjectRenameResult> => {
      const args: RenameProjectArgs = { id, newName }
      return ipcRenderer.invoke('project:rename', args)
    },
    export: (id: string): Promise<ProjectExportResult> =>
      ipcRenderer.invoke('project:export', id),
    openFolder: (id: string): Promise<void> =>
      ipcRenderer.invoke('project:openFolder', id),
    delete: (id: string): Promise<ProjectDeleteResult> =>
      ipcRenderer.invoke('project:delete', id),
    checkOverlays: (id: string): Promise<OverlayDriftReport> =>
      ipcRenderer.invoke('project:checkOverlays', id),
    backup: (id: string): Promise<ProjectBackupResult> =>
      ipcRenderer.invoke('project:backup', id),
    upgradeOverlays: (id: string, files: string[]): Promise<OverlayUpgradeResult> =>
      ipcRenderer.invoke('project:upgradeOverlays', { id, files })
  },

  // Generic editable-resource load/save (the registry). The level editor and
  // all new tools (strings, …) use this for both load and save.
  editor: {
    // Return type left to inference (invoke → Promise<any>) so this satisfies
    // the contract's typed `loadResource({kind:'level'})` → Promise<LevelData>
    // overload as well as the generic Promise<unknown> form.
    loadResource: (resource: EditableResource) =>
      ipcRenderer.invoke('editor:loadResource', resource),
    spriteProperties: (req: SpritePropertiesRequest): Promise<SpriteProperty[]> =>
      ipcRenderer.invoke('editor:spriteProperties', req),
    saveResource: (
      resource: EditableResource,
      model: unknown
    ): Promise<SaveResourceResult> =>
      ipcRenderer.invoke('editor:saveResource', resource, model),
    /** Palette-colour editing: the saved overlay's edit set (usePaletteEditor
     *  baseline). */
    loadPaletteEdits: (): Promise<PaletteEdit[]> => ipcRenderer.invoke('editor:loadPaletteEdits'),
    /** Palette-colour editing: persist the full edit set (offset → value) to the
     *  project overlay (Bank57.asm). Caller marks the build dirty on success. */
    savePaletteEdits: (edits: PaletteEdit[]): Promise<SaveResourceResult> =>
      ipcRenderer.invoke('editor:savePaletteEdits', edits),
    /** Backdrop-gradient editing: the saved overlay's gradient stop edits
     *  (useGradientEditor baseline). */
    loadGradientEdits: (): Promise<GradientEdit[]> => ipcRenderer.invoke('editor:loadGradientEdits'),
    /** Backdrop-gradient editing: persist the full gradient stop edit set to the
     *  project overlay (Bank57.asm). Caller marks the build dirty on success. */
    saveGradientEdits: (edits: GradientEdit[]): Promise<SaveResourceResult> =>
      ipcRenderer.invoke('editor:saveGradientEdits', edits),
    /** The 16×24 pristine base gradient colours; the panel overlays the draft for
     *  display so a reset reveals base without a rebuild. */
    gradientBaseColors: (): Promise<number[][]> => ipcRenderer.invoke('editor:gradientBaseColors'),
    levelBudget: (
      levelRecordId: number,
      level: LevelData
    ): Promise<PoolBudgetReport | null> =>
      ipcRenderer.invoke('editor:levelBudget', levelRecordId, level),
    poolOverview: (
      activeLevelRecordId: number | null,
      activeLevel: LevelData | null
    ): Promise<PoolOverview | null> =>
      ipcRenderer.invoke('editor:poolOverview', activeLevelRecordId, activeLevel),
    getRelocationState: (): Promise<RelocationState> =>
      ipcRenderer.invoke('editor:getRelocationState'),
    setLevelRelocation: (levelRecordId: number, relocated: boolean): Promise<RelocationState> =>
      ipcRenderer.invoke('editor:setLevelRelocation', levelRecordId, relocated),
    setLevelDecoupled: (levelRecordId: number, decoupled: boolean): Promise<RelocationState> =>
      ipcRenderer.invoke('editor:setLevelDecoupled', levelRecordId, decoupled),
    resetLevel: (levelRecordId: number): Promise<ResetLevelResult> =>
      ipcRenderer.invoke('editor:resetLevel', levelRecordId),
    saveGfxEdit: (
      format: 'lz2' | 'lz16',
      fileId: number,
      tiles: Uint8Array,
      rowCount?: number
    ): Promise<SaveGfxEditResult> =>
      ipcRenderer.invoke('editor:saveGfxEdit', format, fileId, tiles, rowCount),
    resetGfxEdit: (format: 'lz2' | 'lz16', fileId: number): Promise<ResetGfxEditResult> =>
      ipcRenderer.invoke('editor:resetGfxEdit', format, fileId),
    listGfxEdits: (): Promise<GfxEditEntry[]> => ipcRenderer.invoke('editor:listGfxEdits'),
    gfxFileRole: (file: string): Promise<GfxFileRole> =>
      ipcRenderer.invoke('editor:gfxFileRole', file),
    resetGfxEditFile: (file: string): Promise<ResetGfxEditResult> =>
      ipcRenderer.invoke('editor:resetGfxEditFile', file),
    exportGfxPngs: (
      header: RenderHeaderRequest | null,
      opts?: ExportGfxOptions
    ): Promise<ExportGfxResult> =>
      ipcRenderer.invoke('editor:exportGfxPngs', header, opts),
    exportBgRegion: (
      header: RenderHeaderRequest,
      args: BgRegionExportArgs
    ): Promise<BgRegionExportResult> =>
      ipcRenderer.invoke('editor:exportBgRegion', header, args),
    importBgRegion: (): Promise<BgRegionImportResult> => ipcRenderer.invoke('editor:importBgRegion'),
    getAsepriteExe: (): Promise<AsepriteInfo | null> => ipcRenderer.invoke('aseprite:getExe'),
    locateAseprite: (): Promise<LocateAsepriteResult> => ipcRenderer.invoke('aseprite:locate'),
    openInAseprite: (dir: string, file: string): Promise<boolean> => ipcRenderer.invoke('aseprite:open', dir, file),
    openInM1te: (dir: string, file: string, bg?: 1 | 2 | 3): Promise<boolean> => ipcRenderer.invoke('m1te:open', dir, file, bg),
    listM1Files: (dir: string): Promise<M1ExportFile[]> => ipcRenderer.invoke('editor:listM1Files', dir),
    listRegionExports: (): Promise<string[]> => ipcRenderer.invoke('editor:listRegionExports'),
    removeRegionExport: (dir: string): Promise<string[]> => ipcRenderer.invoke('editor:removeRegionExport', dir),
    openRegionFolder: (dir: string): Promise<void> => ipcRenderer.invoke('editor:openRegionFolder', dir),
    importRegionFolder: (dir: string): Promise<BgRegionImportResult> =>
      ipcRenderer.invoke('editor:importRegionFolder', dir),
    importGraphics: (): Promise<ImportGraphicsResult> => ipcRenderer.invoke('editor:importGraphics'),
    importGraphicsFolder: (dir: string): Promise<ImportGraphicsResult> =>
      ipcRenderer.invoke('editor:importGraphicsFolder', dir),
    loadMap16Block: (map16Id: number): Promise<Map16SubTileEdit[] | null> =>
      ipcRenderer.invoke('editor:loadMap16Block', map16Id),
    saveMap16Block: (
      map16Id: number,
      subtiles: Map16SubTileEdit[]
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('editor:saveMap16Block', map16Id, subtiles),
    resetMap16Block: (map16Id: number): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> =>
      ipcRenderer.invoke('editor:resetMap16Block', map16Id),
    listMap16BlockEdits: (): Promise<number[]> => ipcRenderer.invoke('editor:listMap16BlockEdits'),
    renderMap16Block: (
      header: RenderHeaderRequest,
      subtiles: Map16SubTileEdit[]
    ): Promise<Map16BlockPreview | null> => ipcRenderer.invoke('editor:renderMap16Block', header, subtiles),
    removeLevelsPreview: (recordIds: number[]): Promise<RemovalPreviewResult> =>
      ipcRenderer.invoke('editor:removeLevelsPreview', recordIds),
    removeLevels: (recordIds: number[]): Promise<RemoveLevelsResult> =>
      ipcRenderer.invoke('editor:removeLevels', recordIds),
    removableVanillaLevels: (): Promise<RemovableVanillaLevels | { error: string }> =>
      ipcRenderer.invoke('editor:removableVanillaLevels'),
    removedLevels: (): Promise<RemovedLevelEntry[]> => ipcRenderer.invoke('editor:removedLevels'),
    restoreLevels: (recordIds: number[]): Promise<RestoreLevelsResult> =>
      ipcRenderer.invoke('editor:restoreLevels', recordIds),
    creatableSlots: (): Promise<CreatableSlot[]> => ipcRenderer.invoke('editor:creatableSlots'),
    createLevel: (recordId: number): Promise<CreateLevelResult> =>
      ipcRenderer.invoke('editor:createLevel', recordId),
    setExitDest: (
      sourceLevelRecordId: number,
      screenIndex: number,
      destX: number,
      destY: number
    ): Promise<SetExitDestResult> =>
      ipcRenderer.invoke('editor:setExitDest', sourceLevelRecordId, screenIndex, destX, destY),
    setExitEntrance: (
      sourceLevelRecordId: number,
      screenIndex: number,
      entranceType: number
    ): Promise<SetExitEntranceResult> =>
      ipcRenderer.invoke('editor:setExitEntrance', sourceLevelRecordId, screenIndex, entranceType)
  },

  // BizHawk render harness — POC. First call boots EmuHawk against the
  // stashed reference cart and keeps it alive across subsequent calls.
  bizhawk: {
    ping: (): Promise<string> => ipcRenderer.invoke('bizhawk:ping'),
    info: (): Promise<string> => ipcRenderer.invoke('bizhawk:info'),
    dumpVram: (): Promise<Uint8Array> => ipcRenderer.invoke('bizhawk:dumpVram'),
    dumpCgram: (): Promise<Uint8Array> => ipcRenderer.invoke('bizhawk:dumpCgram'),
    loadLevel: (
      translevelId: number,
      warps?: ReadonlyArray<BizhawkWarp>,
      inventory?: TestInventory
    ): Promise<string> =>
      ipcRenderer.invoke('bizhawk:loadLevel', translevelId, warps, inventory),
    readMem: (domain: string, addr: number, len: number): Promise<Uint8Array> =>
      ipcRenderer.invoke('bizhawk:readMem', domain, addr, len),
    writeMem: (domain: string, addr: number, bytes: Uint8Array): Promise<string> =>
      ipcRenderer.invoke('bizhawk:writeMem', domain, addr, bytes),
    isRunning: (): Promise<boolean> => ipcRenderer.invoke('bizhawk:isRunning'),
    applyPaletteLive: (edits: PaletteEdit[], revertOffsets: number[]): Promise<PaletteLiveResult> =>
      ipcRenderer.invoke('bizhawk:applyPaletteLive', edits, revertOffsets),
    captureAt: (
      x: number,
      y: number
    ): Promise<CaptureAtResult> =>
      ipcRenderer.invoke('bizhawk:captureAt', x, y),
    launch: (): Promise<void> => ipcRenderer.invoke('bizhawk:launch'),
    stop: (): Promise<void> => ipcRenderer.invoke('bizhawk:stop'),
    getExe: (): Promise<string | null> => ipcRenderer.invoke('bizhawk:getExe'),
    locate: (): Promise<LocateBizhawkResult> => ipcRenderer.invoke('bizhawk:locate')
  },

  debug: {
    findInstances: (
      kind: FindInstanceKind,
      idHex: string
    ): Promise<ObjectInstance[]> =>
      ipcRenderer.invoke('debug:findInstances', kind, idHex)
  },

  // Custom patches: per-project local patches (toggle on/off) + the prepackaged
  // catalog (add into a project), applied to the finished ROM post-build.
  // Mutations mark the build dirty (renderer side), like the other tools.
  patches: {
    listProject: (): Promise<PatchSummary[]> => ipcRenderer.invoke('patches:listProject'),
    listPrepackaged: (): Promise<PrepackagedPatch[]> => ipcRenderer.invoke('patches:listPrepackaged'),
    add: (builtinId: string): Promise<PatchMutationResult> => ipcRenderer.invoke('patches:add', builtinId),
    import: (): Promise<PatchImportResult[]> => ipcRenderer.invoke('patches:import'),
    newTemplate: (): Promise<PatchImportResult> => ipcRenderer.invoke('patches:newTemplate'),
    setEnabled: (id: string, enabled: boolean): Promise<PatchMutationResult> =>
      ipcRenderer.invoke('patches:setEnabled', id, enabled),
    reorder: (ids: string[]): Promise<PatchMutationResult> => ipcRenderer.invoke('patches:reorder', ids),
    remove: (id: string): Promise<PatchMutationResult> => ipcRenderer.invoke('patches:remove', id),
    getPatchPool: (): Promise<PatchPoolSettings> => ipcRenderer.invoke('patches:getPatchPool'),
    setPatchPoolKB: (kb: number): Promise<PatchMutationResult> =>
      ipcRenderer.invoke('patches:setPatchPoolKB', kb),
    preview: (id: string): Promise<PatchPreview | null> => ipcRenderer.invoke('patches:preview', id),
    openFolder: (): Promise<void> => ipcRenderer.invoke('patches:openFolder'),
    authoringPaths: (): Promise<PatchAuthoringPaths> => ipcRenderer.invoke('patches:authoringPaths'),
    openAuthoringFolder: (which: 'asm' | 'sym'): Promise<void> =>
      ipcRenderer.invoke('patches:openAuthoringFolder', which)
  },

  // ROM import: pick a modified third-party ROM, diff it against the extracted
  // V1.0 base, and apply the chosen level changes into the active project's
  // overlay. Applying marks the build dirty (renderer side).
  importRom: {
    analyze: (): Promise<RomImportReport | null> => ipcRenderer.invoke('import:analyze'),
    apply: (selection: RomImportSelection): Promise<RomImportApplyResult> =>
      ipcRenderer.invoke('import:apply', selection)
  },

  // GBA import: pick an SMA3 (U) cart, list its sublevels, and overwrite chosen
  // SNES records with them. Applying marks the build dirty (renderer side).
  importGba: {
    analyze: (): Promise<GbaImportReport | null> => ipcRenderer.invoke('gbaImport:analyze'),
    apply: (selection: GbaImportApplySelection): Promise<GbaImportApplyResult> =>
      ipcRenderer.invoke('gbaImport:apply', selection)
  },

  // Level validation: the decode side of the Validation panel. The check logic
  // is renderer-side; these only run the object decoder main-side.
  validation: {
    signals: (level: LevelData): Promise<LevelDecodeSignals> =>
      ipcRenderer.invoke('validation:signals', level),
    allLevels: (): Promise<LevelValidationInput[]> => ipcRenderer.invoke('validation:allLevels')
  }
} satisfies ShinyEggAPI

contextBridge.exposeInMainWorld('shinyEgg', api)
