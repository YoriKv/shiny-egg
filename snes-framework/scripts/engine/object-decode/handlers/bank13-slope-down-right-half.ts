// Bank13 stamp handler for object $EA — init_slope_down_right_half.
//
// Cart `CODE_init_slope_down_right_half` (`Bank12.asm:5350`) is the half-
// height mirror of object $E7 (down-left-half). The init:
//   - shifts `$1B` left by `$10` (one cell up)
//   - bumps `$2E` by 1 (one row taller)
//   - sets `$17 = $FFFE` (signed -2 → slope steps 2 rows up per col-pair,
//     i.e. half-slope diagonal; cf. `$FFFF`/-1 for the "long" $E5/$E8)
//   - activates `CODE_stamp_slope_down_right_half` (`CODE_stamp_slope_down_right_half`,
//     `Bank13.asm:14739`) via walker_setup_keep_slope.
//
// Per-cell stamp algorithm (`CODE_stamp_slope_down_right_half` tail-calls
// `CODE_stamp_slope_body_narrow` at `CODE_stamp_slope_body_narrow`):
//   set `$9B = 1` (rewind flag — walker re-anchors `$2C` to 0 on each
//                  column wrap, so row=0 fires once per column)
//   if `$2C == 0`:
//       `$A1 = (prng & 7) * 2`         // pick variant 0..7
//   record = `DATA_slope_down_right_half_ptrs[$A1]`  // 8 ptrs → 5 records
//   if `$2C >= 4`:
//       bias = (`$2C` - 4) * 2
//       jungleFloorRandomFillBiased(bias)
//   else:
//       tile = record[`$2C`]
//       if tile != 0: stampCell(tile)
//
// The cart's stamp is also reused by `CODE_stamp_shoreline_slope_right`
// (shoreline-slope right-side variant) — irrelevant for object $EA's
// own decode.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { stampCell, signed8, shiftOriginNibble } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Tile records — 5 distinct 4-word arrays at `DATA_13F97F..DATA_13F99F`
// (Bank13.asm:14720-14733). Each record holds row 0..3 entries; row 4+
// falls through to `CODE_jungle_floor_random_fill` (jungle-canopy pool).
// ─────────────────────────────────────────────────────────────────────

const SLOPE_DOWN_RIGHT_HALF_RECORDS: readonly (readonly number[])[] = [
  [0x85B8, 0x050B, 0x060D, 0x79BA], // DATA_13F97F → record 0
  [0x85B8, 0x050B, 0x060D, 0x79AC], // DATA_13F987 → record 1
  [0x85B7, 0x050A, 0x060D, 0x79BA], // DATA_13F98F → record 2
  [0x85B6, 0x050B, 0x060D, 0x79AF], // DATA_13F997 → record 3
  [0x85B6, 0x050B, 0x060D, 0x79BA], // DATA_13F99F → record 4
] as const;

// `DATA_slope_down_right_half_ptrs` / `DATA_slope_down_right_half_ptrs` (Bank13.asm:14735).
// 8 pointers → 5 records (3 mirror reuses). Indexed by `$A1` rolled
// via `(prng & 7) << 1`, so the value-as-byte-offset $00,$02,...,$0E
// decodes back to variant 0..7 → record below.
const SLOPE_DOWN_RIGHT_HALF_VARIANT_TO_RECORD = [4, 3, 2, 1, 0, 3, 1, 0] as const;

// `DATA_jungle_floor_fill_tiles` / `DATA_jungle_floor_fill_tiles` (Bank13.asm:14359) —
// duplicated here from `bank13-slopes-misc.ts` to keep this file self-
// contained (a follow-up consolidation pass can lift it into _shared.ts
// once both slope families settle).
const DATA_jungle_floor_fill_tiles = [
  0x79BB, 0x79BC, 0x79BD, 0x79BE, 0x79BF, 0x79C0, 0x79C1, 0x79C2,
  0x79C3, 0x79C4, 0x79E0, 0x79E0, 0x79E0, 0x79E0, 0x79E0, 0x79E0,
] as const;

/** `CODE_jungle_floor_random_fill` (`Bank13.asm:14374`) — `bias` enters
 *  in `$00`. PRNG-pick 0..15, ADD bias, clamp to 15, stamp. */
function jungleFloorRandomFillBiased(state: DecodeState, bias: number): void {
  let pick = (prngNext(state) & 0x0F) + bias;
  if (pick > 0x0F) pick = 0x0F;
  stampCell(state, DATA_jungle_floor_fill_tiles[pick]!);
}

const stampSlopeDownRightHalf: PerCellHandler = (state) => {
  // Cart `CODE_stamp_slope_down_right_half` writes `$9B = 1` unconditionally at entry; the
  // walker honours this on column-wrap by rewinding `$2C` to 0. We mirror
  // by setting `rewound` so the walker's per-column reset path engages.
  state.rewound = 0x0001;

  const row = signed8(state.zp2C);
  if (row === 0) {
    // (prng & 7) << 1 → byte-offset $00,$02,...,$0E into the 8-ptr table.
    state.zpA1 = (prngNext(state) & 0x07) << 1;
  }

  const variant = (state.zpA1 >>> 1) & 0x07;
  const recordIdx = SLOPE_DOWN_RIGHT_HALF_VARIANT_TO_RECORD[variant]!;
  const record = SLOPE_DOWN_RIGHT_HALF_RECORDS[recordIdx]!;

  if (row >= 4) {
    // `CODE_stamp_slope_body_narrow`'s rows-4+ branch: bias = (row-4)*2,
    // tail-call jungle_floor_random_fill.
    jungleFloorRandomFillBiased(state, (row - 4) * 2);
    return;
  }

  // Rows 0..3 → record[row]; `$0000` entries mean "skip stamp"
  // (transparent). All 5 records have non-zero entries here so the
  // BEQ in the cart never fires in practice — kept for fidelity.
  const tile = record[row]!;
  if (tile === 0) return;
  stampCell(state, tile);
};

function initSlopeDownRightHalf(state: DecodeState): void {
  // Cart: shift `$1B` left by `$10` (origin -=$0010), `$2E += 1`,
  // `$17 = $FFFE` (slope step -2 rows per col), keep-slope walker.
  shiftOriginNibble(state, -0x0010);
  state.zp2E = (state.zp2E + 1) & 0xffff;
  state.zp17 = 0xFFFE; // signed -2 (half-slope diagonal step)
  walkerSetupKeepSlope(state, stampSlopeDownRightHalf);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installSlopeDownRightHalfHandlers(): void {
  registerStdObjectHandler(0xEA, initSlopeDownRightHalf);
}
