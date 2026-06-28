// Public type contracts shared between the framework runtime (Node) and the
// renderer-facing preload typings (DOM-only). This file MUST stay free of
// Node-only imports (no `node:fs`, `Buffer`, `process`, etc.) so the
// renderer tsconfig can resolve it without dragging Node types into the
// DOM typecheck. Implementation modules in this directory re-export these
// types so existing `snes-framework/<subpath>` imports keep working.

// ── ROM versions ──────────────────────────────────────────────────────────

export type RomVersion =
  | 'YI_U1' | 'YI_U2'
  | 'YI_E1' | 'YI_E2'
  | 'YI_J1' | 'YI_J2' | 'YI_J3';

// ── Editable resources (generic load/save registry) ──────────

/** A reference to one editable thing the editor loads/saves through the generic
 *  resource IPC. `level` is backed by a LevelData `.bin`; `asm-region` (step 5)
 *  is a marker-bounded span in a `yi/*.asm` file, looked up by id in the
 *  main-side resource registry. */
export type EditableResource =
  | { kind: 'level'; recordId: number }
  | { kind: 'asm-region'; id: string }
  | { kind: 'world-map' };

/** Result of a generic resource save — `files` are the overlay-relative paths
 *  written (empty when nothing changed). */
export type SaveResourceResult =
  | { ok: true; files: string[] }
  | { ok: false; error: string };

// ── Extraction ────────────────────────────────────────────────────────────

export interface ExtractionState {
  romVersion: RomVersion;
  /** ISO 8601 timestamp of when the extraction completed. */
  extractedAt: string;
  /** Absolute path of the reference cart used for the extraction. */
  sourceCart: string;
  /** MD5 of the reference cart that was extracted. */
  sourceCartMd5: string;
  /** How many files the extraction produced. */
  extractedFiles: number;
  /** Of those, how many were deliberately-empty placeholders. */
  emptyFiles: number;
  /** Version of the extraction pipeline that produced this extract
   *  (state.ts `EXTRACT_PIPELINE_VERSION`). Absent on extracts that predate
   *  versioning — treated as out of date. */
  pipelineVersion?: number;
}

export interface ExtractResult {
  extracted: number;
  empty: number;
}

/** Verdict of the out-of-date-extract check (state.ts `checkExtractFreshness`):
 *  is the on-disk extract (assets + editor-data) current with this app's
 *  extraction pipeline? The extract-side analogue of the outdated-overlay
 *  checker — catches e.g. a stale levels.json after an app upgrade. */
export interface ExtractFreshness {
  /** 'none' = never extracted; 'stale' = re-extract needed; 'fresh' = current. */
  status: 'none' | 'fresh' | 'stale';
  /** Human-readable causes when stale (pipeline updated / output missing). */
  reasons: string[];
}

// ── Build ─────────────────────────────────────────────────────────────────

export interface BuildResult {
  outputPath: string;
  romLabel: string;
  romVersion: RomVersion;
  /** Main SNES symbol map written alongside the .sfc (asar --symbols=wla). */
  symbolsPath: string;
  /** SuperFX sym written alongside the .sfc (carries FXCODE_* / lz16_* labels). */
  superfxSymbolsPath: string;
}

// ── Level data ────────────────────────────────────────────────────────────

export interface LevelObject {
  /** Editor-session-only stable identity, stamped at load and preserved
   *  across edits — never serialized (the serializer reads only the encoded
   *  fields). Lets selection + undo/redo track an entity whose stream
   *  `index` shifts when siblings are inserted/deleted. */
  uid?: number;
  /** Index in the object stream (stable across edits to same stream). */
  index: number;
  /** Object number — `0x00` = extended (see `exnum`), else standard object id. */
  num: number;
  /** Extended-object subtype if num=0, else undefined. */
  exnum?: number;
  /** Tile-grid X (0..255). YI uses 16-pixel cells. */
  x: number;
  /** Tile-grid Y (0..255). */
  y: number;
  /** Width in cells. 1 if not encoded for this object type. */
  w: number;
  /** Height in cells. 1 if not encoded for this object type. */
  h: number;
  /** Raw record bytes — for round-trip / debugging. */
  raw: number[];
}

/**
 * Screen-exit record: 5 bytes per record (`screenIndex`, then 4 payload bytes,
 * `0xFF` terminator). The payload meaning depends on byte 1:
 *   - byte1 ∈ $00..$DD → level warp (destination level, dest X/Y, entrance type)
 *   - byte1 ∈ $DE..$E9 → minibattle entry (minibattle ID, return X/Y, return level)
 */
export type ScreenExit = ScreenExitWarp | ScreenExitMinibattle;

export interface ScreenExitWarp {
  /** Editor-session-only stable identity — see `LevelObject.uid`. */
  uid?: number;
  variant: 'warp';
  screenIndex: number;
  /** Destination level ID (0..0xDD). */
  destLevelRecordId: number;
  /** Destination X in the target level. */
  destX: number;
  /** Destination Y in the target level. */
  destY: number;
  /** Entrance type. */
  entranceType: number;
}

export interface ScreenExitMinibattle {
  /** Editor-session-only stable identity — see `LevelObject.uid`. */
  uid?: number;
  variant: 'minibattle';
  screenIndex: number;
  /** Minibattle level ID (0xDE..0xE9). */
  minibattleId: number;
  /** Return X (where Yoshi reappears on exit). */
  returnX: number;
  /** Return Y. */
  returnY: number;
  /** Return-level ID. */
  returnLevelRecordId: number;
}

export interface LevelSprite {
  /** Editor-session-only stable identity — see `LevelObject.uid`. */
  uid?: number;
  index: number;
  /** Sprite num — 9 bits (0..511). */
  num: number;
  /** Tile-grid X (0..255). */
  x: number;
  /** Tile-grid Y (0..127). */
  y: number;
}

// ── Levels catalog (level-dropdown source) ────────────────────────────────

/** Level scroll/render axis. Drives per-region BG1 tileset/palette banding for
 *  Graphic/Palette Changer sprites ($1BA-$1C9): 'horizontal' bands by column
 *  (cell-X), 'vertical' by row (cell-Y, e.g. 0x2B Raphael's Castle, whose
 *  changers sit at one X but spread across Y screens). Derived at render time
 *  from the changers' own X-vs-Y spread — see engine `deriveBg1Direction`. */
export type RenderDirection = 'horizontal' | 'vertical';

