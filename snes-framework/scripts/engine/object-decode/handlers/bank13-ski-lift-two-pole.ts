// Bank13 ski-lift-two-pole stamp handler + Bank12 init wrapper.
//
// Standard object $3E — `ski_lift_two_pole`: two ski-lift wire support
// poles side by side. A single-cell stamp that morphs the underlying tile
// based on the under-tile and row position. The per-cell handler picks one
// of three Map16 IDs based on:
//   1) the current cell's existing tile (`$12`): if it equals one of
//      the three "join markers" $0092, $0093, or $00A6, stamp $00A7
//      (the canonical terrain-join tile) — preserves an existing seam.
//   2) otherwise, pick by row position within the object:
//        row 0 (top)                 → $00B3
//        row N-1 (bottom, $2C+1==$2E) → template-slot $1C74
//        everything else (body)      → $00B4
//
// The cart routine indirects through a 3-pointer table whose third
// entry is a template-slot pointer ($1C74) rather than an inline tile,
// so the "bottom" tile is per-tileset.
//
// Asm sources:
//   CODE_init_ski_lift_two_pole     Bank12.asm:3523  ($12:968C)
//   CODE_stamp_ski_lift_two_pole    Bank13.asm:4435  ($13:A0E4)
//   DATA_ski_lift_two_pole_select   Bank13.asm:4470  ($13:A11C) — 3-entry pointer table
//   DATA_ski_lift_two_pole_top_tile Bank13.asm:4474  ($13:A122) — dw $00B3
//   DATA_ski_lift_two_pole_bot_tile Bank13.asm:4478  ($13:A124) — dw $00B4
//   (Note: DATA_ski_lift_two_pole_left/right/extras at $13A0CC/D8/DE are
//   NOT consumed by this handler — they belong to a sibling routine.)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Tile constants
// ─────────────────────────────────────────────────────────────────────

// Three "join marker" tiles that, if found under the cursor, get
// overwritten with $00A7 instead of taking the row-pick path.
const JOIN_MARKER_A = 0x0092;
const JOIN_MARKER_B = 0x0093;
const JOIN_MARKER_C = 0x00A6;
const JOIN_OUT_TILE = 0x00A7; // canonical terrain-join tile (CODE_13A0F9 branch)

// Row-pick: inline tile values (cart `LDA $0000,y` deref of A122/A124).
const TOP_TILE = 0x00B3; // DATA_ski_lift_two_pole_top_tile
const BODY_TILE = 0x00B4; // DATA_ski_lift_two_pole_bot_tile (mid-row "body")

// Bottom-row tile is read from template slot $001C74 (per-tileset).
// Lives in the FloorRow0 region ($1C5C-$1C79); no canonical TT name yet.
// Spec trace (object $3E in current.bin) shows this slot resolving to
// Map16 $2A0C in the test tileset.
const SLOT_SKI_LIFT_TWO_POLE_BOTTOM = 0x001C74;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_ski_lift_two_pole ($13:A0E4)
//
//   REP #$30
//   LDX $1D ; LDA $12              ; load current tile
//   CMP #$0092 ; BEQ CODE_13A0F9    \
//   CMP #$0093 ; BEQ CODE_13A0F9    | join-marker overwrite
//   CMP #$00A6 ; BNE CODE_13A0FE   /
//   CODE_13A0F9: LDA #$00A7 ; BRA store
//
//   CODE_13A0FE:                    ; row-pick branch
//     LDY #$0000                    ; default Y = 0 (top)
//     LDA $2C ; BEQ store_with_y    ; row == 0 → top
//     INY ; INY                     ; Y = 2 (body)
//     INC ; CMP $2E ; BNE store_with_y  ; row+1 != extent → body
//     INY ; INY                     ; Y = 4 (bottom)
//   CODE_13A10E:
//     LDA DATA_ski_lift_two_pole_select,y             ; pointer table: $A122, $A124, $1C74
//     TAY
//     LDA $0000,y                   ; deref → inline tile or template-slot value
//   store:
//     STA buffer,x ; SEP #$30 ; RTL
//
// The pointer-then-deref shape is just a 3-way select. We collapse it
// to a switch on the (already word-doubled) cart Y value (0 / 2 / 4)
// → (TOP_TILE, BODY_TILE, templateAt(SLOT_SKI_LIFT_TWO_POLE_BOTTOM)).
// ─────────────────────────────────────────────────────────────────────

const skiLiftTwoPoleStamp: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;
  if (cur === JOIN_MARKER_A || cur === JOIN_MARKER_B || cur === JOIN_MARKER_C) {
    stampCell(state, JOIN_OUT_TILE);
    return;
  }

  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;

  let mapId: number;
  if (row === 0) {
    mapId = TOP_TILE;                                    // Y=0 → A122 → $00B3
  } else if (((row + 1) & 0xff) === rowExtent) {
    mapId = state.templateAt(SLOT_SKI_LIFT_TWO_POLE_BOTTOM); // Y=4 → $1C74 → per-tileset
  } else {
    mapId = BODY_TILE;                                   // Y=2 → A124 → $00B4
  }
  stampCell(state, mapId);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_ski_lift_two_pole ($12:968C)
//
//   REP #$20
//   LDX #(CODE_stamp_ski_lift_two_pole-1)>>16
//   LDA #CODE_stamp_ski_lift_two_pole-1
//   JMP walker_setup_trampoline
//
// Plain trampoline-walker init: same handler for even-col / odd-col /
// row slots, $19=$7FFF, slope=0. No DP mutations (spec confirms walker
// reads stream's raw $1B/$1C/$2A/$2E/$15 unchanged).
// ─────────────────────────────────────────────────────────────────────

function initSkiLiftTwoPole(state: DecodeState): void {
  walkerSetupTrampoline(state, skiLiftTwoPoleStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installSkiLiftTwoPoleHandlers(): void {
  registerStdObjectHandler(0x3E, initSkiLiftTwoPole);
}
