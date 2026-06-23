// Bank13 stamp handlers for the next batch of high-impact level objects.
//
// Ports use the trace-harness outputs in
// `yi-shiny/trace-harness/scenarios/object-render/output/` as ground
// truth — each output spec captures the exact per-cell Map16 IDs the
// live cart's BG_HDFTCK / stamp routines produce for a known test
// object. Slope stampers ($E4/$E5/$E8) are full ports of the cart's
// per-variant tile-record tables (`DATA_13F556..` for $E4,
// `DATA_13F672..` for $E5, `DATA_13F828..` for $E8) lifted verbatim
// from the asm; rows past the silhouette tail-call
// `jungleFloorRandomFillBiased` to fill the slope's interior with
// `$79xx` ground tiles weighted toward the `$79E0` fallback.
//
// Covered handlers:
//   $63       init_three_segment_row             → 3-tile left/mid/right table
//   $C4       init_pole_6variant_aligned         → fence-post on even cols
//   $EB / $EC init_shoreline_slope_capped (L/R)  → cap + 2 body + alt water
//   $E4       init_slope_steep_up_left           → 10-variant 6-entry silhouette + jungle fill
//   $E5       init_slope_down_left_long         → 5-variant 8-entry silhouette + jungle fill
//   $E8       init_slope_down_right_long           → 5-variant 8-entry silhouette + jungle fill
//
// Edge-fix calls (`CODE_slope_fix_left_edge` / `_right_edge` corner
// blends) and the runtime variant-fallback ("$A1=4 or 8 + underlying
// tile in $9000..$904F → force $A1=0") are ported for $E5/$E8 — they
// smooth slope-meets-ground seams ($79D6-$79D9 → $79C8/$79C9) and
// substitute a denser variant when overlaying existing ground. $E4
// (steep-up-left) doesn't call them per the asm.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope, walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import {
  stampCell, signed8,
  readBuf16, writeBuf16, setProbeToCurrent, shiftOriginNibble,
  jungleFloorRandomFillBiased, probeLeftTile, probeRightTile,
} from './_shared.ts';
import { getMap16Left, getMap16Right } from '../fetch.ts';
// Shoreline sub-handlers reuse the half-slope bodies for their rows-0..2, exactly
// as the cart's CODE_stamp_shoreline_slope_left/right JSL into them.
import { stampSlopeDownLeftHalf } from './bank13-slope-down-left-half.ts';
import { stampSlopeDownRightHalf } from './bank13-slope-down-right-half.ts';

// ───────────────────────────────────────────────────────────────────────
// $63 — CODE_init_three_segment_row → CODE_three_segment_row
//
// Cart (`Bank13.asm:7710`): picks one of three tiles based on horizontal
// position within the row — leftmost ($151E), interior ($151F),
// rightmost ($1520). Trace `std-63` confirms 2-cell run as
// `[$151E, $1520]` (left + right with no interior).
//
// `$28` is the signed column counter (0..extent for positive widths,
// 0..-extent for negative). `$2A` is the signed column extent. The cart
// detects "rightmost" as `$28+1 == $2A` regardless of sign.
// ───────────────────────────────────────────────────────────────────────

const DATA_three_segment_row_tiles = [0x151E, 0x151F, 0x1520] as const;

const threeSegmentRow: PerCellHandler = (state) => {
  const col = signed8(state.zp28);
  const extent = signed8(state.zp2A);
  // Leftmost = first column visited (col 0 regardless of direction).
  const isLeftmost = col === 0;
  // Rightmost = the cell immediately before extent. For positive extent
  // this is the highest col; for negative it's the lowest. Walker step
  // for $28 mirrors the sign of $2A so `col + 1 === extent` works.
  const isRightmost = (col + 1) === extent;
  const idx = isLeftmost ? 0 : isRightmost ? 2 : 1;
  stampCell(state, DATA_three_segment_row_tiles[idx]!);
};

