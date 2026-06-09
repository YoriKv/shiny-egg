// Extended object $82 — `CODE_extobj_handler_goal_roof_8x5`
// ("goal roof", an 8-wide x 5-tall fixed Map16 block at the level goal).
// Dispatch table slot $82 in DATA_extended_object_init_ptrs (Bank12) →
// CODE_extobj_handler_goal_roof_8x5 (verified via the spec.json init_handler
// and the DATA_extended_object_init_ptrs closure dump).
//
// This is a WALKER-DRIVEN extended object (shape 2 in the shared brief).
// The init handler shifts the origin UP 4 sub-rows, hard-codes the
// rectangle extents (8 cols x 5 rows, slope 0) and tail-calls the shared
// intra-object walker trampoline. The walker visits the rectangle in
// COLUMN-MAJOR order (outer = column 0..7, inner = row 0..4). The per-cell
// stamper (CODE_12B45C, walker slot $12B45B) indexes a flat 40-word source
// table by `Y = (row*8 + col)*2` and stamps the word found.
//
//   REP #$20
//   LDA $1B : AND #$0F0F : STA $00      ; \ preserve sub-X + screen-X nibbles
//   LDA $1B : AND #$70F0                ; | isolate sub-Y + screen-Y nibbles
//   SEC : SBC #$0040                    ; | subY -= 4 (origin moves UP 4 rows;
//   AND #$70F0                          ; |   borrow propagates into screen-Y)
//   ORA $00 : STA $1B                   ; / merge X nibbles back, store
//   LDA #$0008 : STA $2A                ; col extent = 8
//   LDA #$0005 : STA $2E                ; row extent = 5
//   LDX #(CODE_12B45C-1)>>16            ; per-cell stamper bank
//   LDA #CODE_12B45C-1                  ; per-cell stamper ptr
//   JMP CODE_walker_setup_trampoline    ; slope 0; all 3 walker slots = stamper
//
// The `$1B` Y-decrement ($0040 → -4 sub-rows) is NOT optional and is NOT
// supplied by the walker: without it the 8x5 roof stamps 4 rows too low
// (verified by the buffer-diff trace on level 0x00). The earlier port
// dropped this shift on the mistaken assumption that the walker replicated
// it; it does not.
//
// Per-cell stamper (CODE_12B45C, $12:B45C):
//   Y = ($2C*8 + $28) * 2                ; (row*8 + col) word index → 0..78
//   tile = DATA_12B40C[Y]                ; direct 16-bit Map16 ID lookup
//   stamp tile                            (no transform, no $5B sentinel)
//
// DATA_12B40C is EMBEDDED below verbatim — the 40 word entries were
// recovered from the spec.json per-cell `table_lookup` records (record_addr
// $12B40C..$12B45A, record_value), cross-checked against each cell's
// `stamp` mapid + buf_addr. All 40 cells reproduce 1:1 (table value =
// output mapid at the matching buffer offset). Indexed by word index
// `n = row*8 + col` (low nibble of the 16x16 block grid the cart's
// $2C*8+$28 computes).
//
// No PRNG, no neighbour probes, no savefile/flag gates: the stamper is a
// pure (row, col) → table → Map16 lookup, so the port is exact (no PRNG
// carry caveat).
//
// (Cells 0/6/12/... in the trace dispatch to CODE_128874 with col/row = -1
// — those are the walker's per-column row-wrap bookkeeping cells, NOT real
// stamps; the walker port handles wrap internally, so they have no
// counterpart here. Only the 40 CODE_12B45C cells stamp.)
//
// Asm references (per spec + DATA_extended_object_init_ptrs closure):
//   $12:8000  DATA_extended_object_init_ptrs[$82]  → CODE_extobj_handler_goal_roof_8x5 (init)
//   $12:B45C  CODE_12B45C        (per-cell stamper)
//   $12:B40C  DATA_12B40C        (40-word tile table)

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

const ROOF_COLS = 0x08; // col extent (STA $2A)
const ROOF_ROWS = 0x05; // row extent (STA $2E)

// Cart tile table DATA_12B40C ($12:B40C), 40 words = 5 rows x 8 cols.
// Indexed by word index n = row*8 + col. Recovered + verified from the
// spec.json per-cell trace (record_value at $12B40C + n*2). Laid out below
// in row-major blocks of 8 for readability (row 0 first).
const DATA_12B40C: readonly number[] = [
  // row 0 (cols 0..7)
  0x8400, 0x8401, 0x8402, 0x8403, 0x8401, 0x8402, 0x8404, 0x8405,
  // row 1
  0x840c, 0x840d, 0x840e, 0x840f, 0x840e, 0x840d, 0x8411, 0x8412,
  // row 2
  0x8406, 0x8407, 0x8406, 0x8407, 0x8406, 0x8407, 0x8406, 0x8407,
  // row 3
  0x8408, 0x8409, 0x840a, 0x840b, 0x8408, 0x8409, 0x840a, 0x840b,
  // row 4
  0x840a, 0x840b, 0x840a, 0x840b, 0x8408, 0x8409, 0x8408, 0x8409,
] as const;

// Per-cell stamper. Ports CODE_12B45C ($12:B45C): index DATA_12B40C by the
// walker's row/col counters (Y = (row*8 + col)*2 → word index row*8 + col)
// and stamp the looked-up Map16 ID into the current cell ($1D, set by walker).
const stampGoalRoof8x5: PerCellHandler = (state: DecodeState): void => {
  const n = ((state.zp2C << 3) + state.zp28) & 0xff; // row*8 + col → 0..39
  const tile = DATA_12B40C[n];
  if (tile === undefined) return; // out of table (shouldn't occur for 8x5)
  stampCell(state, tile);
};

// Init handler: shift origin UP 4 sub-rows, then fixed 8x5 rectangle,
// slope 0, single stamper in all walker slots.
const initExtGoalRoof8x5: InitHandler = (state: DecodeState): void => {
  // Cart $1B Y-decrement (CODE_extobj_handler_goal_roof_8x5): subtract 4 from the sub-Y nibble
  // of the origin word, isolating X nibbles ($0F0F) and the sub-Y/screen-Y
  // bits ($70F0) exactly as the asm does so a borrow out of sub-Y
  // propagates into the screen-Y nibble. zp1B is the low byte of the
  // $1C:$1B word; recompose, shift, split back.
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const xKeep = word1B & 0x0f0f; // sub-X (low nibble of $1B) + screen-X (low nibble of $1C)
  const yBits = (((word1B & 0x70f0) - 0x0040) & 0x70f0) & 0xffff;
  const newWord = (yBits | xKeep) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  state.zp2A = ROOF_COLS; // col extent = 8
  state.zp2E = ROOF_ROWS; // row extent = 5
  walkerSetupTrampoline(state, stampGoalRoof8x5);
};

export function installExtGoalRoof8x5Handlers(): void {
  registerExtObjectHandler(0x82, initExtGoalRoof8x5);
}
