// Bank12 ext-object $4E — "upward grass 1x2" (walker-driven, 1 col x 2 rows).
//
// A 1-wide, 2-tall vertical grass tuft. The init sets a fixed 1x2 rectangle
// and tail-calls the shared walker; the per-cell stamper picks its tile from
// a 2-entry table indexed by the walker's row counter. No PRNG, no neighbour
// probes, no savefile gates — a pure (row -> tile) lookup, so the port is
// exact.
//
// Asm sources (V1.0), verbatim from the build .sym closure:
//
//   CODE_extobj_handler_upward_grass_1x2  Bank12.asm:1918  ($12:8B1E)
//     REP #$20
//     LDA #$0001 : STA $2A        ; col extent = 1
//     LDA #$0002 : STA $2E        ; row extent = 2
//     LDX #(CODE_12AD5D-1)>>16
//     LDA #CODE_12AD5D-1
//     JMP CODE_walker_setup_trampoline   ; slope 0; all 3 walker slots = stamper
//
//   CODE_12AD5D  (per-cell stamper)       Bank12.asm:6547  ($12:AD5D)
//     REP #$30
//     LDA $2C : ASL A : TAY       ; row counter * 2
//     LDX $1D
//     LDA DATA_12AD59,y           ; word lookup
//     STA.l !RAM_YI_Level_LevelDataBuffer,x   ; stamp
//     SEP #$30 : RTL
//
//   DATA_12AD59  (row tile table)         Bank12.asm:6544  ($12:AD59)
//     dw $0082,$014D             ; row 0 -> $0082, row 1 -> $014D
//
// The spec.json's per-cell `CODE_128640` events are the SHARED WALKER's own
// row-step routine (`CODE_128640: INC $2C ...`, reached after the stamper
// RTLs), not a call the stamper makes — the stamper itself ends at RTL with
// no JMP. So there is no post-stamp decorator here; the walker (walker.ts)
// already models that step. The init's note "row_extent 0001 -> 0002" in the
// spec.md reflects the entry DP ($2E=1, seeded by the parser) vs the value
// at walker time ($2E=2): the cart overwrites $2E with #$0002 outright.
//
// Verified against ext-4E spec.json: 2 grass cells stamp $0082 @ $7F8310
// (row 0) and $014D @ $7F8330 (row 1), 0 mismatches.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12AD59 — row tile table, indexed by (row counter * 2) = row.
const UPWARD_GRASS_TILES: readonly number[] = [0x0082, 0x014d];

const GRASS_COLS = 0x0001; // STA $2A
const GRASS_ROWS = 0x0002; // STA $2E

// ─────────────────────────────────────────────────────────────────────
// CODE_12AD5D — per-cell stamper ($12:AD5D). Row counter ($2C) selects the
// tile from DATA_12AD59; stamp at the walker's current cell offset ($1D).
// The walker presents $2C as the ascending row index (0,1); the table has
// exactly 2 entries, so mask to its two valid slots.
// ─────────────────────────────────────────────────────────────────────
const upwardGrassStamp: PerCellHandler = (state: DecodeState): void => {
  stampCell(state, UPWARD_GRASS_TILES[state.zp2C & 0x0001]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_upward_grass_1x2 ($12:8B1E). Fixed 1x2 rectangle,
// single stamper in all walker slots, slope 0.
// ─────────────────────────────────────────────────────────────────────
const initUpwardGrass1x2: InitHandler = (state: DecodeState): void => {
  state.zp2A = GRASS_COLS; // col extent = 1
  state.zp2E = GRASS_ROWS; // row extent = 2
  walkerSetupTrampoline(state, upwardGrassStamp);
};

export function installExtUpwardGrass1x2Handlers(): void {
  registerExtObjectHandler(0x4e, initUpwardGrass1x2);
}
