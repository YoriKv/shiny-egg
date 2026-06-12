// Collision-table extraction.
//
// The cart's per-page collision metadata lives in **`bg_type_table`** at SNES
// `$0A:BB12` (PC `$053B12` via LoROM mapping) — 168 entries × 3 bytes = 504
// bytes total. Collision is keyed on the **HIGH byte** of a Map16 tile ID
// (= the Map16 page), not the full 16-bit ID. So all 256 visual variants of
// a page share the same collision behavior. This is why a single 168-entry
// table covers the cart's ~5000 Map16 tiles.
//
// 24-bit entry layout (see `docs/mchip.md` §3.3.2 for the canonical
// reference):
//
//   Byte 0 — shape + surface flags
//     bit 0   MD   partial-solid (head/foot collidable, sides pass through)
//     bit 1   AL   solid-all
//     bit 2   SK   slope (consume byte 2 + slope_panels_table)
//     bit 3   WT   water
//     bit 4   MG   lava
//     bit 5   TN   tunnel
//     bits 6-7    unused
//
//   Byte 1 — door bits + secondary tag
//     bit 0   DR   door
//     bit 1   BD   bonus door (key-locked entry)
//     bit 2        unused
//     bits 3-7    secondary tag (5-bit, 0..31; 28 named values, 4 reserved)
//
//   Byte 2 — slope sub-index (only meaningful when SK bit set in byte 0)
//     $00..$1F   → static slope profile (indexes slope_panels_table)
//     $80..$81   → "RAM-supplied" runtime slope (moving / boss slopes)
//
// **Slope profiles** (`slope_panels_table` at SNES `$0A:BD0E`, PC `$053D0E`)
// encode the per-x-pixel Y surface position. The actual access pattern from
// the GSU asm (`yi/SuperFX/Banks/Bank0A.asm:4376-4398`) is:
//
//   addr = slope_panels_table + slope_idx*128 + (probe_x & $0F)*8 [+2 if "up"]
//   GETB  → unsigned byte (subpixel Y, units of 1/2 pixel — divide by 2 for tile Y)
//   GETBS → signed byte (direction / "off-tile" marker)
//
// **Layout** (see `yi/SuperFX/Banks/Bank0A.asm:3395-3416`): one logical
// 4096-byte blob covering 32 static slope indices ($00..$1F); each panel
// is **128 bytes** = 16 in-tile pixel rows × 8 bytes per row. The two
// entry points partition the 8 bytes per row:
//   - Foot/head probe (BG_HDFTCK):  bytes 0,1 (down) or 2,3 (up)
//   - Side-collision probe (BG_SIDECK): bytes 4..7
//
// The cart computes slope_idx*128 via `SWAP R8 ; LSR` (= shift left 8, shift
// right 1). Earlier versions of this comment incorrectly claimed the
// formula was `slope_idx + x*8` — that produced garbage profiles for any
// slope_idx > 6 (off by a factor of 128).

import type { SymbolMap } from './symbol-map.ts';

/** Shape + surface flag bits in byte 0 of a bg_type_table entry. */
export interface CollisionFlags {
  /** Partial-solid: head/foot probes hit, side probes pass through. */
  md: boolean;
  /** Solid-all: collides on every side. */
  al: boolean;
  /** Slope: consult slope_idx + slope_panels_table for the per-pixel
   *  surface line. Foot probes derive the player's Y position from this. */
  sk: boolean;
  /** Water: swim-mode trigger. */
  wt: boolean;
  /** Lava. */
  mg: boolean;
  /** Tunnel. */
  tn: boolean;
}

/** Door bits in byte 1 of a bg_type_table entry. */
export interface CollisionDoors {
  /** Regular door. */
  dr: boolean;
  /** Bonus door (key-locked entry to a sub-level). */
  bd: boolean;
}

/** Named secondary tags (5-bit, byte 1 bits 3..7) — the per-tile behaviour
 *  class. 28 defined, 4 reserved. Names are English behaviour descriptions;
 *  the order + 2-letter codes match the BG collision-type table
 *  (`chip/ys_bgcheck.h`, `docs/mchip.md` §3.3.2). */
