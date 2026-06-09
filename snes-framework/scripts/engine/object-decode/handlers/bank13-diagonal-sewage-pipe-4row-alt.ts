// Bank12 init + Bank13 stamp handlers for the 4-row alt diagonal-sewage-pipe
// (standard objects $B8 and $B9). Part of the unified $B2–$B9
// diagonal-sewage-pipe family — see `_diagonal-sewage-pipe-shared.ts`.
//
// Cart entry points:
//   CODE_init_diagonal_sewage_pipe_4row_alt        ($12:A000, Bank12.asm:4931)
//   DATA_diagonal_sewage_pipe_4row_alt_body_ptrs   ($12:9FFC, Bank12.asm:4926)
//                                                    $B8 → CODE_stamp_diagonal_sewage_pipe_alt_ceiling     ($13:E2E8, shared with $B6)
//                                                    $B9 → CODE_stamp_diagonal_sewage_pipe_4row_alt_floor  ($13:E374)
//   CODE_stamp_diagonal_sewage_pipe_alt_ceiling    ($13:E2E8, shared with $B6)
//   CODE_stamp_diagonal_sewage_pipe_4row_alt_floor ($13:E374)
//
// 4-row counterpart of the $B6/$B7 alt pair. The ceiling body and tile
// table are reused from the 3-row file; the floor body has its own
// 4-entry tile table (otherwise identical decorator probe).

import type { DecodeState } from '../state.ts';
import { registerStdObjectHandler } from './index.ts';
import { initDiagonalKeepSlope, makeKeepSlopeRowStamp } from './_shared.ts';
import {
  ABOVE_PROBE,
  BELOW_PROBE,
  DATA_diagonal_sewage_pipe_4row_alt_floor_tiles,
  DATA_diagonal_sewage_pipe_alt_ceiling_tiles,
} from './_diagonal-sewage-pipe-shared.ts';

// $B8 ceiling body — shares the alt-ceiling tile table with $B6 (which
// walks rows 0..2; $B8 walks rows 0..3). The cart actually shares the
// `CODE_stamp_diagonal_sewage_pipe_alt_ceiling` routine itself between
// $B6 and $B8, but the per-file closure here is cheap and keeps the
// alt-ceiling import surface symmetrical with the plain-ceiling case.
const stampDiagonalSewagePipeAltCeiling =
  makeKeepSlopeRowStamp(DATA_diagonal_sewage_pipe_alt_ceiling_tiles, BELOW_PROBE);

// $B9-only floor body.
const stampDiagonalSewagePipe4rowAltFloor =
  makeKeepSlopeRowStamp(DATA_diagonal_sewage_pipe_4row_alt_floor_tiles, ABOVE_PROBE);

// Merge: object IDs 0xB8, 0xB9 share this handler.
function initDiagonalSewagePipe4rowAlt(state: DecodeState): void {
  initDiagonalKeepSlope(
    state,
    /* rowExtent */ 4,
    /* $15 bit 0 = 0 → alt ceiling ($B8) */ stampDiagonalSewagePipeAltCeiling,
    /* $15 bit 0 = 1 → alt floor   ($B9) */ stampDiagonalSewagePipe4rowAltFloor,
  );
}

export function installDiagonalSewagePipe4rowAltHandlers(): void {
  registerStdObjectHandler(0xB8, initDiagonalSewagePipe4rowAlt);
  registerStdObjectHandler(0xB9, initDiagonalSewagePipe4rowAlt);
}