// Merge: object IDs 0x63, 0x64, 0x65 share this handler.
function initThreeSegmentRow(state: DecodeState): void {
  // Cart CODE_init_three_segment_row defensively zeros $A1 even though
  // the stamp doesn't read it — guards against $A1 leakage from a prior
  // object into a downstream handler that does read it without writing.
  state.zpA1 = 0;
  state.zp17 = 0;
  walkerSetupTrampoline(state, threeSegmentRow);
}

// ───────────────────────────────────────────────────────────────────────
// $C4-$C9 — CODE_init_pole_6variant_aligned (Bank12.asm:5005)
//
// Cart splits 6 IDs across 3 stamp variants × 2 tile choices:
//   modified_id = id (if id < $C7) else id + 1     // $C7 → $C8 fence-post
//   force $2A = 1   if modified_id & 1 == 1        // single-column
//   force $2E = 1   if modified_id & 1 == 0        // single-row
//   tile = $6000 if (modified_id >> 2) & 2 == 0    // DATA_alt_state_ground_tiles[0]
//        = $7400 otherwise                         // DATA_alt_state_ground_tiles[1]
//   variant = modified_id & 3                      // 0, 1, or 2
//     0 → CODE_stamp_pole_col_aligned   (even-col gate, trampoline → $17=0)
//     1 → CODE_stamp_pole_row_aligned   (even-row gate, trampoline → $17=0)
//     2 → CODE_stamp_pole_with_single_row (sets $9B=$FFFF; keep-slope → $17=$FFFF)
//
// Stamp tile picked via $15 (init stores `(modified_id >> 2) & 2` into
// $15; stamp reads `LDA $15 ; AND #$0002 ; TAY ; LDA DATA_alt_state_ground_tiles,y`).
// ───────────────────────────────────────────────────────────────────────

const POLE_TILES = [0x6000, 0x7400] as const;

function poleTileFromState(state: DecodeState): number {
  return POLE_TILES[(state.zp15 & 0x02) >>> 1]!;
}

const stampPoleColAligned: PerCellHandler = (state) => {
  if ((state.zp28 & 1) !== 0) return;
  stampCell(state, poleTileFromState(state));
};

const stampPoleRowAligned: PerCellHandler = (state) => {
  if ((state.zp2C & 1) !== 0) return;
  stampCell(state, poleTileFromState(state));
};

const stampPoleSingleRow: PerCellHandler = (state) => {
  // Cart CODE_stamp_coin_with_single_row sets $9B = $FFFF on first call. $9B is the walker's
  // "rewound" flag; combined with $17=$FFFF (keep-slope), each row-wrap
  // triggers origin rewind + $2E decrement → short single-row segment.
  state.rewound = 0xFFFF;
  if ((state.zp28 & 1) !== 0) return;
  stampCell(state, poleTileFromState(state));
};

const POLE_STAMPS = [
  stampPoleColAligned,
  stampPoleRowAligned,
  stampPoleSingleRow,
] as const;

function initPole6variant(state: DecodeState): void {
  // CODE_init_pole_6variant_aligned (Bank12.asm:5005).
  let modified = state.zp15 & 0xff;
  if (modified >= 0xC7) modified = (modified + 1) & 0xff;

  // Force width=1 (odd modified) or height=1 (even modified).
  if ((modified & 1) !== 0) {
    state.zp2A = 1;
  } else {
    state.zp2E = 1;
  }

  // Tile selector: $15 = (modified >> 2) & 2 → 0 or 2 (indexes DATA_alt_state_ground_tiles).
  state.zp15 = (modified >>> 2) & 0x02;

  // Cart unconditionally sets $17 = $FFFF; the trampoline zeros it for
  // variants 0/1, keep-slope preserves it for variant 2.
  state.zp17 = 0xFFFF;

  const variantIdx = modified & 0x03;
  const stamp = POLE_STAMPS[variantIdx]!;
  if (variantIdx < 2) {
    walkerSetupTrampoline(state, stamp);
  } else {
    walkerSetupKeepSlope(state, stamp);
  }
}

