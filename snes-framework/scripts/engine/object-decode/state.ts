// Shared mutable state for the YI object-decode pipeline. Mirrors the
// zero-page + WRAM/SRAM state the cart's Bank10/12/13 routines use, so a
// straight TS port of each routine can read & write the same "registers"
// the asm refers to.
//
// Naming follows the asm's zero-page DP slots — `zp1B`, `zp1C`, etc. —
// to make line-by-line correspondence with the source asm trivial during
// porting and review. Yes it's ugly; the explicit names beat trying to
// figure out which "scratch byte" $1B refers to mid-trace.
//
// See:
//   docs/leveldataengine.md §3.4 (walker zero-page contract)
//   yi/Banks/Bank12.asm:830-925 (full walker ZP table)

/** A per-cell handler is called by the walker for each Map16 cell of an
 *  object's rectangle. It reads state (mostly `zp1D` = buffer offset and
 *  `zp12` = current Map16 ID) and writes the new Map16 ID into the buffer. */
export type PerCellHandler = (state: DecodeState) => void;

/** An init handler is dispatched by the Bank10 parser for each object byte
 *  encountered. It typically sets up the walker rectangle + per-cell handler
 *  via `walkerSetupTrampoline(state, handler)`. */
export type InitHandler = (state: DecodeState) => void;

/**
 * Per-decode replacement of object handlers, keyed by object id.
 *
 * The registry in `handlers/index.ts` is a module-level singleton holding OUR
 * cart's (retail V1.0) handler set — correct for every level the editor edits.
 * These overrides exist for decoding streams authored against a DIFFERENT
 * object table: the source leak's pre-release generations reuse the same ids
 * for entirely different objects (e.g. std $21-$30 are a soap-bubble family in
 * the oldest dispatch table and the jungle family in the retail one), so the
 * retail handler draws confidently-wrong geometry for them.
 *
 * Scoped to one `decodeLevel` call, so a research renderer can swap in an era's
 * handlers without touching the global registry the editor depends on.
 *
 * A `null` VALUE means "explicitly draw nothing" — distinct from an ABSENT key,
 * which falls through to the globally-registered handler. Use it when the era's
 * object is known to differ but hasn't been ported: drawing nothing is honest,
 * drawing the retail object is not.
 */
export interface ObjectHandlerOverrides {
  /** Standard-object id → handler (or null for "draw nothing"). */
  std?: ReadonlyMap<number, InitHandler | null>;
  /** Extended-object id → handler (or null for "draw nothing"). */
  ext?: ReadonlyMap<number, InitHandler | null>;
}

/** A parsed exit record (5 bytes on disk; we store the decoded fields). */
export interface DecodedScreenExit {
  /** Source screen index (0..127) — the page byte from the stream. */
  sourceScreen: number;
  /** Destination level ID or minibattle ID. */
  destLevelRecordId: number;
  /** Destination X cell coord. */
  destX: number;
  /** Destination Y cell coord. */
  destY: number;
  /** Entrance type byte (player-state to spawn into). */
  entranceType: number;
}

/** Top-level result of running the object decoder. */
export interface DecodeResult {
  /** 32 KB Map16 ID grid. Indexed by per-screen-allocated byte offset
   *  (NOT raw (x,y) — use the per-screen map to translate). */
  levelDataBuffer: Uint8Array;
  /** Per-screen page mapping. screenPageMap[screen] = LRU page index
   *  (0 = unallocated, 1..63 = allocated page). */
  screenPageMap: Uint8Array;
  /** Total number of distinct screen pages allocated by the decoder. */
  pageCount: number;
  /** Parsed screen exits, in stream order. */
  exits: DecodedScreenExit[];
}

const LEVEL_DATA_BUFFER_BYTES = 0x8000; // $7F:8000..$7F:FFFF, 32 KB
const SCREEN_PAGE_MAP_BYTES = 128;       // $6CAA,x — 128 screens max
const LRU_CHAIN_BYTES = 64;              // $0D4E + 64 entries

