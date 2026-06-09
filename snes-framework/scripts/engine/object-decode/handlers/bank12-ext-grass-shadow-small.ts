// Ext-object handler: grass_shadow_small (ext ID 0x6A)
// Ports CODE_extobj_handler_grass_shadow_small ($12:8CA7) + its per-cell
// stamper CODE_12B194 ($12:B194) / CODE_12B1BF ($12:B1BF), indexing tile
// table DATA_12B1B1 ($12:B1B1). Asm: yi/Banks/Bank12.asm:2169.
//
// Shape-2 (walker-driven, slope=0). The init writes a FIXED 3-col x 2-row
// extent (ignoring the stream's own extents), STZ $15 (orientation -> 0),
// then tail-calls the slope-zero walker trampoline:
//   CODE_extobj_handler_grass_shadow_small:
//     REP #$10 : STZ $15 : LDX #$0003 : LDY #$0002 : BRA CODE_128CCC
//   CODE_128CCC:
//     STX $2A : STY $2E : REP #$20 : SEP #$10
//     LDX #(CODE_12B194-1)>>16 : LDA #CODE_12B194-1
//     JMP CODE_walker_setup_trampoline
//
// Per cell, CODE_12B194 builds the table index from the walker counters and
// dispatches on $15 (= 0 here) through jump table DATA_12B18E -> CODE_12B1BF:
//   REP #$30
//   LDA $28 : ASL : STA $00          ; col*2
//   LDA $2C : ASL : ASL : ASL        ; row*8
//   ORA $00 : TAY                    ; Y = (row*8) | (col*2)  (byte offset)
//   LDX $15 : JSR (DATA_12B18E,x)    ; $15=0 -> CODE_12B1BF: LDA DATA_12B1B1,y
//   LDX $1D : STA !LevelDataBuffer,x ; stamp the looked-up word
// => word index = (Y >> 1) = col + row*4 into DATA_12B1B1.
//
// DATA_12B1B1 ($12:B1B1), verbatim from asm closure (7 words):
//   dw $776A, $776B, $776C, $0000, $01CB, $01D0, $01CF
// As a 4-col x 2-row grid (row stride 4 words):
//   row 0 (top, grass tuft):           $776A $776B $776C $0000
//   row 1 (bottom, ground/shadow strip): $01CB $01D0 $01CF (no 4th entry)
//
// (all 6 stamping cells; the 3 "subX=-1" cells are walker row-wrap bookkeeping
// frames, not stamps):
//   col0 row0 -> idx0 -> $776A @ off$0346   col0 row1 -> idx4 -> $01CB @ off$0366
//   col1 row0 -> idx1 -> $776B @ off$0348   col1 row1 -> idx5 -> $01D0 @ off$0368
//   col2 row0 -> idx2 -> $776C @ off$034A   col2 row1 -> idx6 -> $01CF @ off$036A
//
// This is a 2-cell-tall OVERLAY (top tuft + bottom shadow strip), NOT a
// read-modify-write: CODE_12B1BF loads the tile straight from DATA_12B1B1 and
// stamps it; the existing $12 cell is never consulted.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12B1B1 ($12:B1B1) — row stride 4 words; indexed [col + row*4].
// Idx 3 ($0000) and idx 7 (past the 7-word table) are unreachable here: the
// init pins the col extent to 3, so col is only ever 0..2.
const GRASS_SHADOW_TILES: readonly number[] = [
  0x776a, 0x776b, 0x776c, 0x0000, // row 0 (top: grass tuft)
  0x01cb, 0x01d0, 0x01cf, 0x0000, // row 1 (bottom: ground/shadow strip)
];

// Ports CODE_12B194 / CODE_12B1BF ($12:B194): word index = col + row*4.
const perCellGrassShadowSmall: PerCellHandler = (state: DecodeState): void => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const idx = (col + row * 4) & 0x7;
  stampCell(state, GRASS_SHADOW_TILES[idx]);
};

// Ports CODE_extobj_handler_grass_shadow_small ($12:8CA7).
function initGrassShadowSmall(state: DecodeState): void {
  state.zp15 = 0x00;   // STZ $15
  state.zp2A = 0x0003; // STX $2A (col extent)
  state.zp2E = 0x0002; // STY $2E (row extent)
  walkerSetupTrampoline(state, perCellGrassShadowSmall); // JMP CODE_walker_setup_trampoline (slope=0)
}

export function installExtGrassShadowSmallHandlers(): void {
  registerExtObjectHandler(0x6a, initGrassShadowSmall);
}
