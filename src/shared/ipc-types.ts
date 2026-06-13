// Single source of truth for the app-side IPC data shapes — request/result
// envelopes that cross the main ↔ renderer boundary. The main-process handlers
// (src/main/**) import these for their handler signatures; the preload bridge
// imports them for its method types; the renderer-facing contract
// (src/preload/api.d.ts) re-exports them so the renderer sees the same shapes.
//
// This file MUST stay free of Node-only AND DOM-only imports (no `node:fs`,
// `Buffer`, `process`, no `File`/`Window`) so BOTH tsconfigs can type-check it.
// Framework-owned shapes (LevelData, GfxFilesResult, Bg1RenderResult, …) live in
// `snes-framework/types`, not here — this module is for app/IPC concepts only.

import type {
  AnchorResolution,
  Bg1RenderResult,
  BgLayerDescriptor,
  ForeignLevelDiff,
  LayerCellPatch,
  LevelData,
  LevelObject,
  LevelMap16Usage,
  ObjectRenderVerdict,
  PaletteEdit,
  PatchSource,
  RomImportInventory,
  RomVersion,
  SpriteCelBounds
} from 'snes-framework/types'
import type { CollisionEntry } from 'snes-framework/collision'

// ── Cart lifecycle ──────────────────────────────────────────────────────────

export interface FrameworkExtractArgs {
  romVersion: RomVersion
  referenceCartPath: string
}

export interface CartIdentification {
  path: string
  md5: string
  romVersion: RomVersion | null
  supported: boolean
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  /** Folder id (under userData/projects) of the project the editor reopens
   *  on launch. Written whenever the user creates or switches projects. */
  lastProjectId?: string
  /** Absolute path to BizHawk's `EmuHawk.exe`, saved via the "Locate BizHawk"
   *  button. Until this is set (or, in dev, the `../bizhawk/EmuHawk.exe`
   *  fallback exists) the toolbar shows Locate instead of Launch / Test Level. */
  bizhawkPath?: string
}

/** Result of the `bizhawk:locate` file picker. `ok` + `path` on success;
 *  `ok:false` with no `error` = the user cancelled; `ok:false` + `error` = the
 *  pick was rejected (e.g. not EmuHawk.exe). */
export interface LocateBizhawkResult {
  ok: boolean
  path?: string
  error?: string
}

// ── BizHawk ─────────────────────────────────────────────────────────────────

/** One chained world-map → sub-room warp for `bizhawk.loadLevel`. After the
 *  picked translevel boots, the supervisor walks N of these in order (a deep
 *  sub-room may be reachable only by chaining several). All fields are 0..255. */
export interface BizhawkWarp {
  destLevelRecordId: number
  destX: number
  destY: number
  entranceType: number
}

/** `bizhawk.captureAt` result — a PNG screenshot of the emulator frame plus the
 *  supervisor's reply line. */
export interface CaptureAtResult {
  png: Uint8Array
  message: string
}

// ── Projects ────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  /** Folder name under userData/projects; stable id, equals `name` (rename
   *  moves the folder, keeping them in sync). */
  id: string
  /** Display name; identical to `id`. */
  name: string
  /** ISO timestamps. */
  createdAt: string
  modifiedAt: string
  /** RomVersion + cart MD5 of the base extraction this project is bound to —
   *  stamped at create (or lazily on first save). Lets us refuse saving an
   *  overlay against a mismatched base. */
  romVersion?: string
  cartMd5?: string
  /** Hex level record ids the user has migrated into free-space regions (e.g.
   *  `["0x7D"]`). Both the level's tracked obj/spr blobs relocate; the region is
   *  auto-assigned first-fit. Empty/absent = none. */
  relocations?: string[]
  /** Hex level record ids the user has de-coupled (biased-sprite levels `0x19`/
   *  `0xCB`) — materialise their own sprite blob + repoint, freeing their
   *  partner to migrate. Empty/absent = none. */
  decoupled?: string[]
  /** Hex record ids of NEW-SLOT levels (`0xDA`/`0xDB` — base sentinel rows)
   *  given real data by a ROM import: their overlay blobs place into free
   *  regions and their `Ptrs:` row repoints at build. Empty/absent = none. */
  newSlots?: string[]
  /** Hex record ids of vanilla levels REMOVED from the game: at build their
   *  `Ptrs:` row repoints at the 1-byte sentinels and their owned blobs are
   *  deleted (pool boundary reclaim frees the bytes); their world-map slots
   *  were taken off the entrance tables when the removal was made.
   *  Empty/absent = none. */
  removedLevels?: string[]
}

/** The active project's free-space migration + de-couple state (both lists, so
 *  the UI refreshes the Banks panel after any toggle). Hex level ids. */
