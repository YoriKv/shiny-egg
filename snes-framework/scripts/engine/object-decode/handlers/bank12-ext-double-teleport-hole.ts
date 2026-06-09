// Bank12 EXTENDED-object handler — double_teleport_hole (ext $1E).
//
//
// Walker-driven (shape-2): an 8-col × 4-row column-major sweep. Despite
// the "teleport" name, the per-cell stamper ONLY writes Map16 cells — it
// does NOT touch any screen-exit / teleport state. The "double teleport"
// is the screen exit on the same screen (modelled elsewhere in the editor
// as a warp exit); this ext object just paints the visual corridor-hole
// rim tiles. So nothing here interacts with exit/teleport state.
//
// Ports CODE_extobj_handler_double_teleport_hole ($12:89DD,
// Bank12.asm:1739) + its per-cell stamper CODE_12AB02 ($12:AB02,
// Bank12.asm:6228). Asm (verbatim):
//
//   CODE_extobj_handler_double_teleport_hole:
//     REP #$20
//     LDA #$0008 ; STA $2A      ; col extent = 8
//     LSR        ; STA $2E      ; row extent = 8>>1 = 4
//     LDX #(CODE_12AB02-$01)>>16 ; LDA #CODE_12AB02-$01
//     JMP CODE_walker_setup_trampoline
//
//   CODE_12AB02:
//     REP #$30
//     LDA $28 ; BEQ CODE_12AB17    ; col == 0 → first column
//     INC ; CMP $2A ; BEQ CODE_12AB12  ; (col+1)==colExtent → last column
//     LDA #$0000 ; BRA CODE_12AB20    ; middle column → $0000 (no row off)
//   CODE_12AB12:                      ; last column
//     LDA #$9D9B ; BRA CODE_12AB1A
//   CODE_12AB17:                      ; first column
//     LDA #$9D9A
//   CODE_12AB1A:                      ; common: A += 2*row
//     CLC ; ADC $2C ; CLC ; ADC $2C
//   CODE_12AB20:
//     LDX $1D ; STA.l !RAM_YI_Level_LevelDataBuffer,x ; SEP #$30 ; RTL
//
// Net tile picks:
//   col 0      → $9D9A + 2*row   (rows 0-3: 9D9A 9D9C 9D9E 9DA0)
//   col 7 last → $9D9B + 2*row   (rows 0-3: 9D9B 9D9D 9D9F 9DA1)
//   cols 1-6   → $0000           (cleared; no row offset)
// No DATA tables and no PRNG / neighbour-probe / template-slot reads.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Cart asm: `LDA #$9D9A` (first column base) / `LDA #$9D9B` (last column base).
const FIRST_COL_BASE = 0x9D9A;
const LAST_COL_BASE = 0x9D9B;

// CODE_extobj_handler_double_teleport_hole ($12:89DD).
function initDoubleTeleportHole(state: DecodeState): void {
  state.zp2A = 0x0008; // col extent (8 columns)
  state.zp2E = 0x0008 >>> 1; // row extent: LSR of $2A's #$0008 = 4 rows
  walkerSetupTrampoline(state, perCellDoubleTeleportHole);
}

// CODE_12AB02 ($12:AB02) — per-cell stamper.
const perCellDoubleTeleportHole: PerCellHandler = (state) => {
  const col = state.zp28 & 0xffff;
  const row = state.zp2C & 0xffff;
  let value: number;
  if (col === 0) {
    // CODE_12AB17 → first column: $9D9A + 2*row.
    value = (FIRST_COL_BASE + 2 * row) & 0xffff;
  } else if (((col + 1) & 0xffff) === (state.zp2A & 0xffff)) {
    // CODE_12AB12 → last column ($28+1 == colExtent): $9D9B + 2*row.
    value = (LAST_COL_BASE + 2 * row) & 0xffff;
  } else {
    // CODE_12AB20 path with A=#$0000 → middle columns cleared (no row offset).
    value = 0x0000;
  }
  stampCell(state, value);
};

// Registration. Ext id $1E only (the $11E mirror is automatic —
// getExtObjectHandler masks id & 0xff).
export function installExtDoubleTeleportHoleHandlers(): void {
  registerExtObjectHandler(0x1E, initDoubleTeleportHole);
}