export interface LevelCatalogEntry {
  /** Data-record index — the value used by `loadLevel(id)` and warp-exit
   *  navigation. This is the index into the cart's `Ptrs` table at
   *  `$17:F7C3`, NOT the translevel ID. For world-map slots they were
   *  conflated historically; the gm$0C indirection at `DATA_level_entrance_indexes` /
   *  `DATA_map_level_entrances` reveals they're a different id space.
   *
   *  `null` for slots with NO editable level data — bonus / mini-game / intro
   *  slots load through a separate system (Bank11 gm$2E/$30), not `Ptrs`. They
   *  used to take an identity fallback (`id = translevelId`), which collided
   *  with real levels' record indices (e.g. Scratch And Match's translevel
   *  `0x15` vs Prince Froggy's Fort's record `0x15`). Such entries are
   *  catalogued for completeness but aren't loadable/selectable as levels. */
  recordId: number | null;
  /** Translevel ID (world-map slot, 0..71) — the value to inject as
   *  `CurrentLevelFromMap` when loading via the cart's natural gm$0C path
   *  (e.g. the BizHawk "Test Level" button). Omitted for entries that
   *  aren't reachable from the world map (bonus / mini-game / sub-room
   *  slots). */
  translevelId?: number;
  /** Display name as printed on the world map / level intro screen. */
  name: string;
  /** Group label (e.g. "World 3") for dropdown headers. */
  world: string;
  /** Slot label (e.g. "3-2", "Extra", "Intro"). */
  slot: string;
}

export interface LevelCatalogGroup {
  label: string;
  levels: LevelCatalogEntry[];
}

export interface LevelsCatalog {
  groups: LevelCatalogGroup[];
}

export interface LevelData {
  recordId: number;
  romVersion: RomVersion;
  /** 15 unpacked header bytes; meaning varies per field (tileset, BG, music…). */
  header: number[];
  objects: LevelObject[];
  exits: ScreenExit[];
  sprites: LevelSprite[];
  /**
   * If this level has an entry record in the framework's world-map entrance
   * table (`DATA_map_level_entrances` in `yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm`),
   * the cell coordinates Yoshi spawns at when entering from the world map. Missing for sub-rooms
   * and other levels reachable only via in-level exits.
   */
  spawn?: { x: number; y: number };
  /** True if the slot in the pointer table is zeroed (no level here). */
  empty: boolean;
  /** True if the slot is special-cased in the engine (e.g. level 0x38). */
  special: boolean;
  /** Diagnostics: bytes consumed from each stream, for spot-checks. */
  diag: {
    headerBytes: number;
    objectBytes: number;
    exitBytes: number;
    spriteBytes: number;
  };
}

// ── Level-data byte-budget (shared-pool gate) ──────────────────────────────
// Per-level obj/spr `.bin` streams are incbin'd into fixed bank "pools" closed
// by a `%FREE_BYTES(boundary, …)` whose `assert pc() <= boundary` is the build
// gate. A pool's effective limit is `capacityBytes + headroomBytes` (the movable
// boundary-move headroom a build can absorb; 0 for fixed pools). Beyond that, a
// level can be *migrated* out to a free region — reclaiming its slot for the
// bank's other levels (research/notes-rom-free-space.md). A level can touch
// two pools (Bank15 splits a level's obj and spr blobs across its two pools), so
// the report is per-pool. See research/notes-level-data-byte-budget.md.

export interface PoolBudgetEntry {
  /** Stable pool id, e.g. `Bank4C` (single pool) or `Bank15#1` (multi-pool). */
  poolId: string;
  /** Bank as a `0xNN` hex string, for display. */
  bank: string;
  /** Total bytes at the fixed boundary (Σ base blob sizes). */
  capacityBytes: number;
  /** Extra bytes the pool may grow by if its `%FREE_BYTES` boundary is moved at
   *  build time (0 for non-movable pools). The effective limit is
   *  `capacityBytes + headroomBytes`. */
  headroomBytes: number;
  /** Current total: this level's live stream sizes + the other members' overlay
   *  sizes (base where unsaved). */
  usedBytes: number;
  /** `usedBytes − (capacityBytes + headroomBytes)`. > 0 means over budget (build
   *  would fail even after moving the boundary); ≤ 0 is remaining room (negated). */
  overBy: number;
  /** Hex ids of the OTHER levels sharing this pool (where the user can free
   *  space if over even with headroom). */
  otherLevels: string[];
}

export interface PoolBudgetReport {
  /** Hex id of the level the report is for. */
  levelRecordId: string;
  /** The pool(s) this level participates in (one, or two for split levels). */
  pools: PoolBudgetEntry[];
  /** Any pool over budget. */
  over: boolean;
  /** Largest `overBy` across the pools (> 0 ⇒ over). */
  worstOverBy: number;
  /** Set when this level is migrated into a free region — the id(s) it lands in.
   *  Its blobs are then sized against the region, not its home pool. */
  relocatedTo?: string[];
  /** True when the level is over its home pool but COULD be migrated to a free
   *  region (migratable + a region has room) — the editor offers "migrate"
   *  instead of only "shrink a neighbour". */
  canRelocate?: boolean;
}

// ── Bank-pool overview ("Banks" panel) ──────────────────────────────────────
// The cross-pool companion to PoolBudgetReport: every level-data pool with its
// capacity/headroom/used/free totals and per-level breakdown, plus the free
// regions levels can be migrated into (PoolOverview.freeRegions). Drives the
// Banks panel's migrate / de-couple controls. Sizes are on-disk (overlay-if-saved,
// base otherwise); the level currently being edited is overlaid with its live
// serialized size so the figures track unsaved edits.

export interface PoolOverviewLevel {
  /** Hex id of the level (e.g. `0x43`). */
  levelRecordId: string;
  /** Bytes this level contributes to THIS pool — Σ of its obj/spr blobs that
   *  live here. (Bank15 splits a level's obj vs spr across two pools, so a split
   *  level appears in two entries, each counting only its blob in that pool.) */
  bytes: number;
  /** Whether this level can be migrated to a free region (movable + not
   *  non-symbolically coupled). The Banks panel enables its "→ free space"
   *  button accordingly. */
  migratable?: boolean;
  /** Biased-sprite level (0x19/0xCB) — the panel offers a "De-couple" toggle. */
  decouplable?: boolean;
  /** Whether this level is currently de-coupled. */
  decoupled?: boolean;
  /** Set on the residual row of a level that is ALSO migrated out: its own
   *  blobs left this pool, but its de-coupled spr blob is still placed home
   *  (planLayout places de-couples home-first regardless of migration). The
   *  "→ free space" button is moot for such a row — the level is already
   *  migrated — so the panel disables it. */
  migrated?: boolean;
  /** Set on the residual row of a REMOVED level whose bytes couldn't all be
   *  freed (a non-reclaimable pool, a shared/raw pointer slice, or a borrowed
   *  terminator a kept biased level still needs). The level is out of the game
   *  either way — its `Ptrs:` row points at the sentinels. */
  removed?: boolean;
}

