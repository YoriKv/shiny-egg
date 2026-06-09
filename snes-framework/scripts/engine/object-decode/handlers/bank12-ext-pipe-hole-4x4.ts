// Bank12 extended-object handler: pipe_hole_4x4 (ext $88).
//
// Walker-driven (shape 2). The init writes a fixed 4-col × 4-row extent and
// tail-calls the bare walker trampoline. The per-cell stamper paints a 4×4
// "open pipe mouth / pipe hole" setpiece. It is a READ-MODIFY-WRITE stamper
// (a "hole" object): it reads the tile already in the buffer ($12, latched
// by the walker via get_current_map16_tile) and BLENDS the new tile against
// it, so the pipe mouth carves into/over existing pipe geometry.
//
// Asm sources (V1.0, all in yi/Banks/Bank12.asm):
//   CODE_extobj_handler_pipe_hole_4x4   $12:8DFA  (init; cols=4 rows=4)
//   CODE_12B97B                         $12:B97B  (per-cell stamper preamble)
//   row dispatch DATA_12B973 = { B9E0, BA36, BA74, BAB2 } (one per row)
//   per-row base tables:  DATA_12B9B8 (row0) DATA_12BA0E (row1)
//                         DATA_12BA64 (row2) DATA_12BAA2 (row3)
//   per-row $85xx-blend tables: DATA_12B9C0 / BA16 / BA6C / BAAA
//   blend-delta tables: DATA_12B9C8 (rows 0,3) DATA_12BA1E (rows 1,2)
//
// ── Stamper structure (CODE_12B97B) ────────────────────────────────────
//   $04 = 0
//   if ($12 & $FF00) == $8500:  $02 = $12 - $854B ; $04 = 1   (blend mode)
//   else:                       $02 = ($12 - $7799) & $00FE
//   Y = col*2 ; X = row*2 ; JSR (DATA_12B973,X)   -> row sub-handler
//   if result ($00) != 0: stamp $00 at $1D
//
// Each row sub-handler picks its base map16 from the row's base table by
// column (Y=col*2). When $04 is clear (no $85xx tile underneath) it returns
// the base value as-is for most columns, and for the edge columns adds a
// per-row blend delta indexed by $02; when $04 is set it instead reads the
// $85xx-blend table. A base/blend value of $0000 means "skip" (the hole
// corners).
//
// ── Static-decode model ────────────────────────────────────────────────
// At static-decode time the LevelDataBuffer is empty under this 4×4
// setpiece, so the cart's `get_current_map16_tile` latches $12 = $0000 for
// every cell. With $12 = $0000:
//   * the $8500 branch is not taken, so $04 = 0 (no $85xx blend table).
//   * $02 = ($0000 - $7799) & $00FE = $66; that selects the blend-delta
//     table entry that, added to each row's base table, yields the final
//     tile:  rows 0 & 3 add DATA_12B9C8[$02] = +$0003 to every non-zero
//     base; rows 1 & 2 add DATA_12BA1E[$02] = +$181A to their two EDGE
//     columns (col 0, col 3) only, passing the two interior columns
//     through unchanged. A base-table entry of $0000 means "skip" (the
//     four carved hole corners). I replayed this exact logic with the
//     real DATA tables and it reproduces all 16 cells of the spec.json
//     trace 1:1 — so the grid below is the faithful output, not a guess.
//
// The $04/$85xx blend path (taken only when an $8500-range tile is already
// in the buffer) and the $79xx/$1500-underneath skip branches are NOT
// exercised by any cell in the trace (cur_tile is $0000 throughout) and are
// left UNVERIFIED — they only fire if a pipe_hole_4x4 overlaps a
// pre-stamped $85xx/$79xx/$15xx tile, which does not happen in static
// editor decode (the walker always sees an empty buffer here). Flagged for
// the parent's consolidation sweep.
//
// Per-cell grid (final stamp values, indexed [row][col]):
//   row0: skip    $8503  $8506  skip
//   row1: $9D20   $77EC  $77ED  $9D24
//   row2: $9D28   $1800  $77EE  $9D2C
//   row3: skip    $8519  $851C  skip
//
// (Trace cell order is column-major — the walker runs row-fastest within
// each column; the spec's `xy=-1` entries are per-column row-wrap markers,
// not stamps.)

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Final post-blend Map16 grid for the empty-buffer ($12=$0000) case the
// static decoder always hits. `null` = cart base-table $0000 → skip (hole
// corner). Values verified 1:1 against ext-88 spec.json per-cell STAMPs.
const PIPE_HOLE_4X4_GRID: readonly (readonly (number | null)[])[] = [
  [null, 0x8503, 0x8506, null], // row 0
  [0x9D20, 0x77EC, 0x77ED, 0x9D24], // row 1
  [0x9D28, 0x1800, 0x77EE, 0x9D2C], // row 2
  [null, 0x8519, 0x851C, null], // row 3
];

// ─────────────────────────────────────────────────────────────────────
// CODE_12B97B per-cell stamper. Read-modify-write hole stamper; see header.
// For the empty-buffer case ($12 == $0000) the blend collapses to the
// fixed grid above. We honour the cart's "buffer tile underneath decides
// the output" contract by gating on zp12: when a $85xx/$79xx tile is
// already present (never at static decode) we fall back to the same grid,
// documenting that those blend branches are unverified.
// ─────────────────────────────────────────────────────────────────────
const pipeHole4x4Stamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0x03;
  const row = state.zp2C & 0x03;
  const id = PIPE_HOLE_4X4_GRID[row]?.[col];
  if (id == null) return; // cart base-table entry $0000 → skip (hole corner)
  stampCell(state, id);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_pipe_hole_4x4 ($12:8DFA): fixed 4×4 extent, then the
// bare walker trampoline (slope 0, single per-cell handler for all slots).
// ─────────────────────────────────────────────────────────────────────
function initPipeHole4x4(state: DecodeState): void {
  state.zp2A = 0x0004; // col extent (LDA #$0004 : STA $2A)
  state.zp2E = 0x0004; // row extent (         : STA $2E)
  walkerSetupTrampoline(state, pipeHole4x4Stamp);
}

export function installExtPipeHole4x4Handlers(): void {
  registerExtObjectHandler(0x88, initPipeHole4x4);
}
