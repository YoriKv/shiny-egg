// Bank12 init + Bank13 stamp handlers for the 3-row alt diagonal-sewage-pipe
// (standard objects $B6 and $B7). Part of the unified $B2–$B9
// diagonal-sewage-pipe family — see `_diagonal-sewage-pipe-shared.ts`.
//
// Cart entry points:
//   CODE_init_diagonal_sewage_pipe_3row_alt        ($12:9FE5, Bank12.asm:4912)
//   DATA_diagonal_sewage_pipe_3row_alt_body_ptrs   ($12:9FE1, Bank12.asm:4907)
//                                                    $B6 → CODE_stamp_diagonal_sewage_pipe_alt_ceiling     ($13:E2E8, shared with $B8)
//                                                    $B7 → CODE_stamp_diagonal_sewage_pipe_3row_alt_floor  ($13:E32D)
//   CODE_stamp_diagonal_sewage_pipe_alt_ceiling    ($13:E2E8, shared with $B8)
//   CODE_stamp_diagonal_sewage_pipe_3row_alt_floor ($13:E32D)
//
// The "alt" pair differs from the plain $B2/$B3 pair by adding a
// decorator probe: row 1's sentinel tile triggers a neighbour Map16
// lookup (below for ceiling, above for floor) and may swap to a
// "seam" tile if the neighbour matches one of two well-known shapes.
// See `_diagonal-sewage-pipe-shared.ts` for the `BELOW_PROBE` /
// `ABOVE_PROBE` descriptors.

import type { DecodeState } from '../state.ts';
import { registerStdObjectHandler } from './index.ts';
import { initDiagonalKeepSlope, makeKeepSlopeRowStamp } from './_shared.ts';
import {
  ABOVE_PROBE,
  BELOW_PROBE,
  DATA_diagonal_sewage_pipe_3row_alt_floor_tiles,
  DATA_diagonal_sewage_pipe_alt_ceiling_tiles,
} from './_diagonal-sewage-pipe-shared.ts';

// $B6 ceiling body — also reused by $B8 via the 4-row-alt init. The
// 3-row caller walks rows 0..2 ($2E=3), so the table's 4th entry
// ($77AC) is unreachable from here; preserved in the shared table for
// $B8 (which walks rows 0..3 with $2E=4) and cart `dw` fidelity.
const stampDiagonalSewagePipeAltCeiling =
  makeKeepSlopeRowStamp(DATA_diagonal_sewage_pipe_alt_ceiling_tiles, BELOW_PROBE);

// $B7-only floor body.
const stampDiagonalSewagePipe3rowAltFloor =
  makeKeepSlopeRowStamp(DATA_diagonal_sewage_pipe_3row_alt_floor_tiles, ABOVE_PROBE);

// Merge: object IDs 0xB6, 0xB7 share this handler.
function initDiagonalSewagePipe3rowAlt(state: DecodeState): void {
  initDiagonalKeepSlope(
    state,
    /* rowExtent */ 3,
    /* $15 bit 0 = 0 → alt ceiling ($B6) */ stampDiagonalSewagePipeAltCeiling,
    /* $15 bit 0 = 1 → alt floor   ($B7) */ stampDiagonalSewagePipe3rowAltFloor,
  );
}

export function installDiagonalSewagePipe3rowAltHandlers(): void {
  registerStdObjectHandler(0xB6, initDiagonalSewagePipe3rowAlt);
  registerStdObjectHandler(0xB7, initDiagonalSewagePipe3rowAlt);
}
