// Renderer-facing contract for `window.shinyEgg`. This file declares only the
// preload *API* surface (the method-bearing interfaces) and the global `Window`
// augmentation; every data shape it references is re-exported from its single
// source:
//   • framework-owned shapes  → `snes-framework/types` (Node-free island)
//   • collision tables        → `snes-framework/collision`
//   • app/IPC envelopes       → `../shared/ipc-types` (Node- + DOM-free)
// Renderer code imports both the API types AND the data shapes from here, so
// this stays the one import surface the renderer sees. (Renamed from
// `index.d.ts` so it isn't shadowed by `index.ts` and stays searchable.)

import type {
  Bg1RenderResult,
  BuildResult,
  EditableResource,
  ExtractFreshness,
  ExtractionState,
  ExtractResult,
  GfxFileEntry,
  GfxFilesResult,
  GradientEdit,
  LayerCellPatch,
  LevelData,
  LevelsCatalog,
  PaletteCatalog,
  PaletteCatalogGroup,
  PaletteCatalogEntry,
  PaletteCatalogSwatch,
  PaletteEdit,
  MusicSetsModel,
  PoolBudgetReport,
  PoolOverview,
  SaveResourceResult,
  WorldMapEntrance,
  WorldMapMidwayEntrance,
  WorldMapModel,
  WorldMapPathPoint,
  WorldMapPathsModel,
  YoshiColorsModel
} from 'snes-framework/types'
import type { CollisionEntry } from 'snes-framework/collision'
import type {
  AudioAramUsageResult,
  AudioCatalogResult,
  AudioComposeSpcResult,
  AudioDecodeSongResult,
  AudioExportRunResult,
  AudioExportStateResult,
  AudioImportResult,
  AudioSongImportPreviewResult,
  AudioSongImportStateResult,
  Bg1LayerResponse,
  BgLayersResult,
  BizhawkWarp,
  TestInventory,
  CartIdentification,
  CaptureAtResult,
  CollisionLayerResponse,
  CollisionRenderResult,
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
  EmulatorState,
  EmulatorKind,
  LocateEmulatorResult,
  LocateAsepriteResult,
  AsepriteInfo,
  LocateYychrResult,
  YychrProjectState,
  YychrProjectExportResult,
  YychrProjectImportResult,
  YychrThumbnailEntry,
  M1teMapsState,
  M1teMapsExportResult,
  M1teMapsImportResult,
  M1teMapsFile,
  ArtworkFormat,
  GfxProjectState,
  GfxProjectExportResult,
  GfxProjectImportResult,
  GfxProjectFile,
  ObjectCellsResponse,
  ObjectInfluenceRequest,
  ObjectInstance,
  OverlayDriftReport,
  OverlayUpgradeResult,
  PaletteLiveResult,
  PatchAuthoringPaths,
  PatchImportResult,
  PatchMutationResult,
  PatchPoolSettings,
  PatchPreview,
  PatchSummary,
  PickerThumbnails,
  PickerThumbnailsRequest,
  PrepackagedPatch,
  ProjectBackupResult,
  ProjectDeleteResult,
  ProjectExportResult,
  ProjectInfo,
  ProjectRenameResult,
  ProjectSummary,
  CreatableSlot,
  CreateLevelResult,
  RelocationState,
  RemovableVanillaLevels,
  RemovalPreviewResult,
  RemovedLevelEntry,
  RemoveLevelsResult,
  BgRegionExportArgs,
  BgRegionExportResult,
  BgRegionImportResult,
  M1ExportFile,
  RegionImportLogEntry,
  ExportGfxOptions,
  GfxExportTrack,
  ExportGfxResult,
  GfxEditEntry,
  GfxEditChange,
  GfxEditKind,
  GfxFileRole,
  ImportGraphicsResult,
  Map16BlockPreview,
  Map16SubTileEdit,
  MessageGlyphPreview,
  RenderGfxFilesArgs,
  RenderHeaderRequest,
  RenderImage,
  RenderMap16Args,
  RenderVramArgs,
  GbaImportApplyResult,
  GbaImportApplySelection,
  GbaImportReport,
  ResetGfxEditResult,
  ResetLevelResult,
  RestoreLevelsResult,
  RomImportApplyResult,
  RomImportReport,
  RomImportSelection,
  SaveGfxEditResult,
  SetExitDestResult,
  SetExitEntranceResult,
  Settings,
  SpriteLayerResponse,
  SpriteProperty,
  SpritePropertiesRequest
} from '../shared/ipc-types'

