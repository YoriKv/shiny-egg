// Bank13 castle-wall-platform stamp handler + Bank12 init wrapper.
//
// Standard object $53 — the horizontal platform on a castle wall. A
// wall-aware OVERWRITE handler: it does NOT lay down tiles into empty
// buffer. Instead it walks a (col_extent × row_extent) rectangle and,
// for each cell, only stamps when the existing under-tile (`$12`) is
// already in the wall family `[$00C2, $00C8)` (and not the two "wall-tee"
// markers $150D / $150E). The new tile encodes the cell's column-edge
// position (left edge / right edge / interior even / interior odd) using
// a 4-entry platform-top table, then optionally overlays a 4-entry
// "grass cap" tile for interior cells whose under-tile sits in
// `[$00C4, $00C8)`.
//
// In practice this is the "set up the autotile stamp pattern across a
// single rectangle on an existing wall" routine (broad neighbour-class
// lookup). The spec's test scenario walks 13 cells against an empty
// buffer (under-tile $0000 everywhere), so every cell early-exits with
// no stamp — matching the spec's `output_mapid: null` rows + zero stamp
// events. (See spec.md cells 0..12; the `cells stamped: 13` count refers
// to "handler invocations", not actual buffer writes.)
//
// Asm sources:
//   CODE_init_castle_wall_platform     Bank12.asm:3757  ($12:9820)
//   CODE_stamp_castle_wall_platform    Bank13.asm:6568  ($13:B98D)
//   DATA_13BA10 (platform-top table)  Bank13.asm:6640  dw $00D1,$150D,$150E,$00D2
//   DATA_13BA18 (grass-cap table)   Bank13.asm:6643  dw $151B,$151B,$0000,$151A

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { TT } from '../template-slots.ts';

// ─────────────────────────────────────────────────────────────────────
// Acceptance window (cart prologue, $13:B98D..$13:B99E).
//
// Only proceed if `$12` is in the wall family `[WALL_FAMILY_LO,
// WALL_FAMILY_HI)` AND not equal to one of the two wall-tee markers
// ($150D / $150E). Otherwise the cart RTLs without writing the buffer.
// ─────────────────────────────────────────────────────────────────────

/** Inclusive low end of the wall family the handler operates on
 *  ($00C2 — canonical "writable wall-grid" marker; also drives several
 *  other Bank13 wall-aware handlers). */
const WALL_FAMILY_LO = 0x00C2;
/** Exclusive high end of the wall family ($00C8). */
const WALL_FAMILY_HI = 0x00C8;
/** Wall-tee marker A — skip if `$12` matches. */
const WALL_TEE_A = 0x150D;
/** Wall-tee marker B — skip if `$12` matches. */
const WALL_TEE_B = 0x150E;

// ─────────────────────────────────────────────────────────────────────
// DATA_13BA10 (Bank13.asm:6640). 4-entry platform-top table indexed by Y
// (in bytes, halved here to entry index 0..3):
//
//   Y=0 ($00D1) — left edge of object (col == 0)
//   Y=2 ($150D) — interior even (col+1) parity OR D1/D2 override hit
//   Y=4 ($150E) — interior odd (col+1) parity
//   Y=6 ($00D2) — right edge of object (col+1 == col_extent)
//
// These four constants are raw Map16 IDs (NOT template-slot addresses)
// — the cart `LDA DATA_13BA10,y / STA.l buffer,x` stamps the literal.
// ─────────────────────────────────────────────────────────────────────

const DATA_castle_wall_platform_top: ReadonlyArray<number> = [
  0x00D1, 0x150D, 0x150E, 0x00D2,
];

// ─────────────────────────────────────────────────────────────────────
// DATA_13BA18 (Bank13.asm:6643). 4-entry grass-cap overlay table indexed
// by (Y = ($12 - WALL_FAMILY_GRASS_LO) * 2), halved here to 0..3:
//
//   $12=$00C4 → $151B
//   $12=$00C5 → $151B
//   $12=$00C6 → $0000 (clears the cell — "no grass cap")
//   $12=$00C7 → $151A
//
// Overlay only fires for interior columns (col != 0); the rightmost
// column is allowed (no col+1 == colExtent check on this branch).
// ─────────────────────────────────────────────────────────────────────

/** Inclusive low end of grass-overlay sub-range ($00C4). */
const WALL_FAMILY_GRASS_LO = 0x00C4;
/** Exclusive high end of grass-overlay sub-range ($00C8 — same as
 *  WALL_FAMILY_HI, but kept separate for clarity at the call site). */
const WALL_FAMILY_GRASS_HI = 0x00C8;