/** Per-tileset Map16-ID template slots — cart WRAM `$00:19DA..$00:1FDA`,
 *  populated at level-load by `init_per_tileset_template_slots`
 *  (Bank10 `CODE_init_per_tileset_template_slots`) and consumed by Bank13 shape-aware stamp
 *  handlers via `CMP.w $1C92` / `LDA.w $1C9A` etc. Stored as 16-bit
 *  Map16 IDs; indexed by `(wramAddr - $19DA) >>> 1`. */
export const TEMPLATE_WRAM_BASE = 0x19DA;
export const TEMPLATE_WORD_COUNT = 0x300; // covers $19DA..$1FDA — wider than $1DFC max for safety

/**
 * Working state for one full level-load run. Allocate fresh per call —
 * everything's mutable and the asm freely walks through it.
 */
export class DecodeState {
  // --- Backing storage --------------------------------------------------
  /** The Map16 ID grid (cart `!RAM_YI_Level_LevelDataBuffer`, $7F:8000). */
  readonly levelDataBuffer = new Uint8Array(LEVEL_DATA_BUFFER_BYTES);
  /** Per-screen LRU page mapping (cart `$6CAA,x`). 0 = unallocated. */
  readonly screenPageMap = new Uint8Array(SCREEN_PAGE_MAP_BYTES);
  /** Per-screen LevelDataBuffer base offset table (cart `$6CA9,x`).
   *  Populated lazily by `resolveScreenPage`. */
  readonly screenBufBase = new Uint8Array(SCREEN_PAGE_MAP_BYTES);
  /** 64-entry LRU round-robin chain (cart `$0D4E,y`). */
  readonly lruChain = new Uint8Array(LRU_CHAIN_BYTES);
  /** Per-tileset sentinel Map16 IDs the Bank13 stamp handlers compare
   *  against. Cart WRAM `$00:19DA..$00:1FDA` (16-bit Map16 IDs).
   *  Populated by `populateTemplates` at level-load. Indexed by
   *  `(wramAddr - TEMPLATE_WRAM_BASE) >>> 1`; use `templateAt(addr)`
   *  for natural address-style access. */
  readonly templates = new Uint16Array(TEMPLATE_WORD_COUNT);

  // --- Source stream ----------------------------------------------------
  /** The level's object .bin bytes (or cart-resident slice). */
  src!: Uint8Array;
  /** Byte cursor into `src` — cart `$99`. Bank10 parser advances this. */
  ptrOffset = 0;

  // --- 15-field unpacked level header (cart `$7E:0134..0152`) -----------
  /** Indexed by field number 0..14. See yi/Banks/Bank10.asm:1044 for the
   *  field meanings (BG color, BG1/2/3 tileset/palette, sprite tileset/
   *  palette, level mode, animation tileset/palette, BG scroll rate,
   *  music, item memory). */
  readonly header = new Array<number>(15).fill(0);

  // --- Zero-page scratch (per-handler register file) --------------------
  // Names: `zp<hex>` mirrors the cart DP slot. Comments cite usage.
  zp00 = 0; // scratch 16-bit temp
  zp02 = 0; // scratch 16-bit temp
  zp0A = 0; // sign-extend length byte (long-form parser)
  zp0E = 0; // working Map16 position low (for fetch primitives)
  zp0F = 0; // working Map16 position high
  zp12 = 0; // current cell's Map16 ID (latched by getCurrentMap16Tile)
  zp14 = 0; // per-column slope accumulator
  zp15 = 0; // object ID (set by parser) / orientation byte
  zp17 = 0; // per-row slope advance (added to $14 on each row step)
  zp19 = 0; // row-walk end (trampoline sets to $7FFF = unbounded)
  zp1B = 0; // current cell low byte (sub-screen nibble-interleaved coords)
  zp1C = 0; // current cell high byte (screen-page coords)
  zp1D = 0; // cell byte offset into levelDataBuffer
  zp28 = 0; // column counter (signed)
  zp2A = 0; // column extent (signed; negative grows left)
  zp2B = 0; // high byte of the 16-bit column extent ($2A:$2B). NOT a
            // "screen-page carry" — the fetch primitives derive that from $2C's
            // high nibble via the cart's `LDA $2B` word-read of $2B:$2C (see
            // fetch.ts). Read as `zp2A | (zp2B<<8)` by signed-extent handlers.
  zp2C = 0; // row counter (signed)
  zp2E = 0; // row extent (signed; negative grows up)
  zpA1 = 0; // shared "handler parameter / variant index" slot. Slope
            // stampers ($E4/$E5/$E6/$E8) latch a prng-rolled variant
            // into this on the first cell of each object; subsequent
            // cells read it back to pick from their per-variant tile
            // record. Cart DP slot $A1; survives across cells within
            // one object (reset by init handlers as needed).