export interface RelocationState {
  relocations: string[]
  decoupled: string[]
}

/** A project plus its overlay-changed files (workRoot-relative paths). */
export interface ProjectInfo extends ProjectSummary {
  files: string[]
  /** Bound to a different cart than is currently extracted — saving blocked. */
  baseMismatch: boolean
}

export type ProjectExportResult =
  | { ok: true; savedPath: string }
  | { ok: false; canceled: true }
  | { ok: false; error: string }

export type ProjectRenameResult =
  | { ok: true; project: ProjectSummary }
  | { ok: false; error: string }

export type ProjectDeleteResult =
  | { ok: true; current: ProjectSummary }
  | { ok: false; error: string }

export interface RenameProjectArgs {
  id: string
  newName: string
}

// ── Outdated-overlay checker ─────────────────────────────────────────────────
// A project stores edits as a sparse overlay of full `.asm` file copies with
// `;@editable:<id>` regions spliced in. When the editor's base `.asm` later
// changes (code fixed outside the regions, or a new region added — e.g. the
// message-pointer table), the overlay's frozen copy drifts. The checker, on
// project launch, re-splices each genuinely-edited region onto the fresh base
// and offers a per-file upgrade (backup first). See src/main/overlay-upgrade.ts.

/** One overlay `.asm` file that has drifted from the current base. Region ids
 *  are the `;@editable:<id>` marker ids in that file. */
export interface OverlayDriftFile {
  /** workRoot-relative POSIX path, e.g. 'yi/SuperFX/Banks/Bank51.asm'. */
  file: string
  /** Regions whose content you actually changed — the upgrade keeps your edits. */
  editsPreserved: string[]
  /** Regions the base added after this overlay was written — the upgrade adopts them. */
  regionsAdded: string[]
  /** Regions removed from the base — your edits to them can't be carried over. */
  regionsDropped: string[]
}

/** Result of scanning a project's overlay `.asm` files for drift. */
export interface OverlayDriftReport {
  /** Drifted files (empty ⇒ the project is up to date). */
  files: OverlayDriftFile[]
}

export type ProjectBackupResult =
  | { ok: true; project: ProjectSummary }
  | { ok: false; error: string }

/** Result of upgrading the requested overlay files. `upgraded` lists the files
 *  actually rewritten (a no-drift or skipped file is omitted). */
export type OverlayUpgradeResult =
  | { ok: true; upgraded: string[] }
  | { ok: false; error: string; upgraded: string[] }

// ── Render requests ─────────────────────────────────────────────────────────

/** Level-header fields fed to the engine renderers. */
export interface RenderHeaderRequest {
  bgColor: number
  bg1Tileset: number
  bg2Tileset: number
  bg3Tileset: number
  spriteTileset: number
  bg1Palette: number
  bg2Palette: number
  bg3Palette: number
  spritePalette: number
  yoshiColor: number
  isWorld6: boolean
  /** header[10] LevelHeaderAnimationTileset. Selects which per-tileset
   *  animated-tile handler runs during init_tileset_animation. Optional;
   *  defaults to 0 (no per-tileset animation). */
  animationTileset?: number
  /** header[9] LevelMode. Read by some animation handlers (e.g. handler $06
   *  switches VRAM target on mode $0A boss arena). Optional; defaults to 0. */
  levelMode?: number
}

export interface RenderMap16Args {
  header: RenderHeaderRequest
  firstId?: number
  cellCount?: number
  cellsPerRow?: number
}

/** Named VRAM region for the Tiles panel inspector. `custom` lets callers pass
 *  raw offsets for things like the animated-tile slot inspector. */
export type RenderVramRegion =
  | 'all'
  | 'bg1'
  | 'bg2'
  | 'bg3'
  | 'sprite'
  | { kind: 'custom'; vramByteOffset: number; bpp: 2 | 4; tileCount?: number }

export interface RenderVramArgs {
  header: RenderHeaderRequest
  /** Region selector; default 'all' = full VRAM as 4bpp. */
  region?: RenderVramRegion
  paletteRow?: number
  tileCount?: number
  cellsPerRow?: number
}

export interface RenderGfxFilesArgs {
  header: RenderHeaderRequest
  cellsPerRow?: number
  /** Sprite palette row (0..7 = CGRAM rows 8..15). Default 0. */
  spritePaletteRow?: number
}

// ── Render results ──────────────────────────────────────────────────────────

export interface RenderImage {
  /** RGBA8888 byte sequence (length = width*height*4). */
  rgba: Uint8Array
  width: number
  height: number
}