// ───────────────────────────────────────────────────────────────────────
// $EB / $EC — CODE_init_shoreline_slope_capped / CODE_stamp_shoreline_slope_capped
//
// Cart (init Bank12.asm:5499 → walker_setup_trampoline; stamp $13:FA0D): the
// per-cell stamp sets $0E = $1B, then dispatches to the left ($EB) or right
// ($EC) sub-handler by the direction bit in $15. Each sub-handler:
//   rows 0-2 → JSL the SHARED half-slope body (stamp_slope_down_left/right_half),
//              so the same variant roll ($13F7EE / $13F9C6) the $E7/$EA objects
//              use fires for shoreline columns too (that shared call is why those
//              PRNG sites' cart call-counts exceed the standalone half-slope's).
//   rows 3+  → stamp a water tile ($79D6/$79D8 + row parity) at the current cell,
//              then probe the WATER-side neighbour; if it's a $79xx tile,
//              PRNG-pick ($13FA4D / $13FAC0) a sand-fill from
//              DATA_shoreline_sandfill_tiles and overwrite it. On the last row,
//              probe the LAND-side neighbour and stamp the slope-end cap
//              ($79C8/$79C9) when it matches the end-column blend table.
//
// (Was a deterministic approximation that hardcoded the cap/body and skipped the
// PRNG — replaced with the faithful shared-body port for pixel-exact parity.)
// ───────────────────────────────────────────────────────────────────────

// DATA_shoreline_sandfill_tiles ($13:F9F9) — 4 sand-fill tiles, PRNG-picked
// (prng & 6 → entry) to replace water-adjacent $79xx grass.
const DATA_shoreline_sandfill_tiles = [0x79AD, 0x79AE, 0x79B5, 0x79DD] as const;

// DATA_shoreline_endcol_match_tiles ($13:FA01), as high-byte categories — on the
// slope's last row these (or a neighbour in $85A8..$85B0) extend the cap.
const SHORELINE_ENDCOL_MATCH_HI: readonly number[] = [0x03, 0x06, 0x08, 0x0A, 0x0C, 0x10];

/** Last-row cap test — cart `CODE_13FA6A` match loop + the $85A8..$85B0 gate. */
function shorelineEndcolMatch(probeTile: number): boolean {
  if (SHORELINE_ENDCOL_MATCH_HI.includes((probeTile >> 8) & 0xff)) return true;
  return probeTile >= 0x85A8 && probeTile < 0x85B0;
}

// $EB — CODE_stamp_shoreline_slope_left ($13:FA1B).
function stampShorelineLeft(state: DecodeState): void {
  if ((state.zp2C & 0xffff) < 3) { stampSlopeDownLeftHalf(state); return; }
  stampCell(state, (0x79D6 + (state.zp2C & 1)) & 0xffff);
  const nOff = getMap16Right(state); // water side = right
  if ((readBuf16(state, nOff) & 0xff00) === 0x7900) {
    const idx = prngNext(state, RNG_SITE.shorelineSlopeLeft) & 0x06;
    writeBuf16(state, nOff, DATA_shoreline_sandfill_tiles[idx >> 1]!);
  }
  if (((state.zp2C + 1) & 0xffff) === (state.zp2E & 0xffff)
      && shorelineEndcolMatch(probeLeftTile(state))) {
    stampCell(state, 0x79C8);
  }
}

// $EC — CODE_stamp_shoreline_slope_right ($13:FA8E), mirror of left.
function stampShorelineRight(state: DecodeState): void {
  if ((state.zp2C & 0xffff) < 3) { stampSlopeDownRightHalf(state); return; }
  stampCell(state, (0x79D8 + (state.zp2C & 1)) & 0xffff);
  const nOff = getMap16Left(state); // water side = left
  if ((readBuf16(state, nOff) & 0xff00) === 0x7900) {
    const idx = prngNext(state, RNG_SITE.shorelineSlopeRight) & 0x06;
    writeBuf16(state, nOff, DATA_shoreline_sandfill_tiles[idx >> 1]!);
  }
  if (((state.zp2C + 1) & 0xffff) === (state.zp2E & 0xffff)
      && shorelineEndcolMatch(probeRightTile(state))) {
    stampCell(state, 0x79C9);
  }
}