  // --- Allocator state --------------------------------------------------
  /** Total screens allocated this level so far (cart `$97`). */
  pageCount = 0;
  /** Last-allocated screen-page index (cart `$0D4D`, page LRU counter). */
  lastLruPage = 0;
  /** "Rewound" flag (cart `$9B`) — non-zero = walker wrapped to new screen. */
  rewound = 0;

  /** Per-decode object-handler replacement (see `ObjectHandlerOverrides`).
   *  Null = use the global registry for every id, the editor's normal path.
   *  Set by `decodeLevel` AFTER `reset()`, like the PRNG replay fields. */
  handlerOverrides: ObjectHandlerOverrides | null = null;

  // --- Per-cell handler slots (set by init handler before walker runs) -
  /** Cart $1F/$21 — handler for ODD column index. */
  oddColHandler: PerCellHandler | null = null;
  /** Cart $22/$24 — handler for EVEN column index. */
  evenColHandler: PerCellHandler | null = null;
  /** Cart $25/$27 — handler for row-end boundary. */
  rowHandler: PerCellHandler | null = null;

  // --- PRNG state -------------------------------------------------------
  /** Deterministic 16-bit LFSR seed for our PRNG port. The cart uses
   *  HV-counter entropy which we can't reproduce offline; this gives a
   *  reproducible but uncorrelated value for cosmetic-randomness handlers.
   *  `reset()` restores this default; `decodeLevel`'s `prngSeed` option then
   *  overrides it (the editor's "Refresh RNG" action — re-rolls the cosmetic
   *  random-tile variants by starting the LFSR from a different value). */
  prngState = 0xACE1;
  /** Optional captured cart-PRNG output sequence (one byte per get_random_byte
   *  call, in call order) from the `level-rng` trace. When set, `prngNext`
   *  returns these bytes instead of the LFSR, so the decode reproduces the live
   *  game's exact random-tile variants (the cart PRNG is stateless — only its
   *  output sequence is replicable). Falls back to the LFSR once exhausted. */
  prngReplay: readonly number[] | null = null;
  /** Per-caller-site captured PRNG queues (cart caller PC → {bytes, cursor}),
   *  the preferred replay form: it keeps each Bank13 stamper site's sequence
   *  aligned even when other sites' call counts diverge. Built per decode from
   *  the `prngReplayBySite` option. A tagged `prngNext(state, site)` consumes
   *  from the matching queue; untagged calls / unmatched sites fall back to
   *  `prngReplay` then the LFSR. */
  prngReplayBySite: Map<number, { bytes: readonly number[]; idx: number }> | null = null;
  /** Cursor into `prngReplay`; `prngCalls` = total `prngNext` calls this decode
   *  (for trace-alignment diagnostics). Both reset per decode. */
  prngReplayIdx = 0;
  prngCalls = 0;

  // --- Exit list (parsed in tail of LoadLevelData) ---------------------
  readonly exits: DecodedScreenExit[] = [];

