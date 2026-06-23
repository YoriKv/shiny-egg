// Bank13 stamp handler for the 22.5-degree floor slopes (objects $04 / $05).
//
// Cart entry points:
//   CODE_init_floor_slope_22deg     ($12:92BC, Bank12.asm:2913)
//   CODE_floor_slope_22deg          ($13:830F, Bank13.asm:611)
//   DATA_slope22_orientation_signs  ($12:92B8, alias DATA_slope22_orientation_signs)
//   DATA_floor_slope_22deg_pick_dispatch                     (Bank13.asm:599)  pick_right / pick_left dispatch
//   DATA_floor_slope_22deg_right_desc_slots / DATA_floor_slope_22deg_right_asc_slots       per-row slot tables for pick_right
//   DATA_floor_slope_22deg_left_desc_slots / DATA_floor_slope_22deg_left_asc_slots       per-row slot tables for pick_left
//
// Algorithm (cart-faithful):
//
//   init:
//     JSR CODE_floor_row_shift_up                          ; $1B -= $10, $2E += 1
//     A = ($15 & 1) << 1                                   ; → 0 or 2
//     $15 = A
//     $17 = DATA_slope22_orientation_signs[A>>1]           ; $FFFF (down) or $0001 (up)
//     if A != 0: JSR CODE_floor_row_shift_up               ; second up-shift for the
//                                                          ;   $0001 (rising) orientation
//     walker_setup_keep_slope(CODE_floor_slope_22deg)
//
//   per-cell stamp (CODE_floor_slope_22deg):
//     Y = $2C * 2
//     if Y >= 8  (row >= 4):
//         tail-call CODE_bg_floor_random                   ; randomised filler
//         return
//     $9B = 0
//     X = ($28 & 1) << 1                                   ; 0 (even col) or 2 (odd col)
//     if X == 0: pick_right(Y) using DATA_floor_slope_22deg_right_desc_slots or 138340 by $15
//     else:      pick_left(Y) using DATA_floor_slope_22deg_left_desc_slots or 13835D by $15
//                (pick_left also does INC $9B → enables keep-slope row rewind)
//     X = slot returned in X
//     stamp template_at(X)
//
// Verified against trace-harness specs std-04-init_floor_slope_22deg and
// std-05-init_floor_slope_22deg (every per-cell Map16 ID matches the
// cart-side trace at byte-exact precision for rows 0..3; row 4+ falls
// through to bg_floor_random, which is the same prng-driven picker
// ported in bank13-floor.ts).
//
// GoldenEgg cross-check: GE.Level.Obj04Main covers BOTH $04 and $05 (no
// separate Obj05Main exists). Its (`_v >= 4` → Obj01MainCode2 (= cart's
// bg_floor_random), else 4-entry per-row tile by `_h & 1` and orientation
// bit) is the same shape as the cart — no divergence.
//
// Acknowledged simplifications: none of substance. The pick_right /
// pick_left tables encode raw template-slot WRAM addresses (most of
// which lack canonical TT.* aliases yet — they live inside the small
// $1A00 / $1C00 structural-family ranges); we keep them as raw hex with
// per-line comments so a future template-slot naming pass can grep
// them. The `$9B` increment on pick_left mirrors the cart's keep-slope
// row rewind toggle — required for the diagonal walker to advance one
// row per column-pair.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { TT } from '../template-slots.ts';
import {
  stampCell, floorRowShiftUp,
} from './_shared.ts';
import { bgFloorRandom } from './bank13-floor.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_slope22_orientation_signs (Bank12.asm:2908)
//
// 2-entry sign table: index 0 (== $15 bit 0 clear) gives $FFFF
// (descending slope, $17 = -1 ⇒ walker steps down-right), index 1
// (== $15 bit 0 set) gives $0001 (ascending slope, $17 = +1 ⇒ walker
// steps up-right). Note: the cart indexes by Y = A (already shifted
// left by 1), so the table is dw-spaced.
// ─────────────────────────────────────────────────────────────────────

const DATA_slope22_orientation_signs = [0xFFFF, 0x0001] as const;

// ─────────────────────────────────────────────────────────────────────
// Per-row slot tables consumed by pick_right / pick_left.
//
// Each entry is a 16-bit WRAM template-slot address that the per-cell
// stamp dereferences via state.templateAt() to obtain the actual Map16
// ID. Slot addresses are kept as raw hex where there's no canonical
// TT.* alias yet (the framework rename pass hasn't reached the small
// $1A00 / $1C00 structural families); inline comments describe each.
// ─────────────────────────────────────────────────────────────────────

// DATA_floor_slope_22deg_right_desc_slots — pick_right, orientation $15=0 (descending: $04).
// 4 slots, indexed by Y = $2C * 2 (so we use rowIdx directly).
// Source: Bank13.asm:635  dw $1C60, $1A42, $1A60, $1CAE
const DATA_floor_slope_22deg_right_desc_slots = [
  0x001C60,                       // row 0 even-col: top-cap descending L tile
  0x001A42,                       // row 1 even-col: small $1A00 family entry
  0x001A60,                       // row 2 even-col
  0x001CAE,                       // row 3 even-col: FlatFloor random-pool slot 0
] as const;

// DATA_floor_slope_22deg_right_asc_slots — pick_right, orientation $15=2 (ascending: $05).
const DATA_floor_slope_22deg_right_asc_slots = [
  0x001C64,                       // row 0 even-col
  TT.Family0C00_Anchor,           // row 1 = $001A2A
  0x001A40,                       // row 2
  TT.FlatFloor_Row3RightLo,       // row 3 = $001CC4
] as const;

