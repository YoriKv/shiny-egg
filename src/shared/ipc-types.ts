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
  /** Absolute path to the Aseprite executable, saved via the Graphics panel's
   *  "Locate Aseprite" button (for opening exported `.aseprite` projects). */
  asepritePath?: string
  /** Canvas background colour (the area behind/around the level), as a `#rrggbb`
   *  hex. App-wide, set via the toolbar swatch; absent ⇒ the renderer default. */
  canvasBackgroundColor?: string
  /** Grid line colour (both the per-screen and per-cell grid), as an `rgba(...)`
   *  string so the user can pick colour AND opacity. App-wide, set via the
   *  toolbar swatch beside the background; absent ⇒ the renderer default. The
   *  renderer scales this alpha across the cell/screen/boundary depth tiers. */
  gridColor?: string
  /** One-time-migration marker: set the first time settings load, so the legacy
   *  pure-black canvas-background default is bumped to the new grey exactly once
   *  (a user who later re-picks black keeps it). See main/settings.ts. */
  canvasBgDefaultMigrated?: boolean
}

/** Result of the `aseprite:locate` file picker (same shape as the BizHawk one):
 *  `ok`+`path` on success; `ok:false` no `error` = cancelled; `ok:false`+`error`
 *  = the pick was rejected. */
export interface LocateAsepriteResult {
  ok: boolean
  path?: string
  error?: string
}

/** The located Aseprite, with the version probed from `<exe> --version`. The
 *  `.aseprite` format has NO version field (aseprite/docs/ase-file-specs.md — the
 *  128-byte header carries none; Aseprite decides "minimum version to open" purely
 *  from which chunk types are present), so the only way to match our save format to
 *  the user's install is to probe the binary. The Graphics panel keys the
 *  tilemap-export gate off `supportsTilemap`: our tilemap `.aseprite` files (tileset
 *  chunk 0x2023 + tilemap layer type 2 + cel type 3) need Aseprite 1.3+, where
 *  tilemaps landed — an older Aseprite skips those chunks and opens a blank layer,
 *  corrupting the round-trip on save. */
