// Bank13 stamp handler for std object $6A — 3-wide platform bar.
//
//
// Init (Bank12.asm:4111, CODE_init_3wide_platform_bar @ $12:9A99):
//   REP #$20
//   LDX #(CODE_3wide_platform_bar-$01)>>16     ; bank byte of per-cell handler
//   LDA #CODE_3wide_platform_bar-$01           ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline    ; all 3 slots = CODE_3wide_platform_bar
//
// Per-cell stamp (Bank13.asm:8162, CODE_3wide_platform_bar @ $13:C728):
//   REP #$30
//   LDX $1D
//   LDY #$6400                     ; default: left cap
//   LDA $28                        ; column counter
//   BEQ +                          ; col 0 -> stamp $6400
//     INY                          ;   Y = $6401 (middle/body)
//     INC                          ;   A = col + 1
//     CMP $2A                      ;   col+1 == col_extent?
//     BNE +                        ;     no  -> stamp $6401
//     INY                          ;     yes -> Y = $6402 (right cap)
//   +
//   TYA
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30
//   RTL
//
// Translation: column 0 stamps $6400, the last column ($28+1 == $2A)
// stamps $6402, every column in between stamps $6401. The trace's 16-cell
// run (col_extent=$10, row_extent=$01) confirms `[6400, 6401×14, 6402]`.
//
// Init DP diff: none — the init handler does not mutate any walker-
// relevant DP field before invoking the walker (see spec.md table).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

const TILE_LEFT_CAP  = 0x6400;
const TILE_BODY      = 0x6401;
const TILE_RIGHT_CAP = 0x6402;

const stamp3widePlatformBar: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const extent = state.zp2A & 0xff;
  let tile: number;
  if (col === 0) {
    tile = TILE_LEFT_CAP;
  } else if (((col + 1) & 0xff) === extent) {
    tile = TILE_RIGHT_CAP;
  } else {
    tile = TILE_BODY;
  }
  stampCell(state, tile);
};

function init3widePlatformBar(state: DecodeState): void {
  walkerSetupTrampoline(state, stamp3widePlatformBar);
}

export function install3widePlatformBarHandlers(): void {
  registerStdObjectHandler(0x6A, init3widePlatformBar);
}