export interface DecodedLevelLayout {
  /** 32-KB Map16 ID buffer (cart `$7F:8000`). Indexed by
   *  `(lru_page << 9) + (cell_y << 5) + cell_x * 2`. */
  levelDataBuffer: Uint8Array
  /** Per-screen page mapping; sentinel $80 = unallocated. */
  screenPageMap: Uint8Array
  pageCount: number
  objectsParsed: number
  unregisteredObjects: number
  exitsParsed: number
  aborted: boolean
  overflowed: boolean
  source: { objectFile: string }
}

/** `render:levelTileUsage` result — the level's distinct Map16 blocks (usage +
 *  coverage + palette, from `levelMap16Usage`) plus a composite thumbnail of
 *  those blocks. `image` cells are row-major in `blocks` order at `cellPx` per
 *  cell, `cellsPerRow` wide — so the panel positions each block's badges from
 *  its index. */
export interface LevelTileUsage extends LevelMap16Usage {
  image: RenderImage
  cellsPerRow: number
  /** Pixel size of one Map16 cell in `image` (16). */
  cellPx: number
}

/** `render:editablePalette` result — the level's BASE 512-byte CGRAM (no colour
 *  edits applied), plus, per CGRAM colour index, the palette-blob byte-offset
 *  that backs it (`provenance`; −1 = the interpreter never writes it ⇒ not
 *  editable). The panel applies the live edit DRAFT (held by `usePaletteEditor`)
 *  on top for display; the canvas previews the draft via `paletteOverride`. */
export interface DecodedPalette {
  cgram: Uint8Array
  provenance: Int32Array
}

export interface CollisionRenderResult {
  /** Full-extent collision overlay (4096 × 2048 px). Cells without
   *  collision-worthy metadata render as alpha=0. */
  rgba: Uint8Array
  width: number
  height: number
  /** Number of unique Map16 pages that contributed visible overlay pixels. */
  uniquePagesRendered: number
}

/** Object-drag cell-highlight: the per-cell provenance classes for the dragged
 *  object — or, for a multi-select drag, the whole group (merged in one decode).
 *  `footprint` = a target's own visible cells; `neighbor` = a tile a target
 *  stamped into an adjacent cell; `buried` = a target cell a later non-target
 *  object overdrew; `buriedNeighbor` = both. The renderer paints each a
 *  translucent colour; with several targets each cell carries its last writer's
 *  class (what the decode actually renders). */
export type InfluenceClass = 'footprint' | 'neighbor' | 'buried' | 'buriedNeighbor'

export interface DecodedObjectInfluence {
  /** Absolute cells (x 0..255, y 0..127) the target object(s) touched,
   *  classified. Empty when they stamp nothing (no ported handler / command
   *  object). `mid` = the Map16 ID stamped there — lets the editor link a
   *  selected object to its blocks (Tiles "Used" view) + palette rows. */
  cells: { x: number; y: number; cls: InfluenceClass; mid: number }[]
}

/** `render:collisionTable` response — the cart's per-page `bg_type_table`
 *  plus the per-TILE pipe-entry bits (`DATA_0AEBBC`, indexed by a Map16 id's
 *  low byte; meaningful only for pages tagged `pipe-mouth`). Both cart-static.
 *  The bits let the renderer tell player-enterable mouth tiles (low-nibble
 *  direction bits set — a tile-driven screen exit) apart from plain tagged
 *  pipe terrain; see data/exit-triggers.ts for the mechanism. */
export interface CollisionTableResult {
  table: CollisionEntry[]
  pipeEntryBits: Uint8Array
}

/** `render:objectInfluence` request — decode `override` (the level with the
 *  dragged object(s) at their pending position) recording provenance for the
 *  objects at `targetIndices` in `override.objects` (one index for a single
 *  drag; the whole group for a multi-select drag). */
export interface ObjectInfluenceRequest {
  levelRecordId: number
  override: LevelData
  targetIndices: number[]
}

/** Token identifying the level state a layer render represents (Tier 2
 *  incremental re-render). Opaque to the renderer — it's main's
 *  decode content key. The renderer echoes the token of whatever its backing
 *  canvas currently shows back as `baseToken` on its next request, so main can
 *  diff against the EXACT state the canvas reflects (race-safe: a dropped /
 *  cancelled response never advances the renderer's token, so the next request
 *  still diffs from the right base — or falls back to a full render). */
export type LayerStateToken = string

/** A per-level layer render response: a FULL bitmap the renderer repaints its
 *  backing canvas with (first load / level / tileset / changer change, no
 *  usable base, or a too-large diff), or a sparse PATCH of only the changed
 *  cells it overwrites onto the existing backing canvas. `token` labels the
 *  state this response brings the canvas to. */
export type Bg1LayerResponse =
  | { mode: 'full'; token: LayerStateToken; full: Bg1RenderResult }
  | { mode: 'patch'; token: LayerStateToken; patch: LayerCellPatch }