export interface AsepriteInfo {
  path: string
  /** Dotted version from `--version` (e.g. `"1.3.17"`), or null when the probe
   *  failed / output couldn't be parsed (then `supportsTilemap` is given the benefit
   *  of the doubt — see below). */
  version: string | null
  /** Version ≥ 1.3 ⇒ tilemap export is safe to offer. A null/unparseable `version`
   *  is treated as `true` (don't punish a working install for a flaky `--version`);
   *  the gate fires only when we POSITIVELY read a pre-1.3 version. */
  supportsTilemap: boolean
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

/** Items to pre-load into Yoshi's egg-trail inventory when Test Level boots a
 *  level. The trail caps at 6 items (eggs + keys share the slots), so
 *  `eggs + keys` must be ≤ 6; `{ eggs: 0, keys: 0 }` is empty (a vanilla boot).
 *  The supervisor maps the counts to concrete NorSpr sprite IDs (green egg /
 *  carryable key) and the Lua harness seeds them via the between-level
 *  egg-inventory snapshot the level loader restores on entry. */
export interface TestInventory {
  /** Green eggs trailing Yoshi (0..6). */
  eggs: number
  /** Carryable keys on the trail (0..6). `eggs + keys` ≤ 6. */
  keys: number
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
  /** header[11] LevelHeaderAnimationPalette. Indexes `DATA_animation_palette_ptr`
   *  (the per-frame palette-cycle handler). Used by the BG3 gfx export to flag
   *  when BG3's palette colours are animated (so the exported colours are one
   *  frame of a cycle). Optional; defaults to 0 (no per-frame palette animation). */
  animationPalette?: number
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

/** A rendered preview of one special markup glyph (button icon / arrow / star /
 *  …), for the Message-Text markup keyboard. `dataUrl` is a PNG of the glyph's
 *  1bpp font cell(s), white-on-transparent. Keyed by its markup `token`. */
export interface MessageGlyphPreview {
  token: string
  dataUrl: string
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
  /** BG2/BG3 BACKGROUND planes (priority-0 tiles), drawn behind BG1. */
  bg2: RenderImage
  bg3: RenderImage
  /** BG2/BG3 FOREGROUND planes (priority-1 tiles) drawn ABOVE BG1 (source-over),
   *  or `null` when the layer has no foreground tiles (the common case → no
   *  buffer shipped). The cart's per-tile priority bit puts these tiles in front
   *  of BG1 (e.g. 1-1's foreground flowers). Required-but-nullable: always
   *  present in the contract so the canvas + gates can't silently drop it. */
  bg2Front: RenderImage | null
  bg3Front: RenderImage | null
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
  /** Override the decode's PRNG seed (the "Refresh RNG" editor action) — re-rolls
   *  the cosmetic random-tile variants the cart picks via its HV-counter PRNG (we
   *  port it as a 16-bit LFSR). Absent ⇒ the default deterministic seed (0xACE1).
   *  `bg1Layer` / `collisionLayer` (and any other decode-backed handler) honour
   *  it; the seed-independent layers (`spriteLayer`, `bgLayers`) ignore it. */
  prngSeed?: number
  // (The sprite cel-format gate, settled palette row (SP4) and rest frame (SP3) are asm-fixed
  //  facts the engine now owns directly — sprite-render-facts.ts — so they're no longer sent.)
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

/** `render:entityRenderValidity` request (the unified picker-catalog pass).
 *  `override` mirrors `LevelRenderRequest` (live header edits are honoured).
 *  `candidates` are the std/ext objects to verdict. `spriteNums`, when present,
 *  is the full sprite catalog: the handler warms the picker's object AND sprite
 *  thumbnail caches from the same decodes it ran for the verdicts (so the picker
 *  opens warm). Omit it for a verdicts-only run. */
export interface EntityValidityRequest {
  levelRecordId: number
  override?: LevelData
  candidates: EntityValidityCandidate[]
  spriteNums?: number[]
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
 *  for the objects tab, or `spriteNums` for the sprites tab. `override` mirrors
 *  LevelRenderRequest. (The cel-format gate / settled palette / rest frame are
 *  engine-owned asm-fixed facts now — sprite-render-facts.ts — not sent.) */
export interface PickerThumbnailsRequest {
  levelRecordId: number
  override?: LevelData
  candidates?: EntityValidityCandidate[]
  spriteNums?: number[]
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

/** Result of "fit the sprite tileset to a level's sprites" (`render:fitSpriteset`):
 *  the best-covering stock spriteset id for `header[7]`, plus coverage. */
export interface FitSpritesetResult {
  /** Chosen stock spriteset id (0x00..0x7F) — set as header field 7. */
  spriteTileset: number
  /** Placed-sprite instances whose gfx file the chosen spriteset loads. */
  servedInstances: number
  /** Placed-sprite instances that need a variable gfx file at all. */
  gatedInstances: number
  /** Required gfx file ids the chosen spriteset still can't load (non-empty ⇒
   *  some sprites will render wrong: >6 distinct files, or no stock set fits). */
  missingFiles: number[]
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

/** Result of a cross-level warp-exit ENTRANCE-type edit (the incoming-marker's
 *  Entrance dropdown). Same auto-save semantics as `SetExitDestResult` — on
 *  success the source level's overlay was rewritten and the built ROM is stale. */
export type SetExitEntranceResult = { ok: true } | { ok: false; error: string }

/** Result of saving an edited graphics blob (re-encode + overlay write). `file`
 *  is the overlay path written (relative to `assets/yi`). On success the built
 *  ROM is stale and needs a rebuild (gfx edits don't render live). */
export type SaveGfxEditResult =
  | { ok: true; file: string }
  | { ok: false; error: string }

/** Result of discarding a saved graphics edit. `removed` is true when an overlay
 *  blob actually existed (→ the built ROM is now stale). */
export type ResetGfxEditResult = { ok: boolean; removed?: boolean; error?: string }

/** One overlay-edited graphics file in the active project (the "Changed graphics"
 *  list / per-file reset). `file` is the overlay path relative to `assets/yi` —
 *  the reset target. */
export interface GfxEditEntry {
  file: string
  /** Human label (e.g. "Gfx file 0x38 (LZ2)" or an animation-CHR description). */
  label: string
  /** A compressed gfx blob vs the shared raw animation CHR. */
  kind: 'compressed' | 'raw-chr'
  bytes: number
}

/** What a graphics file maps back to — the role(s) it's loaded as across the cart
 *  (e.g. "BG1 tileset", "Sprite sheet", "Title screen — logo"). The expandable
 *  detail for the "Changed graphics" list. Empty when it can't be classified. */
export interface GfxFileRole {
  roles: string[]
}

/** A Map16 sub-tile descriptor — one 8×8 quadrant of a Map16 block (the structured
 *  Map16 editor's unit). Structurally the engine `Map16SubTile`. */
export interface Map16SubTileEdit {
  /** 10-bit tile index into BG1 VRAM (relative to the BG1 char base). */
  tileIndex: number
  /** BG palette row 0..7. */
  paletteRow: number
  hflip: boolean
  vflip: boolean
  priority: boolean
}

/** Result of rendering a Map16 block to a 16×16 bitmap (the editor's live preview). */
export interface Map16BlockPreview {
  rgba: Uint8Array
  width: number
  height: number
}

/** Options for exporting graphics PNGs (the Graphics panel). All optional. */
/** Which sub-track(s) of the graphics export to write. `metasprites` includes the
 *  GSU glyphs; `worldmap` covers the overworld map char sheets + world-map / level
 *  icons + terrain / ground; `systemscreens` covers the boot / title / storybook
 *  char sheets + the title logo / island / scenery + storybook scene. (`worldmap` +
 *  `systemscreens` are the two halves of what used to be a single `screens` track.) */
export type GfxExportTrack = 'metasprites' | 'worldmap' | 'systemscreens'

export interface ExportGfxOptions {
  /** Limit the export to these tracks. */
  tracks?: GfxExportTrack[]
  /** `aseprite` writes the assembled screens / metasprites as indexed Aseprite
   *  projects instead of PNGs. The title island's Aseprite export is a COMBINED
   *  tilemap: one file edits pixels, placement, AND added tiles together (assumes
   *  Manual tileset mode — see gfx-png-import.ts). `m1te2` (World Map track only)
   *  writes the overworld (one `.M1` per world × half, BG1+BG2+BG3) + a combined icons
   *  `.M1` (all per-level icons in level order + marker + castle) as M1TE2 sessions
   *  instead of the PNG/Aseprite map outputs. Default `png`. */
  format?: 'png' | 'aseprite' | 'm1te2'
  /** Sprite id → friendly name; NAMES the metasprite PNGs (does not limit them). */
  spriteNames?: Record<number, string>
}

/** Result of exporting the current level's graphics to PNGs (the Graphics panel).
 *  `canceled` when the folder dialog was dismissed. */
export type ExportGfxResult =
  | { ok: true; count: number; dir: string }
  | { ok: false; error: string }
  | { canceled: true }

// ── BG region export/import (src/main/bg-region-io.ts) ──────────────────────

/** Which BG layer a region export targets. */
export type BgRegionLayer = 1 | 2 | 3

/** Export file format for a region. `png` = the flat sheet (pixels). `aseprite` = the
 *  **8×8-CHR pixel** tilemap project (the foundational pixel unit — one Aseprite tile =
 *  one 8×8 CHR, so the cart's CHR sharing is visible; all layers). `aseprite-layout` =
 *  the **16×16-WORD placement** tilemap for BG2/BG3 only (rearrange which tile goes where;
 *  8×8 placement is impossible in 16×16 tile mode — see research/graphics-editing). BG1
 *  has no static tilemap placement (that's the level editor), so it rejects
 *  `aseprite-layout`. `m1te2` = an M1TE2 `.M1` session file (BG2/BG3 only) bundling the
 *  layer's tilemap + CHR + palette for editing in M1TE2 — one `.M1` per 32×32 screen since
 *  M1TE2's map is a fixed 32×32. Round-trips (CHR pixels + tilemap words + palette). */
export type BgRegionFormat = 'png' | 'aseprite' | 'aseprite-layout' | 'm1te2'

/** A rectangle of BG1 level cells (16×16 px each), in absolute level coords.
 *  Ignored for BG2/BG3 (the whole tilemap is exported). */
export interface BgRegionRect {
  col0: number
  row0: number
  cols: number
  rows: number
}

/** Renderer → main args for a region export (header is passed separately). */
export interface BgRegionExportArgs {
  layer: BgRegionLayer
  /** Required for BG1 (the selected level rectangle); ignored for BG2/BG3. */
  rect?: BgRegionRect
  /** The loaded level — its decode backs the BG1 positioned grid + its header
   *  colours every layer. */
  level: LevelData
  /** Output format. Defaults to `png`; `aseprite` = 8×8 pixel tilemap; `aseprite-layout`
   *  = 16×16-word placement (BG2/BG3 only). */
  format?: BgRegionFormat
}

export type BgRegionExportResult =
  | { ok: true; file: string; cells: number; dir: string; /** Non-fatal notice (e.g. a BG1 M1TE area cropped to 16×16). */ warning?: string }
  | { ok: false; error: string }
  | { canceled: true }

/** An exported `.M1` session file in a tracked export folder, with its BG layer
 *  parsed from the filename (`bg2-region*.M1` → 2) — for the Graphics panel's list
 *  of clickable "open in M1TE" entries under each folder. */
export interface M1ExportFile {
  file: string
  layer: 1 | 2 | 3
}

/** Per-region detail line for the import log. */
export interface RegionImportLogEntry {
  file: string
  layer: BgRegionLayer
  source: 'png' | 'aseprite' | 'm1te2'
  /** Tile edits sliced from this region. */
  tiles: number
  /** Opaque pixels whose colour was in no slot of their cell's palette row. */
  mismatches: number
  conflicts: number
}

export type BgRegionImportResult =
  | {
      ok: true
      dir: string
      applied: number
      /** Tilemap WORDS rewritten by the index-based placement diff (BG2/BG3 cells whose
       *  Aseprite tile-index / flip changed — `diffBgRegionPlacement`, NOT a pixel compare).
       *  Counted apart from `applied` so a placement-only import still marks the build dirty. */
      repositioned: number
      conflicts: number
      regions: number
      mismatches: number
      /** Palette colours written back to the master palette blob. */
      paletteChanged: number
      perRegion: RegionImportLogEntry[]
      log: string[]
      errors: string[]
    }
  | { ok: false; error: string }
  | { canceled: true }

/** Result of the unified "import this folder" — auto-detects the all-graphics PNG
 *  manifest AND any BG-region files, runs both, and merges into one log. */
export type ImportGraphicsResult =
  | {
      ok: true
      dir: string
      /** Files (gfx + palette) changed — drives the build-dirty mark. */
      changed: number
      /** Master-palette colours written back (e.g. a recolour imported from M1TE / a
       *  swatch). Non-zero ⇒ the renderer reloads its palette draft so the live preview
       *  reflects the import (the edits were persisted behind the edit-session's back). */
      paletteChanged: number
      /** Pre-formatted log + error lines for display (gfx counts + region log). */
      log: string[]
      errors: string[]
    }
  | { ok: false; error: string }
  | { canceled: true }

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
 *  Lightweight: no chunk bytes. */
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
  /** Number of build-time asm edits — distinct ROM write regions in the patch's
   *  asm (`org` / `%patchcode` / `%patchdata` / legacy `freecode`/`freedata`). */
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
  /** Number of build-time asm edits — distinct ROM write regions in the patch's
   *  asm (`org` / `%patchcode` / `%patchdata` / legacy `freecode`/`freedata`). */
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

/** Result of importing an `.ips` / `.asm` into the active project. `notes` carries
 *  any conversion advisories (asar `.asm` import rewrites the source — e.g.
 *  `freecode` → the reserved patch pool — and reports what it changed). */
export type PatchImportResult =
  | { ok: true; patch: PatchSummary; notes?: string[] }
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

// ── GBA cart import (Super Mario Advance 3 → SNES YI) ───────────────────────
// Import a sublevel out of an SMA3 (U) GBA cart and overwrite a SNES record in
// the active project. SMA3 is a port of YI, so the level-data formats are nearly
// identical (engine: snes-framework/gba-import); the app orchestrator is
// src/main/gba-import.ts.

/** One importable sublevel found in the GBA cart (analyse view). */
export interface GbaImportSublevel {
  /** GBA sublevel id (also the default SNES record id, since the id spaces
   *  align for ported content). */
  sublevelId: number
  objects: number
  sprites: number
  exits: number
  /** GBA camera sprites dropped (no SNES equivalent). */
  spritesDropped: number
  /** Advynia custom objects dropped. */
  objectsDropped: number
  /** Distinct warning kinds for this sublevel (e.g. `camera-sprite-dropped`). */
  warnings: string[]
}

/** Result of analysing a picked GBA cart. */
export type GbaImportReport =
  | {
      ok: true
      /** Absolute path of the analysed cart (echoed into the apply selection). */
      filePath: string
      /** GBA internal title + game code + whole-ROM CRC32 (hex string). */
      title: string
      gameCode: string
      crc32: string
      sublevels: GbaImportSublevel[]
    }
  | { ok: false; error: string }

/** Selection to apply: each pair overwrites a SNES record with a GBA sublevel. */
export interface GbaImportApplySelection {
  /** GBA cart path (must match the analysed cart). */
  filePath: string
  items: Array<{ sublevelId: number; targetRecordId: number }>
}

/** Result of applying a GBA import to the active project's overlay. */
export type GbaImportApplyResult =
  | {
      ok: true
      /** Sublevels written, with their human-readable conversion warnings. */
      applied: Array<{ sublevelId: number; targetRecordId: number; warnings: string[] }>
      /** Targets that failed to write, with why. */
      failed: Array<{ targetRecordId: number; error: string }>
    }
  | { ok: false; error: string }