// Objects $EB (left) and $EC (right) share this init/stamp.
function initShorelineSlopeCapped(state: DecodeState): void {
  // Cart $15 & $04 LSR 1 → 0 (left, $EB) or 1 (right, $EC).
  const isRight = ((state.zp15 & 0x04) >>> 1) !== 0;
  // Shift $1B left by $10 (one cell), bump $2E by 1; trampoline walker.
  shiftOriginNibble(state, -0x0010);
  state.zp2E = (state.zp2E + 1) & 0xffff;
  state.zp17 = 0;
  walkerSetupTrampoline(state, (s) => {
    setProbeToCurrent(s); // cart CODE_stamp_shoreline_slope_capped: $0E = $1B
    if (isRight) stampShorelineRight(s); else stampShorelineLeft(s);
  });
}

// ───────────────────────────────────────────────────────────────────────
// $E4 / $E5 / $E8 — slope stampers (steep-up-left, long-down-left,
//                                    long-down-right)
//
// Cart `CODE_stamp_slope_steep_up_left` (`Bank13.asm:14317`),
// `CODE_stamp_slope_down_left_long` (`Bank13.asm:?`),
// `CODE_stamp_slope_down_right_long` (`Bank13.asm:?`) each do:
//   - Rows 0-2 (E4) or 0-3 (E5/E8): pick from a per-variant tile table
//     indexed by `(zp2C << 1 + (zp28 & 1)) << 1` → produces the actual
//     diagonal silhouette using $85xx slope-edge tiles.
//   - Rows 3+ / 4+: tail-call `CODE_jungle_floor_random_fill` for the
//     slope's filled interior (16-entry prng pick from
//     `DATA_jungle_floor_fill_tiles`: 10 distinct $79xx variants + 6
//     weighted $79E0 = 62.5% foliage, 37.5% fallback).
//
// **Simplified port**: we call `jungleFloorRandomFill` for EVERY row,
// skipping the proper silhouette tile-table on rows 0-3. Visually the
// slope's bounds will show as filled jungle-canopy color (richer than
// `$67`'s canopy thanks to the higher foliage ratio); the diagonal
// silhouette is missing. Refine later by porting the per-variant
// $85xx tile tables.
// ───────────────────────────────────────────────────────────────────────

// jungleFloorRandomFillBiased + DATA_jungle_floor_fill_tiles now live in
// _shared.ts (single home; was copy-pasted across 4 slope files).

const jungleFloorRandomFill: PerCellHandler = (state) => {
  jungleFloorRandomFillBiased(state, 0);
};

// ───────────────────────────────────────────────────────────────────────
// $E4 — CODE_stamp_slope_steep_up_left silhouette tables
//
// 10 distinct 6-entry tile records (`DATA_13F556..DATA_13F5C2`). Each
// record's entries are indexed `[row*2 + col_parity]`:
//   [0] = row 0, even col   [1] = row 0, odd col
//   [2] = row 1, even col   [3] = row 1, odd col
//   [4] = row 2, even col   [5] = row 2, odd col
// `$0000` entries are "skip stamp" (leave whatever was at that cell).
// ───────────────────────────────────────────────────────────────────────

const SLOPE_STEEP_UP_LEFT_RECORDS: readonly (readonly number[])[] = [
  [0x0000, 0x0000, 0x859A, 0x859B, 0x79DA, 0x79DB], // DATA_13F556 → record 0
  [0x0000, 0x0000, 0x859F, 0x85A0, 0x79DD, 0x79DE], // DATA_13F562 → record 1
  [0x0000, 0x0000, 0x859A, 0x859C, 0x79DD, 0x79DE], // DATA_13F56E → record 2
  [0x0000, 0x0000, 0x859F, 0x85A1, 0x79DD, 0x79DF], // DATA_13F57A → record 3
  [0x0000, 0x0000, 0x859A, 0x859B, 0x79DC, 0x79DB], // DATA_13F586 → record 4
  [0x0000, 0x0000, 0x85A2, 0x85A0, 0x79DD, 0x79DC], // DATA_13F592 → record 5
  [0x0000, 0x85C5, 0x85A2, 0x859D, 0x79DA, 0x79AC], // DATA_13F59E → record 6
  [0x85C8, 0x0000, 0x85A3, 0x85A4, 0x79AD, 0x79AF], // DATA_13F5AA → record 7
  [0x85C6, 0x85C7, 0x859E, 0x859D, 0x79DC, 0x79DB], // DATA_13F5B6 → record 8
  [0x85C8, 0x85C5, 0x85A3, 0x85A4, 0x79DC, 0x79B6], // DATA_13F5C2 → record 9
] as const;

