// Ports CODE_extobj_handler_pipe_shape_family ($12:8D2A) — ext IDs 0x71..0x7D.
//
// ONE shared init dispatches all 13 IDs. It reads three parallel tables indexed
// by the low nibble of $15 (the ext id; 0x71->1 .. 0x7D->D):
//
//   CODE_extobj_handler_pipe_shape_family:
//     REP #$20 : LDA $15 : AND #$000F : TAY : ASL : TAX
//     LDA DATA_128CF6-1,Y : AND #$00FF : STA $2A   ; per-id COL extent
//     LDA DATA_128D03-1,Y : AND #$00FF : STA $2E   ; per-id ROW extent
//     LDA DATA_128D10-2,X                          ; per-id PER-CELL stamper ptr
//     LDX #(CODE_12B23C-1)>>16 : JMP walker_setup_trampoline
//
//   DATA_128CF6 (col, by nibble 1..D): 06 06 01 01 02 02 02 02 04 04 06 06 02
//   DATA_128D03 (row, by nibble 1..D): 01 01 06 06 04 04 06 06 02 02 02 02 01
//   DATA_128D10 (stamper-1 ptr, nibble 1..D): 12B23C 12B25A 12B271 12B288
//     12B2A3 12B2CB 12B2F8 12B326 12B349 12B36A 12B393 12B3BC 12B3D1
//
// DISPATCH KEY: $15 (== ext id, state.zp15). Low nibble selects column extent
// ($2A), row extent ($2E), and which per-id stamper + tile table the walker
// calls. Each id has its OWN stamper and OWN tile table — no single flat table.
//
// THREE index schemes (the stamper computes Y from the walker counters $28/$2C;
// confirmed for every id by matching each spec.json cell's table-lookup `index`
// (= Y) against scheme(col,row)):
//   - INDEX-BY-COL  (Y = $28*2):           0x71 0x72 0x7D   -> tiles[col]
//   - INDEX-BY-ROW  (Y = $2C*2):           0x73 0x74        -> tiles[row]
//   - GRID stride-8 (Y = (($28<<3)|$2C)*2): 0x75 0x76 0x77 0x78 0x79 0x7A 0x7B 0x7C
//                                                            -> tiles[col*8 + row]
// The GRID stampers (CODE_12B2A3 family) also do `BEQ skip` (no stamp when the
// looked-up word is $0000), so the rectangular walk can leave sparse / hollow
// shapes (the pipe interiors). The COL/ROW stampers always stamp.
//
// TILE TABLES below are the spec.json per-cell `record_value` words placed at
// their observed (col*8 + row) slot for GRID ids, or (col)/(row) for COL/ROW
// ids. Slots the trace never visited stay $0000 (= BEQ-skip). For the small
// shapes (0x71-0x76, 0x7D) the trace covers every cell, so they are fully
// verified. For 0x77-0x7C the trace covers a representative sample (full first
// column or the shape's perimeter); cells in the unobserved interior are left
// $0000 and are flagged !fullyVerified — back-fill from the raw DATA_12Bxxx asm
// words (Bank12.asm ~7203-7382) in the parent consolidation sweep if needed.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

const PIPE_SHAPE_FIRST_ID = 0x71;
const PIPE_SHAPE_LAST_ID = 0x7d;

const IDX = { COL: 0, ROW: 1, GRID8: 2 } as const;
type IdxScheme = (typeof IDX)[keyof typeof IDX];

interface PipeShapeVariant {
  readonly cols: number; // $2A col extent  (DATA_128CF6, by nibble)
  readonly rows: number; // $2E row extent  (DATA_128D03, by nibble)
  readonly scheme: IdxScheme; // how the per-id stamper indexes its table
  readonly skipZero: boolean; // GRID stampers BEQ-skip a $0000 word
  readonly tiles: readonly number[]; // per-id tile word table (spec record_value)
  readonly fullyVerified: boolean; // false = grid interior unobserved (see header)
}

