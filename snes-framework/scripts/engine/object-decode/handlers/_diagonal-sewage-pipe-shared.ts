// Shared tile tables, probe descriptors, and pre-instantiated stamps
// for the diagonal-sewage-pipe family — std objects $B2 through $B9.
//
// yi-shiny unified this whole cluster under one name: the cart's
// 4 distinct init handlers and 5 distinct stamp routines all render
// fragments of a single "diagonal sewage pipe" decoration with two
// row-heights (3 and 4) × two side-axes (ceiling = $15 bit 0 clear,
// floor = $15 bit 0 set) × two variants (plain and alt-with-probe).
//
// All shared by-name with the asm:
//   DATA_diagonal_sewage_pipe_ceiling_tiles            ($13:E279)
//   DATA_diagonal_sewage_pipe_3row_floor_tiles         ($13:E29C)
//   DATA_diagonal_sewage_pipe_4row_floor_tiles         ($13:E2BD)
//   DATA_diagonal_sewage_pipe_alt_ceiling_tiles        ($13:E2E0)
//   DATA_diagonal_sewage_pipe_3row_alt_floor_tiles     ($13:E327)
//   DATA_diagonal_sewage_pipe_4row_alt_floor_tiles     ($13:E36C)
//
// Stamp `CODE_stamp_diagonal_sewage_pipe_ceiling` ($13:E281) is shared
// by both $B2 (3-row init) and $B4 (4-row init); we pre-instantiate it
// once here so both files import the same closure.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { getMap16Above, getMap16Below } from '../fetch.ts';
import { type DecoratorProbe, makeKeepSlopeRowStamp } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Plain (non-decorator) tile tables.
//
// DATA_diagonal_sewage_pipe_ceiling_tiles ($13:E279):
//   Cart `dw $792E,$5D09,$77B9,$77AB` — 4 entries. Used by both the
//   3-row ($B2) and 4-row ($B4) ceiling sides. The 3-row caller walks
//   rows 0..2 ($2E=3) so the 4th entry ($77AB) is unreachable there;
//   the 4-row caller walks all 4 ($2E=4). Kept at 4 entries for
//   byte-for-byte fidelity with the cart's `dw` declaration.
//
// DATA_diagonal_sewage_pipe_3row_floor_tiles ($13:E29C):
//   Cart `dw $77BA,$082D,$791D` — 3 entries, $B3 only.
//
// DATA_diagonal_sewage_pipe_4row_floor_tiles ($13:E2BD):
//   Cart `dw $77AE,$77BA,$082D,$791D` — 4 entries, $B5 only.
// ─────────────────────────────────────────────────────────────────────

export const DATA_diagonal_sewage_pipe_ceiling_tiles: ReadonlyArray<number> = [
  0x792E, 0x5D09, 0x77B9, 0x77AB,
];

export const DATA_diagonal_sewage_pipe_3row_floor_tiles: ReadonlyArray<number> = [
  0x77BA, 0x082D, 0x791D,
];

export const DATA_diagonal_sewage_pipe_4row_floor_tiles: ReadonlyArray<number> = [
  0x77AE, 0x77BA, 0x082D, 0x791D,
];

// ─────────────────────────────────────────────────────────────────────
// Alt (decorator-probe) tile tables.
//
// DATA_diagonal_sewage_pipe_alt_ceiling_tiles ($13:E2E0):
//   Cart `dw $792D,$5B0C,$77C9,$77AC` — 4 entries. Row 1 ($5B0C) is
//   the probe-below sentinel. Shared by $B6 (3-row) and $B8 (4-row).
//
// DATA_diagonal_sewage_pipe_3row_alt_floor_tiles ($13:E327):
//   Cart `dw $77CA,$0A2E,$791E` — 3 entries, $B7 only.
//
// DATA_diagonal_sewage_pipe_4row_alt_floor_tiles ($13:E36C):
//   Cart `dw $77AD,$77CA,$0A2E,$791E` — 4 entries, $B9 only.
// ─────────────────────────────────────────────────────────────────────

export const DATA_diagonal_sewage_pipe_alt_ceiling_tiles: ReadonlyArray<number> = [
  0x792D, 0x5B0C, 0x77C9, 0x77AC,
];

export const DATA_diagonal_sewage_pipe_3row_alt_floor_tiles: ReadonlyArray<number> = [
  0x77CA, 0x0A2E, 0x791E,
];

export const DATA_diagonal_sewage_pipe_4row_alt_floor_tiles: ReadonlyArray<number> = [
  0x77AD, 0x77CA, 0x0A2E, 0x791E,
];

// ─────────────────────────────────────────────────────────────────────
// Decorator probes (alt-ceiling and alt-floor share these between the
// 3-row and 4-row callers — only the tile table size differs).
//
// Cart `CODE_stamp_diagonal_sewage_pipe_alt_ceiling` ($13:E2E8): the
// row-1 sentinel ($5B0C) probes the cell BELOW the current; if it's
// either `$779F` or `$77A0` (flat-floor tops), swap to `$5B0D`.
//
// Cart `CODE_stamp_diagonal_sewage_pipe_3row_alt_floor` ($13:E32D)
// and `CODE_stamp_diagonal_sewage_pipe_4row_alt_floor` ($13:E374):
// the row-1 ($B7) or row-2 ($B9) sentinel ($0A2E) probes the cell
// ABOVE; if it's `$7799` or `$779A`, swap to `$0A2F`.
// ─────────────────────────────────────────────────────────────────────

export const BELOW_PROBE: DecoratorProbe = {
  sentinel:    0x5B0C,
  matchA:      0x779F,
  matchB:      0x77A0,
  replacement: 0x5B0D,
  probe:       getMap16Below,
};

export const ABOVE_PROBE: DecoratorProbe = {
  sentinel:    0x0A2E,
  matchA:      0x7799,
  matchB:      0x779A,
  replacement: 0x0A2F,
  probe:       getMap16Above,
};

// ─────────────────────────────────────────────────────────────────────
// Pre-instantiated shared stamp: CODE_stamp_diagonal_sewage_pipe_ceiling
// ($13:E281) is referenced by both $B2 ($B2/$B3 3-row init) and $B4
// ($B4/$B5 4-row init). Single closure shared between both files.
// ─────────────────────────────────────────────────────────────────────

export const stampDiagonalSewagePipeCeiling: PerCellHandler =
  makeKeepSlopeRowStamp(DATA_diagonal_sewage_pipe_ceiling_tiles);

// Re-export `DecodeState` so individual init files don't all need to
// import it directly when they only touch state via the shared helpers.
export type { DecodeState };