// ── Re-exported data shapes ─────────────────────────────────────────────────
// The renderer imports these from this contract (single import surface). Each
// name resolves to its single definition site; this contract never re-declares.
export type {
  AllLevelsValidationResult,
  AnchorMethod,
  AnchorResolution,
  Bg1RenderResult,
  BuildResult,
  CollectibleCounts,
  EditableResource,
  ExtractFreshness,
  ExtractionState,
  ExtractResult,
  ForeignLevelDiff,
  GfxFileBlock,
  GfxFileEntry,
  GfxFilesResult,
  GradientEdit,
  InventoryCategory,
  LayerCellPatch,
  LevelCatalogEntry,
  LevelCatalogGroup,
  LevelData,
  LevelDecodeSignals,
  LevelImportability,
  LevelStreamCounts,
  LevelMap16Usage,
  LevelObject,
  LevelSprite,
  LevelsCatalog,
  LevelValidationInput,
  LevelValidationResult,
  Map16SubTileUsage,
  MessagePtrOption,
  MessagePtrTableModel,
  ObjectRenderVerdict,
  PaletteCatalog,
  PaletteCatalogGroup,
  PaletteCatalogEntry,
  PaletteCatalogSwatch,
  PaletteEdit,
  PoolBudgetEntry,
  PoolBudgetReport,
  PoolOverview,
  PoolOverviewEntry,
  PoolOverviewLevel,
  RomImportInventory,
  RomVersion,
  SaveResourceResult,
  ScreenExit,
  ScreenExitMinibattle,
  ScreenExitWarp,
  MarkupToken,
  SpriteCelBounds,
  SpriteLayerResult,
  StringTableEntry,
  StringTableModel,
  TileCoverage,
  UsedMap16,
  MusicSetSettingModel,
  MusicSetsModel,
  ValidationIssue,
  ValidationSeverity,
  WorldMapEntrance,
  WorldMapMidwayEntrance,
  WorldMapModel,
  WorldMapPathPoint,
  WorldMapPathsModel,
  YoshiColorsModel
} from 'snes-framework/types'
export type {
  CollisionEntry,
  CollisionFlags,
  CollisionDoors,
  SecondaryTag
} from 'snes-framework/collision'
export type {
  Bg1LayerResponse,
  BgLayersResult,
  BizhawkWarp,
  TestInventory,
  CartIdentification,
  CaptureAtResult,
  CollisionLayerResponse,
  CollisionRenderResult,
  CollisionTableResult,
  DecodedLevelLayout,
  DecodedObjectInfluence,
  DecodedPalette,
  EntityRenderValidity,
  EntityValidityCandidate,
  EntityValidityRequest,
  FindInstanceKind,
  FitSpritesetResult,
  FitSurfaceRequest,
  FitTileset,
  FrameworkExtractArgs,
  InfluenceClass,
  LevelRenderRequest,
  LevelTileUsage,
  EmulatorState,
  EmulatorKind,
  EmulatorLocation,
  LocateEmulatorResult,
  LocateAsepriteResult,
  AsepriteInfo,
  LocateYychrResult,
  YychrFileStatus,
  YychrProjectFile,
  YychrProjectState,
  YychrProjectExportResult,
  YychrImportFileOutcome,
  YychrProjectImportResult,
  YychrThumbnail,
  YychrThumbnailEntry,
  M1teMapsFile,
  M1teMapsState,
  M1teMapsExportResult,
  M1teMapsImportResult,
  ArtworkFormat,
  GfxProjectState,
  GfxProjectExportResult,
  GfxProjectImportResult,
  GfxProjectFile,
  PaintCorner,
  ObjectInfluenceRequest,
  ObjectInstance,
  OverlayDriftFile,
  OverlayDriftReport,
  OverlayUpgradeResult,
  PaletteLiveResult,
  PatchAuthoringPaths,
  PatchImportResult,
  PatchMutationResult,
  PatchPoolSettings,
  PatchPreview,
  PatchPreviewChunk,
  PatchSummary,
  PickerThumbnails,
  PickerThumbnailsRequest,
  PrepackagedPatch,
  ProjectBackupResult,
  ProjectDeleteResult,
  ProjectExportResult,
  ProjectInfo,
  ProjectRenameResult,
  ProjectSummary,
  CreatableSlot,
  CreateLevelResult,
  RelocationState,
  RemovableVanillaLevels,
  RemovalBlocked,
  RemovalPreview,
  RemovalPreviewResult,
  RemovedLevelEntry,
  RemoveLevelsResult,
  BgRegionLayer,
  BgRegionRect,
  BgRegionFormat,
  BgRegionExportArgs,
  BgRegionExportResult,
  BgRegionImportResult,
  M1ExportFile,
  RegionImportLogEntry,
  ExportGfxOptions,
  GfxExportTrack,
  ExportGfxResult,
  GfxEditEntry,
  GfxEditChange,
  GfxEditKind,
  GfxFileRole,
  ImportGraphicsResult,
  Map16BlockPreview,
  Map16SubTileEdit,
  MessageGlyphPreview,
  RenderGfxFilesArgs,
  RenderHeaderRequest,
  RenderImage,
  RenderMap16Args,
  RenderVramArgs,
  RenderVramRegion,
  ResetGfxEditResult,
  ResetLevelResult,
  RestoreLevelsResult,
  GbaImportApplyResult,
  GbaImportApplySelection,
  GbaImportReport,
  GbaImportSublevel,
  RomImportApplyResult,
  RomImportLevel,
  RomImportNames,
  RomImportPalette,
  RomImportReport,
  RomImportSelection,
  SaveGfxEditResult,
  SetExitDestResult,
  SetExitEntranceResult,
  Settings,
  SpriteLayerResponse,
  SpriteProperty,
  SpritePropertiesRequest,
  AudioAramUsageResult,
  AudioCatalogResult,
  AudioCatalogUi,
  AudioComposeSpcResult,
  AudioDecodeSongResult,
  AudioExportFileUi,
  AudioExportRunResult,
  AudioExportStateResult,
  AudioImportItemUi,
  AudioImportResult,
  AudioImportSongCandidateUi,
  AudioImportSongFileUi,
  AudioImportTargetUi,
  AudioSettingUi,
  AudioSfxUi,
  AudioSongImportPreviewResult,
  AudioSongImportRunResult,
  AudioSongImportStateResult
} from '../shared/ipc-types'
export type {
  AramImportBudget,
  AramSegment,
  PatternSpan,
  SettingAramUsage,
  SongTimeline,
  TimedNote,
  TimedVcmd,
  VoiceTimeline
} from 'snes-framework/types'

// ── API surface (method-bearing; contract-only, no data analogue) ───────────

export interface SettingsAPI {
  get: () => Promise<Settings>
  set: (patch: Partial<Settings>) => Promise<Settings>
}

export interface ProjectsAPI {
  list: () => Promise<ProjectSummary[]>
  /** Current project, auto-creating the default `new-shiny-00` if none. */
  ensureCurrent: () => Promise<ProjectSummary>
  /** Create a project and make it current. With a `name`, uses it (validated +
   *  uniqueness-checked main-side); without one, auto-names the next `new-shiny-NN`. */
  create: (name?: string) => Promise<ProjectSummary>
  /** Make an existing project current (persisted across launches). */
  switch: (id: string) => Promise<ProjectSummary>
  info: (id: string) => Promise<ProjectInfo>
  /** Rename (moves the folder). Name: lowercase ascii + `-`/`_`, no spaces.
   *  Returns `{ ok:false, error }` on an invalid/taken name or a locked
   *  folder (e.g. open in Explorer) — never rejects. */
  rename: (id: string, newName: string) => Promise<ProjectRenameResult>
  /** Export as ROM: build and Save-As to a user-chosen `.sfc`. */
  export: (id: string) => Promise<ProjectExportResult>
  /** Export as Patch: build and Save-As a `.bps` patch — the built ROM
   *  BPS-diffed against the reference cart, for ROM-free distribution. */
  exportPatch: (id: string) => Promise<ProjectExportResult>
  /** Reveal the project folder in the OS file manager. */
  openFolder: (id: string) => Promise<void>
  /** Delete the project folder. On success returns the new current project.
   *  Returns `{ ok:false, error }` on a locked folder (e.g. open in Explorer). */
  delete: (id: string) => Promise<ProjectDeleteResult>
  /** Scan the project's overlay `.asm` files for drift against the current base
   *  (out-of-region base changes, or editable regions the base added later).
   *  Run on project launch; empty `files` ⇒ up to date. */
  checkOverlays: (id: string) => Promise<OverlayDriftReport>
  /** Duplicate the project as a `<id>-backup-<date>` restore point (the "back up
   *  first" step before an upgrade). Does not switch to it. */
  backup: (id: string) => Promise<ProjectBackupResult>
  /** Re-splice the listed overlay files' edited regions onto the fresh base,
   *  adopting base changes outside them + newly-added regions. */
  upgradeOverlays: (id: string, files: string[]) => Promise<OverlayUpgradeResult>
}