/** `DATA_slope_steep_up_left_ptrs` (Bank13.asm:14312) — 16 ptrs to the
 *  10 records above. `prng & $0F` selects an index here; we then look
 *  up which underlying record (0..9) to use. */
const SLOPE_STEEP_UP_LEFT_VARIANT_TO_RECORD = [
  9, 8, 7, 6, 5, 4, 3, 2,
  1, 0, 8, 6, 4, 2, 1, 0,
] as const;

// NOTE on cart-side origin/slope quirks. The cart's init handlers shift
// the origin left by $20 (2 cells) via `CODE_slope_shift_origin_left_20`
// and bump $2E by 2, then set $17 to $FFFF for $E5/$E8 (diagonal walker
// step = -1 row per col) and tail-call walker_setup_keep_slope. We
// mirror this exactly. The diagonal step makes the walker allocate
// extra screen pages along the slope's staircase, which can exhaust the
// 64-page LRU pool on dense levels; the parser's per-object
// ScreenOverflowError catch (parser.ts) absorbs that without halting
// the rest of the decode.

// ─────────────────────────────────────────────────────────────────────
// $E4 — CODE_stamp_slope_steep_up_left
// (Bank13.asm:14317)
//
// Per-cell algorithm:
//   if zp2C >= 3 (row 3+):
//       bias = (zp2C - 3) * 2    // increases each row → more $79E0 fallback
//       jungleFloorRandomFillBiased(bias)
//   else (rows 0..2):
//       col_parity = zp28 & 1
//       if (row 0 AND col 0):
//           zpA1 = (prng & $0F) * 2   // pick variant 0..15 once per object
//       record_idx = SLOPE_STEEP_UP_LEFT_VARIANT_TO_RECORD[zpA1 / 2]
//       entry_idx = row * 2 + col_parity   // 0..5
//       tile = SLOPE_STEEP_UP_LEFT_RECORDS[record_idx][entry_idx]
//       if tile != 0: stampCell(tile)   // $0000 entries = "leave existing tile"
// ─────────────────────────────────────────────────────────────────────

const stampSlopeSteepUpLeft: PerCellHandler = (state) => {
  const row = signed8(state.zp2C);
  const col = state.zp28 & 0xff;
  if (row >= 3) {
    jungleFloorRandomFillBiased(state, (row - 3) * 2);
    return;
  }
  const colParity = col & 1;
  // Cart CODE_slope_steep_up_left_body re-rolls the variant on every (row=0, even-col)
  // cell, not just (0,0) — gives each column-pair its own silhouette
  // variant. Matches `BNE` on `$28 & 1` then `BNE` on `$2C` in the asm.
  if (row === 0 && colParity === 0) {
    state.zpA1 = (prngNext(state, RNG_SITE.slopeSteepUpLeft) & 0x0F) << 1;
  }
  const variant = (state.zpA1 >>> 1) & 0x0F;
  const recordIdx = SLOPE_STEEP_UP_LEFT_VARIANT_TO_RECORD[variant]!;
  const record = SLOPE_STEEP_UP_LEFT_RECORDS[recordIdx]!;
  const tile = record[row * 2 + colParity]!;
  if (tile === 0) return; // $0000 = skip stamp (transparent)
  stampCell(state, tile);
};

function initSlopeSteepUpLeft(state: DecodeState): void {
  // Cart: JSR slope_shift_origin_left_20 (origin -= $0020, $2E += 2),
  // then walker_setup_trampoline with $17=0.
  shiftOriginNibble(state, -0x0020);
  state.zp2E = (state.zp2E + 2) & 0xffff;
  state.zp17 = 0;
  walkerSetupTrampoline(state, stampSlopeSteepUpLeft);
}