export type CollisionLayerResponse =
  | { mode: 'full'; token: LayerStateToken; full: CollisionRenderResult }
  | { mode: 'patch'; token: LayerStateToken; patch: LayerCellPatch }

/** Sprite-layer render response (Tier 2 incremental, same model as bg1): a FULL
 *  RGBA the renderer repaints its backing canvas with, or a sparse PATCH of only
 *  the 16×16 cells whose composited sprite pixels changed. `bounds` (per-num cel
 *  click area / selection box) is carried in BOTH modes — it's cheap and lets a
 *  newly-placed sprite num get a correct hit-box without waiting for a full. */
export type SpriteLayerResponse =
  | { mode: 'full'; token: LayerStateToken; bounds: SpriteCelBounds[]; full: Bg1RenderResult }
  | { mode: 'patch'; token: LayerStateToken; bounds: SpriteCelBounds[]; patch: LayerCellPatch }

export interface BgLayersResult {
  bg2: RenderImage
  bg3: RenderImage
  /** Per-level backdrop. Solid form = CSS hex (CGRAM[0], header < $10).
   *  Gradient form = 1×2048 RGBA strip tiled horizontally (header >= $10,
   *  the cart's 24-stop atmospheric gradient). */
  backdrop:
    | { kind: 'solid'; css: string }
    | { kind: 'gradient'; rgba: Uint8Array; width: number; height: number }
  levelMode: number
  /** Per-layer approximate-color-math compositing descriptors (visibility +
   *  blend + draw role) derived from the level mode's PPU registers. YI puts
   *  BG2/BG3 on the subscreen + composites via color math for most modes, so
   *  these honour main ∪ sub membership — not just the main-screen TM bit. See
   *  `composeBgLayers` (snes-framework/scripts/engine/bg-layers-compose.ts). */
  bg2Layer: BgLayerDescriptor
  bg3Layer: BgLayerDescriptor
  regs: {
    bg2TilemapAddr: number
    bg3TilemapAddr: number
    bg2CharAddr: number
    bg3CharAddr: number
  }
}

/** Per-level render request. `override` lets the renderer ship a mutated
 *  `LevelData` (live editor preview) instead of having main re-read the
 *  on-disk `.bin`. */
export interface LevelRenderRequest {
  levelRecordId: number
  override?: LevelData
  /** Pending master-palette colour edits (the `usePaletteEditor` draft) to apply
   *  to CGRAM before rendering — the live in-editor preview of unsaved palette
   *  edits (the analog of `override` for level data). Applied via the per-entry
   *  provenance offset. Absent / empty ⇒ base palette. `render:cgram`,
   *  `bg1Layer`, `spriteLayer`, `bgLayers` honour it. */
  paletteOverride?: PaletteEdit[]
  /** `render:bg1Layer` / `render:collisionLayer` / `render:spriteLayer` (Tier 2
   *  incremental re-render): the `token` of the state the renderer's backing canvas
   *  for this layer currently shows. Main diffs the new decode against that base's
   *  resolved-cell grid (bg1/collision) or content-signature grid (sprites) and
   *  returns a sparse PATCH; absent / unknown / a context change ⇒ a FULL render.
   *  Other handlers ignore it. */
  baseToken?: LayerStateToken
  /** `render:spriteLayer` only — sprite nums that render a **Format-B** cel
   *  (multi-tile `special_chr`). Derived from the prebaked `obj-metadata` `cel`
   *  field (`cel === 'B'`), a ground-truth per-sprite classification replacing the
   *  old unreliable `category` gate. Absent ⇒ no gate. Other handlers ignore it. */
  celRenderableNums?: number[]
  /** `render:spriteLayer` only — sprite nums that render a **Format-A** single
   *  tile (`object_data`; items like red coin / eggs / key). Derived from
   *  `obj-metadata` `cel === 'A'`. The engine renders these AND forces the
   *  Format-A path for them (resolves the ~few sprites that carry both a
   *  `special_chr` and an `object_data`, e.g. the Key). Other handlers ignore it. */
  formatANums?: number[]
}

// ── Entity render-validity (picker filter) ──────────────────────────────────
// Would a picker entry render correctly in-game under the current level's
// header? Objects are probed main-side (decode alone + VRAM coverage — see
// snes-framework entity-render-validity.ts, model lessons in its header);
// sprites are a renderer-local set inclusion over obj-metadata
// `spritesetFiles`, fed by the result's `spritesetFiles`.

/** One picker-catalog candidate to probe: a std/ext object id plus its
 *  metadata default size (the synthetic probe level places it alone at that
 *  size). The catalog is renderer-owned (obj-metadata), so candidates ride
 *  the request instead of main importing renderer data. */
export interface EntityValidityCandidate {
  kind: 'std' | 'ext'
  id: number
  w: number
  h: number
}

