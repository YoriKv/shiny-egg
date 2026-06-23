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
// ── Blend model ─────────────────────────────────────────────────────────
// CODE_12B97B is a READ-MODIFY-WRITE stamper: the tile already in the buffer
// ($12, latched by the walker) decides each cell's output. There are three
// regimes, all ported below:
//
//   1. EMPTY buffer ($12 == $0000) — the common non-overlap case. The cart's
//      $02 = ($0000-$7799)&$00FE = $66 OVERRUNS DATA_12B9C8 (24 bytes) and
//      reads into the tables/code laid out after it (caps add +$0003 from
//      DATA_12BA1E's tail, mids add +$181A on the edge columns from bytes
//      inside CODE_12BA74). Those overrun reads collapse to the fixed grid
//      below — verified 1:1 against the ext-88 spec.json trace. We return the
//      grid directly for $12==0 rather than model the cross-table/code read.
//
//   2. NON-BLEND overlap ($12 != 0, high byte != $85) — e.g. a pipe mouth
//      carved into a $77xx wall/decoration. $02 = ($12-$7799)&$00FE indexes
//      the per-row delta table (DATA_12B9C8 caps / DATA_12BA1E mids) by word
//      ($02>>1); cap rows skip when $12 is $79xx (and $15xx for row 3) so the
//      wall shows through, and skip the four hole corners; mid rows add the
//      delta only on the edge columns. A full all-levels decode sweep shows
//      every real overlap offset lands IN-BOUNDS (≤$16) — the only offsets
//      that would overrun belong to $79xx/$15xx tiles, which the guards skip
//      before the lookup, so the cross-table read of regime 1 only ever
//      happens for the empty buffer.
//
//   3. BLEND overlap ($12 high byte == $85) — a pipe mouth over another
//      already-stamped pipe-mouth tile. $02 = $12-$854B is ADDED to the
//      per-row $85xx-blend table (cap rows skip a $0000 entry; mid rows add
//      $02 only on the edge columns).
//
// Cart base/blend/delta tables (verbatim, Bank12.asm):
//   row0 base DATA_12B9B8  blend DATA_12B9C0   } caps, delta DATA_12B9C8
//   row3 base DATA_12BAA2  blend DATA_12BAAA   }
//   row1 base DATA_12BA0E  blend DATA_12BA16   } mids, delta DATA_12BA1E
//   row2 base DATA_12BA64  blend DATA_12BA6C   }
//
// Per-cell EMPTY-buffer grid (regime 1), indexed [row][col]:
//   row0: skip    $8503  $8506  skip
//   row1: $9D20   $77EC  $77ED  $9D24
//   row2: $9D28   $1800  $77EE  $9D2C
//   row3: skip    $8519  $851C  skip

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Final stamp values for the empty-buffer ($12=$0000) case — see regime 1.
// `null` = cart base-table $0000 → skip (hole corner). Verified 1:1 against
// ext-88 spec.json per-cell STAMPs.
const PIPE_HOLE_4X4_GRID: readonly (readonly (number | null)[])[] = [
  [null, 0x8503, 0x8506, null], // row 0
  [0x9D20, 0x77EC, 0x77ED, 0x9D24], // row 1
  [0x9D28, 0x1800, 0x77EE, 0x9D2C], // row 2
  [null, 0x8519, 0x851C, null], // row 3
];

