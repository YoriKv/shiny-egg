// Bank13 chomp sign-post / vertical-pipe stamp handlers + Bank12 init.
//
// Standard object $A9 — ChompSignPostOrVerticalPipe: a Chomp sign-post
// prop, or a vertical pipe, chosen by the BG1 tileset.
// CODE_init_chomp_sign_or_pipe (Bank12.asm:4779, $12:9F13) branches on
// BG1 tileset:
//
//   tileset $03 (water/pipe tileset) → wires CODE_stamp_water_top_3state
//                                  (vertical-pipe variant) with $2A forced
//                                  to 2 (always 2 columns wide regardless
//                                  of stream).
//   any other tileset            → wires CODE_stamp_cliff_top (single-col
//                                  sign-post stamper).
//
// Both paths use the standard `walker_setup_trampoline` (one handler in
// all 3 slots, $19=$7FFF row threshold, no slope).
//
// Asm sources:
//   CODE_init_chomp_sign_or_pipe     Bank12.asm:4779 ($12:9F13)
//   CODE_stamp_cliff_top             Bank13.asm:11471 ($13:DDCA)
//   CODE_stamp_water_top_3state      Bank13.asm:11495 ($13:DDF0)
//   CODE_water_top_3state_top        Bank13.asm:11524 ($13:DE22)
//   CODE_water_top_3state_mid        Bank13.asm:11534 ($13:DE31)
//   CODE_water_top_3state_bot        Bank13.asm:11550 ($13:DE4B)
//
// Trace fixture: std-A9 with default (non-water) tileset → 16 stamps of
// Map16 $0083, all from the empty-cell branch of CODE_stamp_cliff_top.
// The trace doesn't exercise the water-tileset 3-state path, but the
// asm is short + verbatim so we mirror it for completeness.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_cliff_top (Bank13.asm:11471, $13:DDCA).
//
// Asm (verbatim):
//   REP #$30
//   LDY #$0083                    ; default Map16 ID (cliff-top base tile)
//   LDA $12                       ; current cell's existing Map16 ID
//   BEQ stamp                     ; empty cell → stamp $0083 unconditionally
//   LDY $1C78                     ; level-aware top-edge slot (last slot
//                                 ;   of FloorRow0 family $1C5C-$1C79)
//   CMP $1C5C (FloorRow0_LeftLo)  ; existing tile matches floor-top-left?
//   BEQ stamp                     ;   → stamp the level-aware top-edge
//   CMP $1C5E (FloorRow0_RightLo) ; or floor-top-right?
//   BNE skip                      ; neither → leave cell alone
// stamp: LDX $1D ; TYA ; STA buf,X
// skip:  SEP #$30 ; RTL
//
// Spec trace: all 16 cells took the empty-cell branch ($12==0), so every
// stamp output Map16 $0083. The conditional level-aware $1C78 path fires
// only when the cliff-top object overlaps existing floor-top tiles.
// ─────────────────────────────────────────────────────────────────────

const CLIFF_TOP_DEFAULT_TILE = 0x0083;

// Slot $001C78 = byte offset $1C into the FloorRow0 family (slot 14 of 15).
// Only this handler references it — no shared TT entry warranted.
const SLOT_FLOOR_ROW0_TOP_EDGE = 0x001C78;

const stampCliffTop: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;
  if (cur === 0) {
    stampCell(state, CLIFF_TOP_DEFAULT_TILE);
    return;
  }
  const floor0Left  = state.templateAt(TT.FloorRow0_LeftLo);
  const floor0Right = state.templateAt(TT.FloorRow0_RightLo);
  if (cur === floor0Left || cur === floor0Right) {
    stampCell(state, state.templateAt(SLOT_FLOOR_ROW0_TOP_EDGE));
  }
  // else: leave the cell as-is (skip).
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_water_top_3state (Bank13.asm:11495, $13:DDF0).
//
// 3-row vertical sequence (top / middle / bottom) of waterline tiles
// for the water-tileset variant. Always 2 columns wide (init forces
// $2A=2). $2C (row) selects which sub-handler:
//
//   row 0           → top sub-handler  (4-entry table DATA_13DE1A)
//   row 1..3        → middle sub       (3-entry rolling counter via $A1)
//   row $2E-2..$2E-1 → middle sub      (same)
//   row $2E         → bottom sub       (3-entry table DATA_13DE45)
//
// Cart asm dispatch (verbatim):
//   REP #$30
//   X = 0
//   LDA $2C ; BNE skip_zero
//     STZ $A1                       ; row 0 resets the mid-counter
//   skip_zero:
//   CMP #$0004 ; BCC dispatch       ; $2C < 4 → top sub (X=0)
//     X = 2 (middle)
//     LDA $2E ; SBC $2C ; CMP #$0003 ; BCS dispatch
//       X = 4 (bottom — $2E-$2C < 3 → near last 3 rows)
//   dispatch: JSR (DATA_13DDEA,X)   ; dispatch table → top/mid/bot
//   STA.l buf,X
//
// Sub-handlers add ($28) to the table-read tile before returning. Tables:
//
//   DATA_13DE1A (top, indexed by $2C * 2):
//     [$3D2F, $7D22, $0110, $0112]    — rows 0,1,2,3 base tiles
//   DATA_13DE2B (mid, indexed by $A1 cycling 0/1/2):
//     [$3D31, $3D16, $3D33]           — rolling 3-tile pattern
//   DATA_13DE45 (bot, indexed by ($2E-$2C) * 2):
//     [$0110, $7D22, $3D35]           — last-3 rows from the bottom
//
// $A1 is the rolling mid-state counter (zp slot — `state.zpA1`). The
// init resets it implicitly via the row-0 STZ on first cell; mid handler
// pre-increments mod 3 each call.
// ─────────────────────────────────────────────────────────────────────