  // --- Provenance side-channel (object drag cell-highlight) -------------
  // Inert on the normal decode path: all three stay at their defaults and the
  // recorder in `_shared.ts` short-circuits on `provenanceCells === null`, so
  // BG1 / collision / layout decodes are byte-for-byte unchanged. Armed only by
  // the `objectInfluence` IPC, for ONE object (single drag) or a SET of objects
  // (multi-select drag) — one decode records all of them.
  /** Record which cells these STREAM INDICES write (the dragged object, or the
   *  whole multi-selection). null = off. */
  provenanceTargets: Set<number> | null = null;
  /** Stream index of the object currently being stamped — set by the parser
   *  before each handler dispatch (= the object's index in `level.objects`). */
  currentObjectIndex = -1;
  /** Recorded cells for `provenanceTargets`: buffer byte-offset → flags.
   *  `neighbor` = written into a cell other than the current footprint cell
   *  (the cart's `PutrTile` / `state 0x10` touch-up); `buried` = a strictly-LATER
   *  non-target object overdrew it; `by` = the target stream index that last
   *  wrote it (so a later non-target buries it, but an earlier one can't, and a
   *  later target re-stamping restores it). With several targets the map is keyed
   *  by cell offset → each cell carries the LAST writer's class, matching what the
   *  decode renders. Allocated only when targets are armed. */
  provenanceCells: Map<number, { neighbor: boolean; buried: boolean; by: number }> | null = null;

  /** Per-cell stamp attribution for drawn-tiles hit-testing (buffer byte-offset →
   *  the SET of object stream indices that stamped a tile there). Independent of
   *  `provenanceTargets` (the drag highlight): the recorder in `_shared.ts`
   *  collects into this whenever it's non-null, capturing EVERY writer of a cell
   *  (not just the visible/topmost one) so a click can cycle through overwritten
   *  objects too. null = off — the normal decode path pays only a null check and
   *  the buffer is untouched (render output byte-for-byte unchanged). Armed by the
   *  `objectCells` IPC; resolved to per-object absolute-cell footprints by
   *  `resolveObjectFootprints`. */
  cellStampers: Map<number, Set<number>> | null = null;

  /** Read the populated template Map16 ID at a cart WRAM address (16-bit
   *  word). Bank13 ports use this for `CMP $1C92`-style shape-aware
   *  fallback checks. Pass slot constants from `./template-slots.ts`
   *  (`TT.FlatFloor_PageAnchor` etc., mirroring the asm's
   *  `!RAM_YI_Level_TileTpl_*` defines) rather than raw hex for
   *  readability. Returns 0 for addresses outside the populated range —
   *  matches the cart's runtime behaviour for unwritten slots. */
  templateAt(wramAddr: number): number {
    const off = (wramAddr - TEMPLATE_WRAM_BASE) >>> 1;
    return off < this.templates.length ? this.templates[off]! : 0;
  }

  /** Reset everything to the post-`init_level_data_buffer` state, ready
   *  for a new load. */
  reset(src: Uint8Array, header: readonly number[]): void {
    this.levelDataBuffer.fill(0);
    this.screenPageMap.fill(0x80); // matches cart loop at CODE_108BA7 (STA $80)
    this.screenBufBase.fill(0);
    this.lruChain.fill(0);
    this.templates.fill(0);
    this.src = src;
    this.ptrOffset = 0;
    for (let i = 0; i < 15; i++) this.header[i] = header[i] ?? 0;
    this.zp00 = this.zp02 = this.zp0A = this.zp0E = this.zp0F = 0;
    this.zp12 = this.zp14 = this.zp15 = this.zp17 = this.zp19 = 0;
    this.zp1B = this.zp1C = this.zp1D = 0;
    this.zp28 = this.zp2A = this.zp2B = this.zp2C = this.zp2E = 0;
    this.zpA1 = 0;
    this.pageCount = 0;
    this.lastLruPage = 0;
    this.rewound = 0;
    this.oddColHandler = this.evenColHandler = this.rowHandler = null;
    this.prngState = 0xACE1;
    this.prngReplayIdx = 0;
    this.prngCalls = 0;
    // NB: prngReplay / prngReplayBySite are set by the caller AFTER reset()
    // (decodeLevel options), so they are intentionally not cleared here.
    this.exits.length = 0;
    this.currentObjectIndex = -1;
    this.provenanceTargets = null;
    this.provenanceCells = null;
    this.cellStampers = null;
  }
}