// ─────────────────────────────────────────────────────────────────────
// $E5 / $E8 — CODE_stamp_slope_down_left_long / _down_right_long
// (Bank13.asm:14411 / :14594)
//
// Both share the body helper `CODE_stamp_slope_body_shared`
// (Bank13.asm:14649). Differences:
//   - Tile-record set ($E5: DATA_13F672+; $E8: DATA_13F828+).
//   - Edge-fix call sites:
//       $E5 row 1 + col 0           → slope_fix_right_edge
//       $E5 row 2 + (`$28-1==$2A`)  → slope_fix_left_edge
//       $E8 row 1 + col 0           → slope_fix_left_edge
//       $E8 row 2 + (`$28+1==$2A`)  → slope_fix_right_edge
//
// Per-cell algorithm:
//   STZ $9B                        ; clear rewound flag every cell
//   row-specific edge-fix probes (see table)
//   if (col_odd AND row+1 == row_extent): $9B++   ; narrow-body signal
//   if (row 0 + col_even):
//       prng & 7 << 1 → $A1
//       if ($A1 == 4 or 8) AND underlying tile in [$9000, $9050):
//           $A1 = 0                ; force base variant on ground overlay
//   tail-call stamp_slope_body_shared (rows 0..3: record-pick; 4+: jungle fill)
// ─────────────────────────────────────────────────────────────────────

// CODE_slope_fix_left_edge (Bank13.asm:14549). Probes left neighbour;
// if it's a standard ground tile ($79D8 or $79D9), overwrites with the
// slope-meets-ground corner blend ($79C9). Cleans the seam where a
// down-left or down-right slope abuts pre-existing flat ground.
// Exported for reuse by the shorty/half slope handlers ($E6/$E9).
export function slopeFixLeftEdge(state: DecodeState): void {
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  const leftTile = readBuf16(state, leftOff);
  if (leftTile === 0x79D8 || leftTile === 0x79D9) {
    writeBuf16(state, leftOff, 0x79C9);
  }
}

// CODE_slope_fix_right_edge (Bank13.asm:14562). Mirror of left edge:
// probes right neighbour; if it's $79D6 or $79D7, overwrites with the
// right-side corner blend ($79C8).
// Exported for reuse by the shorty/half slope handlers ($E6/$E9).
export function slopeFixRightEdge(state: DecodeState): void {
  setProbeToCurrent(state);
  const rightOff = getMap16Right(state);
  const rightTile = readBuf16(state, rightOff);
  if (rightTile === 0x79D6 || rightTile === 0x79D7) {
    writeBuf16(state, rightOff, 0x79C8);
  }
}

// DATA_13F672..DATA_13F6B2 — 5 distinct 8-entry records for $E5.
// Each entry is [r0c0, r0c1, r1c0, r1c1, r2c0, r2c1, r3c0, r3c1].
const SLOPE_DOWN_LEFT_LONG_RECORDS: readonly (readonly number[])[] = [
  [0x0000, 0x0000, 0x85A8, 0x85A7, 0x0D0D, 0x0C0C, 0x79AD, 0x79AC], // DATA_13F672 → 0
  [0x0000, 0x0000, 0x85A8, 0x85A7, 0x0D0E, 0x0C0C, 0x79B6, 0x79AE], // DATA_13F682 → 1
  [0x0000, 0x0000, 0x85A8, 0x85A6, 0x0D0E, 0x0C0B, 0x79BD, 0x79AE], // DATA_13F692 → 2
  [0x85C2, 0x0000, 0x85A9, 0x85A6, 0x0D0E, 0x0C0C, 0x79AD, 0x79AF], // DATA_13F6A2 → 3
  [0x85C3, 0x85C1, 0x85AA, 0x85A5, 0x0D0E, 0x0C0C, 0x79B1, 0x79B0], // DATA_13F6B2 → 4
] as const;

// DATA_slope_down_left_ptrs (Bank13.asm:14396) — 8 variants → 5 records
// with 3 mirror reuses.
const SLOPE_DOWN_LEFT_LONG_VARIANT_TO_RECORD = [0, 1, 2, 3, 4, 4, 3, 0] as const;