export interface BizHawkAPI {
  /** Heartbeat; resolves to "PONG" when EmuHawk's harness is connected. */
  ping: () => Promise<string>
  /** One-line info string (core, ROM name, current frame). */
  info: () => Promise<string>
  /** Raw 64 KB of emulated VRAM. */
  dumpVram: () => Promise<Uint8Array>
  /** Raw 512 bytes of emulated CGRAM (256 × u16 LE BGR-15). */
  dumpCgram: () => Promise<Uint8Array>
  /**
   * Loads the requested translevel ID by stomping WRAM directly from the
   * harness Lua ($7E:021A level slot, $7E:038C $00 load-type, $7E:0118
   * $0C gamemode), then blocking until gm$0F is stable. Returns
   * "OK 0xXX frames=N boot=N warp=N\n<state-dump>" on success,
   * "TIMEOUT 0xXX gm=0xYY ..." if the load chain didn't reach gm$0F
   * within 600 frames. Works on the byte-identical-to-reference build —
   * no in-cart hook required.
   *
   * Pass `warps` to chain N sub-room loads after the main level: Lua
   * synthesizes a 4-byte screen-exit record at $7F:7E00 per warp and
   * re-enters gm$0C with the warp flag set, so the cart loads each
   * destination as if Yoshi had taken a warp from the prior level.
   * Use for sub-rooms reachable only via a chain of warps from the
   * root world-map slot.
   *
   * Pass `inventory` ({ eggs, keys }, sum ≤ 6) to seed Yoshi's egg trail
   * before the load — main maps the counts to sprite IDs and the harness
   * writes them into the cart's between-level inventory snapshot. Default: empty.
   */
  loadLevel: (
    translevelId: number,
    warps?: ReadonlyArray<BizhawkWarp>,
    inventory?: TestInventory
  ) => Promise<string>
  /**
   * Read `len` bytes from BizHawk memory `domain` ("WRAM" / "CARTRAM" /
   * "VRAM" / "CGRAM" / "OAM" / "CARTROM"), starting at `addr` (the offset
   * within the domain — NOT a 24-bit SNES address). Used by verification
   * flows that need to inspect arbitrary engine state post-load.
   */
  readMem: (domain: string, addr: number, len: number) => Promise<Uint8Array>
  /**
   * Write `bytes` into BizHawk memory `domain` ("WRAM" / "CARTRAM" / "CGRAM" /
   * …) starting at `addr` (the offset within the domain — NOT a 24-bit SNES
   * address). The generic counterpart of `readMem` — the editor's pathway to
   * edit the RUNNING game's memory without a rebuild. Boots EmuHawk if not
   * running (like `readMem`); reply is "OK <n>". Live-edit pushes that must NOT
   * boot go through `applyPaletteLive`, which gates on `isRunning` first.
   */
  writeMem: (domain: string, addr: number, bytes: Uint8Array) => Promise<string>
  /** Whether the managed EmuHawk subprocess is currently running + connected.
   *  Lets callers push live edits only when there's something to push to. */
  isRunning: () => Promise<boolean>
  /**
   * Apply the unsaved palette color edits to the screen the RUNNING emulator is
   * showing now (level / world map / title / …, detected from live state), with NO
   * rebuild. Writes ONLY the edited entries plus `revertOffsets` (offsets undone or
   * reset since the last sync, written back to base) — nothing else is touched.
   * Per-screen only (the master blob is read-only ROM); no-ops WITHOUT booting when
   * EmuHawk isn't running.
   */
  applyPaletteLive: (edits: PaletteEdit[], revertOffsets: number[]) => Promise<PaletteLiveResult>
  /**
   * Teleport BizHawk's camera + Yoshi to (x, y) pixel coords, settle
   * for ~60 frames so the game's camera-smoothing converges to our
   * target, then capture. Programmatic primitive — no UI button.
   */
  captureAt: (
    x: number,
    y: number
  ) => Promise<CaptureAtResult>
  /** Spawn the selected emulator if not running. Cold boot — no savestate. */
  launch: () => Promise<void>
  /** Force-stop the managed emulator subprocess(es). */
  stop: () => Promise<void>
}

/** Emulator selection + locate (BizHawk / Mesen). Which backend the `bizhawk.*`
 *  control methods drive, plus the toolbar's located-status source of truth. */
export interface EmulatorAPI {
  /** Selected backend + each backend's located status (drives the toolbar's two
   *  Locate buttons, then Launch / Test Level once the selected one is located). */
  getState: () => Promise<EmulatorState>
  /** Switch the selected backend (the right-click menu). Persisted. */
  setKind: (kind: EmulatorKind) => Promise<EmulatorState>
  /** Open a file picker to choose the given backend's executable, persist it, and
   *  select that backend (locating one selects it). */
  locate: (kind: EmulatorKind) => Promise<LocateEmulatorResult>
}