export const SECONDARY_TAG_NAMES = [
  'none',               // 0x00
  'snow-grass-floor',   // 0x01 YK — snow / grass top surface
  'soap',               // 0x02 SP — slippery surface
  'dented-floor',       // 0x03 HK
  'mud',                // 0x04 DO
  'lava',               // 0x05 YG
  'coin',               // 0x06 CO
  'question-block',     // 0x07 QB
  'edible-bg',          // 0x08 ET — tongue-eatable BG tile
  'rail',               // 0x09 SN — track / rail
  'damage',             // 0x0A FL — hurts on contact
  'stake',              // 0x0B KU — poundable / spiky stake
  'stairs-left',        // 0x0C KL — down-left stairs
  'stairs-right',       // 0x0D KR — down-right stairs
  'falling-floor',      // 0x0E OD — drops when stepped on
  'switch-block',       // 0x0F CB — dashed block, solid only while ! switch on
  'mario-block',        // 0x10 MB
  'tube-block',         // 0x11 TK
  'countdown-block',    // 0x12 CT
  'waterfall-floor',    // 0x13 WF
  'pipe-mouth',         // 0x14 DK — pipe-mouth tiles (page $7D). TWO consumers: (1) PLAYER pipe entry — the GSU collision probes (Bank0B) accept a tagged tile whose per-tile DATA_0AEBBC byte has the pressed direction's entry bit, then CODE_0BDC20 commits the warp (tile-driven, no sprite); (2) enemy-spawn gate — enemy inits (CODE_0EB8AE) standing on it become pipe generators. Full model: editor data/exit-triggers.ts
  'cedar-tree',         // 0x15 SG
  'switch-coin',        // 0x16 CC — dashed coin, collectible only while ! switch on
  'ice-block',          // 0x17 IC
  'wobbly-rock',        // 0x18 GG
  'damage-slope-stake', // 0x19 HR — hurts on contact
  'damage-icicle',      // 0x1A TR — hurts on contact
  'knockdown',          // 0x1B DE — knocks the player down on contact
  '<unused>',           // 0x1C
  '<unused>',           // 0x1D
  '<unused>',           // 0x1E
  '<unused>',           // 0x1F
] as const;
export type SecondaryTag = typeof SECONDARY_TAG_NAMES[number];

/** A single per-page collision record (decoded from 3 raw cart bytes). */
export interface CollisionEntry {
  /** Map16 page this entry describes (0..167). */
  page: number;
  /** Raw byte 0 — preserved for debugging / overlays. */
  raw0: number;
  /** Raw byte 1. */
  raw1: number;
  /** Raw byte 2. */
  raw2: number;
  /** Shape + surface flags. */
  flags: CollisionFlags;
  /** Door bits. */
  doors: CollisionDoors;
  /** Secondary tag index (0..31). */
  tag: number;
  /** Slope sub-index (byte 2) — only meaningful when `flags.sk === true`.
   *  Values 0..31 reference a static slope_panels_table profile.
   *  Values $80..$81 indicate runtime-supplied (animated/moving) slopes. */
  slopeIdx: number;
}

const COLLISION_TABLE_PAGES = 168;
const COLLISION_TABLE_BYTES = COLLISION_TABLE_PAGES * 3;

/**
 * Decode one 3-byte cart entry into a structured CollisionEntry.
 *
 * Exposed for callers that want to decode individual entries without
 * loading the full table (e.g. unit tests).
 */
export function decodeCollisionEntry(
  page: number,
  raw0: number,
  raw1: number,
  raw2: number
): CollisionEntry {
  return {
    page,
    raw0, raw1, raw2,
    flags: {
      md: (raw0 & 0x01) !== 0,
      al: (raw0 & 0x02) !== 0,
      sk: (raw0 & 0x04) !== 0,
      wt: (raw0 & 0x08) !== 0,
      mg: (raw0 & 0x10) !== 0,
      tn: (raw0 & 0x20) !== 0,
    },
    doors: {
      dr: (raw1 & 0x01) !== 0,
      bd: (raw1 & 0x02) !== 0,
    },
    tag: (raw1 >>> 3) & 0x1f,
    slopeIdx: raw2,
  };
}