export interface PoolOverviewEntry {
  /** Stable pool id, e.g. `Bank4C` or `Bank15#1`. */
  poolId: string;
  /** Bank as a `0xNN` hex string. */
  bank: string;
  /** Whether the pool can absorb growth via a build-time boundary move. */
  movable: boolean;
  /** Whether levels can be migrated OUT (reclaim) even if the pool can't grow —
   *  true for movable pools and for non-movable-but-reclaimable ones (Bank15). */
  reclaimable: boolean;
  /** Total bytes at the fixed boundary (Σ base blob sizes). */
  capacityBytes: number;
  /** Extra bytes a movable pool may grow by (0 for fixed pools). */
  headroomBytes: number;
  /** Effective limit = `capacityBytes + headroomBytes`. */
  limitBytes: number;
  /** Current total across all blobs in the pool. */
  usedBytes: number;
  /** `limitBytes − usedBytes`. Negative ⇒ over budget. */
  freeBytes: number;
  /** Levels in this pool with their byte usage, descending by bytes. */
  levels: PoolOverviewLevel[];
  /** Levels migrated OUT of this pool into a free region (shown greyed with a
   *  "→ region" tag). Their bytes are no longer in `usedBytes` — the
   *  consolidating reclaim handed that room back, so `freeBytes` rises. `bytes` is
   *  what this level's blobs would re-occupy here if migrated back, so the user can
   *  weigh that against `freeBytes`. Biased-sprite levels keep their de-couple
   *  flags here too: a coupled level migrated to free space has no resident row,
   *  so this is where the panel's de-couple toggle lives for it (de-coupling it
   *  is what frees its partner to migrate). */
  migratedOut?: {
    levelRecordId: string;
    regionId: string;
    bytes: number;
    decouplable?: boolean;
    decoupled?: boolean;
  }[];
  /** Levels REMOVED from the game whose freed blobs left this pool — `bytes`
   *  is what the removal handed back here (already excluded from `usedBytes`). */
  removedOut?: {
    levelRecordId: string;
    bytes: number;
  }[];
}

/** A free region ($FF tail) as a relocation destination, with live usage. */
export interface FreeRegionOverviewEntry {
  /** Stable id, e.g. `FreeRegion51`. */
  id: string;
  /** Bank as `0xNN`. */
  bank: string;
  /** Total free bytes the region offers. */
  capacityBytes: number;
  /** Bytes consumed by migrated-in / de-coupled blobs. */
  usedBytes: number;
  /** `capacityBytes − usedBytes`. */
  freeBytes: number;
  /** Levels relocated into this region, with bytes, descending. */
  levels: PoolOverviewLevel[];
}

export interface PoolOverview {
  romVersion: RomVersion;
  pools: PoolOverviewEntry[];
  /** Free regions usable as relocation targets, with live used/free (YI_U1;
   *  empty for versions without free regions). */
  freeRegions: FreeRegionOverviewEntry[];
}

// ── Render outputs (engine renderers) ──────────────────────────────────────
// Declared here (Node-free) so the renderer-facing contract can re-export them
// instead of hand-redeclaring; the engine modules that produce them
// (`render-gfx-files.ts`, `render-bg1.ts`) re-export from here so their existing
// `snes-framework/<subpath>` import paths keep working.

