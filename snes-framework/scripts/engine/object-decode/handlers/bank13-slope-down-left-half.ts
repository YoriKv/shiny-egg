// Bank13 stamp handler for std object $E7 — half-height
// down-left slope.
//
// Cart `CODE_init_slope_down_left_half` (Bank12.asm:5310) +
// `CODE_stamp_slope_down_left_half` (Bank13.asm:14531). This is the
// "narrow / half" sibling of $E5 (long down-left) and $E6 (short
// down-left). They all share `CODE_stamp_slope_body_narrow`
// (Bank13.asm:14754) — rows 0..3 indirect-fetch from a per-variant
// 4-word record (DATA_13F7A7..DATA_13F7C7), rows 4+ tail-call
// `CODE_jungle_floor_random_fill` (the shared helper already lives in
// `bank13-slopes-misc.ts`; we duplicate the small biased-pick helper
// here to keep the file self-contained and avoid cross-file plumbing
// for one short function).
//
// Differences from $E5 (long) / $E6 (short):
//   $E5 init shifts origin by $20 (2 cols) and uses a wider
//   "body_shared" stamper with column-parity entries. $E6 init shifts
//   by $10 like us, but the stamp adds a right-edge fix-up call on the
//   last column of row 2. $E7 has neither edge fix nor parity gate —
//   the narrowest, simplest member of the family.
//
// Edge-fix call sites (`CODE_slope_fix_*_edge` corner-blend) are
// cart-side runtime visual smoothing that doesn't materially affect
// the static editor preview, so they're not ported here (matches the
// convention in `bank13-slopes-misc.ts`).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell, signed8, shiftOriginNibble, jungleFloorRandomFillBiased } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_13F7A7..DATA_13F7C7 — 5 distinct 4-word records for $E7.
// Each entry is [row0, row1, row2, row3]. (No column-parity dimension —
// the half-slope is one-tile-wide per col-step.) `$0000` entries would
// mean "skip stamp", but none of the half-slope records have any.
// ─────────────────────────────────────────────────────────────────────

const SLOPE_DOWN_LEFT_HALF_RECORDS: readonly (readonly number[])[] = [
  [0x85A7, 0x020A, 0x030D, 0x79B9], // DATA_13F7A7 → 0
  [0x85A7, 0x020A, 0x030D, 0x79AC], // DATA_13F7AF → 1
  [0x85A6, 0x020B, 0x030D, 0x79B9], // DATA_13F7B7 → 2
  [0x85A7, 0x020A, 0x030D, 0x79B6], // DATA_13F7BF → 3
  [0x85B3, 0x020A, 0x030D, 0x79B9], // DATA_13F7C7 → 4
] as const;

// DATA_slope_down_left_half_ptrs (Bank13.asm:14527) — 8 variants → 5
// records with 3 mirror reuses. Same 5-distinct + 3-mirror layout as
// DATA_slope_down_left_short_ptrs.
//   dw F7C7, F7BF, F7B7, F7AF, F7A7, F7BF, F7AF, F7A7
const SLOPE_DOWN_LEFT_HALF_VARIANT_TO_RECORD = [4, 3, 2, 1, 0, 3, 1, 0] as const;


// ─────────────────────────────────────────────────────────────────────
// $E7 — CODE_stamp_slope_down_left_half (Bank13.asm:14531)
//
// Per-cell algorithm:
//   $9B = 1                              // "narrow slope" signal
//   if $2C == 0 (row 0):
//       $A1 = (prng & $07) << 1          // pick variant 0..7 each new col
//   record = DATA_slope_down_left_half_ptrs[$A1 >> 1]
//   → CODE_stamp_slope_body_narrow:
//       if $2C >= 4 (row 4+):
//           bias = ($2C - 4) * 2
//           jungleFloorRandomFillBiased(bias)
//       else (rows 0..3):
//           tile = record[$2C]
//           if tile != 0: stampCell(tile)
//
// Note: unlike $E5 (long), there is no `(col & 1) == 0` parity gate on
// the variant re-roll — the half-slope is one-tile-wide per col-step,
// so every column at row 0 rolls a fresh variant. Trace confirms this:
// cells 0/10/18/24/28 (all col-step row-0 cells) each call prng.
// ─────────────────────────────────────────────────────────────────────

// Exported so the shoreline-left handler ($EB) can reuse it as its rows-0..2
// body, exactly as the cart's `CODE_stamp_shoreline_slope_left` does
// (`JSL CODE_stamp_slope_down_left_half`). That shared call is what makes the
// $13F7EE variant roll fire for shoreline columns too.
export const stampSlopeDownLeftHalf: PerCellHandler = (state) => {
  // Cart: REP #$30; LDA #$0001; STA $9B (narrow-slope signal —
  // consumed by `body_narrow` callers; cosmetic for our decoder but
  // we mirror the write for fidelity with $E6 and the shoreline reuse
  // at CODE_stamp_shoreline_slope_left).
  state.rewound = 0x0001;
  const row = signed8(state.zp2C);
  if (row === 0) {
    state.zpA1 = (prngNext(state, RNG_SITE.slopeDownLeftHalf) & 0x07) << 1;
  }
  if (row >= 4) {
    jungleFloorRandomFillBiased(state, (row - 4) * 2);
    return;
  }
  const variant = (state.zpA1 >>> 1) & 0x07;
  const recordIdx = SLOPE_DOWN_LEFT_HALF_VARIANT_TO_RECORD[variant]!;
  const record = SLOPE_DOWN_LEFT_HALF_RECORDS[recordIdx]!;
  const tile = record[row]!;
  if (tile === 0) return; // $0000 = skip stamp (none in the half-slope records)
  stampCell(state, tile);
};

function initSlopeDownLeftHalf(state: DecodeState): void {
  // Cart CODE_init_slope_down_left_half (Bank12.asm:5310):
  //   REP #$20
  //   $1B = (($1B & $F0F0) - $0010) & $F0F0 | ($1B & $0F0F)   // -$10 col
  //   INC $2E                                                  // row-extent +1
  //   $17 = $FFFE                                              // slope step -2
  //   walker_setup_keep_slope CODE_stamp_slope_down_left_half
  //
  // The -$10 shift is HALF a column (long-slope siblings $E5/$E8 use
  // -$20 = 2 cells). The $17 = $FFFE step (-2 rows per col) makes the
  // walker advance two rows per column-wrap — the half-slope's steep
  // diagonal. Spec confirms: xy_lo $10 → $00 (row-shift-up by $10),
  // row_extent $0009 → $000A (+1).
  shiftOriginNibble(state, -0x0010);
  state.zp2E = (state.zp2E + 1) & 0xffff;
  state.zp17 = 0xFFFE; // signed -2
  walkerSetupKeepSlope(state, stampSlopeDownLeftHalf);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installSlopeDownLeftHalfHandlers(): void {
  registerStdObjectHandler(0xE7, initSlopeDownLeftHalf);
}