// DATA_floor_slope_22deg_left_desc_slots — pick_left, orientation $15=0 (descending: $04).
const DATA_floor_slope_22deg_left_desc_slots = [
  0x001C62,                       // row 0 odd-col
  TT.Family1000_Anchor,           // row 1 = $001A50
  0x001A5C,                       // row 2
  TT.FlatFloor_Row3LeftLo,        // row 3 = $001CC2
] as const;

// DATA_floor_slope_22deg_left_asc_slots — pick_left, orientation $15=2 (ascending: $05).
const DATA_floor_slope_22deg_left_asc_slots = [
  0x001C66,                       // row 0 odd-col
  0x001A34,                       // row 1: +$0A into Family0C00 (5-slot family)
  TT.Family1200_Anchor,           // row 2 = $001A5E (1-slot family)
  0x001CB0,                       // row 3: FlatFloor random-pool slot 1
] as const;

// ─────────────────────────────────────────────────────────────────────
// pick_right (CODE_floor_slope_22deg_pick_right, Bank13.asm:641)
//
// Selects a slot from one of two 4-entry tables based on $15:
//   $15 == 0: DATA_floor_slope_22deg_right_desc_slots    (descending slope, $04)
//   $15 != 0: DATA_floor_slope_22deg_right_asc_slots    (ascending slope,  $05)
// Returns the slot WRAM address. Caller dereferences via templateAt().
// ─────────────────────────────────────────────────────────────────────

function pickRightSlot(state: DecodeState, rowIdx: number): number {
  // $15 was re-encoded by the init handler to 0 or 2; the BNE in the
  // cart triggers on any non-zero value.
  const table = state.zp15 === 0 ? DATA_floor_slope_22deg_right_desc_slots : DATA_floor_slope_22deg_right_asc_slots;
  return table[rowIdx]!;
}

// ─────────────────────────────────────────────────────────────────────
// pick_left (CODE_floor_slope_22deg_pick_left, Bank13.asm:658)
//
// Same shape as pick_right with two differences:
//   1. INC $9B first — sets the walker's "rewound" flag to 1, which
//      tells the keep-slope walker's row-wrap path to do a nibble
//      rewind on the next column boundary (needed for the diagonal
//      step that keeps the slope on a per-column-pair pitch).
//   2. Different table choice:
//      $15 == 0: DATA_floor_slope_22deg_left_desc_slots
//      $15 != 0: DATA_floor_slope_22deg_left_asc_slots
// ─────────────────────────────────────────────────────────────────────

function pickLeftSlot(state: DecodeState, rowIdx: number): number {
  // INC $9B (cart: $9B is the "rewound" 16-bit flag).
  state.rewound = (state.rewound + 1) & 0xffff;
  const table = state.zp15 === 0 ? DATA_floor_slope_22deg_left_desc_slots : DATA_floor_slope_22deg_left_asc_slots;
  return table[rowIdx]!;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_slope_22deg (Bank13.asm:611)
//
// Per-cell stamp.
// ─────────────────────────────────────────────────────────────────────

const floorSlope22deg: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  // Cart: LDA $2C ASL ; TAY ; CPY #$0008 BCC in_bounds.
  // CPY #$0008 with Y = row*2 fires for row >= 4.
  if (row >= 4) {
    // Cart: `JSL.l CODE_bg_floor_random` — the FULL routine (early-outs +
    // last-row branch + neighbour-fix + pick_random). The last-row branch
    // gates whether a roll happens, so it must be present for the per-site
    // PRNG replay ($13810C) to stay cadence-aligned with the cart.
    bgFloorRandom(state);
    return;
  }
  // STZ $9B — clear rewound flag before per-row dispatch.
  state.rewound = 0;
  const colParity = state.zp28 & 0x01;
  let slotAddr: number;
  if (colParity === 0) {
    slotAddr = pickRightSlot(state, row);
  } else {
    slotAddr = pickLeftSlot(state, row);
  }
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_floor_slope_22deg (Bank12.asm:2913)
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x04, 0x05 share this handler.
function initFloorSlope22deg(state: DecodeState): void {
  // Step 1: JSR CODE_floor_row_shift_up.
  floorRowShiftUp(state);

  // Step 2: A = ($15 & 1) << 1 → 0 or 2; STA $15; TAY.
  const a = (state.zp15 & 0x01) << 1;
  state.zp15 = a;

  // Step 3: $17 = DATA_slope22_orientation_signs[A >> 1].
  // The cart indexes the byte-spaced 16-bit table by Y = A directly,
  // so DATA[0] for A=0 and DATA[2] for A=2 → table[A>>1].
  state.zp17 = DATA_slope22_orientation_signs[a >>> 1]!;

  // Step 4: TYA ; BEQ skip-second-shift. Only re-shift when A != 0
  // (i.e. ascending slope, $05).
  if (a !== 0) {
    floorRowShiftUp(state);
  }

  // Step 5: LDX/LDA = CODE_floor_slope_22deg-$01 ; JMP walker_setup_keep_slope.
  walkerSetupKeepSlope(state, floorSlope22deg);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installFloorSlope22degHandlers(): void {
  registerStdObjectHandler(0x04, initFloorSlope22deg);
  registerStdObjectHandler(0x05, initFloorSlope22deg);
}