// Per-row blend descriptor — one entry per the 4 row sub-handlers dispatched
// by DATA_12B973 = {B9E0, BA36, BA74, BAB2}.
//   base/blend : 4-entry (one per column) Map16 tables. base = non-blend
//                ($12 not $85xx) path; blend = $85xx-underlying path.
//   delta      : signed add table indexed by ($02 >> 1) on the non-blend path.
//   cap        : rows 0/3 (a $0000 base/blend entry is a hole corner → skip;
//                non-blend skips when $12's high byte is in `guardHi`).
//                rows 1/2 (`cap:false`) add the delta/$02 only on edge columns
//                (0,3) and never guard or skip-on-zero.
//   guardHi    : underlying-tile high bytes that force a cap-row skip (leave
//                the wall tile showing through).
interface PipeHoleRow {
  base: readonly number[];
  blend: readonly number[];
  delta: readonly number[];
  cap: boolean;
  guardHi: readonly number[];
}
const DELTA_CAP = [
  0x0002, 0x0001, 0x0000, 0x0002, 0x0000, 0x0000,
  0x0000, 0x0000, 0x0000, 0x0001, 0x0000, 0x0000,
]; // DATA_12B9C8
const DELTA_MID = [
  0x0002, 0x0001, 0x0000, 0x0002, 0x0000, 0x0000,
  0x0000, 0x0000, 0x0003, 0x0001, 0x0000, 0x0003,
]; // DATA_12BA1E
const PIPE_HOLE_ROWS: readonly PipeHoleRow[] = [
  { base: [0x0000, 0x8500, 0x8503, 0x0000], blend: [0x0000, 0x857A, 0x857E, 0x0000], delta: DELTA_CAP, cap: true, guardHi: [0x7900] },
  { base: [0x8506, 0x77EC, 0x77ED, 0x850A], blend: [0x8582, 0x77EC, 0x77ED, 0x8586], delta: DELTA_MID, cap: false, guardHi: [] },
  { base: [0x850E, 0x1800, 0x77EE, 0x8512], blend: [0x858A, 0x1800, 0x77EE, 0x858E], delta: DELTA_MID, cap: false, guardHi: [] },
  { base: [0x0000, 0x8516, 0x8519, 0x0000], blend: [0x0000, 0x8592, 0x8596, 0x0000], delta: DELTA_CAP, cap: true, guardHi: [0x1500, 0x7900] },
];

/** Port of one row sub-handler (CODE_12B9E0 / BA36 / BA74 / BAB2) for the
 *  overlap case ($12 != 0). Returns the Map16 to stamp, or `null` to skip
 *  (leave the underlying tile). `z` is the latched underlying tile ($12). */
function pipeHoleOverlapTile(z: number, row: number, col: number): number | null {
  const R = PIPE_HOLE_ROWS[row]!;
  const isEdge = col === 0 || col === 3;
  let result: number;
  if ((z & 0xff00) === 0x8500) {
    // Blend mode ($04=1): $02 = $12 - $854B, added to the $85xx-blend table.
    const add = (z - 0x854b) & 0xffff;
    const v = R.blend[col]!;
    if (R.cap) {
      if (v === 0) return null; // cart BEQ → store 0 → skip
      result = (v + add) & 0xffff;
    } else {
      result = isEdge ? (v + add) & 0xffff : v; // interior cols pass through
    }
  } else {
    // Non-blend: $02 = ($12 - $7799) & $00FE = byte offset into the delta table.
    const off = (z - 0x7799) & 0x00fe;
    const v = R.base[col]!;
    if (R.cap) {
      if (v === 0) return null; // hole corner
      if (R.guardHi.includes(z & 0xff00)) return null; // $79xx/$15xx → show wall
      result = (v + (R.delta[off >> 1] ?? 0)) & 0xffff;
    } else {
      result = isEdge ? (v + (R.delta[off >> 1] ?? 0)) & 0xffff : v;
    }
  }
  return result === 0 ? null : result; // preamble: stamp only when $00 != 0
}

// ─────────────────────────────────────────────────────────────────────
// CODE_12B97B per-cell stamper — read-modify-write hole stamper; see header.
// ─────────────────────────────────────────────────────────────────────
const pipeHole4x4Stamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0x03;
  const row = state.zp2C & 0x03;
  const z = state.zp12 & 0xffff;
  const id = z === 0
    ? PIPE_HOLE_4X4_GRID[row]?.[col] // empty buffer → fixed grid (regime 1)
    : pipeHoleOverlapTile(z, row, col); // overlap → real blend (regimes 2/3)
  if (id == null) return; // skip (hole corner, guard, or $00 result)
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