const DATA_castle_wall_platform_grass_cap: ReadonlyArray<number> = [
  0x151B, 0x151B, 0x0000, 0x151A,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_castle_wall_platform ($13:B98D, Bank13.asm:6568).
//
// Pseudocode (16-bit A/X/Y throughout — REP #$30 prologue):
//
//   if !(WALL_FAMILY_LO <= $12 < WALL_FAMILY_HI) return;
//   if $12 == $150D || $12 == $150E return;
//
//   ; --- Pick Y (column-edge classification) ---
//   if $28 == 0:               Y = 0     ; left edge
//   else if ($28 + 1) == $2A:  Y = 6     ; right edge
//   else if ($28 + 1) & 1:     Y = 4     ; interior, odd (col+1)
//   else:                      Y = 2     ; interior, even (col+1)
//
//   ; --- Edge-specific D1/D2 override (only on left/right edges) ---
//   if col == 0 || col+1 == $2A:
//     if Family0200_Anchor <= $12 < Family1200_Anchor: return   ; family-skip
//     if $12 == $00D1 || $12 == $00D2: Y = 2
//
//   ; --- Stamp platform-top tile from DATA_13BA10[Y/2] ---
//   stamp DATA_castle_wall_platform_top[Y/2];
//
//   ; --- Optional grass-cap overlay (interior columns only) ---
//   if $12 in [$00C4, $00C8) && col != 0:
//     stamp DATA_castle_wall_platform_grass_cap[($12 - $00C4)];
// ─────────────────────────────────────────────────────────────────────

const stampCastleWallPlatform: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;

  // Acceptance gate — wall family only, exclude wall-tee markers.
  if (cur < WALL_FAMILY_LO || cur >= WALL_FAMILY_HI) return;
  if (cur === WALL_TEE_A || cur === WALL_TEE_B) return;

  // Column-edge classification. The cart works in 16-bit A; `$28` and
  // `$2A` are 8-bit byte values within a 16-bit word during REP #$30.
  // For the comparisons below we treat them as unsigned 8-bit (matches
  // bank13-bg-autotile-block conventions for `col` / `colExtent`).
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  const colPlus1 = (col + 1) & 0xff;

  let y: number; // entry index 0..3 into DATA_castle_wall_platform_top
  let isEdge: boolean;

  if (col === 0) {
    y = 0; // left edge
    isEdge = true;
  } else if (colPlus1 === colExtent) {
    y = 3; // right edge — asm uses Y=6 (bytes); entry index = 3
    isEdge = true;
  } else if ((colPlus1 & 0x01) === 0) {
    y = 1; // interior, (col+1) even — asm Y=2; entry index = 1
    isEdge = false;
  } else {
    y = 2; // interior, (col+1) odd — asm Y=4; entry index = 2
    isEdge = false;
  }

  // Edge-only D1/D2 override pass. The cart re-tests `$28` and routes
  // both edges through the same fallthrough at CODE_13B9C8. Inside:
  //  - if $12 sits in the Family0200..Family1200 range, RTL without
  //    stamping (full-skip, not just override).
  //  - if $12 == $00D1 or $00D2, force Y = $02 (entry index 1).
  if (isEdge) {
    const family0200 = state.templateAt(TT.Family0200_Anchor) & 0xffff;
    const family1200 = state.templateAt(TT.Family1200_Anchor) & 0xffff;
    if (cur >= family0200 && cur < family1200) {
      return; // family-range skip
    }
    if (cur === 0x00D1 || cur === 0x00D2) {
      y = 1;
    }
  }

  // Stamp the platform-top tile (literal Map16 ID, no template deref).
  stampCell(state, DATA_castle_wall_platform_top[y]!);

  // Grass-cap overlay: only when interior column (col != 0) AND the
  // under-tile sat in `[$00C4, $00C8)`. Note the cart's `LDA $28 BEQ`
  // is checked AFTER the first stamp — so on the left edge the overlay
  // is suppressed, but on the rightmost column it IS allowed (the
  // colPlus1==colExtent path doesn't skip the overlay branch).
  if (cur >= WALL_FAMILY_GRASS_LO && cur < WALL_FAMILY_GRASS_HI && col !== 0) {
    const overlayIdx = cur - WALL_FAMILY_GRASS_LO; // 0..3
    stampCell(state, DATA_castle_wall_platform_grass_cap[overlayIdx]!);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_castle_wall_platform ($12:9820, Bank12.asm:3757).
//
//   REP #$20
//   LDX #(CODE_stamp_castle_wall_platform-1)>>16
//   LDA #CODE_stamp_castle_wall_platform-1
//   JMP walker_setup_trampoline
//
// Plain trampoline-walker init: same handler for even-col / odd-col /
// row slots, $19=$7FFF, slope=0. Spec confirms no DP mutations — the
// walker reads the stream's raw $1B/$1C/$2A/$2E/$15 unchanged.
// ─────────────────────────────────────────────────────────────────────

function initCastleWallPlatform(state: DecodeState): void {
  walkerSetupTrampoline(state, stampCastleWallPlatform);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installCastleWallPlatformHandlers(): void {
  registerStdObjectHandler(0x53, initCastleWallPlatform);
}