// DATA_13F828..DATA_13F868 — 5 distinct 8-entry records for $E8.
const SLOPE_DOWN_RIGHT_LONG_RECORDS: readonly (readonly number[])[] = [
  [0x0000, 0x0000, 0x85AD, 0x85B1, 0x0F11, 0x100E, 0x79B2, 0x79BE], // DATA_13F828 → 0
  [0x0000, 0x0000, 0x85AD, 0x85B1, 0x0F10, 0x100E, 0x79AF, 0x79B7], // DATA_13F838 → 1
  [0x0000, 0x0000, 0x85AD, 0x85B2, 0x0F10, 0x100F, 0x79B3, 0x79B4], // DATA_13F848 → 2
  [0x85C3, 0x0000, 0x85AE, 0x85B1, 0x0F10, 0x100E, 0x79C2, 0x79B6], // DATA_13F858 → 3
  [0x85C2, 0x85C3, 0x85AF, 0x85B0, 0x0F11, 0x100E, 0x79B2, 0x79BE], // DATA_13F868 → 4
] as const;

const SLOPE_DOWN_RIGHT_LONG_VARIANT_TO_RECORD = [0, 1, 2, 3, 4, 4, 3, 0] as const;

/** Shared rows-0..3 + rows-4+ implementation used by $E5 and $E8.
 *  `record` is the 8-entry per-variant array; `bias` is added to the
 *  jungle-fill PRNG roll for rows 4+. */
function stampSlopeBodyShared(
  state: DecodeState,
  record: readonly number[]
): void {
  const row = signed8(state.zp2C);
  if (row >= 4) {
    jungleFloorRandomFillBiased(state, (row - 4) * 2);
    return;
  }
  const colParity = state.zp28 & 1;
  const tile = record[row * 2 + colParity]!;
  if (tile === 0) return;
  stampCell(state, tile);
}

interface SlopeLongConfig {
  records: readonly (readonly number[])[];
  variantToRecord: readonly number[];
  /** Cart PRNG caller PC for this slope's body variant roll ($E5 = $13F713,
   *  $E8 = $13F8C9) — they're separate routines in the cart, so each gets its
   *  own replay queue even though we share `makeSlopeLongStamp`. */
  prngSite: number;
  /** Row-1 + col-0 edge-fix (`$E5`: right-edge; `$E8`: left-edge). */
  row1EdgeFix: (state: DecodeState) => void;
  /** Row-2 edge-fix (`$E5`: left-edge; `$E8`: right-edge). */
  row2EdgeFix: (state: DecodeState) => void;
  /** Row-2 edge condition (`$E5`: `$28-1==$2A`; `$E8`: `$28+1==$2A`). */
  row2EdgeTest: (state: DecodeState) => boolean;
}

function makeSlopeLongStamp(cfg: SlopeLongConfig): PerCellHandler {
  return (state) => {
    // STZ $9B — clear rewound flag at entry (Bank13.asm:14413/14596).
    state.rewound = 0;

    const row = signed8(state.zp2C);
    const col = state.zp28 & 0xff;

    // Row-1 + col-0 edge-fix.
    if (row === 1 && col === 0) {
      cfg.row1EdgeFix(state);
    }
    // Row-2 + edge-test edge-fix.
    if (row === 2 && cfg.row2EdgeTest(state)) {
      cfg.row2EdgeFix(state);
    }

    // body: col parity + last-row $9B inc (cart "narrow-body" signal).
    const colParity = col & 1;
    if (colParity !== 0) {
      const rowPlus1 = (row + 1) & 0xff;
      if (rowPlus1 === (state.zp2E & 0xff)) {
        state.rewound = (state.rewound + 1) & 0xffff;
      }
    }

    // PRNG variant roll on (row=0, col-even). The cart's $A1==4-or-8
    // underlying-tile fallback (Bank13.asm:14449-14460) forces $A1=0
    // when the cell already holds ground ($9000..$904F) so the slope's
    // silhouette doesn't gap-out over pre-stamped terrain.
    if (row === 0 && colParity === 0) {
      state.zpA1 = (prngNext(state, cfg.prngSite) & 0x07) << 1;
      if (state.zpA1 === 4 || state.zpA1 === 8) {
        const cur = readBuf16(state, state.zp1D);
        if (cur >= 0x9000 && cur < 0x9050) {
          state.zpA1 = 0;
        }
      }
    }

    const variant = (state.zpA1 >>> 1) & 0x07;
    const recordIdx = cfg.variantToRecord[variant]!;
    const record = cfg.records[recordIdx]!;
    stampSlopeBodyShared(state, record);
  };
}

