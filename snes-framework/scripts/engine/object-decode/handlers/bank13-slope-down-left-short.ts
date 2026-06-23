// $E6 — CODE_init_slope_down_left_short / CODE_stamp_slope_down_left_short
//
// Short down-left ground slope (4-row silhouette + jungle-fill tail).
// Cart `CODE_init_slope_down_left_short` (Bank12.asm:5300) calls the
// shared `CODE_slope_shift_origin_left_20` (origin -= $0020, $2E += 2),
// sets $17=$FFFF (slope step = -1 row per col), and tail-calls
// `walker_setup_keep_slope` with stamp `CODE_stamp_slope_down_left_short`
// (Bank13.asm:14486).
//
// Per-cell stamp algorithm (Bank13.asm:14487):
//   if zp2C == 2 AND (zp28-1) & 0xff == zp2A & 0xff:
//       JSR slope_fix_left_edge   // smooths left-side seam against ground
//   zp9B = 1                       // signal "narrow slope" to body helper
//   if zp2C == 0:
//       zpA1 = (prng & 7) << 1     // re-roll variant on every row-0 cell
//   record_ptr = DATA_slope_down_left_short_ptrs[zpA1]
//   tail-call stamp_slope_body_narrow(record_ptr)
//
// `stamp_slope_body_narrow` (Bank13.asm:14754 / $13:F9D3):
//   if zp2C >= 4:
//       bias = (zp2C - 4) * 2
//       jungleFloorRandomFillBiased(bias)
//   else:
//       tile = record[zp2C]        // 4-word per-variant record
//       if tile != 0: stampCell(tile)   // $0000 = leave existing
//
// Differs from $E5 long-slope only in:
//   - record width: 4 words (row-indexed only) vs 8 words (row*2+col_parity)
//   - variant table: 5 distinct records, 8 entries (vs 5/8 for long)
//   - variant reroll: every row=0 cell (any col parity) vs every (row=0, even col)
//
// Edge-fix call (CODE_slope_fix_left_edge) is now ported — see
// slopeFixLeftEdge in bank13-slopes-misc.ts. Fires on row 2 +
// (`$28-1==$2A`); probes the left neighbour and rewrites $79D8/$79D9
// ground tiles to $79C9 (slope-meets-ground corner blend).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell, signed8, shiftOriginNibble, jungleFloorRandomFillBiased } from './_shared.ts';
import { slopeFixLeftEdge } from './bank13-slopes-misc.ts';

// DATA_13F73F..DATA_13F75F — 5 distinct 4-word records for $E6.
// Each entry is [row0, row1, row2, row3]. $0000 entries = "skip stamp".
const SLOPE_DOWN_LEFT_SHORT_RECORDS: readonly (readonly number[])[] = [
  [0x0000, 0x85B9, 0x0814, 0x79AA], // DATA_13F73F → record 0
  [0x0000, 0x85BA, 0x0815, 0x79AA], // DATA_13F747 → record 1
  [0x0000, 0x85B9, 0x0816, 0x79AB], // DATA_13F74F → record 2
  [0x85C1, 0x85BB, 0x0816, 0x79AB], // DATA_13F757 → record 3
  [0x85C2, 0x85BC, 0x0814, 0x79B6], // DATA_13F75F → record 4
] as const;

// DATA_slope_down_left_short_ptrs (Bank13.asm:14482) — 8 variants → 5
// records with 3 mirror reuses (entries 5/6/7 reuse 4/3/0 — outer-edge
// silhouette wraps back to the cleanest variant).
const SLOPE_DOWN_LEFT_SHORT_VARIANT_TO_RECORD = [0, 1, 2, 3, 4, 4, 3, 0] as const;

/** Shared rows-0..3 + rows-4+ implementation for the narrow (single-col)
 *  short / half slope body. Mirror of `stamp_slope_body_narrow`
 *  (Bank13.asm:14754). The "narrow" variant indexes the per-variant
 *  record by row alone (4 words), unlike the "shared" wide variant which
 *  uses `row*2 + col_parity` (8 words). */
function stampSlopeBodyNarrow(
  state: DecodeState,
  record: readonly number[]
): void {
  const row = signed8(state.zp2C);
  if (row >= 4) {
    jungleFloorRandomFillBiased(state, (row - 4) * 2);
    return;
  }
  const tile = record[row]!;
  if (tile === 0) return; // $0000 = leave existing tile
  stampCell(state, tile);
}

const stampSlopeDownLeftShort: PerCellHandler = (state) => {
  const row = signed8(state.zp2C);

  // Row 2 + far-column edge-fix (Bank13.asm:14740-14747). Fires when
  // `$28 - 1 == $2A` (low byte) — natural for negative col-extent
  // (slope grows leftward). Probes left neighbour and substitutes the
  // ground-meets-slope corner blend if it's $79D8/$79D9.
  if (row === 2 && ((state.zp28 - 1) & 0xff) === (state.zp2A & 0xff)) {
    slopeFixLeftEdge(state);
  }

  // $9B=1 signal to body helper. The walker reads $9B as the "rewound"
  // flag; setting it here triggers a nibble-rewind on the next column
  // wrap. The cart's keep-slope walker uses this in concert with
  // $17=$FFFF to step diagonally down-left one Map16 cell per column.
  state.rewound = 0x0001;

  // Re-roll variant on every row-0 cell (any col parity). The cart's
  // `LDA $2C / BNE` only tests row — each new column at row=0 picks a
  // fresh variant from the 8-entry ptr table.
  if (row === 0) {
    state.zpA1 = (prngNext(state, RNG_SITE.slopeDownLeftShort) & 0x07) << 1;
  }
  const variant = (state.zpA1 >>> 1) & 0x07;
  const recordIdx = SLOPE_DOWN_LEFT_SHORT_VARIANT_TO_RECORD[variant]!;
  const record = SLOPE_DOWN_LEFT_SHORT_RECORDS[recordIdx]!;
  stampSlopeBodyNarrow(state, record);
};

function initSlopeDownLeftShort(state: DecodeState): void {
  // Cart: JSR slope_shift_origin_left_20 (origin -= $0020, $2E += 2),
  // then $17=$FFFF (slope step = -1 row per col), keep-slope walker.
  // Mirrors $E5/$E8's init shape exactly.
  shiftOriginNibble(state, -0x0020);
  state.zp2E = (state.zp2E + 2) & 0xffff;
  state.zp17 = 0xFFFF; // signed -1
  walkerSetupKeepSlope(state, stampSlopeDownLeftShort);
}

export function installSlopeDownLeftShortHandlers(): void {
  registerStdObjectHandler(0xE6, initSlopeDownLeftShort);
}
