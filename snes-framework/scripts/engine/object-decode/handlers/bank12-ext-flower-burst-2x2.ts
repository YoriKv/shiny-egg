// Bank12 extended-object $A4 — "flower burst 2x2".
//
// Shape: walker-driven 2x2 block (shape-2). The init sets both extents to
// 2 and tail-calls the bare walker trampoline with a per-cell stamper. The
// walker then paints a 2-col × 2-row rectangle, invoking the stamper once
// per cell with the column counter ($28) and row counter ($2C) live.
//
// Map16 ID per cell = DATA_12BF47[row] + col, i.e. a row-base tile plus
// the column index:
//   row 0 → base $000A → cells $000A (col0), $000B (col1)
//   row 1 → base $8800 → cells $8800 (col0), $8801 (col1)
// ($8800 = same tile id $0000 with the high YXPCCCTT priority/flip bits
// set; the +col just walks consecutive map16 ids within the row.)
// Verified against ext-A4 spec.json: all 4 walker cells match exactly.
//
// Asm sources (yi/Banks/Bank12.asm), confirmed via `cli.ts closure`:
//   CODE_extobj_handler_flower_burst_2x2   $12:8F19
//   CODE_12BF4B (per-cell stamp)           $12:BF4B
//   DATA_12BF47 (row-base tile table)      $12:BF47
//
// Asm (verbatim, init CODE_extobj_handler_flower_burst_2x2):
//   REP #$20
//   LDA #$0002 : STA $2A     ; col extent = 2
//             STA $2E        ; row extent = 2
//   LDX #(CODE_12BF4B-1)>>16
//   LDA #CODE_12BF4B-1
//   JMP CODE_walker_setup_trampoline
//
// Asm (verbatim, stamp body CODE_12BF4B):
//   REP #$30
//   LDA $2C            ; row counter
//   ASL A              ; ×2 (word index into DATA_12BF47)
//   TAY
//   LDA DATA_12BF47,y  ; row-base map16 id
//   CLC
//   ADC $28            ; + column counter
//   LDX $1D
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30
//   RTL                ; one store per cell — no decorator call
//
//   DATA_12BF47:  dw $000A  ; row 0 base
//                 dw $8800  ; row 1 base
//
// Note on the spec's second "stamp handler" CODE_128640/CODE_128874:
// $12:8640 is the walker's OWN post-cell row-step (INC $2C → check extent →
// resolve next page), and $12:8874 is the column/row terminator — neither
// is a real stamper. They appear in the trace because they run after
// CODE_12BF4B returns. walker.ts already implements that stepping, so there
// is nothing extra to model: every cell emits a single store (matches all
// 6 trace cells — the 2 "CODE_128874" entries are the empty terminators).

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12BF47 ($12:BF47): per-row base Map16 id. Indexed by row (×2 → word).
const ROW_BASE_TILE = [0x000a, 0x8800] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_12BF4B — per-cell stamper ($12:BF4B).
// map16 = DATA_12BF47[row] + col.
// ─────────────────────────────────────────────────────────────────────

const flowerBurst2x2Stamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff; // walker row counter
  const col = state.zp28 & 0xffff; // walker column counter
  const base = ROW_BASE_TILE[row] ?? ROW_BASE_TILE[0];
  stampCell(state, (base + col) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_flower_burst_2x2 ($12:8F19).
// LDA #$0002 → STA $2A / STA $2E (both extents = 2), then bare walker
// trampoline. (Dispatcher pre-seeds both to $0001; the literal store
// overwrites to $0002, i.e. the 1→2 bump the spec's DP-diff reports.)
// ─────────────────────────────────────────────────────────────────────

function initFlowerBurst2x2(state: DecodeState): void {
  state.zp2A = 0x0002; // col extent = 2
  state.zp2E = 0x0002; // row extent = 2
  walkerSetupTrampoline(state, flowerBurst2x2Stamp);
}

export function installExtFlowerBurst2x2Handlers(): void {
  registerExtObjectHandler(0xa4, initFlowerBurst2x2);
}