/** `render:entityRenderValidity` request. `override` mirrors
 *  `LevelRenderRequest` (live header edits are honoured). */
export interface EntityValidityRequest {
  levelRecordId: number
  override?: LevelData
  candidates: EntityValidityCandidate[]
}

/** `render:entityRenderValidity` result. `objects`/`extended` are keyed by hex
 *  id (`"0x4A"` — the Record hex-key rule). `spritesetFiles` is the level's 6
 *  variable sprite-gfx file ids as hex strings (the same format as
 *  obj-metadata's `spritesetFiles`), so the sprite-side check stays a
 *  synchronous renderer-local set inclusion. `mode7` ⇒ PPU mode-7 arena
 *  (levelMode $09): no normal BG1 rendering — the verdict maps are empty and
 *  the picker must not gate objects on them. */
export interface EntityRenderValidity {
  objects: Record<string, ObjectRenderVerdict>
  extended: Record<string, ObjectRenderVerdict>
  spritesetFiles: string[]
  mode7: boolean
}

/** `render:pickerThumbnails` request — per-catalog-entry bitmaps under this
 *  level's header (§B5 picker thumbnails). One tab per call: pass `candidates`
 *  for the objects tab, or `spriteNums` (+ the cel-gate num sets, the same
 *  convention as `render:spriteLayer`) for the sprites tab. `override` mirrors
 *  LevelRenderRequest. */
export interface PickerThumbnailsRequest {
  levelRecordId: number
  override?: LevelData
  candidates?: EntityValidityCandidate[]
  spriteNums?: number[]
  celRenderableNums?: number[]
  formatANums?: number[]
}

/** `render:pickerThumbnails` result — hex-id-keyed bitmaps; an ABSENT key
 *  means no faithful bitmap exists (object stamps nothing / mode-7, or a
 *  glyph-tier sprite) and the picker keeps the text-only row. */
export interface PickerThumbnails {
  objects: Record<string, RenderImage>
  extended: Record<string, RenderImage>
  sprites: Record<string, RenderImage>
}

/** A paintable tileset (has fit-metadata): numeric BG1 tileset + human label.
 *  Populates the paint panel's tileset selector. */
export interface FitTileset {
  tileset: number
  name: string
}

/** A painted height corner: a target surface row at a cell-corner column. */
export interface PaintCorner {
  col: number
  row: number
}

/** render:fitSurface — forward fit of a painted height curve to std objects. The
 *  fitter interpolates the slope lines between corners, decomposes each run into a
 *  representable staircase, and returns the std objects that draw it. */
export interface FitSurfaceRequest {
  /** The level being edited — the fallback base when `tileset` has no metadata. */
  levelRecordId: number
  /** Selected paint tileset (the paint panel). Picks the object palette + the
   *  representative base level used for footprint probing. */
  tileset: number
  /** Painted corners (cell-corner columns + rows); order-independent. */
  corners: PaintCorner[]
  /** Row the fitted objects fill down to (the solid body depth under the surface). */
  baseline: number
}

/** Debug object/sprite finder: which index to search. */
export type FindInstanceKind = 'sprite' | 'std' | 'ext'

/** One match from the debug instance finder — a level + cell position where the
 *  searched id appears (base-cart index data). */
export interface ObjectInstance {
  /** Data-record level id (the value `loadLevel`/navigation use). */
  levelRecordId: number
  /** Cell coords (16px units), matching the level loader's object/sprite x/y. */
  x: number
  y: number
  /** Byte offset of the record in its stream (for display/disambiguation). */
  offset: number
}

/** Result of resetting a level — deletes its overlay `.bin`(s) so it reloads
 *  from the pristine base cart. `removed` is true when an overlay actually
 *  existed (→ the built ROM is now stale and needs a rebuild). */
export type ResetLevelResult =
  | { ok: true; removed: boolean }
  | { ok: false; error: string }

/** Result of a cross-level warp-exit destination edit (the incoming-marker
 *  drag, plan §A8 #8.5). On success the source level's overlay `.bin`(s) were
 *  rewritten (auto-saved) → the built ROM is stale and needs a rebuild. */
export type SetExitDestResult = { ok: true } | { ok: false; error: string }

// ── Vanilla-level removal (src/main/level-removal.ts) ───────────────────────

/** A requested record a removal refused, with the human-readable why. */
export interface RemovalBlocked {
  recordId: number
  reason: string
}