const DATA_13DE1A_top = [0x3D2F, 0x7D22, 0x0110, 0x0112] as const;
const DATA_13DE2B_mid = [0x3D31, 0x3D16, 0x3D33] as const;
const DATA_13DE45_bot = [0x0110, 0x7D22, 0x3D35] as const;

const stampWaterTop3State: PerCellHandler = (state) => {
  const row    = state.zp2C & 0xffff;
  const rowEnd = state.zp2E & 0xffff;
  const col    = state.zp28 & 0xffff;

  // Row-0 resets the rolling mid-counter ($A1). Matches the asm
  // `LDA $2C ; BNE +; STZ $A1 ; +:` pattern.
  if (row === 0) {
    state.zpA1 = 0;
  }

  let tile: number;
  if (row < 4) {
    // Top sub: DATA_13DE1A[$2C].
    tile = DATA_13DE1A_top[row & 0x03]!;
  } else {
    // Distance from last row, asm: `LDA $2E ; CLC ; SBC $2C` (note: CLC
    // before SBC means the subtraction borrows in — `$2E - $2C - 1`).
    const distFromEnd = (rowEnd - row - 1) & 0xffff;
    if (distFromEnd >= 3) {
      // Middle sub: rolling 3-counter on $A1. Asm:
      //   LDA $A1 ; INC ; CMP #3 ; BCC +; LDA #0 ; +: STA $A1
      const next = ((state.zpA1 & 0xffff) + 1) % 3;
      state.zpA1 = next & 0xffff;
      tile = DATA_13DE2B_mid[next]!;
    } else {
      // Bottom sub: DATA_13DE45[$2E-$2C].
      tile = DATA_13DE45_bot[distFromEnd & 0x03] ?? 0;
    }
  }

  // All three sub-handlers end with `CLC ; ADC $28 ; RTS` — caller adds
  // column to the table-read tile before stamping.
  stampCell(state, (tile + col) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_chomp_sign_or_pipe (Bank12.asm:4779, $12:9F13).
//
// Asm (verbatim):
//   REP #$20
//   LDX BG1TilesetLo
//   CPX #$03
//   BEQ water_path
//     LDX/LDA #CODE_stamp_cliff_top-1
//     JMP CODE_walker_setup_trampoline
//   water_path:
//     LDA #$0002 ; STA $2A          ; force col-extent to 2
//     LDX/LDA #CODE_stamp_water_top_3state-1
//     JMP CODE_walker_setup_trampoline
//
// BG1Tileset is `state.header[1]` (4-bit field — no need to mask for
// the equality check since tileset IDs are all <$10).
// ─────────────────────────────────────────────────────────────────────

function initChompSignOrPipe(state: DecodeState): void {
  const bg1Tileset = state.header[1] ?? 0;
  if (bg1Tileset === 0x03) {
    // Water/pipe-tileset variant (vertical pipe): force $2A = 2 then
    // trampoline into the 3-state water-top stamper.
    state.zp2A = 0x0002;
    walkerSetupTrampoline(state, stampWaterTop3State);
  } else {
    walkerSetupTrampoline(state, stampCliffTop);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Only object $A9 dispatches through this init; the cart's
// DATA_standard_object_init_ptrs table points $A9 → CODE_init_chomp_sign_or_pipe.
// ─────────────────────────────────────────────────────────────────────
export function installChompSignOrPipeHandlers(): void {
  registerStdObjectHandler(0xA9, initChompSignOrPipe);
}