export interface RenderAPI {
  map16Gallery: (args: RenderMap16Args) => Promise<RenderImage>
  vramGrid: (args: RenderVramArgs) => Promise<RenderImage>
  /** PNG previews (data URLs) of the special markup glyphs for the Message-Text
   *  keyboard, decoded from the static 1bpp message font. */
  messageFontGlyphs: () => Promise<MessageGlyphPreview[]>
  gfxFiles: (args: RenderGfxFilesArgs) => Promise<GfxFilesResult>
  /** The level's gfx-file manifest — which compressed files scene_gfx_layout
   *  loads into VRAM (file id, layer via dpSlot, VRAM offset, format, size).
   *  Manifest only, no pixels. Pass `override` to track live header edits. Null
   *  for empty/special slots. Backs the Tiles "Header" tab. */
  gfxManifest: (req: LevelRenderRequest) => Promise<GfxFileEntry[] | null>
  /** Decoded BG1 layer. Returns a discriminated `full | patch` response (Tier 2
   *  incremental re-render): `full` repaints the renderer's backing canvas;
   *  `patch` carries only the changed cells to overwrite. Pass `baseToken` (the
   *  token of the state the backing canvas currently shows) to opt into patches.
   *  Null for empty/special slots. */
  bg1Layer: (req: LevelRenderRequest) => Promise<Bg1LayerResponse | null>
  /** Static enemy-sprite layer (tier-1 OAM pixel render). Tier-2 incremental
   *  (same model as bg1): a FULL-extent RGBA the renderer repaints its backing
   *  canvas with, or a sparse PATCH of only the changed 16×16 cells. Each
   *  Format-B-cel sprite is composited at its placed position; sprites without a
   *  cel are absent here (the canvas's vector-glyph overlay draws them). `bounds`
   *  (per-num click area) rides both modes. Null for empty/special slots. */
  spriteLayer: (req: LevelRenderRequest) => Promise<SpriteLayerResponse | null>
  /** Live 512-byte CGRAM for the level. Null for empty/special slots. */
  cgram: (req: LevelRenderRequest) => Promise<Uint8Array | null>
  /** Palette-color editing: CGRAM (overlay-patched) + per-entry blob
   *  provenance + the project's current palette edits. Null for empty/special. */
  editablePalette: (req: LevelRenderRequest) => Promise<DecodedPalette | null>
  /** Whole-game palette catalog (the Palette panel's "All Palettes" tab): every
   *  selectable master-blob palette by pointer table + by scene, each swatch
   *  carrying its blob offset for the shared global-edit model. Cart-static (no
   *  per-level args). Null if the built ROM/symbols are unavailable. */
  paletteCatalog: () => Promise<PaletteCatalog | null>
  /** Composited 512×256 overworld terrain image for one world (0-based) — the
   *  World Map panel's Yoshi-path preview (BG3 ground ⊕ BG2 scenery ⊕ BG1
   *  path/markers, honouring unbuilt gfx-live edits). Cart-static per world.
   *  Null when the built ROM/symbols are unavailable. */
  worldMapTerrain: (world: number) => Promise<RenderImage | null>
  decodeLevelLayout: (req: LevelRenderRequest) => Promise<DecodedLevelLayout | null>
  /** Paint tool — forward-fit a painted height curve to std objects. The corners
   *  are interpolated into slope lines, decomposed into a representable staircase,
   *  and returned as the objects that draw the surface (added to the level by the
   *  caller). The `tileset` (paint panel) picks the object palette. */
  fitSurface: (req: FitSurfaceRequest) => Promise<LevelObject[]>
  /** Paintable tilesets (those with fit-metadata) for the paint panel's selector. */
  fitTilesets: () => Promise<FitTileset[]>
  /** Pick the stock sprite tileset (header[7]) that best covers the given placed
   *  sprites' graphics. `spriteNums` are the level's sprite ids. */
  fitSpriteset: (spriteNums: number[]) => Promise<FitSpritesetResult>
  /** The level's distinct Map16 blocks (usage count, VRAM-coverage health,
   *  palette rows) + a composite thumbnail — the Tiles "Used" view. Pass
   *  `override` so it tracks live edits. Null for empty/special slots. */
  levelTileUsage: (req: LevelRenderRequest) => Promise<LevelTileUsage | null>
  /** Object-drag cell-highlight: per-cell provenance classes for ONE object,
   *  decoded from `override` at its pending position. Drag-transient (no
   *  patching). Null for empty/special slots. */
  objectInfluence: (req: ObjectInfluenceRequest) => Promise<DecodedObjectInfluence | null>
  /** Per-object drawn-tile footprints (which cells each object stamps, visible +
   *  overwritten) for the editor's drawn-tiles hit-testing. Pass `override` so it
   *  tracks live edits; cached main-side on the object-state token. */
  objectCells: (req: LevelRenderRequest) => Promise<ObjectCellsResponse | null>
  /** Picker render-validity: per std/ext-object verdicts under this level's
   *  header (each candidate probe-decoded alone main-side, cached per
   *  gfx-header tuple) plus the level's 6 variable spriteset file ids for the
   *  renderer-local sprite check (lib/sprite-render-validity). Pass `override`
   *  so live header edits are honoured. Null for empty/special slots. */
  entityRenderValidity: (req: EntityValidityRequest) => Promise<EntityRenderValidity | null>
  /** Picker thumbnails (§B5): per-catalog-entry bitmaps under this level's
   *  header — objects probe-decoded alone with their stamped cells blitted,
   *  sprites via the static cel pipeline (parity-0 variant). One tab per call:
   *  `candidates` (objects) or `spriteNums` + cel-gate sets. An absent key has
   *  no faithful bitmap (no-visual object / glyph-tier sprite) — keep the
   *  text-only row. Cached main-side per gfx-header tuple. Null for
   *  empty/special slots. */
  pickerThumbnails: (req: PickerThumbnailsRequest) => Promise<PickerThumbnails | null>
  bgLayers: (req: LevelRenderRequest) => Promise<BgLayersResult | null>
  /** Collision overlay. Returns a `full | patch` response (Tier 2). Collision
   *  pixels are tileset-independent, so a patch is valid for any same-level edit
   *  (the grid diff captures every decode change). Null for empty/special slots. */
  collisionLayer: (req: LevelRenderRequest) => Promise<CollisionLayerResponse | null>
  collisionTable: () => Promise<CollisionTableResult>
  /** 256-byte standard-object property table (low 2 bits = size-encoding flag).
   *  Per-cart static; cache once renderer-side. */
  objectPropertyTable: () => Promise<Uint8Array>
}

/** Generic editable-resource load/save (the registry). The level editor and
 *  all new tools (strings, …) load and save through this. */
