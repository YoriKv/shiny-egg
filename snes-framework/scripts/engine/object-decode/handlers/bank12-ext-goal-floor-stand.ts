// Bank12 EXTENDED-object handler: goal_floor_stand (ext $81).
//
// SHAPE: walker-driven (shape-2), NOT inline single-cell. The init widens
// the column extent then tail-calls the walker; a per-cell stamper writes a
// run of consecutive Map16 ids ($6F00 + col).
//
// Asm (verbatim closure of CODE_extobj_handler_goal_floor_stand, $12:8D6A):
//   CODE_extobj_handler_goal_floor_stand:        ; ext-obj ID $81
//     REP.b #$20
//     LDA.w #$0004
//     STA.b $2A                                  ; col extent = 4
//     LDX.b #(CODE_12B3FB-$01)>>16               ; per-cell stamper bank
//     LDA.w #CODE_12B3FB-$01                      ; per-cell stamper ptr
//     JMP.w CODE_walker_setup_trampoline         ; slope 0; all 3 slots = stamper
//
//   CODE_12B3FB ($12:B3FB):                       ; per-cell stamp
//     REP.b #$30
//     LDX.b $1D                                   ; buffer offset (walker-latched)
//     LDA.b $28                                   ; column counter (0..3)
//     CLC
//     ADC.w #$6F00                                ; tile = $6F00 + col
//     STA.l !RAM_YI_Level_LevelDataBuffer,x       ; STAMP
//     SEP.b #$30
//     RTL
//
// The init only writes $2A (=4). It does NOT touch $2E, so the row extent
// stays at the parser's 1x1 default ($2E=1) — matching the spec's
// init_dp_delta ($2E unchanged 0001→0001). Walker visits cols 0..3 (row 0):
//     col 0 → $6F00 @ buf $0310 (7F8310)
//     col 1 → $6F01 @ buf $0312 (7F8312)
//     col 2 → $6F02 @ buf $0314 (7F8314)
//     col 3 → $6F03 @ buf $0316 (7F8316)
//
// The trace's interleaved "CODE_128874" cells (indices 0,2,4,6 — null walker,
// no stamps) and the trailing "CODE_128640" calls are the walker engine's own
// screen-wrap / column-advance bookkeeping; our walker (`intraObjectWalker`)
// owns that, so the per-cell stamper is invoked only for the 4 real columns.
//
// No PRNG, neighbour probes, template-slots, or savefile gates: pure
// (col → $6F00+col) lookup, so the port is exact.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';

// Base Map16 id of the goal-floor-stand run. Cart stamps $6F00 + column.
const GOAL_FLOOR_BASE = 0x6F00;
const GOAL_FLOOR_COL_EXTENT = 0x0004; // init: LDA #$0004 : STA $2A

// CODE_12B3FB — per-cell stamp. Map16 = $6F00 + column counter ($28).
const stampGoalFloorStand: PerCellHandler = (state: DecodeState): void => {
  const col = state.zp28 & 0xff; // LDA $28
  stampCell(state, (GOAL_FLOOR_BASE + col) & 0xffff); // CLC : ADC #$6F00
};

// CODE_extobj_handler_goal_floor_stand — init: widen col extent to 4 (row
// extent stays at the 1x1 default), point all three walker slots at the
// stamper, and run the walker (slope 0).
const initGoalFloorStand: InitHandler = (state: DecodeState): void => {
  state.zp2A = GOAL_FLOOR_COL_EXTENT; // LDA #$0004 : STA $2A
  walkerSetupTrampoline(state, stampGoalFloorStand);
};

// Registration. Ext id $81 only (the $181 mirror is automatic —
// getExtObjectHandler masks id & 0xff).
export function installExtGoalFloorStandHandlers(): void {
  registerExtObjectHandler(0x81, initGoalFloorStand);
}