const stampSlopeDownLeftLong = makeSlopeLongStamp({
  records: SLOPE_DOWN_LEFT_LONG_RECORDS,
  variantToRecord: SLOPE_DOWN_LEFT_LONG_VARIANT_TO_RECORD,
  prngSite: RNG_SITE.slopeDownLeftLongBody,
  row1EdgeFix: slopeFixRightEdge,
  row2EdgeFix: slopeFixLeftEdge,
  // $E5 row-2 fires when `$28 - 1 == $2A` (low byte). For positive col
  // extent the walker never reaches that condition; for negative extent
  // (slope grows leftward) it fires on the far-edge column.
  row2EdgeTest: (state) =>
    ((state.zp28 - 1) & 0xff) === (state.zp2A & 0xff),
});
const stampSlopeDownRightLong = makeSlopeLongStamp({
  records: SLOPE_DOWN_RIGHT_LONG_RECORDS,
  variantToRecord: SLOPE_DOWN_RIGHT_LONG_VARIANT_TO_RECORD,
  prngSite: RNG_SITE.slopeDownRightLongBody,
  row1EdgeFix: slopeFixLeftEdge,
  row2EdgeFix: slopeFixRightEdge,
  // $E8 row-2 fires when `$28 + 1 == $2A` — the natural last-col test
  // for positive extent.
  row2EdgeTest: (state) =>
    ((state.zp28 + 1) & 0xff) === (state.zp2A & 0xff),
});

function initSlopeDownLeftLong(state: DecodeState): void {
  // Cart: JSR slope_shift_origin_left_20 (origin -=$0020, $2E +=2),
  // then $17=$FFFF (slope step -1 row per col), keep-slope walker.
  // We mirror the origin/$2E adjustment + slope step — the parser's
  // overflow-continue fix catches LRU exhaustion on a per-object
  // basis without halting the rest of the decode.
  shiftOriginNibble(state, -0x0020);
  state.zp2E = (state.zp2E + 2) & 0xffff;
  state.zp17 = 0xFFFF; // signed -1
  walkerSetupKeepSlope(state, stampSlopeDownLeftLong);
}

function initSlopeDownRightLong(state: DecodeState): void {
  // Mirror of $E5 — same origin shift + slope step, different stamp
  // record set.
  shiftOriginNibble(state, -0x0020);
  state.zp2E = (state.zp2E + 2) & 0xffff;
  state.zp17 = 0xFFFF;
  walkerSetupKeepSlope(state, stampSlopeDownRightLong);
}

// ───────────────────────────────────────────────────────────────────────
// Registration
// ───────────────────────────────────────────────────────────────────────

export function installBank13SlopesMiscHandlers(): void {
  registerStdObjectHandler(0x63, initThreeSegmentRow);
  // $64 / $65 share the init handler with $63 per the cart's dispatch
  // table footprint (Bank12.asm comment "Object $63-$65 init").
  registerStdObjectHandler(0x64, initThreeSegmentRow);
  registerStdObjectHandler(0x65, initThreeSegmentRow);
  // Cart CODE_init_pole_6variant_aligned dispatches $C4-$C9 via $15.
  for (let id = 0xC4; id <= 0xC9; id++) {
    registerStdObjectHandler(id, initPole6variant);
  }
  registerStdObjectHandler(0xE4, initSlopeSteepUpLeft);
  registerStdObjectHandler(0xE5, initSlopeDownLeftLong);
  registerStdObjectHandler(0xE8, initSlopeDownRightLong);
  registerStdObjectHandler(0xEB, initShorelineSlopeCapped);
  registerStdObjectHandler(0xEC, initShorelineSlopeCapped);
}