export interface EditorAPI {
  /** Load a resource's model. `{kind:'level'}` resolves to `LevelData`; other
   *  kinds return `unknown` (the caller narrows). */
  loadResource(resource: { kind: 'level'; recordId: number }): Promise<LevelData>
  loadResource(resource: { kind: 'world-map' }): Promise<WorldMapModel>
  loadResource(resource: { kind: 'world-map-paths' }): Promise<WorldMapPathsModel>
  loadResource(resource: { kind: 'yoshi-colors' }): Promise<YoshiColorsModel>
  loadResource(resource: { kind: 'music-sets' }): Promise<MusicSetsModel>
  loadResource(resource: EditableResource): Promise<unknown>
  /** Per-sprite-type computed read-only properties (Properties panel) — `[]` for
   *  a sprite type with no provider. */
  spriteProperties: (req: SpritePropertiesRequest) => Promise<SpriteProperty[]>
  /** Persist a resource's model into the active project's overlay. */
  saveResource: (
    resource: EditableResource,
    model: unknown
  ) => Promise<SaveResourceResult>
  /** The saved overlay's palette-color edit set (the usePaletteEditor baseline). */
  loadPaletteEdits: () => Promise<PaletteEdit[]>
  /** Persist the full palette-color edit set (offset → value) to the project
   *  overlay (Bank57.asm). Caller marks the build dirty on success. */
  savePaletteEdits: (edits: PaletteEdit[]) => Promise<SaveResourceResult>
  /** The saved overlay's backdrop-gradient stop edits (the useGradientEditor baseline). */
  loadGradientEdits: () => Promise<GradientEdit[]>
  /** Persist the full gradient stop edit set to the project overlay (Bank57.asm).
   *  Caller marks the build dirty on success. */
  saveGradientEdits: (edits: GradientEdit[]) => Promise<SaveResourceResult>
  /** The 16×24 pristine base gradient colors (BackgroundColor $10..$1F × 24 stops);
   *  the panel overlays the live draft on these for display. */
  gradientBaseColors: () => Promise<number[][]>
  /** Live byte-budget for a level's shared bank pool(s) — drives the editor's
   *  warn-on-save / block-on-build surfaces. Null when there's no pool map yet
   *  (unbuilt cart) or the level has no editable streams (empty/special). */
  levelBudget: (levelRecordId: number, level: LevelData) => Promise<PoolBudgetReport | null>
  /** Cross-pool byte-budget overview for the "Banks" panel: every level-data
   *  bank pool with its capacity/headroom/used/free totals and per-level
   *  breakdown, plus the free regions levels can migrate into. Pass the active
   *  (being-edited) level so its blobs reflect live unsaved sizes (null = on-disk
   *  sizes only). Null pre-build. */
  poolOverview: (
    activeLevelRecordId: number | null,
    activeLevel: LevelData | null
  ) => Promise<PoolOverview | null>
  /** Active free-space migration + de-couple state (hex level ids). Drives the
   *  Banks panel's migrate/return + de-couple controls. */
  getRelocationState: () => Promise<RelocationState>
  /** Migrate a level into / out of a free region. Persists to project.json;
   *  returns the updated state. The renderer marks the build dirty. */
  setLevelRelocation: (levelRecordId: number, relocated: boolean) => Promise<RelocationState>
  /** De-couple / re-couple a biased-sprite level (0x19/0xCB) — materialise its
   *  own sprite blob + repoint. Persists; returns the updated state. */
  setLevelDecoupled: (levelRecordId: number, decoupled: boolean) => Promise<RelocationState>
  /** Reset a level to base: delete its overlay `.bin`(s). The renderer reloads
   *  the level afterwards (and rebuilds when `removed`). */
  resetLevel: (levelRecordId: number) => Promise<ResetLevelResult>
  /** Save an edited graphics blob: re-encode the decompressed `tiles` → overlay
   *  blob (the build's reinsert pipeline places it). `rowCount` (lz16 tile-rows)
   *  is required for lz16. The renderer marks the build dirty on success. */
  saveGfxEdit: (
    format: 'lz2' | 'lz16',
    fileId: number,
    tiles: Uint8Array,
    rowCount?: number
  ) => Promise<SaveGfxEditResult>
  /** Discard a saved graphics edit: delete its overlay blob so the next build
   *  reads base. `removed` reports whether one existed (→ rebuild). */
  resetGfxEdit: (format: 'lz2' | 'lz16', fileId: number) => Promise<ResetGfxEditResult>
  /** Every graphics file the active project has overlay-edited (compressed blobs
   *  + raw animation CHR) — the "Changed graphics" list in the Graphics panel. */
  listGfxEdits: () => Promise<GfxEditEntry[]>
  /** What a changed graphics file maps back to — its role(s) across the cart
   *  (BG1/BG2/sprite/title screen…); the expandable detail for the list. */
  gfxFileRole: (file: string) => Promise<GfxFileRole>
  /** Reset one overlay-edited graphics file (a `listGfxEdits` `file` path) back to
   *  vanilla. The renderer marks the build dirty when `removed`. */
  resetGfxEditFile: (file: string) => Promise<ResetGfxEditResult>
  /** Export the current level's gfx files to a chosen folder as PNGs + manifest
   *  (folder picked via a native dialog). Writes the faithful tile sheets, the
   *  metasprite "meta" view (sprites), the metatile "meta" view (Map16 object
   *  blocks), and view-only object previews — see `ExportGfxOptions`. `canceled`
   *  if dismissed. */
  exportGfxPngs: (
    header: RenderHeaderRequest | null, // null ⇒ no level loaded; only the screens track exports
    opts?: ExportGfxOptions
  ) => Promise<ExportGfxResult>
  /** Export a BG layer region (BG1 = the selected level area; BG2/BG3 = the whole
   *  rendered tilemap) to a PNG + sidecar in a chosen folder. `canceled` if
   *  dismissed. */
  exportBgRegion: (
    header: RenderHeaderRequest,
    args: BgRegionExportArgs
  ) => Promise<BgRegionExportResult>
  /** Import edited BG region(s) from a chosen folder (slice → saveGfxEdit; only
   *  changed files are saved). The renderer marks the build dirty when
   *  `applied > 0`. Also remembers the folder (listRegionExports). */
  importBgRegion: () => Promise<BgRegionImportResult>
  /** The located Aseprite (saved → common install locations) + its probed version,
   *  or null when not located. The Graphics panel gates its tilemap-export option on
   *  `supportsTilemap` (tilemap `.aseprite` files need Aseprite 1.3+). */
  getAsepriteExe: () => Promise<AsepriteInfo | null>
  /** Pick the Aseprite executable and persist it to settings. */
  locateAseprite: () => Promise<LocateAsepriteResult>
  /** Open an exported `.M1` session (`dir/file`) in the bundled M1TE editor, opened
   *  straight to BG layer `bg` (2 or 3). Windows-native or via Wine on Linux. Returns
   *  false if the bundled exe or the file is missing (or the launch fails). */
  openInM1te: (dir: string, file: string, bg?: 1 | 2 | 3) => Promise<boolean>
  /** The `.M1` session files in an export folder (each with its BG layer), for the
   *  clickable "open in M1TE" list under each folder. */
  listM1Files: (dir: string) => Promise<M1ExportFile[]>
  /** The saved YY-CHR executable path, or null when not located (settings-only —
   *  YY-CHR is portable, no standard install dir). */
  getYychrExe: () => Promise<string | null>
  /** Pick the YY-CHR executable and persist it to settings. */
  locateYychr: () => Promise<LocateYychrResult>
  /** Open an exported raw CHR sheet (`dir/file`) in YY-CHR (the extension
   *  auto-selects the format). Windows-native or via Wine. Returns false if
   *  YY-CHR isn't located or the file is missing (or the launch fails). */
  openInYychr: (dir: string, file: string) => Promise<boolean>
  /** The YY-CHR tab's browse state: the project folder's manifest rows + per-sheet
   *  change status (`exported: false` = no export in this project yet). */
  yychrProjectState: () => Promise<YychrProjectState>
  /** Export the whole-cart yychr track into the project's fixed `yychr/` folder
   *  (no dialog; the folder is owned by the YY-CHR tab, not the extract list). */
  yychrExportProject: () => Promise<YychrProjectExportResult>
  /** Import edited sheets from the project folder — `files` = folder-relative paths
   *  for a per-file import, null = everything. Advances imported sheets' stored
   *  checksums so their changed status clears. */
  yychrImportProject: (files: string[] | null) => Promise<YychrProjectImportResult>
  /** Sheet thumbnails rendered from the ON-DISK bytes, one batch per IPC round
   *  trip (a null thumb: missing file or the Mode-7 tilemap, which isn't pixel
   *  art). The tab fetches in chunks and caches content-addressed. */
  yychrThumbnails: (files: string[]) => Promise<YychrThumbnailEntry[]>
  /** The M1TE Maps tab's browse state — the yychr-state twin over the project's
   *  fixed `m1te/` folder of `.M1` map sessions. */
  m1teMapsState: () => Promise<M1teMapsState>
  /** Export every fixed `.M1` map surface (overworlds + icons + tilemap screens)
   *  into the project's `m1te/` folder (no dialog; the tab owns the folder). */
  m1teMapsExport: () => Promise<M1teMapsExportResult>
  /** Import edited `.M1`s from the project folder — `files` = folder-relative paths
   *  for a per-file import, null = everything changed. Advances cleanly-imported
   *  files' stored checksums so their changed status clears. */
  m1teMapsImport: (files: string[] | null) => Promise<M1teMapsImportResult>
  /** `.M1` thumbnails composed from the ON-DISK bytes (slots back-to-front), one
   *  batch per IPC round trip; null = missing/invalid file. */
  m1teMapsThumbnails: (files: string[]) => Promise<YychrThumbnailEntry[]>
  /** The Misc Art tab's browse state — the project-folder twin for the
   *  PNG/Aseprite image tracks over the project's fixed `artwork/` folder. */
  artworkState: () => Promise<GfxProjectState>
  /** Export the level-independent image tracks (world map, system screens,
   *  bosses, fonts) into the project's `artwork/` folder in the chosen format. */
  artworkExport: (format: ArtworkFormat) => Promise<GfxProjectExportResult>
  /** Import edited artwork from the project folder — `files` = folder-relative
   *  paths for a per-file import, null = everything changed. Advances
   *  cleanly-imported files' stored checksums so their changed status clears. */
  artworkImport: (files: string[] | null) => Promise<GfxProjectImportResult>
  /** Thumbnails decoded from the ON-DISK bytes (PNG or flattened `.aseprite`),
   *  one batch per IPC round trip; null = missing/invalid file. */
  artworkThumbnails: (files: string[]) => Promise<YychrThumbnailEntry[]>
  /** Folders this project has exported region(s) to (most-recent first) — the
   *  Region tab lists them with per-folder import / remove. */
  listRegionExports: () => Promise<string[]>
  /** Forget a tracked export folder (does not delete files). Returns the new list. */
  removeRegionExport: (dir: string) => Promise<string[]>
  /** Reveal a tracked export folder in the OS file manager. */
  openRegionFolder: (dir: string) => Promise<void>
  /** Import a specific tracked folder (no dialog) — same slice + log as importBgRegion. */
  importRegionFolder: (dir: string) => Promise<BgRegionImportResult>
  /** Unified import (dialog): auto-detect the all-graphics manifest AND/OR BG-region
   *  files in a chosen folder, import both, merge into one log. */
  importGraphics: () => Promise<ImportGraphicsResult>
  /** Unified import of a specific tracked folder (no dialog). */
  importGraphicsFolder: (dir: string) => Promise<ImportGraphicsResult>
  /** Structured Map16 block editor. Load a block's 4 sub-tiles (overlay edit or
   *  vanilla base; null if not an editable block); save/reset them (post-build
   *  byte patch — renderer marks the build dirty); list edited ids; render a 16×16
   *  live preview from a set of sub-tiles. */
  loadMap16Block: (map16Id: number) => Promise<Map16SubTileEdit[] | null>
  saveMap16Block: (
    map16Id: number,
    subtiles: Map16SubTileEdit[]
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  resetMap16Block: (map16Id: number) => Promise<{ ok: true; removed: boolean } | { ok: false; error: string }>
  listMap16BlockEdits: () => Promise<number[]>
  renderMap16Block: (
    header: RenderHeaderRequest,
    subtiles: Map16SubTileEdit[]
  ) => Promise<Map16BlockPreview | null>
  /** Dry-run impact of removing vanilla levels (validated set, world-map
   *  slots, freed bytes, stranded incoming warps) — drives the confirm dialog. */
  removeLevelsPreview: (recordIds: number[]) => Promise<RemovalPreviewResult>
  /** Remove vanilla levels from the game: world-map slots marked unused +
   *  unlocks self-redirected, project `removedLevels` flagged (build repoints
   *  the `Ptrs:` rows + frees the pool bytes), overlay `.bin`s cleared. The
   *  renderer refreshes the catalog/pools and marks the build dirty. */
  removeLevels: (recordIds: number[]) => Promise<RemoveLevelsResult>
  /** The "remove all vanilla" candidate set + the kept-level breakdown. */
  removableVanillaLevels: () => Promise<RemovableVanillaLevels | { error: string }>
  /** The active project's removed levels (with best-effort names) — feeds the
   *  Banks panel's "Restore levels" modal. */
  removedLevels: () => Promise<RemovedLevelEntry[]>
  /** Restore removed levels: re-wire their base world-map slots and clear the
   *  `removedLevels` flags (the next build brings the data back from base).
   *  The renderer refreshes the catalog/pools and marks the build dirty. */
  restoreLevels: (recordIds: number[]) => Promise<RestoreLevelsResult>
  /** Pointer slots a new level can be created in (free sentinel rows +
   *  removed records) — feeds the Banks panel's "Create Level" modal. */
  creatableSlots: () => Promise<CreatableSlot[]>
  /** Create a blank level in a free pointer slot and point the slot at it
   *  (sentinel: new-slot placement; removed: restore around the new data).
   *  The renderer refreshes the catalog, marks the build dirty, and jumps in. */
  createLevel: (recordId: number) => Promise<CreateLevelResult>
  /** Cross-level warp-exit destination edit (incoming-marker drag, §A8 #8.5):
   *  set the warp exit on `screenIndex` in `sourceLevelRecordId` to land at
   *  (destX, destY) and write that level's overlay (auto-save). The renderer
   *  marks the build dirty + refreshes the incoming markers, and keeps a
   *  reversible undo entry. */
  setExitDest: (
    sourceLevelRecordId: number,
    screenIndex: number,
    destX: number,
    destY: number
  ) => Promise<SetExitDestResult>
  /** Cross-level warp-exit entrance-type edit (incoming-marker Entrance dropdown):
   *  set the warp exit on `screenIndex` in `sourceLevelRecordId` to apply
   *  `entranceType` on arrival and write that level's overlay (auto-save). The
   *  renderer marks the build dirty and keeps a reversible undo entry. */
  setExitEntrance: (
    sourceLevelRecordId: number,
    screenIndex: number,
    entranceType: number
  ) => Promise<SetExitEntranceResult>
}

export interface ShinyEggAPI {
  getPathForFile: (file: File) => string
  identifyCart: (cartPath: string) => Promise<CartIdentification>
  getExtractionState: () => Promise<ExtractionState | null>
  /** Out-of-date-extract check — stale pipeline version or a missing output
   *  (e.g. levels.json). 'stale' ⇒ the UI should prompt a re-extract. */
  getExtractFreshness: () => Promise<ExtractFreshness>
  extract: (args: FrameworkExtractArgs) => Promise<ExtractResult>
  build: () => Promise<BuildResult>
  /** Report whether the editor holds unsaved changes, so the main process can
   *  confirm before the window closes (quit guard). Fire-and-forget. */
  setUnsavedChanges: (unsaved: boolean) => void
  /** App version string (from package.json) — shown in the About dialog. */
  getAppVersion: () => Promise<string>
  getLevelsCatalog: () => Promise<LevelsCatalog | null>
  onFrameworkProgress: (cb: (msg: string) => void) => () => void
  settings: SettingsAPI
  projects: ProjectsAPI
  editor: EditorAPI
  render: RenderAPI
  bizhawk: BizHawkAPI
  emulator: EmulatorAPI
  debug: DebugAPI
  patches: PatchesAPI
  importRom: ImportRomAPI
  importGba: ImportGbaAPI
  validation: ValidationAPI
  audio: AudioAPI
}

/** Audio panel: browse/audition the built ROM's music + SFX (synthesized
 *  .spc → the in-editor SPC player), decode sequence/SFX timelines for the
 *  inspector tabs, and drive the per-project export folder — export-all,
 *  base-aware sample import, and song import, the panel's overlay-write
 *  paths (each says when to mark the build dirty).
 *  See research/plan-audio-panel.md. */
export interface AudioAPI {
  /** Music settings + song slots + SFX names over the built ROM. */
  catalog: () => Promise<AudioCatalogResult>
  /** Per-music-set ARAM section usage (sequence window, sample space,
   *  directory slots, instrument rows) — the Songs-tab usage diagram.
   *  Overlay-aware: an imported song changes the picture without a rebuild. */
  aramUsage: () => Promise<AudioAramUsageResult>
  /** Synthesize a playable .spc for a (setting, song slot) — the bytes the
   *  in-editor SPC player consumes. */
  composeSongSpc: (setting: number, songSlotId: number) => Promise<AudioComposeSpcResult>
  /** Synthesize a playable .spc that fires one SFX (engine + global bank
   *  baseline, port-3 poke; the engine accepts ids 0x01-0xBF). */
  composeSfxSpc: (id: number) => Promise<AudioComposeSpcResult>
  /** Synthesize a playable .spc for an explicit block-row (the Edit Song
   *  Sets tab's ▶ — auditions the DRAFT row composition, unsaved edits
   *  included; module contents come from the current build + overlays). */
  composeRowSpc: (blockIds: number[], songSlotId: number) => Promise<AudioComposeSpcResult>
  /** Decode + expand one song into the Sequence inspector's timed timeline. */
  decodeSong: (setting: number, songSlotId: number) => Promise<AudioDecodeSongResult>
  /** Decode + expand one SFX (its full remap chain, each script on its
   *  assigned voice lane) into the same timeline shape. */
  decodeSfx: (id: number) => Promise<AudioDecodeSongResult>
  /** The fixed per-project export folder's contents (`<projectRoot>/audio/`). */
  exportState: () => Promise<AudioExportStateResult>
  /** The one-button export: every SFX script as editable MML .txt into
   *  `<exportDir>/sfx/`, plus every BRR sample (raw .brr + decoded .wav)
   *  into `<exportDir>/samples/<Bank>/` with the import manifest
   *  (checksums + loop metadata). */
  exportAll: () => Promise<AudioExportRunResult>
  /** Base-aware import of edited sample .wavs: unchanged files skip (stale
   *  overrides revert to base bytes), edited ones re-encode to BRR in the
   *  project overlay. Mark the build dirty when imported+reverted > 0. */
  importSamples: () => Promise<AudioImportResult>
  /** Read one exported file's bytes back for in-editor playback (sample
   *  .wav rows; SFX rows synthesize via composeSfxSpc instead). */
  readExportedSpc: (rel: string) => Promise<AudioComposeSpcResult>
  /** Open the export folder in the OS file manager (creates it if needed). */
  openExportFolder: () => Promise<void>
  /** Scan `<projectRoot>/audio/import/` (created on first scan): YI-driver
   *  .spc files, each with its candidate songs, plus the 12 replaceable
   *  target modules. `dropStaccatoToFit` (default false) authorizes the
   *  over-budget retry without the AMK light-staccato note+tie splits;
   *  `useSmwSamples` (default false) carries the packaged real SMW samples
   *  for AMK stock instruments; `noEcho` (default false) strips echo from
   *  compiled imports and claims the echo buffer as extra room (budgets
   *  reflect it per target). */
  songImportState: (downsampleToFit?: boolean, dropStaccatoToFit?: boolean, useSmwSamples?: boolean, noEcho?: boolean) => Promise<AudioSongImportStateResult>
  /** Synthesize a try-out .spc for one (file, source slot, target module)
   *  pick — the target set's baseline with the imported song spliced in.
   *  No ROM write. `targetSlotId` (MML only) merges into that one slot,
   *  preserving the module's other songs; null/omitted replaces the whole
   *  module. */
  previewSongImport: (
    rel: string,
    sourceSlot: number,
    targetBlockId: number,
    downsampleToFit?: boolean,
    dropStaccatoToFit?: boolean,
    useSmwSamples?: boolean,
    noEcho?: boolean,
    targetSlotId?: number | null
  ) => Promise<AudioSongImportPreviewResult>
  /** Import the song into the project: write the extracted module as the
   *  target's overlay blob (budget-gated; the build's audio layout pass
   *  re-fits the region). Mark the build dirty on ok. `targetSlotId` as in
   *  previewSongImport. */
  importSong: (
    rel: string,
    sourceSlot: number,
    targetBlockId: number,
    downsampleToFit?: boolean,
    dropStaccatoToFit?: boolean,
    useSmwSamples?: boolean,
    noEcho?: boolean,
    targetSlotId?: number | null
  ) => Promise<AudioSongImportRunResult>
  /** Remove an imported song (delete the overlay blob — the next build
   *  reconciles the region back). Mark the build dirty on ok. */
  revertSongImport: (targetBlockId: number) => Promise<AudioSongImportRunResult>
  /** Delete one song slot from a module to free its bytes (the slot plays
   *  silence until restored/re-imported); reversible with restoreSong. Mark
   *  the build dirty on ok. */
  deleteSong: (targetBlockId: number, slot: number) => Promise<AudioSongImportRunResult>
  /** Restore a previously-deleted song slot from the pristine module asset. */
  restoreSong: (targetBlockId: number, slot: number) => Promise<AudioSongImportRunResult>
}

/** Level validation — the decode side of the Validation panel. The check logic
 *  is renderer-side (`lib/validation.ts`); these calls only run the object
 *  decoder main-side and return the decode-derived signals the renderer can't
 *  compute itself (page-pool count/overflow, abort flag, screen→page map). */
export interface ValidationAPI {
  /** Decode signals for one (possibly-edited) level — via the override decode
   *  path, so it reflects unsaved edits. */
  signals: (level: LevelData) => Promise<LevelDecodeSignals>
  /** Level data + signals for every backed record, for the all-levels sweep. */
  allLevels: () => Promise<LevelValidationInput[]>
}

/** Import data from a modified/built third-party ROM into the active project as
 *  overlays. Two-step: analyse (a picked `.sfc` diffed
 *  against the extracted V1.0 base → report) then apply the selected records.
 *  Applied edits overwrite the project's overlay; the caller marks the build
 *  dirty. */
export interface ImportRomAPI {
  /** Open a file picker, choose a modified ROM, and analyse it. Returns the diff
   *  report (anchors + changed levels + overwrite warnings), or null when the
   *  dialog is cancelled. */
  analyze: () => Promise<RomImportReport | null>
  /** Apply the selected changed records into the active project's overlay. */
  apply: (selection: RomImportSelection) => Promise<RomImportApplyResult>
}

/** Import levels from the GBA version (Super Mario Advance 3). Two-step: analyse
 *  (pick an SMA3 (U) `.gba` cart → its importable sublevels) then apply
 *  (overwrite chosen SNES records with chosen GBA sublevels). SMA3 is a port of
 *  YI, so the conversion is near-1:1 (camera sprites + a few custom objects are
 *  dropped). Applied edits overwrite the project's overlay; the caller marks the
 *  build dirty. */
export interface ImportGbaAPI {
  /** Open a file picker, choose an SMA3 (U) GBA cart, and enumerate its
   *  importable sublevels. Returns null when the dialog is cancelled. */
  analyze: () => Promise<GbaImportReport | null>
  /** Overwrite the selected SNES records with their chosen GBA sublevels. */
  apply: (selection: GbaImportApplySelection) => Promise<GbaImportApplyResult>
}

/** Debug-only helpers (not part of the normal editing flow). */
export interface DebugAPI {
  /** Every (level, cell position) where an object/sprite id appears, from the
   *  static base-cart index TSVs. `idHex` is hex without `0x`. */
  findInstances: (kind: FindInstanceKind, idHex: string) => Promise<ObjectInstance[]>
}

/** Custom patches — per-project local patches (toggle on/off) plus the editor's
 *  prepackaged catalog (added into a project on demand). Applied to the finished
 *  ROM after the build, so every mutating call requires an active project and
 *  changes what the next build produces; the caller marks the build dirty. */
export interface PatchesAPI {
  /** The active project's local patches in stable list order (top → bottom =
   *  apply order), independent of enabled state. */
  listProject: () => Promise<PatchSummary[]>
  /** The prepackaged catalog, each flagged whether it's already in the project. */
  listPrepackaged: () => Promise<PrepackagedPatch[]>
  /** Copy a prepackaged patch into the active project (does not enable it). */
  add: (builtinId: string) => Promise<PatchMutationResult>
  /** Pick `.ips` / `.bps` / `.asm` file(s) via a dialog and import them into the
   *  active project (does not enable them). Empty array when the dialog is
   *  cancelled. */
  import: () => Promise<PatchImportResult[]>
  /** Create a new self-documenting template patch in the active project (all valid
   *  fields with sample data; disabled, so the user edits then enables it). */
  newTemplate: () => Promise<PatchImportResult>
  /** Enable/disable a project patch (list order is unaffected). */
  setEnabled: (id: string, enabled: boolean) => Promise<PatchMutationResult>
  /** Set the project's patch order (top → bottom = apply order). Enabled state is
   *  preserved; the relative order of enabled patches drives last-wins on overlap. */
  reorder: (ids: string[]) => Promise<PatchMutationResult>
  /** Remove a patch from the project (delete its file + de-list). */
  remove: (id: string) => Promise<PatchMutationResult>
  /** The active project's asm-patch pool size (KB) + selectable bounds. */
  getPatchPool: () => Promise<PatchPoolSettings>
  /** Set the active project's asm-patch pool size (KB, clamped). Changes the build
   *  layout, so the caller marks the build dirty. */
  setPatchPoolKB: (kb: number) => Promise<PatchMutationResult>
  /** Resolve one project patch against the current build's symbols (label
   *  resolution + overlaps with other enabled patches). Null when unknown. */
  preview: (id: string) => Promise<PatchPreview | null>
  /** Open the active project's patches folder in the OS file manager. */
  openFolder: () => Promise<void>
  /** On-disk locations for hand-authoring patches: the framework asm source + the
   *  active project's build symbol files. For the patches-panel help. */
  authoringPaths: () => Promise<PatchAuthoringPaths>
  /** Open the asm-source (`'asm'`) or project-symbols (`'sym'`) folder. */
  openAuthoringFolder: (which: 'asm' | 'sym') => Promise<void>
}

declare global {
  interface Window {
    shinyEgg: ShinyEggAPI
  }
}
