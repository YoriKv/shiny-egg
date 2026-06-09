// Bank12 init + Bank13 stamp handlers for the 4-row diagonal-sewage-pipe
// (standard objects $B4 and $B5). Part of the unified $B2–$B9
// diagonal-sewage-pipe family — see `_diagonal-sewage-pipe-shared.ts`.
//
// Cart entry points:
//   CODE_init_diagonal_sewage_pipe_4row        ($12:9FC6, Bank12.asm:4893)
//   DATA_diagonal_sewage_pipe_4row_body_ptrs   ($12:9FC2, Bank12.asm:4889)
//                                                $B4 → CODE_stamp_diagonal_sewage_pipe_ceiling   ($13:E281, shared with $B2)
//                                                $B5 → CODE_stamp_diagonal_sewage_pipe_4row_floor ($13:E2C5)
//   CODE_stamp_diagonal_sewage_pipe_ceiling    ($13:E281, shared with $B2)
//   CODE_stamp_diagonal_sewage_pipe_4row_floor ($13:E2C5)
//
// Init forces row_extent = 4, $17 = $FFFF (negative slope step), then
// dispatches to ceiling/floor body via $15 bit 0. The 4-row ceiling
// reuses the same stamp + tile table as $B2's 3-row ceiling — the only
// difference is `$2E = 4` here vs `$2E = 3` in the 3row init.

import type { DecodeState } from '../state.ts';
import { registerStdObjectHandler } from './index.ts';
import { initDiagonalKeepSlope, makeKeepSlopeRowStamp } from './_shared.ts';
import {
  DATA_diagonal_sewage_pipe_4row_floor_tiles,
  stampDiagonalSewagePipeCeiling,
} from './_diagonal-sewage-pipe-shared.ts';

// $B5-only body: 4-entry floor table.
const stampDiagonalSewagePipe4rowFloor =
  makeKeepSlopeRowStamp(DATA_diagonal_sewage_pipe_4row_floor_tiles);

// Merge: object IDs 0xB4, 0xB5 share this handler.
function initDiagonalSewagePipe4row(state: DecodeState): void {
  initDiagonalKeepSlope(
    state,
    /* rowExtent */ 4,
    /* $15 bit 0 = 0 → ceiling ($B4) */ stampDiagonalSewagePipeCeiling,
    /* $15 bit 0 = 1 → floor   ($B5) */ stampDiagonalSewagePipe4rowFloor,
  );
}

export function installDiagonalSewagePipe4rowHandlers(): void {
  registerStdObjectHandler(0xB4, initDiagonalSewagePipe4row);
  registerStdObjectHandler(0xB5, initDiagonalSewagePipe4row);
}