/**
 * Load + decode the full `bg_type_table` (168 entries).
 *
 * Resolves the table address via the SuperFX `.sym` (the table lives on
 * the FX side; the consumer is `BG_HDFTCK` in Bank0A SuperFX code).
 */
export function loadCollisionTable(
  rom: Uint8Array,
  symbols: SymbolMap
): CollisionEntry[] {
  const tablePC = symbols.pc('DATA_bg_type_table');
  if (tablePC + COLLISION_TABLE_BYTES > rom.length) {
    throw new RangeError(
      `loadCollisionTable: table address $${tablePC.toString(16)} + ${COLLISION_TABLE_BYTES} bytes exceeds rom (${rom.length} bytes)`
    );
  }
  const out: CollisionEntry[] = new Array(COLLISION_TABLE_PAGES);
  for (let p = 0; p < COLLISION_TABLE_PAGES; p++) {
    const off = tablePC + p * 3;
    out[p] = decodeCollisionEntry(p, rom[off]!, rom[off + 1]!, rom[off + 2]!);
  }
  return out;
}

/** Direction bits (low nibble) of a `DATA_0AEBBC` pipe-entry byte —
 *  `$01`/`$02` horizontal, `$04` down-entry, `$08` up-entry. High bits are
 *  alignment / orientation markers the probes use, not entry gates. */
export const PIPE_ENTRY_DIRECTION_MASK = 0x0f;

/**
 * Load `DATA_0AEBBC` — the per-tile pipe-entry bits for the pipe-mouth page
 * ($7D), indexed by a Map16 id's LOW byte. The GSU player collision probes
 * (Bank0B) accept a tile as a pipe entrance iff its page collision tag is
 * $14 `pipe-mouth` AND this byte carries the pressed direction's entry bit;
 * `CODE_0BDC20` then commits the warp (PipeTransitionType + PlayerState $06).
 * Enterability is therefore per-TILE, not per-page — e.g. mouth $7D08/$7D09
 * ($04/$84, the Enterable vertical pipe) vs body tiles ($00/$01/$02).
 * Tiles past the table's end have no entry bits (treat as 0).
 * Full mechanism: src/renderer/src/data/exit-triggers.ts.
 */
export function loadPipeEntryBits(
  rom: Uint8Array,
  symbols: SymbolMap
): Uint8Array {
  const basePC = symbols.pc('DATA_0AEBBC');
  // Length = distance to the next data label (38 bytes on the stock cart);
  // derive it from the symbols so an asm splice can't silently truncate.
  const endPC = symbols.tryPc('DATA_0AEBE2') ?? basePC + 38;
  return rom.subarray(basePC, Math.min(endPC, basePC + 256));
}

/** Raw slope_panels_table buffer + base address — handed to slope-profile
 *  decoders. The buffer is the full FX-side bank slice starting at the
 *  table base; consumers walk it via the stride-8 packed-grid formula. */
export interface SlopePanels {
  /** Raw bytes starting at slope_panels_table. */
  bytes: Uint8Array;
}

const SLOPE_PANEL_TABLE_BYTES = 4096; // 32 panels × 128 bytes per panel
const SLOPE_PROFILE_PIXELS = 16;
const SLOPE_PANEL_STRIDE = 128; // each slope_idx panel
const SLOPE_PIXEL_STRIDE = 8;   // each in-tile pixel row within a panel

/**
 * Load `slope_panels_table` as a raw byte view. Returns a `Uint8Array`
 * subarray of the rom for zero-copy access. Subsequent decoders index
 * into it via the GSU formula `slope_idx + x_pixel * 8`.
 */