/** Dry-run impact of removing a set of records — drives the confirm dialog. */
export interface RemovalPreview {
  ok: true
  /** Records that will actually be removed (validated subset of the request). */
  recordIds: number[]
  blocked: RemovalBlocked[]
  /** World-map slots that will be marked unused (main + midway index words). */
  translevels: number[]
  /** Kept entrance records whose unlock will be redirected at their own slot. */
  unlockRewires: number
  /** Bytes the build's pool reclaim frees (0 when no pool map yet). */
  freedBytes: number
  /** Owned bytes that stay resident (shared slices / non-reclaimable pools). */
  residualBytes: number
  /** Warp/minibattle exits in KEPT levels pointing into a removed record —
   *  they'd land on the empty sentinel, so the dialog warns about them. */
  incomingWarps: { sourceRecordId: number; destRecordId: number; screenIndex: number }[]
}
export type RemovalPreviewResult = RemovalPreview | { ok: false; error: string }

export type RemoveLevelsResult =
  | { ok: true; removed: number[]; blocked: RemovalBlocked[]; worldMapChanged: boolean }
  | { ok: false; error: string }

/** The "remove all vanilla" candidate set + why the rest are kept. */
export interface RemovableVanillaLevels {
  recordIds: number[]
  /** Kept: have overlay changes (edited / imported), incl. new-slot rooms. */
  keptEdited: number[]
  /** Kept: engine-referenced outside the map/warp flow. */
  keptProtected: number[]
  /** Kept: warp-reachable from an edited or protected level. */
  keptWarpReachable: number[]
}

/** One removed level, for the "Restore levels" modal list. */
export interface RemovedLevelEntry {
  recordId: number
  /** Friendly name (best-effort, from the baked catalog; absent for sub-rooms). */
  name?: string
}

export type RestoreLevelsResult =
  | { ok: true; restored: number[]; worldMapChanged: boolean }
  | { ok: false; error: string }

/** A pointer slot that can host a freshly created level: a REMOVED vanilla
 *  record (its row + base map wiring come back around the new data). The free
 *  sentinel rows (`0xDA`/`0xDB`) are deliberately NOT offered — only existing
 *  level slots are creatable, keeping the slot list to rooms the game already
 *  shipped (the sentinel machinery itself stays: ROM import uses it). */
export interface CreatableSlot {
  recordId: number
  /** The slot's former level name (best-effort; absent for sub-rooms). */
  name?: string
}

export type CreateLevelResult =
  | { ok: true; recordId: number; worldMapChanged: boolean }
  | { ok: false; error: string }

// ── Per-sprite-type computed properties ──────────────────────────────────────
// Read-only, explanatory fields shown in the Properties panel for sprites with
// special behaviour — derived from the sprite + level context, not stored. A
// main-side registry (src/main/sprite-properties.ts) maps sprite num → provider.

/** One computed read-only property row (label + display value). */
export interface SpriteProperty {
  label: string
  value: string
  /** Mouse-over explanation of what the property means / how it's derived. */
  tooltip?: string
}

/** Context for computing a sprite's properties: the sprite (num + cell x/y) plus
 *  the level it's in (record id, and the translevel of the world-map level it's
 *  reached from — some behaviour, e.g. the message box, keys off the translevel). */
export interface SpritePropertiesRequest {
  /** Record id of the loaded level the sprite is in (may be a sub-room). */
  levelRecordId: number | null
  /** Translevel of the world-map level this play context belongs to (the root
   *  level's slot — `CurrentLevelFromMap` persists across sub-room warps). Null
   *  when unresolved. */
  translevelId: number | null
  /** 9-bit sprite num. */
  num: number
  /** Sprite cell X (0..255, 16-px cells). */
  x: number
  /** Sprite cell Y (0..127, 16-px cells). */
  y: number
}

// ── Custom patches (post-build binary patch layer) ──────────────────────────

/** A patch in the active project's local set — toggled on/off per project.
 *  Lightweight: no chunk bytes (see research/plan-custom-patches.md). */
export interface PatchSummary {
  id: string
  name: string
  description?: string
  /** Source credit shown below the description in the tooltip. */
  attribution?: string
  /** Where it originated: copied from the prepackaged catalog, or imported. */
  source: PatchSource
  romVersionAuthored?: RomVersion
  /** Number of contiguous byte-write chunks (from the current `.ips`). */
  chunkCount: number
  /** Total bytes the patch writes (from the current `.ips`). */
  totalBytes: number
  /** Number of build-time asm edits (`org` directives in the `asm` block). */
  asmCount: number
  /** Enabled (applied at build) for the active project. */
  enabled: boolean
}

/** A prepackaged (built-in) patch in the editor's catalog — added into a project
 *  on demand (enabled by default once added). */
export interface PrepackagedPatch {
  id: string
  name: string
  /** Group heading for the catalog list (e.g. "Flutter! - Misc"). Absent →
   *  grouped under "Other". */
  category?: string
  description?: string
  /** Source credit shown below the description in the tooltip. */
  attribution?: string
  romVersionAuthored?: RomVersion
  chunkCount: number
  totalBytes: number
  /** Number of build-time asm edits (`org` directives in the `asm` block). */
  asmCount: number
  /** Already copied into the active project. */
  added: boolean
}