// Keyed by ext id 0x71..0x7D. GRID tables are indexed [col*8 + row].
const PIPE_SHAPE_VARIANTS: Record<number, PipeShapeVariant> = {
  0x71: { cols: 6, rows: 1, scheme: IDX.COL, skipZero: false, fullyVerified: true,
    tiles: [0x791e, 0x0a2f, 0x77bb, 0x77ba, 0x082d, 0x791d] },
  0x72: { cols: 6, rows: 1, scheme: IDX.COL, skipZero: false, fullyVerified: true,
    tiles: [0x792e, 0x5d09, 0x77b9, 0x77cc, 0x5b0d, 0x792d] },
  0x73: { cols: 1, rows: 6, scheme: IDX.ROW, skipZero: false, fullyVerified: true,
    tiles: [0x792d, 0x5b0c, 0x77c9, 0x77ba, 0x082d, 0x791d] },
  0x74: { cols: 1, rows: 6, scheme: IDX.ROW, skipZero: false, fullyVerified: true,
    tiles: [0x792e, 0x5d09, 0x77b9, 0x77ca, 0x0a2e, 0x791e] },
  // GRID8, cols2 rows4 — trace covers all 8 slots
  0x75: { cols: 2, rows: 4, scheme: IDX.GRID8, skipZero: true, fullyVerified: true,
    tiles: [0x7917, 0x77b1, 0x77b4, 0x7927, 0x0000, 0x0000, 0x0000, 0x0000,
            0x7918, 0x0000, 0x0000, 0x7928] },
  0x76: { cols: 2, rows: 4, scheme: IDX.GRID8, skipZero: true, fullyVerified: true,
    tiles: [0x7919, 0x0000, 0x0000, 0x7929, 0x0000, 0x0000, 0x0000, 0x0000,
            0x791a, 0x77b5, 0x77b8, 0x792a] },
  // GRID8, cols2 rows6 — trace: col0 rows0..5 + col1 rows0,5
  0x77: { cols: 2, rows: 6, scheme: IDX.GRID8, skipZero: true, fullyVerified: false,
    tiles: [0x7917, 0x77b1, 0x77b2, 0x77b3, 0x77b4, 0x7927, 0x0000, 0x0000,
            0x7918, 0x0000, 0x0000, 0x0000, 0x0000, 0x7928] },
  0x78: { cols: 2, rows: 6, scheme: IDX.GRID8, skipZero: true, fullyVerified: false,
    tiles: [0x7919, 0x0000, 0x0000, 0x0000, 0x0000, 0x7929, 0x0000, 0x0000,
            0x791a, 0x77b5, 0x77b6, 0x77b7, 0x77b8, 0x792a] },
  // GRID8, cols4 rows2 — trace: perimeter corners
  0x79: { cols: 4, rows: 2, scheme: IDX.GRID8, skipZero: true, fullyVerified: false,
    tiles: [0x7911, 0x7921, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x77a1, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x77a4, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x7912, 0x7922] },
  0x7a: { cols: 4, rows: 2, scheme: IDX.GRID8, skipZero: true, fullyVerified: false,
    tiles: [0x7913, 0x7923, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x0000, 0x77a5, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x0000, 0x77a8, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x7914, 0x7924] },
  0x7b: { cols: 6, rows: 2, scheme: IDX.GRID8, skipZero: true, fullyVerified: false,
    tiles: [0x7911, 0x7921, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x77a1, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x77a2, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x77a3, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x77a4, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x7912, 0x7922] },
  0x7c: { cols: 6, rows: 2, scheme: IDX.GRID8, skipZero: true, fullyVerified: false,
    tiles: [0x7913, 0x7923, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x0000, 0x77a5, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x0000, 0x77a6, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x0000, 0x77a7, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x0000, 0x77a8, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
            0x7914, 0x7924] },
  0x7d: { cols: 2, rows: 1, scheme: IDX.COL, skipZero: false, fullyVerified: true,
    tiles: [0x77c6, 0x77c7] },
};

function pipeShapeTableIndex(v: PipeShapeVariant, col: number, row: number): number {
  switch (v.scheme) {
    case IDX.COL: return col; // Y=$28*2 -> word[col]
    case IDX.ROW: return row; // Y=$2C*2 -> word[row]
    case IDX.GRID8: return (col << 3) | row; // Y=(($28<<3)|$2C)*2
    default: return col;
  }
}

// Per-cell stamper. Ports the 13 per-id stampers (CODE_12B23C family): index
// this id's tile table per its scheme, BEQ-skip a $0000 word for the GRID
// variants, and stamp at the current walker cell ($1D).
const stampPipeShapeCell: PerCellHandler = (state: DecodeState): void => {
  const v = PIPE_SHAPE_VARIANTS[state.zp15 & 0xff];
  if (!v) return;
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const idx = pipeShapeTableIndex(v, col, row);
  if (idx >= v.tiles.length) return; // unobserved cell beyond the captured table
  const tile = v.tiles[idx];
  if (v.skipZero && tile === 0x0000) return; // BEQ skip — leave the cell untouched
  stampCell(state, tile);
};

// Shared init. Ports CODE_extobj_handler_pipe_shape_family: set the per-id walker
// extents ($2A col, $2E row) and dispatch the walker with the shared stamper.
// $15 stays the ext id and selects the table inside the stamper.
function initPipeShape(state: DecodeState): void {
  const v = PIPE_SHAPE_VARIANTS[state.zp15 & 0xff];
  if (!v) return;
  state.zp2A = v.cols;
  state.zp2E = v.rows;
  walkerSetupTrampoline(state, stampPipeShapeCell);
}

export function installExtPipeShapeFamilyHandlers(): void {
  for (let id = PIPE_SHAPE_FIRST_ID; id <= PIPE_SHAPE_LAST_ID; id++) {
    registerExtObjectHandler(id, initPipeShape);
  }
}