export function loadSlopePanels(
  rom: Uint8Array,
  symbols: SymbolMap
): SlopePanels {
  const basePC = symbols.pc('DATA_slope_panels_table');
  // Cover the full 4 KB blob: 32 panels × 128 bytes each.
  return { bytes: rom.subarray(basePC, basePC + SLOPE_PANEL_TABLE_BYTES) };
}

/** One x_pixel column's surface Y, in **subpixel** units (1/2 pixel).
 *  Divide by 2 to get the in-tile pixel Y (0..15 nominal range; values
 *  > 31 mean "off-tile" — the surface is past the visible 16×16 tile).
 *  The `direction` byte is the signed GETBS marker the cart's foot-probe
 *  uses for "above-tile" / "below-tile" disambiguation; surfacing it
 *  here lets the renderer distinguish "fully-solid column" from
 *  "fully-passable column" when subpixelY is out of range. */
export interface SlopeSample {
  /** Foot-DOWN probe: subpixelY at byte 0 of the cell. The cart's BG_HDFTCK
   *  uses this path when the player is moving downward (falling onto the
   *  slope from above). */
  subpixelY: number;
  /** Foot-DOWN probe: signed direction marker at byte 1 of the cell. */
  direction: number;
  /** Foot-UP probe: subpixelY at byte 2 of the cell. The cart reads this
   *  (offset +2) when the player is moving upward (jumping into the slope
   *  from below). Visually for many slopes, the actual surface shape is
   *  encoded here, while foot-down is a flat "ceiling" marker. */
  subpixelYUp: number;
  /** Foot-UP probe: signed direction marker at byte 3 of the cell. */
  directionUp: number;
}

/**
 * Decode one slope_idx's 16-column surface profile from the raw panels
 * buffer. Returns 16 samples, one per x_pixel column 0..15. Each sample
 * carries BOTH the foot-down (bytes 0,1) AND foot-up (bytes 2,3) byte
 * pairs — the cart's BG_HDFTCK picks one or the other based on whether
 * the player is moving up or down at probe time. For some slopes the
 * surface shape only lives in the foot-up bytes (e.g. slope $07's
 * foot-down is uniform `(0, 15)`; the actual descending shape is in
 * foot-up's `direction` byte going 7→0).
 *
 * GSU access pattern (`yi/SuperFX/Banks/Bank0A.asm:3402, 4385-4398`):
 *
 *   addr = base + slope_idx*128 + (x_pixel & $0F)*8 [+2 if probing up]
 *   GETB  → unsigned byte (subpixelY, units of 1/2 pixel)
 *   GETBS → signed byte (direction / "off-tile" marker)
 *
 * For slope_idx in `$80..$81` (RAM-supplied animated slopes), the caller
 * should NOT call this — the static table doesn't contain valid data.
 * For slope_idx >= 32, returns a zeroed profile (defensive fallback).
 */
export function decodeSlopeProfile(
  panels: SlopePanels,
  slopeIdx: number
): SlopeSample[] {
  const out: SlopeSample[] = new Array(SLOPE_PROFILE_PIXELS);
  if (slopeIdx >= 0x20) {
    for (let x = 0; x < SLOPE_PROFILE_PIXELS; x++) {
      out[x] = { subpixelY: 0, direction: 0, subpixelYUp: 0, directionUp: 0 };
    }
    return out;
  }
  const panelBase = slopeIdx * SLOPE_PANEL_STRIDE;
  const sx = (b: number) => (b >= 0x80 ? b - 0x100 : b);
  for (let x = 0; x < SLOPE_PROFILE_PIXELS; x++) {
    const off = panelBase + x * SLOPE_PIXEL_STRIDE;
    out[x] = {
      subpixelY: panels.bytes[off] ?? 0,
      direction: sx(panels.bytes[off + 1] ?? 0),
      subpixelYUp: panels.bytes[off + 2] ?? 0,
      directionUp: sx(panels.bytes[off + 3] ?? 0),
    };
  }
  return out;
}