/** A resolved chunk in a patch preview — where it lands + how it resolved
 *  against the current build's symbols. No raw bytes. */
export interface PatchPreviewChunk {
  /** Resolved absolute PC offset (label address + delta, else the stored offset). */
  offset: number
  length: number
  resolvedVia: 'label' | 'absolute'
  label?: string
}

/** Preview of applying one patch against the active project's current build —
 *  surfaces label-resolution + any overlaps before a build. */
export interface PatchPreview {
  id: string
  chunks: PatchPreviewChunk[]
  /** Human-readable advisories (unresolved labels, version mismatch, out-of-bounds). */
  warnings: string[]
  /** Byte ranges where this patch overlaps other enabled patches. */
  conflicts: Array<{ offset: number; length: number; patchIds: string[] }>
}

/** Result of importing an `.ips` into the active project. */
export type PatchImportResult =
  | { ok: true; patch: PatchSummary }
  | { ok: false; error: string }

/** Generic patch-mutation result (enable/disable/reorder/remove). */
export type PatchMutationResult = { ok: true } | { ok: false; error: string }

/** The asm-patch pool size (KB) reserved off the SuperFX free region, plus its UI
 *  bounds. Bigger reserves more room for hand-authored asm; smaller leaves more
 *  free-region space for level-data migration. Only matters when ≥1 asm patch is
 *  enabled (it's carved at build time then). */
export interface PatchPoolSettings {
  /** Current configured size (KB), clamped to [minKB, maxKB] and snapped to stepKB. */
  kb: number
  /** Minimum selectable size (KB). */
  minKB: number
  /** Maximum selectable size (KB). */
  maxKB: number
  /** Selectable increment (KB) — 0.25 (256 B), so fractional sizes are allowed. */
  stepKB: number
}

/** On-disk locations for hand-authoring patches: the framework asm source (look up
 *  labels + addresses) and the active project's build symbol files (the
 *  label→address mapping, regenerated on every build). Absolute paths. */
export interface PatchAuthoringPaths {
  /** The framework asm source tree (`<framework>/yi`). */
  asmDir: string
  /** The active project's build output dir (where its `.sym` lands), or null when
   *  no project is active. */
  symDir: string | null
  /** The project build's symbol files (main + superfx) that currently exist on
   *  disk; empty until the project has been built at least once. */
  symFiles: string[]
}

// ── ROM import (read a modified/built cart back into overlays) ──────────────
// Renderer-facing report for the "import from a third-party ROM" feature. Wraps
// the framework's RomAnalysis (anchors + per-record diff) with app-side context:
// friendly level names + whether the active project already overlays each level.
// See research/plan-rom-import.md.

/** One changed record in the import report: the framework diff plus app context. */
export interface RomImportLevel extends ForeignLevelDiff {
  /** Friendly level name (best-effort, from the base catalog). */
  name?: string
  /** True when the active project ALREADY has an overlay for this level —
   *  importing overwrites the user's edits (the "warnings" the UI surfaces). */
  hasOverlayConflict: boolean
  /** Set when this level's block is RESOLVABLE by a layout toggle: `migrate`
   *  (0x7D — free-space migration gives it a self-contained obj copy) or
   *  `decouple` (0x19/0xCB — materialise their own sprite blob). The dialog's
   *  "unblock imports" option makes such levels selectable and the apply pass
   *  flips the toggle before writing. Absent for genuinely-blocked records
   *  (0x38, 0xBF/0xD0, clobbered slots). */
  unblockAction?: 'migrate' | 'decouple'
  /** A brand-NEW level: this record has no base level data (a sentinel `Ptrs:`
   *  row — `0xDA`/`0xDB`) and the hack put a real level there. Importing writes
   *  the overlay blobs and the build places them in free space + repoints the
   *  row. */
  isNew?: boolean
}

/** Master-palette colour changes detected in the foreign cart. */
export interface RomImportPalette {
  /** BGR-15 words that differ from the base blob. */
  changedWords: number
  /** Of those, how many you've already edited in this project (overwrite warning). */
  conflicts: number
}

/** Level-name string changes detected in the foreign cart. */
export interface RomImportNames {
  /** Names that will import (well-formed, line-structure matches the base entry). */
  changed: number
  /** Foreign names skipped — garbage/clobbered, a line-count mismatch, or a slot
   *  with no editable base entry. */
  skipped: number
  /** The changed names don't fit the asm region's fixed byte budget (or use an
   *  unsupported glyph) — can't apply. */
  overBudget: boolean
  /** The project already has name edits that importing would rebuild over. */
  hasConflict: boolean
}

