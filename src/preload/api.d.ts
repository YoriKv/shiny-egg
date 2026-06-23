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
  LayerCellPatch,
  LevelData,
  LevelsCatalog,
  PaletteEdit,
  PoolBudgetReport,
  PoolOverview,
  SaveResourceResult,
  WorldMapEntrance,
  WorldMapMidwayEntrance,
  WorldMapModel
} from 'snes-framework/types'
import type { CollisionEntry } from 'snes-framework/collision'
import type {
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
  LocateBizhawkResult,
  LocateAsepriteResult,
  ObjectInfluenceRequest,
  ObjectInstance,
  OverlayDriftReport,
  OverlayUpgradeResult,
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
  RegionImportLogEntry,
  ExportGfxOptions,
  GfxExportTrack,
  ExportGfxResult,
  GfxEditEntry,
  GfxFileRole,
  ImportGraphicsResult,
  Map16BlockPreview,
  Map16SubTileEdit,
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
  AnchorMethod,
  AnchorResolution,
  Bg1RenderResult,
  BuildResult,
  EditableResource,
  ExtractFreshness,
  ExtractionState,
  ExtractResult,
  ForeignLevelDiff,
  GfxFileBlock,
  GfxFileEntry,
  GfxFilesResult,
  InventoryCategory,
  LayerCellPatch,
  LevelCatalogEntry,
  LevelCatalogGroup,
  LevelData,
  LevelImportability,
  LevelStreamCounts,
  LevelMap16Usage,
  LevelObject,
  LevelSprite,
  LevelsCatalog,
  Map16SubTileUsage,
  MessagePtrOption,
  MessagePtrTableModel,
  ObjectRenderVerdict,
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
  WorldMapEntrance,
  WorldMapMidwayEntrance,
  WorldMapModel
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
  LocateBizhawkResult,
  LocateAsepriteResult,
  PaintCorner,
  ObjectInfluenceRequest,
  ObjectInstance,
  OverlayDriftFile,
  OverlayDriftReport,
  OverlayUpgradeResult,
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
  RegionImportLogEntry,
  ExportGfxOptions,
  GfxExportTrack,
  ExportGfxResult,
  GfxEditEntry,
  GfxFileRole,
  ImportGraphicsResult,
  Map16BlockPreview,
  Map16SubTileEdit,
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
  SpritePropertiesRequest
} from '../shared/ipc-types'

// ── API surface (method-bearing; contract-only, no data analogue) ───────────

export interface SettingsAPI {
  get: () => Promise<Settings>
  set: (patch: Partial<Settings>) => Promise<Settings>
}

export interface ProjectsAPI {
  list: () => Promise<ProjectSummary[]>
  /** Current project, auto-creating the default `new-shiny-00` if none. */
  ensureCurrent: () => Promise<ProjectSummary>
  /** Create the next `new-shiny-NN` and make it current. */
  create: () => Promise<ProjectSummary>
  /** Make an existing project current (persisted across launches). */
  switch: (id: string) => Promise<ProjectSummary>
  info: (id: string) => Promise<ProjectInfo>
  /** Rename (moves the folder). Name: lowercase ascii + `-`/`_`, no spaces.
   *  Returns `{ ok:false, error }` on an invalid/taken name or a locked
   *  folder (e.g. open in Explorer) — never rejects. */
  rename: (id: string, newName: string) => Promise<ProjectRenameResult>
  /** Build the ROM and Save-As to a user-chosen `.sfc`. */
  export: (id: string) => Promise<ProjectExportResult>
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
   * Teleport BizHawk's camera + Yoshi to (x, y) pixel coords, settle
   * for ~60 frames so the game's camera-smoothing converges to our
   * target, then capture. Programmatic primitive — no UI button.
   */
  captureAt: (
    x: number,
    y: number
  ) => Promise<CaptureAtResult>
  /** Spawn EmuHawk if not running. Cold boot — no savestate. */
  launch: () => Promise<void>
  /** Force-stop the managed EmuHawk subprocess. */
  stop: () => Promise<void>
  /** Resolved EmuHawk.exe path — the saved location, then the dev fallback
   *  (`../bizhawk/EmuHawk.exe`), else null when BizHawk hasn't been located. */
  getExe: () => Promise<string | null>
  /** Open a file picker to choose EmuHawk.exe and persist it to settings. */
  locate: () => Promise<LocateBizhawkResult>
}

export interface RenderAPI {
  map16Gallery: (args: RenderMap16Args) => Promise<RenderImage>
  vramGrid: (args: RenderVramArgs) => Promise<RenderImage>
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
  /** Palette-colour editing: CGRAM (overlay-patched) + per-entry blob
   *  provenance + the project's current palette edits. Null for empty/special. */
  editablePalette: (req: LevelRenderRequest) => Promise<DecodedPalette | null>
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
  loadResource(resource: EditableResource): Promise<unknown>
  /** Per-sprite-type computed read-only properties (Properties panel) — `[]` for
   *  a sprite type with no provider. */
  spriteProperties: (req: SpritePropertiesRequest) => Promise<SpriteProperty[]>
  /** Persist a resource's model into the active project's overlay. */
  saveResource: (
    resource: EditableResource,
    model: unknown
  ) => Promise<SaveResourceResult>
  /** The saved overlay's palette-colour edit set (the usePaletteEditor baseline). */
  loadPaletteEdits: () => Promise<PaletteEdit[]>
  /** Persist the full palette-colour edit set (offset → value) to the project
   *  overlay (Bank57.asm). Caller marks the build dirty on success. */
  savePaletteEdits: (edits: PaletteEdit[]) => Promise<SaveResourceResult>
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
  /** Resolved Aseprite executable path (saved → common install locations), or null
   *  when not located. */
  getAsepriteExe: () => Promise<string | null>
  /** Pick the Aseprite executable and persist it to settings. */
  locateAseprite: () => Promise<LocateAsepriteResult>
  /** Open `dir/file` in Aseprite (the "Auto-Open Exports" toggle). Returns false
   *  if Aseprite isn't located or the file is missing. */
  openInAseprite: (dir: string, file: string) => Promise<boolean>
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
  /** Dev-only: path of the reference cart next to the project root, or null in
   *  packaged builds / when absent. Lets the extract UI pre-select it. */
  getDevReferenceCart: () => Promise<string | null>
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
  debug: DebugAPI
  patches: PatchesAPI
  importRom: ImportRomAPI
  importGba: ImportGbaAPI
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
  /** Pick `.ips` file(s) via a dialog and import them into the active project
   *  (does not enable them). Empty array when the dialog is cancelled. */
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
