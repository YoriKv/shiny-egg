// $E9 — CODE_init_slope_down_right_short → CODE_stamp_slope_down_right_short
//
// Cart (`Bank12.asm:5340`, stamp `Bank13.asm:14694`): short variant of
// the down-right ground slope — sibling of $E8 (long) and $EA (half).
//
// Init: tail-calls `CODE_slope_shift_origin_left_20` (origin -= $0020,
// $2E += 2), sets $17=$FFFF (slope-step -1 row per col), then
// `walker_setup_keep_slope` with stamp = `CODE_stamp_slope_down_right_short`.
//
// Stamp algorithm (`Bank13.asm:14694`):
//   if zp2C == 2 AND (zp28 + 1) == zp2A:
//     JSR CODE_slope_fix_right_edge   ; right-edge corner blend on last col of row 2
//   zp9B = 1
//   if zp2C == 0:                     ; row 0: roll variant
//     zpA1 = (prng & $07) << 1
//   record = DATA_slope_down_right_short_ptrs[zpA1 >> 1]   ; 8 variants → 5 records
//   tail-call CODE_stamp_slope_body_narrow with $00 = record ptr
//
// `CODE_stamp_slope_body_narrow` (`Bank13.asm:14754`):
//   if zp2C >= 4: bias = (zp2C - 4) * 2; jungleFloorRandomFillBiased
//   else: tile = record[zp2C]; if tile != 0: stampCell(tile)
//
// `CODE_slope_fix_right_edge`'s probe-and-rewrite of the neighbour
// cell is now ported — `slopeFixRightEdge` from bank13-slopes-misc.ts.
// Fires on row 2 + (`$28+1==$2A`); probes the right neighbour and
// substitutes the ground-meets-slope corner blend ($79D6/$79D7 → $79C8).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { stampCell, signed8, shiftOriginNibble } from './_shared.ts';
import { slopeFixRightEdge } from './bank13-slopes-misc.ts';

// DATA_13F917..DATA_13F937 (Bank13.asm:14675-14688) — 5 distinct
// 4-entry records. Each record indexed by row 0..3:
//   [0] = row 0   [1] = row 1   [2] = row 2   [3] = row 3
// `$0000` entries = "skip stamp" (leave existing tile).
const SLOPE_DOWN_RIGHT_SHORT_RECORDS: readonly (readonly number[])[] = [
  [0x0000, 0x85BD, 0x0A15, 0x79B7], // DATA_13F917 → 0
  [0x0000, 0x85BF, 0x0A16, 0x79B7], // DATA_13F91F → 1
  [0x0000, 0x85BD, 0x0A17, 0x79B8], // DATA_13F927 → 2
  [0x85C3, 0x85BE, 0x0A17, 0x79B8], // DATA_13F92F → 3
  [0x85C4, 0x85C0, 0x0A15, 0x79AF], // DATA_13F937 → 4
] as const;

// DATA_slope_down_right_short_ptrs (Bank13.asm:14691):
//   dw DATA_13F917,DATA_13F91F,DATA_13F927,DATA_13F92F,
//      DATA_13F937,DATA_13F937,DATA_13F92F,DATA_13F917
// 8 variants → 5 records with 3 mirror reuses.
const SLOPE_DOWN_RIGHT_SHORT_VARIANT_TO_RECORD = [0, 1, 2, 3, 4, 4, 3, 0] as const;

// DATA_jungle_floor_fill_tiles (Bank13.asm:14359) — re-listed here so this
// file is self-contained. 10 distinct $79xx + 6 weighted $79E0.
const DATA_jungle_floor_fill_tiles = [
  0x79BB, 0x79BC, 0x79BD, 0x79BE, 0x79BF, 0x79C0, 0x79C1, 0x79C2,
  0x79C3, 0x79C4, 0x79E0, 0x79E0, 0x79E0, 0x79E0, 0x79E0, 0x79E0,
] as const;

function jungleFloorRandomFillBiased(state: DecodeState, bias: number): void {
  let pick = (prngNext(state) & 0x0F) + bias;
  if (pick > 0x0F) pick = 0x0F;
  stampCell(state, DATA_jungle_floor_fill_tiles[pick]!);
}

const stampSlopeDownRightShort: PerCellHandler = (state) => {
  const row = signed8(state.zp2C);

  // Row 2 + last-col edge-fix (Bank13.asm:14952-14959). Cart `$28+1==$2A`
  // fires at the natural last col for positive col-extent. Probes the
  // right neighbour and substitutes $79D6/$79D7 → $79C8 (slope-meets-
  // ground right-corner blend).
  if (row === 2 && ((state.zp28 + 1) & 0xff) === (state.zp2A & 0xff)) {
    slopeFixRightEdge(state);
  }

  // Always set $9B = 1 (matches asm — narrows the walker on each
  // successive row, producing the staircase shape).
  state.rewound = 0x0001;

  // Re-roll the variant on row 0. The cart re-rolls every time row=0
  // (which, with $17=$FFFF slope step, happens once at the start of each
  // column-pair when the walker resets), giving each column-pair its own
  // silhouette variant.
  if (row === 0) {
    state.zpA1 = (prngNext(state) & 0x07) << 1;
  }

  const variant = (state.zpA1 >>> 1) & 0x07;
  const recordIdx = SLOPE_DOWN_RIGHT_SHORT_VARIANT_TO_RECORD[variant]!;
  const record = SLOPE_DOWN_RIGHT_SHORT_RECORDS[recordIdx]!;

  // CODE_stamp_slope_body_narrow: rows 0..3 from record, rows 4+ jungle.
  if (row >= 4) {
    jungleFloorRandomFillBiased(state, (row - 4) * 2);
    return;
  }
  const tile = record[row]!;
  if (tile === 0) return; // $0000 = skip stamp
  stampCell(state, tile);

};

function initSlopeDownRightShort(state: DecodeState): void {
  // CODE_slope_shift_origin_left_20: origin -= $0020 (2 cells left),
  // $2E += 2 (2 rows taller).
  shiftOriginNibble(state, -0x0020);
  state.zp2E = (state.zp2E + 2) & 0xffff;
  // $17 = $FFFF (signed -1: slope step -1 row per col → diagonal walker).
  state.zp17 = 0xFFFF;
  walkerSetupKeepSlope(state, stampSlopeDownRightShort);
}

export function installSlopeDownRightShortHandlers(): void {
  registerStdObjectHandler(0xE9, initSlopeDownRightShort);
}