/** Message-box text changes detected in the foreign cart. Like {@link RomImportNames}
 *  but with two extra outcomes specific to messages: foreign messages shared across
 *  pointer slots that we import once (`duplicates`), and slots the hack deleted
 *  (pointer `$0000`) that we blank to match (`blanked`). */
export interface RomImportMessages extends RomImportNames {
  /** Shared foreign messages imported once instead of duplicated (dedup fallback,
   *  only when the full import would overflow the fixed message budget). */
  duplicates: number
  /** Slots the hack deleted (pointer `$0000`) that we blanked to match its layout. */
  blanked: number
}

/** World-map entrance-table changes detected in the foreign cart. The importer
 *  covers exactly what the world-map editor edits: the main entrance records
 *  (spawn coords, the level a tile plays, progression target) and the midway/
 *  checkpoint records. The translevel→record INDEX tables aren't editable, so a
 *  hack that re-indexed the world map isn't imported (out of scope, like the
 *  level-placement importer's other detect-only diffs). */
export interface RomImportWorldMap {
  /** Main-entrance records whose 4 fields differ from base (spawn / level
   *  remap / progression target). */
  entrances: number
  /** Midway/checkpoint records that differ from base. */
  midway: number
  /** Translevel→record INDEX words remapped (which entrance record a world-map
   *  slot uses — main + midway tables). */
  indexRemaps: number
  /** Foreign index words skipped (address a record our fixed tables lack). */
  indexSkipped: number
  /** The project already has world-map overlay edits importing would layer over. */
  hasConflict: boolean
}

/** Result of analysing a picked foreign cart against the project's base. */
export type RomImportReport =
  | {
      ok: true
      foreignPath: string
      foreignMd5: string
      /** Foreign cart looks V1.0-derived (engine constants validate). */
      baseDerived: boolean
      /** Level-data pointer table resolved (level import is possible). */
      levelPtrsResolved: boolean
      anchors: AnchorResolution[]
      levels: RomImportLevel[]
      counts: { changed: number; full: number; rawOnly: number; blocked: number; conflicts: number }
      palette: RomImportPalette
      names: RomImportNames
      messages: RomImportMessages
      worldMap: RomImportWorldMap
      /** Detect-only diff inventory — EVERY differing byte by cart structure,
       *  including the categories the importer doesn't apply (graphics, Map16,
       *  collision, code …). Absent when the pointer table didn't resolve. */
      inventory?: RomImportInventory
    }
  | { ok: false; error: string }

/** Which categories/records the user chose to apply. */
export interface RomImportSelection {
  /** Record IDs to import (subset of the report's full/raw-only levels). */
  recordIds: number[]
  /** Import the master-palette colour changes. */
  palette: boolean
  /** Import the level-name string changes. */
  names: boolean
  /** Import the message-box text changes. */
  messages: boolean
  /** Import the world-map entrance + midway record changes. */
  worldMap: boolean
  /** Pre-emptively resolve resolvable import blocks for the selected records
   *  (set 0x7D's free-space migration / de-couple 0x19/0xCB) before writing,
   *  so their levels import instead of failing the save gate. */
  unblock?: boolean
}

/** Result of applying a ROM import to the active project's overlay. */
export type RomImportApplyResult =
  | {
      ok: true
      /** Records successfully written to the overlay. */
      applied: number
      full: number
      rawOnly: number
      /** Records that failed to write, with why. */
      failed: Array<{ recordId: number; error: string }>
      /** Migration awareness: imported levels the hack had relocated that were
       *  auto-marked migrated (their new sizes overflow their home pools — the
       *  build's layout pass will place them in the free regions). `warning` is
       *  set when pools still don't fit (no eligible candidate / regions full). */
      migration: { applied: number; recordIds: number[]; warning?: string }
      /** Pre-emptive unblock outcome (when `unblock` was selected): the records
       *  whose layout toggles were flipped so their import could proceed. */
      unblocked: { migrated: number[]; decoupled: number[] }
      /** Brand-new levels imported into sentinel slots (`0xDA`/`0xDB`). */
      newSlots: number[]
      /** Palette apply outcome (when selected). */
      palette: { applied: boolean; words: number; error?: string }
      /** Level-name apply outcome (when selected). */
      names: { applied: boolean; changed: number; error?: string }
      /** Message-box text apply outcome (when selected). `changed` counts text
       *  edits; `blanked` counts slots blanked to match the hack's deletions. */
      messages: { applied: boolean; changed: number; blanked: number; error?: string }
      /** World-map entrance/midway/index apply outcome (when selected). */
      worldMap: { applied: boolean; entrances: number; midway: number; indexRemaps: number; error?: string }
    }
  | { ok: false; error: string }
