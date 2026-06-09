// Ports CODE_extobj_handler_goal_pole ($12:8A96, Bank12.asm:1843) — the
// level-end goal pole / post. Walker-driven (shape 2): a 4-column x 0x14-row
// vertical shape. Per-cell stamper is CODE_12AC59 ($12:AC59).
//
// Init (verbatim shape):
//   REP #$20
//   LDA $1B : AND #$0F0F : STA $00              ; keep sub-screen nibbles
//   LDA $1B : AND #$F0F0 : SEC : SBC #$1030
//            : AND #$F0F0 : ORA $00 : STA $1B   ; shift origin -1 screen-col,
//                                               ;   -3 screen-rows ($1B/$1C word)
//   LDA #$0004 : STA $2A                        ; col extent = 4
//   LDA #$0014 : STA $2E                        ; row extent = 0x14
//   LDX/LDA #CODE_12AC59-1 : JMP walker_setup_trampoline
//
// Per-cell stamper CODE_12AC59:
//   REP #$30 : LDA $28 : ASL : TAX : JSR (DATA_12AC6B,x) : LDX $1D : STA buf,x
//   DATA_12AC6B = { CODE_12AC73, CODE_12AC73, CODE_12AC97, CODE_12AC97 }
//   so cols 0/1 → CODE_12AC73 (left half), cols 2/3 → CODE_12AC97 (right half).
//
//   Left half CODE_12AC73 / CODE_12AC7F ($12:AC73):
//     if $2C+1 == $2E      → $00DE        (bottom-row cap, both cols 0 and 1)
//     elif $28 == 0        → keep $12     (col 0 body: leaves existing tile)
//     elif $2C >= $0010    → keep $12     (col 1 rows 16-18: leaves existing)
//     elif $2C odd         → $00E5        (col 1 odd body rows 1,3,..,15)
//     else                 → keep $12     (col 1 even body rows)
//   "keep $12" stamps whatever Map16 ID was already in the buffer; in a clean
//   decode that's $0000, so these cells stamp $0000.
//
//   Right half CODE_12AC97 / CODE_12ACA7 ($12:AC97): pick Y row-class then
//     stamp = DATA_12ACB5[Y] + ($28 & 1):
//       $2C == 0           → Y = 0
//       $2C+1 == $2E       → Y = 4   (bottom row)
//       else               → Y = 2   (body)
//     DATA_12ACB5 ($12:ACB5) = dw $00DF, $00E1, $00E3  (Y = 0/2/4 words).
import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

const GOAL_POLE_EXT_ID = 0x48;

// DATA_12ACB5 ($12:ACB5) — right-half base tiles, one word per row class.
// Indexed by Y = 0 (top), 2 (body), 4 (bottom); we store packed as [0,1,2].
const DATA_12ACB5: readonly number[] = [0x00df, 0x00e1, 0x00e3];

// CODE_12AC73 / CODE_12AC7F ($12:AC73) — left-half per-cell pick (cols 0,1).
// `state.zp12` is the current (already-stamped) Map16 ID at this cell, which
// the cart's "keep" branches re-stamp unchanged (LDA $12).
function leftHalfPick(state: DecodeState): number {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xffff;
  const rowExtent = state.zp2E & 0xffff;
  if (((row + 1) & 0xffff) === rowExtent) return 0x00de; // bottom-row cap
  if (col === 0) return state.zp12 & 0xffff;             // col 0 body: keep
  if (row >= 0x0010) return state.zp12 & 0xffff;         // col 1 rows 16+: keep
  if ((row & 0x0001) !== 0) return 0x00e5;               // col 1 odd body
  return state.zp12 & 0xffff;                            // col 1 even body: keep
}

// CODE_12AC97 / CODE_12ACA7 ($12:AC97) — right-half per-cell pick (cols 2,3).
function rightHalfPick(state: DecodeState): number {
  const row = state.zp2C & 0xffff;
  const rowExtent = state.zp2E & 0xffff;
  let yIdx = 0;                                  // $2C == 0 → Y 0
  if (row !== 0) {
    yIdx = 1;                                    // body → Y 2
    if (((row + 1) & 0xffff) === rowExtent) yIdx = 2; // bottom → Y 4
  }
  return (DATA_12ACB5[yIdx]! + (state.zp28 & 0x0001)) & 0xffff;
}

// CODE_12AC59 ($12:AC59) — dispatch on column (DATA_12AC6B): cols 0/1 →
// left half, cols 2/3 → right half. Stamp at $1D.
const goalPoleStamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const pick = col < 2 ? leftHalfPick(state) : rightHalfPick(state);
  stampCell(state, pick);
};

// CODE_extobj_handler_goal_pole ($12:8A96).
function initGoalPole(state: DecodeState): void {
  // Shift the origin word ($1B low / $1C high) by -$1030 in the screen-coord
  // nibbles ($F0F0), preserving the sub nibbles ($0F0F).
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subKeep = word1B & 0x0f0f;
  const screen = (((word1B & 0xf0f0) - 0x1030) & 0xf0f0);
  const newWord = (screen | subKeep) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  state.zp2A = 0x0004; // col extent
  state.zp2E = 0x0014; // row extent
  walkerSetupTrampoline(state, goalPoleStamp);
}

export function installExtGoalPoleHandlers(): void {
  registerExtObjectHandler(GOAL_POLE_EXT_ID, initGoalPole);
}