export interface GfxFileBlock {
  /** Block category. */
  kind: 'cgx-file' | 'animated' | 'sprite-sheet';
  /** Primary label, e.g. `File $0A → BG1`. */
  label: string;
  /** Secondary label, e.g. `VRAM $E000-$E7FF, LZ2, 64 tiles`. */
  sublabel: string;
  /** Bit depth this block was rendered at. */
  bpp: 2 | 4;
  /** Palette row used. */
  paletteRow: number;
  /** Source range in cart ROM (undefined for animated blocks, whose source
   *  is computed per-iteration). */
  srcPC?: number;
  /** Destination offset in VRAM. */
  vramByteOffset: number;
  /** Tile count rendered. */
  tileCount: number;
  /** RGBA8888 pixels of the block (tile grid, no header). */
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface GfxFilesResult {
  blocks: GfxFileBlock[];
}

/**
 * One entry produced by walking `scene_gfx_layout`. Each entry corresponds
 * to one decompressed `cgx_file/*.CGX`-style blob being copied into VRAM —
 * the cart's atomic gfx-load unit. Useful for editor-side inspection of
 * what files this level actually loads (see render-gfx-files.ts). Emitted by
 * `loadLevelGfx`'s optional `manifest` collector (re-exported from
 * `load-graphics.ts` for back-compat).
 */
export interface GfxFileEntry {
  /** Cart file id (0..$EF). For indirect chunk-list entries this is the
   *  resolved id from the DP slot, NOT the raw $F0-$FE chunk byte. */
  fileId: number;
  /** DP slot index the chunk-list entry indirected through (0..12),
   *  corresponding to asm DP `$10..$1C`. `undefined` if the entry used a
   *  literal id ($00-$EF). Layer assignment is reliable from this when
   *  set: 0..2 BG1, 3..4 BG2, 5..6 BG3, 7..12 sprite. Informational — the
   *  BG renderer no longer filters cells by dp-slot (that "wrap-occlusion"
   *  filter was a workaround for the BGxSC tilemap-address bug that
   *  clobbered char data; see scene-regs.ts `decodeBGxSC`). */
  dpSlot?: number;
  /** Compression format. */
  format: 'lz2' | 'lz16';
  /** PC offset of the compressed blob in the cart. */
  srcPC: number;
  /** Destination byte offset in VRAM. */
  vramByteOffset: number;
  /** Decompressed byte length. Resolved per-format:
   *    LZ16 — from the explicit size word in the chunk-list entry.
   *    LZ2  — captured from the decompressor's `destEnd` return value. */
  sizeBytes: number;
}

export interface Bg1RenderResult {
  /** RGBA8888 bitmap at the full BG1 extent (4096 × 2048). Most bytes are
   *  alpha=0 for unstamped cells; only cells with non-zero Map16 IDs get
   *  pixel data. */
  rgba: Uint8Array;
  width: number;
  height: number;
}

/** Local pixel bounds of one sprite's composited Format-B cel, relative to its
 *  tile (x, y) anchor. Bounds depend only on the sprite `num` + the level's gfx
 *  config (NOT placement), so they're deduped by num. The canvas turns these
 *  into a per-sprite click area + selection box: box top-left in level pixels =
 *  (x * CELL_PX - originX, y * CELL_PX - originY), size width × height. */
export interface SpriteCelBounds {
  /** Sprite num these bounds apply to. */
  num: number;
  /** Anchor → bitmap-top-left offset (mirrors `renderSpriteCel`'s originX/Y). */
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** `render:spriteLayer` result — the tier-1 RGBA layer plus the per-num cel
 *  bounds the canvas needs to give cel-backed sprites a real click area +
 *  selection box (replacing the generic marker). Sprites whose num is absent
 *  from `bounds` have no renderable cel and keep the vector-glyph marker. */
export interface SpriteLayerResult extends Bg1RenderResult {
  bounds: SpriteCelBounds[];
}

/** How an approximate-color-math BG2/BG3 layer should be composited in the
 *  editor's static preview. Derived engine-side from the level mode's PPU
 *  registers (TM/TS main+sub membership + CGADSUB add/subtract/half) by
 *  `composeBgLayers`; applied renderer-side as a canvas blend + draw order.
 *  See snes-framework/scripts/engine/bg-layers-compose.ts. */
export interface BgLayerDescriptor {
  /** Whether the layer reaches the screen at all — on the main OR the sub
   *  screen, tilemap loaded, and not a hide / Mode-7 / cinema / offset-data
   *  case. YI composites BG2/BG3 from the SUBSCREEN via color math for most
   *  level modes, so a layer can be visible through TS with its TM bit clear. */
  visible: boolean;
  /** Draw position relative to BG1. `'background'` = behind BG1 over the
   *  backdrop (the normal additive case). `'overlay'` = above BG1 as a
   *  darkening layer — a subscreen layer the cart's color math SUBTRACTS from
   *  the foreground (e.g. the mode-`$0E`/`$02` cave-shadow BG3). */
  role: 'background' | 'overlay';
  /** Canvas globalCompositeOperation approximating the color math:
   *  `'source-over'` for normal/additive layers, `'multiply'` to darken for
   *  subtract overlays (canvas has no native SNES subtract). */
  blend: 'source-over' | 'multiply';
  /** globalAlpha — 0.5 approximates half-result color math, else 1. */
  alpha: number;
}

/** A sparse cell patch for incremental BG1 / collision re-render
 *  (Tier 2 incremental re-render). Only the 16×16 cells whose
 *  rendered output changed since the renderer's last decode of this level:
 *  `coords[2i],coords[2i+1]` = an absolute cell (x 0..255, y 0..127);
 *  `rgba[i*cellPx*cellPx*4 …]` is that cell's RGBA block, in coords order. The
 *  renderer overwrites each cell on its backing canvas with the block — and
 *  because the overwrite replaces alpha too, a cleared cell's all-zero block
 *  erases the old pixels. `width`/`height` are the full layer extent (4096 ×
 *  2048) the backing canvas is sized to. */
export interface LayerCellPatch {
  cellPx: number;
  width: number;
  height: number;
  coords: Int32Array;
  rgba: Uint8Array;
}

/** Object render-validity verdict (`entity-render-validity.ts`): would this
 *  std/ext object's stamped Map16 tiles have their graphics in VRAM under a
 *  given level header? `ok` = every stamped block's sub-tiles are covered
 *  (gfx-loaded or tile-animation-filled) · `degraded` = some blocks miss ·
 *  `invalid` = no block renders · `no-visual` = a ported handler stamped
 *  nothing (command / screen-effect objects — never filtered out) · `unknown`
 *  = handler unported or the probe decode failed (shown, badged, never
 *  hidden). */
export type ObjectRenderVerdict = 'ok' | 'degraded' | 'invalid' | 'no-visual' | 'unknown';

// ── Asm string tables (string-editor model) ──────────────────
// The structured model the string editor loads/saves through the generic
// asm-region resource IPC. One `StringTableModel` per editable `;@editable`
// region (e.g. the level-name table); the panel can show several as tabs.

export interface StringTableEntry {
  /** Stable asm label of the string body (its primary label) — the edit key
   *  the save path matches edited lines onto. */
  label: string;
  /** Display identifier for the UI (display-only; ignored on save). When a
   *  friendly label is available it's shown with the asm label in parens (e.g.
   *  '1-1 (DATA_514A73)'); otherwise just the asm label, preferring the longest
   *  when a body has several (the descriptive alias, e.g.
   *  'DATA_welcome_to_yoshis_island'). For the message-text model the friendly
   *  alias is shown with the reference-cart memory address in parens (e.g.
   *  'DATA_msg_minigame_watermelon_seed (0x5140D3)'), or the bare
   *  'DATA_<bank><offset>' label for a body with no alias. */
  name: string;
  /** The editable text runs (the `"..."` literals), in order. For the
   *  level-name table this is the two centered display lines. Empty for a markup
   *  entry (the content lives in `markup`). */
  lines: string[];
  /** Markup-model content: the whole message as one editable markup string —
   *  plain text + `[token]`s for control codes / special glyphs (see
   *  asm/msg-markup.ts). Set on message-text entries; absent for the line model. */
  markup?: string;
}

export interface StringTableModel {
  /** Resource id = the `;@editable` marker id, e.g. 'level-name-strings'. */
  id: string;
  /** Human label for the tab, e.g. 'Level Names'. */
  title: string;
  /** Characters the font table can encode — the legal input set. */
  allowedChars: string[];
  /** Max total editable characters (= bytes) for the region; edits that push
   *  the total above this are rejected (would overflow the fixed asm budget). */
  budgetChars: number;
  entries: StringTableEntry[];
  /** True when entries use the markup model (`entry.markup`) rather than the
   *  per-line model (`entry.lines`) — i.e. the message-text region. The editor
   *  renders a markup field per entry instead of per-line inputs. */
  markup?: boolean;
  /** True when entries use the per-line model BUT each line is text + insertable
   *  `[glyph]` tokens (the intro/ending cutscene editors): plain Main.txt text
   *  with special glyphs emitted as raw font bytes. The editor renders per-line
   *  inputs (like the line model) AND shows the glyph keyboard. Control bytes are
   *  preserved verbatim, so the guide is glyphs-only (no control codes). */
  glyphLines?: boolean;
  /** Reference list of the insertable markup tokens for the editor's guide:
   *  glyphs + control codes on `markup` models, glyphs-only on `glyphLines`. */
  markupGuide?: MarkupToken[];
}

/** One entry in the markup-token guide: a glyph or control code the user can
 *  insert as `[token]` (see asm/msg-markup.ts). */
export interface MarkupToken {
  /** Token text (without brackets), e.g. `B`, `star`, `br`. */
  token: string;
  /** Human description, e.g. `B button`, `line break`. */
  label: string;
  kind: 'glyph' | 'control';
}

/** Parsed message font (Main.txt) — char↔byte maps + the encodable char set.
 *  Lives here (Node- and DOM-free) so the renderer can import codec helpers that
 *  reference it (e.g. the markup byte-size estimator) without dragging the
 *  node:fs-backed loader in `scripts/asm/font-table.ts`. */
export interface FontTable {
  charToByte: Map<string, number>;
  byteToChar: Map<number, string>;
  /** Encodable characters, in the order Main.txt lists them. */
  chars: string[];
}

// ── Message-pointer table (DATA_message_box_text_ptrs editor model) ─────────
// The `$51:10DB` message-ID → message-body pointer table: 300 fixed slots, each
// a symbolic `dw <body-label>` the engine indexes by message ID. The editor
// repoints slots via dropdowns (never adds/removes). One `MessagePtrTableModel`
// per `;@editable:message-box-text-ptrs` region; loaded/saved through the same
// asm-region resource IPC as the string tables. See scripts/strings.ts.

/** One selectable message body (a dropdown option) — the targets the pointer
 *  table can reference. */
export interface MessagePtrOption {
  /** Stable id = the body's primary asm label (what's written as `dw <id>`),
   *  e.g. 'DATA_msg_minigame_watermelon_seed' or 'DATA_511D15'. */
  id: string;
  /** Display label: friendly alias + reference address, mirroring
   *  `StringTableEntry.name` (e.g. 'DATA_msg_minigame_watermelon_seed (0x5140D3)'). */
  name: string;
  /** First plain-text line of the message (tokens stripped), for quick
   *  identification in the row. Empty for the bare-$FFFF empty message. */
  preview: string;
}

export interface MessagePtrTableModel {
  /** Discriminates this from `StringTableModel` on the shared asm-region IPC. */
  kind: 'pointer-table';
  /** Resource id = the `;@editable` marker id ('message-box-text-ptrs'). */
  id: string;
  /** Human label for the tab, e.g. 'Message Pointers'. */
  title: string;
  /** The selectable message bodies (dropdown options), in region order. */
  options: MessagePtrOption[];
  /** One entry per table slot; index = message ID. Each is an option `id`, or
   *  '' for a `$0000` null slot. */
  slots: string[];
}

// ── World-map entrance table (world-map editor model) ──────────────────────
// The structured model the world-map editor loads/saves through the generic
// `world-map` resource IPC. One record per slot in `DATA_map_level_entrances`
// (the `;@editable:world-map-entrances` region); fixed 4-byte records edited in
// place, so there's no byte budget. See scripts/world-map.ts + scripts/asm/entrance-table.ts.

export interface WorldMapEntrance {
  /** 0-based position in DATA_map_level_entrances — the stable edit key. */
  index: number;
  /** byte +0 — level-data id (×6 → Ptrs:). The data this world-map tile plays. */
  levelDataId: number;
  /** byte +1 — entrance X in 16-px cells (×16 → Player.X). */
  spawnX: number;
  /** byte +2 — entrance Y in 16-px cells (×16 → Player.Y). */
  spawnY: number;
  /** byte +3 — world-map progression target: the MAP SLOT (translevel space,
   *  NOT a record id) the Yoshi token advances to after this level is cleared
   *  — it lands in CurrentLevelFromMap. The `!Define_YI_LevelID_*` symbols the
   *  serializer writes here are translevels. */
  progTarget: number;
}

/** One record in `DATA_map_level_midway_entrances` — the checkpoint re-entry
 *  state used when restarting past a middle ring. Packed as `dw lohi, lohi`. Byte
 *  +3 differs from the main table: it's the player entrance STATE (pose), not a
 *  progression target. */
export interface WorldMapMidwayEntrance {
  /** 0-based position in DATA_map_level_midway_entrances — the stable edit key. */
  index: number;
  /** byte +0 — level-data id of the sub-room Yoshi re-enters at this checkpoint. */
  levelDataId: number;
  /** byte +1 — re-entry X in 16-px cells. */
  spawnX: number;
  /** byte +2 — re-entry Y in 16-px cells. */
  spawnY: number;
  /** byte +3 — player entrance state (pose) consumed by the gm35 midring restart. */
  entranceState: number;
}

export interface WorldMapModel {
  entrances: WorldMapEntrance[];
  /** Index table (`DATA_level_entrance_indexes`): translevel slot (hex string,
   *  e.g. '0x07') → record index in `entrances` (offset/4). Only slots with a real
   *  main entrance are present — a `$0000` offset (bonus / mini-game / padding
   *  slots that have no main entrance record) is excluded, except translevel 0
   *  which legitimately maps to record 0. */
  translevelToRecordIndex: Record<string, number>;
  /** Midway/checkpoint records (`DATA_map_level_midway_entrances`). */
  midway: WorldMapMidwayEntrance[];
  /** Midway index (`DATA_level_midway_entrance_indexes`): translevel slot (hex
   *  string) → BASE midway record index. A level's checkpoint PAGES are the
   *  records from this base up to the next allocated base (runtime adds
   *  `CheckpointReentryPage × 4`). Only slots with a real midway are present (a
   *  `$0000` offset = no midway, except translevel 0); the renderer derives the
   *  page count per slot from the sorted distinct bases + `midway.length`. */
  midwayIndex: Record<string, number>;
  /** RAW index-table words (`dw` values, byte offsets ×4 into the record
   *  tables) — the EDITABLE form behind the two derived maps above. Present
   *  only when the asm carries the `world-map-(midway-)entrance-indexes`
   *  markers (older overlays may predate them); the serializer splices changed
   *  words in place. The ROM importer writes a hack's translevel→record remap
   *  through these. One word per translevel slot (72 incl. trailing padding). */
  entranceIndexWords?: number[];
  midwayIndexWords?: number[];
  /** The PRISTINE BASE index words (same shape), attached by the app layer
   *  (resources.ts `loadWorldMapResource`) so the editor can re-wire a slot
   *  that's been unwired (a removed level zeroes its words) back to its base
   *  entrance/midway records. Read-only reference data — the serializer never
   *  writes these. */
  baseEntranceIndexWords?: number[];
  baseMidwayIndexWords?: number[];
}

// ── Per-level Map16 usage (Tiles "Used in this level" view) ─────────────────
// Computed by engine/level-tile-usage.ts from a decoded level's Map16 buffer.

/** Whether a tile's graphics are actually present in VRAM:
 *  `loaded` = covered by a loaded gfx chunk; `anim` = filled by the
 *  tile-animation pass (coins / !-switch slots); `miss` = nothing there
 *  (the block stamps a tile whose graphics aren't loaded — renders garbage). */
export type TileCoverage = 'loaded' | 'anim' | 'miss';

export interface Map16SubTileUsage {
  /** 0..1023 — tile index into VRAM, relative to the BG1 char base. */
  tileIndex: number;
  /** 0..7 — BG palette row (CGRAM rows 0..7). */
  paletteRow: number;
  hflip: boolean;
  vflip: boolean;
  /** Absolute VRAM byte offset this sub-tile reads (`bg1CharAddr + idx*32`). */
  vramByteOffset: number;
  coverage: TileCoverage;
}

/** One distinct Map16 ID a level stamps, with health + palette annotations. */
export interface UsedMap16 {
  /** Map16 ID (page<<8 | tile). */
  id: number;
  page: number;
  tile: number;
  /** Cells in the level that stamp this ID. */
  count: number;
  /** `tile >= pageCellCount` — the block indexes past its page's real data. */
  overflow: boolean;
  /** The four 8×8 sub-tiles (TL, TR, BL, BR). */
  subTiles: Map16SubTileUsage[];
  /** Worst coverage across the four sub-tiles (drives the health badge). */
  coverage: TileCoverage;
  /** Distinct palette rows (0..7) the four sub-tiles reference, ascending. */
  paletteRows: number[];
}

export interface LevelMap16Usage {
  /** Used blocks, most-placed first (descending `count`, then ascending `id`). */
  blocks: UsedMap16[];
  /** Distinct BG palette rows (0..7) any used block references, ascending. */
  paletteRowsUsed: number[];
  /** Total stamped (non-zero) cells across allocated screens. */
  totalCells: number;
}

// ── Palette-colour editing (§B10) ───────────────────────────────────────────

/** One edited BGR-15 colour in the master palette blob — `offset` is the byte
 *  offset from the blob base (= `loadLevelPalettes` provenance value), `value`
 *  the new 16-bit colour. A global edit (the blob is shared by palette index). */
export interface PaletteEdit {
  offset: number;
  value: number;
}

/** One edited BGR-15 stop in a backdrop gradient table. `offset` is a byte offset
 *  into the virtual 16-table gradient blob — `gradientId * GRADIENT_STRIDE_BYTES +
 *  stopIndex * 2` — so the 16 tables (one per BackgroundColor $10..$1F) share one
 *  flat `{offset,value}` shape with `PaletteEdit`. `value` is the new 16-bit
 *  colour. A global edit (the table is shared by every level using that
 *  BackgroundColor). See `gradient-edit.ts`. */
export interface GradientEdit {
  offset: number;
  value: number;
}

/** One swatch in the whole-game palette catalog (`buildPaletteCatalog`). */
export interface PaletteCatalogSwatch {
  /** Master-blob byte-offset backing this swatch — the `PaletteEdit.offset` an
   *  edit writes (and the live-draft key). `-1` = not blob-backed (display-only,
   *  e.g. a scene CGRAM entry the interpreter loaded from a non-blob source). */
  offset: number;
  /** Base (pristine, pre-edit) BGR-15 colour word; the UI overlays the live edit
   *  draft on top by `offset`. */
  base: number;
  /** Additional blob byte-offsets that hold the SAME colour and should receive
   *  the same edit (so one swatch edit updates every copy). Used by the World-map
   *  panels group, where worlds 4–6 store their panel colour once per world
   *  palette. Absent/empty ⇒ a plain single-offset swatch. */
  mirrors?: number[];
}

/** One selectable palette in the catalog (a labelled strip of swatches) — e.g.
 *  "BG1 #0x05", a single backdrop colour, or a whole composed scene CGRAM. */
export interface PaletteCatalogEntry {
  /** Primary label, e.g. `#0x05`, `World 4 map`, `Title screen`. */
  label: string;
  /** Optional secondary note, e.g. `rows 4–5 · terrain` or `OBJ pal 5 · Yoshi`. */
  sublabel?: string;
  /** Swatches per display row (the grid is laid out row-major at this width). */
  cols: number;
  swatches: PaletteCatalogSwatch[];
}

/** A labelled group of catalog entries (one pointer table, or one scene class). */
export interface PaletteCatalogGroup {
  /** Stable id, e.g. `bg1`, `bg2`, `sprite`, `backdrop`, `fixed`, `scene`. */
  id: string;
  label: string;
  /** What the graphics pipeline knows about these rows (shown under the header). */
  note?: string;
  entries: PaletteCatalogEntry[];
}

/** The whole-game palette catalog — every palette the cart can select out of the
 *  master blob, organised two ways. Both axes share the global blob-offset edit
 *  model (a swatch edit propagates everywhere that offset is used). */
export interface PaletteCatalog {
  /** Master-blob palettes organised by the cart's pointer tables (BG1/BG2/BG3/
   *  sprite/Yoshi/backdrop) plus the fixed/universal literal rows. */
  catalog: PaletteCatalogGroup[];
  /** System-screen / scene palettes — the composed CGRAM for each known context
   *  (boot, title, storybook, per-world maps). */
  scenes: PaletteCatalogGroup[];
}

// ── Custom patches (post-build binary patch layer) ──────────────────────────
// A patch is byte-level edits applied to the FINISHED build (after asar + the
// project overlay). On disk a patch is a single **self-contained JSON file**
// (`PatchFile`): name/description plus the chunks — each just an absolute
// reference (V1.0) PC offset + hex bytes. It is the source of truth and
// hand-editable in a text editor; IPS is import-only (importing flattens an
// `.ips` into these address-based chunks).
//
// Drift tracking is a BUILD-TIME transform, not stored: at apply each offset is
// remapped through the reference symbols → nearest asm label + delta → that
// label's address in the just-built ROM. So an offset stays correct even after
// asm edits shift the cart, with no label baked into the JSON to go stale.

export type PatchSource = 'builtin' | 'imported' | 'user';

/** A runtime chunk = one contiguous byte write, addressed one of two ways
 *  (exactly one of `offset` / `label` must be set):
 *   - `offset`: absolute reference (V1.0) PC offset — reverse-looked-up to the
 *     nearest asm label + delta at apply, so it tracks asm drift.
 *   - `label` (+ optional `labelOffset`): a `.sym` label resolved DIRECTLY against the
 *     just-built ROM's symbols. No reverse-lookup; the patch names its own anchor.
 *  `bytes` is raw; the on-disk form is `StoredPatchChunk` (hex bytes). */
export interface PatchChunk {
  /** Absolute reference (V1.0) PC offset. Reverse-looked-up + remapped at apply. */
  offset?: number;
  /** Sym label (e.g. `CODE_04F6CE`); resolved against the build `.sym` at apply. */
  label?: string;
  /** Byte offset added to the resolved label address (default 0; label form only). */
  labelOffset?: number;
  bytes: Uint8Array;
}

/** On-disk chunk — the JSON form of `PatchChunk` (bytes as uppercase hex). */
export interface StoredPatchChunk {
  /** Absolute reference (V1.0) PC offset as a hex string, e.g. "0x62D2".
   *  ("$.."/bare-hex and legacy decimal numbers are still accepted on read.) */
  offset?: string;
  label?: string;
  /** Byte offset added to the resolved label address, as a hex string (e.g.
   *  "0x1F"). ("$.."/bare-hex and legacy decimal numbers are still accepted on
   *  read.) */
  labelOffset?: string;
  /** Hex bytes. Written packed + uppercase ("EAEAEAEA"); on read, `$NN`/`0xNN`
   *  byte prefixes and whitespace/comma separators ("$EA $EA") are also accepted. */
  bytes: string;
}

/** A self-contained patch file (`<id>.json`). The source of truth on disk. */
export interface PatchFile {
  id: string;
  name: string;
  /** Group heading the prepackaged catalog lists this patch under (e.g.
   *  "Flutter! - Death Mechanics"). Absent → grouped under "Other". */
  category?: string;
  /** Concise, user-facing summary shown in the patches panel. */
  description?: string;
  /** Source credit (original hack + author + URL), shown on its own line below
   *  the description in the patch tooltip. */
  attribution?: string;
  /** Technical mechanism notes (addresses, opcodes, scope). Not shown in the
   *  UI - reference for hand-editing the JSON. One array entry per line. */
  details?: string[];
  source: PatchSource;
  /** Best-effort ROM version the offsets were authored against (community IPS
   *  ≈ USA V1.0). Warned about on a version mismatch. */
  romVersionAuthored?: RomVersion;
  /** Original filename, for imported patches. */
  importedFrom?: string;
  /** asar source assembled INTO the ROM at build time (pre-compile), via the
   *  framework's `YI_ApplyPatchesPostAssembly` hook (the final build phase). Use
   *  `org` for trampolines / in-place edits, and `%patchcode()` / `%endpatchcode()`
   *  (the reserved patch pool) for NEW routines — do NOT use asar `freespace` /
   *  `freecode` (asar can't confine them to a safe region on this cart; the pool is a
   *  reserved carve-off of the Bank51 free region, kept clear of the level-data
   *  relocation allocator — see pool-map.ts PATCH_POOL_REGION_ID).
   *  Engine labels are injected as `!CODE_*` / `!RAM_*` defines (resolved against the
   *  just-built ROM, so they survive asm drift). One string (newline-joined) or an
   *  array of lines. A patch may carry `asm`, `chunks`, or both. */
  asm?: string | string[];
  /** Binary byte-writes applied post-build (after asar). Optional — an asm-only
   *  patch omits it. */
  chunks?: StoredPatchChunk[];
}

/** One resolved chunk write in the apply report. */
export interface PatchChunkResolution {
  patchId: string;
  /** Resolved absolute offset actually written. */
  offset: number;
  length: number;
  resolvedVia: 'label' | 'absolute';
  label?: string;
}

/** A byte range where ≥2 enabled patches overlap (later in order wins). */
export interface PatchConflict {
  offset: number;
  length: number;
  patchIds: string[];
}

/** Result of applying a project's enabled patches to a built ROM. */
export interface PatchApplyReport {
  /** Patch ids applied, in order. */
  applied: string[];
  /** Patches/chunks dropped, with why (e.g. unresolved label + out-of-bounds). */
  skipped: Array<{ id: string; reason: string }>;
  /** Human-readable advisories (label fallbacks, version mismatch, …). */
  warnings: string[];
  conflicts: PatchConflict[];
  chunks: PatchChunkResolution[];
  bytesWritten: number;
  /** New checksum after the fix-up (or the unchanged one when no bytes wrote). */
  checksum: number;
}

// ── ROM import (read a modified/built cart back into overlays) ──────────────
// Framework-side analysis shapes for the "import from a third-party ROM"
// feature. The app layer (src/main/rom-import,
// src/shared/ipc-types) wraps these into the renderer-facing report (adds
// per-level overlay-conflict flags + friendly names).

/** How an anchor table's address was recovered in the foreign cart. The
 *  resolution ladder tries these in order. */
export type AnchorMethod =
  | 'vanilla-addr' // table sits at its unmodified V1.0 address (common case)
  | 'code-signature' // recovered from the engine routine that reads it
  | 'scan' // brute-force structural scan of the ROM
  | 'manual' // user-supplied address
  | 'sym' // user-supplied asar .sym
  | 'unresolved'; // could not be located

/** One resolved (or unresolved) top-level table anchor in the foreign cart. */
export interface AnchorResolution {
  /** Stable key, e.g. `'levelPtrs'`. */
  key: string;
  /** Human label, e.g. `'Level-data pointer table'`. */
  label: string;
  /** Vanilla V1.0 PC offset the validator started from. */
  vanillaPc: number;
  /** Resolved PC offset in the foreign cart, or null if unresolved. */
  pc: number | null;
  method: AnchorMethod;
  /** 0..1 — validator score / confidence in the resolved address. */
  confidence: number;
  /** Whether this anchor is required for the categories being imported. */
  required: boolean;
  note?: string;
}

/** Decoded-stream summary counts for one level (base or foreign side). */
export interface LevelStreamCounts {
  objects: number;
  sprites: number;
  exits: number;
  objBytes: number;
  sprBytes: number;
}

/** How importable a changed level is. */
export type LevelImportability =
  | 'full' // decode→serialize round-trips: import as an editable level
  | 'raw-only' // decode gap: import raw bytes, flagged (may not edit/render right)
  | 'blocked'; // cannot be saved per-level (exceptional/aliased/special slot)

/** One record whose foreign streams differ from the base cart. */
export interface ForeignLevelDiff {
  recordId: number;
  objChanged: boolean;
  sprChanged: boolean;
  importability: LevelImportability;
  blockedReason?: string;
  /** True when the hack REPOINTED this record's streams (its `Ptrs:` row differs
   *  from vanilla — GoldenEgg's save relocates into its free space). Feeds the
   *  apply-side auto-migration: an imported level that no longer fits its home
   *  pool is marked migrated so the build places it in our free regions. */
  relocated?: boolean;
  /** Base-cart decode summary (null if the base slot is empty/special). */
  base: LevelStreamCounts | null;
  /** Foreign-cart decode summary (null if the foreign slot is empty). */
  foreign: LevelStreamCounts | null;
}

/** One category row of the detect-only diff inventory: bytes that differ from
 *  base, grouped by the cart structure they fall in (import/inventory.ts). */
export interface InventoryCategory {
  key: string;
  /** Human label, e.g. `'Compressed graphics (LZ2/LZ16)'`. */
  label: string;
  /** Differing bytes attributed to this category. */
  bytes: number;
  /** Contiguous diff runs (a rough "how scattered" signal). */
  runs: number;
  /** True when a semantic import already covers this category (level data,
   *  palette colours, strings, world map) — the diff is expected, not dropped. */
  imported: boolean;
  /** Up to 3 sample locations, `'label+0x12 (34 B)'`. */
  examples: string[];
}

/** Detect-only inventory of EVERY byte the foreign cart changed, including the
 *  regions the importer can't apply (graphics, Map16, collision, code …). */
export interface RomImportInventory {
  totalDiffBytes: number;
  /** Non-empty categories, descending by bytes. */
  categories: InventoryCategory[];
}

/** Result of analysing a foreign cart against the base V1.0 cart. */
export interface RomAnalysis {
  foreignMd5: string;
  /** Whether the foreign cart looks V1.0-derived (engine constants validate). */
  baseDerived: boolean;
  baseNote?: string;
  anchors: AnchorResolution[];
  /** True when the level-data pointer table resolved (level import is possible). */
  levelPtrsResolved: boolean;
  /** Only the records whose streams differ from base. */
  levels: ForeignLevelDiff[];
  /** Full-cart diff inventory (absent when the pointer table didn't resolve —
   *  nothing aligns, so per-structure attribution would be noise). */
  inventory?: RomImportInventory;
}

// ── Level validation (Validation panel) ─────────────────────────────────────
// Static playability lints — the editor-surfaced analogue of the dev CLIs
// (sweep-levels / validity-report / validate-neighbor-deps). Produced by the
// main-side engine `scripts/engine/validation.ts`, consumed by the renderer's
// ValidationPanel. Catches level designs that look fine in the static editor
// but break, glitch, or read garbage at runtime. See the panel for the catalog.

export type ValidationSeverity = 'error' | 'warning' | 'info';

/** One finding against one level. */
export interface ValidationIssue {
  /** Stable check id (e.g. 'sprite-cap', 'item-memory', 'warp-dest'). */
  check: string;
  /** Short check title for grouping in the UI. */
  title: string;
  severity: ValidationSeverity;
  /** One-line, human-readable description of this specific finding. */
  message: string;
  /** Record id of the level this issue is in. */
  levelRecordId: number;
  /** Tile-grid cell to focus the camera on when the user clicks the issue. */
  x?: number;
  y?: number;
  /** Entity to select on jump, so the user lands on the offending item. */
  entity?: { kind: 'object' | 'sprite' | 'exit'; id?: number };
  /** The specific sprites this issue concerns (a collision group, every
   *  missing-gfx placement, …). Rendered as a collapsible id + position list,
   *  each jump-able. `levelRecordId` overrides the issue's level for cross-level
   *  findings (the sprites live in different levels). */
  sprites?: { num: number; x: number; y: number; levelRecordId?: number }[];
}

/** Collectible tally for a level (the Advynia "Count Items" readout). */
export interface CollectibleCounts {
  /** Sprite 0x0FA / 0x110. */
  flowers: number;
  /** Sprite 0x065. */
  redCoins: number;
  /** Floating-coin sprite 0x1AF + coin objects 0x68 / 0x8A. */
  coins: number;
  /** All item-memory-tracked collectibles considered by the collision check. */
  tracked: number;
}

/** Per-level validation result. */
export interface LevelValidationResult {
  levelRecordId: number;
  /** Friendly level name, when resolvable from the catalog. */
  name?: string;
  issues: ValidationIssue[];
  counts: CollectibleCounts;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

/** Result of the all-levels sweep. */
export interface AllLevelsValidationResult {
  /** Per-level results — only levels with ≥1 issue are included. */
  levels: LevelValidationResult[];
  /** Cross-level findings (item-memory collisions across warp-connected levels). */
  crossLevel: ValidationIssue[];
  levelsChecked: number;
  /** Totals across per-level + cross-level findings. */
  totalErrors: number;
  totalWarnings: number;
  totalInfo: number;
}

/** Decode-derived signals the renderer-side check engine can't compute itself
 *  (they come from running the object decoder main-side). A thin projection of
 *  the engine `DecodeState` / `DecodeStats`. */
export interface LevelDecodeSignals {
  /** False when the level couldn't be decoded at all (the rest is meaningless). */
  decoded: boolean;
  /** 128-byte screen→LRU-page map (low 6 bits = page; `0x80` = unmapped).
   *  Plain number[] for IPC transport. */
  screenPageMap: number[];
  /** Distinct allocated pages (cap is 63). */
  pageCount: number;
  /** Decode overflowed the page pool (>63) — buffer corruption. */
  overflowed: boolean;
  /** Decode aborted mid-stream — malformed object data. */
  aborted: boolean;
}

/** One level's inputs for the all-levels sweep — the renderer runs the checks. */
export interface LevelValidationInput {
  levelRecordId: number;
  level: LevelData;
  signals: LevelDecodeSignals;
  /** True when this record is entered from the world map (a value in
   *  `translevelToRecord`). A fresh item-memory session starts here — the
   *  bitmap is cleared on map entry, then persists across screen-exit warps —
   *  so the cross-level item-memory check roots its sessions at these. */
  isRoot: boolean;
}
