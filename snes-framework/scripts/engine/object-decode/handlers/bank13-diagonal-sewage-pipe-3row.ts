// Bank12 init + Bank13 stamp handlers for the 3-row diagonal-sewage-pipe
// (standard objects $B2 and $B3). Part of the unified $B2–$B9
// diagonal-sewage-pipe family — see `_diagonal-sewage-pipe-shared.ts`
// for the shared tile tables, probe descriptors, and `_shared.ts` for
// the keep-slope factory primitives.
//
// Cart entry points:
//   CODE_init_diagonal_sewage_pipe_3row        ($12:9FA7, Bank12.asm:4874)
//   DATA_diagonal_sewage_pipe_3row_body_ptrs   ($12:9FA3, Bank12.asm:4870)
//                                                $B2 → CODE_stamp_diagonal_sewage_pipe_ceiling   ($13:E281)
//                                                $B3 → CODE_stamp_diagonal_sewage_pipe_3row_floor ($13:E2A2)
//   CODE_stamp_diagonal_sewage_pipe_ceiling    ($13:E281, shared with $B4)
//   CODE_stamp_diagonal_sewage_pipe_3row_floor ($13:E2A2)
//
// Init forces row_extent = 3, $17 = $FFFF (negative slope step), and
// dispatches to ceiling/floor body via $15 bit 0. Spec entry-DP diff
// shows `row_extent 0001 → 0003 (delta $0002)`.
//
// Note on the shared ceiling table: $B2 only walks rows 0..2 ($2E=3),
// so the 4th entry ($77AB) in `DATA_diagonal_sewage_pipe_ceiling_tiles`
// is unreachable here. Kept in the shared table for byte-for-byte
// fidelity with the cart `dw` declaration and so $B4 can reach it.

import type { DecodeState } from '../state.ts';
import { registerStdObjectHandler } from './index.ts';
import { initDiagonalKeepSlope, makeKeepSlopeRowStamp } from './_shared.ts';
import {
  DATA_diagonal_sewage_pipe_3row_floor_tiles,
  stampDiagonalSewagePipeCeiling,
} from './_diagonal-sewage-pipe-shared.ts';

// $B3-only body: 3-entry floor table.
const stampDiagonalSewagePipe3rowFloor =
  makeKeepSlopeRowStamp(DATA_diagonal_sewage_pipe_3row_floor_tiles);

// Merge: object IDs 0xB2, 0xB3 share this handler.
function initDiagonalSewagePipe3row(state: DecodeState): void {
  initDiagonalKeepSlope(
    state,
    /* rowExtent */ 3,
    /* $15 bit 0 = 0 → ceiling ($B2) */ stampDiagonalSewagePipeCeiling,
    /* $15 bit 0 = 1 → floor   ($B3) */ stampDiagonalSewagePipe3rowFloor,
  );
}

export function installDiagonalSewagePipe3rowHandlers(): void {
  registerStdObjectHandler(0xB2, initDiagonalSewagePipe3row);
  registerStdObjectHandler(0xB3, initDiagonalSewagePipe3row);
}
