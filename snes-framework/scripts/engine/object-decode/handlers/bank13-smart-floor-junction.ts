// Bank13 smart-floor-junction stamp handler (std object $7A).
//
// Cart entry points:
//   CODE_init_smart_floor_junction       ($12:9BD5, Bank12.asm:4296)
//   CODE_smart_floor_junction_stamp      ($13:C9AD, Bank13.asm:8567)
//   DATA_smart_floor_junction_handlers   ($13:C9ED) — 9-entry sub-handler ptr table
//   CODE_smart_floor_junction_topleft    ($13:C9FF)
//   CODE_smart_floor_junction_topmid     ($13:CA2A)
//   CODE_smart_floor_junction_topright   ($13:CA2E)
//   CODE_smart_floor_junction_midleft    ($13:CA59)
//   CODE_smart_floor_junction_midmid     ($13:CA98)
//   CODE_smart_floor_junction_midright   ($13:CAA0)
//   CODE_smart_floor_junction_botleft    ($13:CADF)
//   CODE_smart_floor_junction_botmid     ($13:CB0B)
//   CODE_smart_floor_junction_botright   ($13:CB1D)
//   DATA_smart_floor_junction_midleft_tiles  ($13:CA94)  dw $1D8A,$1DAA
//   DATA_smart_floor_junction_midmid_tiles   ($13:CA9C)  dw $1D8C,$1D8E
//   DATA_smart_floor_junction_midright_tiles ($13:CADB)  dw $1D90,$1DAC
//   DATA_smart_floor_junction_botmid_tiles   ($13:CB19)  dw $1D94,$1D96
//
// Init handler ($12:9BD5) is a bare walker-trampoline: $17=0, all three
// slots → CODE_smart_floor_junction_stamp, walker termination via
// $2C==$2E. No DP mutation pre-walk (spec confirms).
//
// Per-cell stamp ($13:C9AD):
//   1. Y     = ($28 & 1) * 2                — sub-table picker (left vs right tile)
//   2. $00   = $12                          — latch current Map16 ID for sub-handlers
//   3. X     = 0 if row==0
//            6 if row==$2E-1 (last row)     — BEWARE: cart does `INC ; CMP $2E ; BNE`,
//                                            so the LAST row gets X=12 only when
//                                            $2C == $2E - 1; "INC; CMP; BNE" branches
//                                            AWAY from the X=12 path when NOT equal,
//                                            i.e. mid-row keeps X=6.
//            12 otherwise (middle row)
//   4. X    += 0 if col==0
//            +4 if col==$2A-1 (last col)    — same INC/CMP/BNE pattern
//            +2 otherwise (middle col)
//   5. JSR (DATA_smart_floor_junction_handlers, X) — sub-handler returns slot
//      address in X (or $FFFF to skip-stamp).
//   6. If X < 0 ($FFFF / high bit set): skip stamp (preserve previous tile).
//      Else: LDA $0000,X → Map16 ID via templateAt → stamp.
//
// All 9 sub-handlers operate by inspecting $00 (current cell Map16 ID)
// against various Family6800 slot ($1D8A..$1DB0) values to decide
// whether to stamp the "interior" template or skip / pick a corner alt.
// Top-left, top-right, bot-left, bot-right also probe BELOW (`get_map16_below`)
// for a particular slot to detect a "stack on top of another smart-floor"
// scenario — if matched, return $FFFF so the lower tile's existing
// content is preserved.
//
// All slot addresses ($1D8A..$1DB0) are unnamed members of the Family6800
// template family (TT.Family6800_Anchor = $1D8A is the only canonical TT
// name; the rest are unnamed siblings). Cart's
// init_per_tileset_template_slots writes them per-tileset via the indirect
// `LDA ptr ; TAY ; STA [find],y` pattern, so they show up in the cart
// runtime as a contiguous 20-slot block but have no individual symbols.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { getMap16Below } from '../fetch.ts';
import { stampCell, readBuf16, setProbeToCurrent } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Unnamed Family6800-region template slots (CODE_init_smart_floor_junction
// reads only — see template-slots.ts for the canonical Family6800_Anchor
// at $1D8A; the rest are addressed inline via raw offsets in the cart).
// ─────────────────────────────────────────────────────────────────────

const SLOT_1D8A = TT.Family6800_Anchor;  // also DATA_midleft_tiles[0]
const SLOT_1D8C = 0x001D8C;              // DATA_midmid_tiles[0]   — interior body L
const SLOT_1D8E = 0x001D8E;              // DATA_midmid_tiles[1]   — interior body R
const SLOT_1D90 = 0x001D90;              // DATA_midright_tiles[0]
const SLOT_1D92 = 0x001D92;              // bot-left primary
const SLOT_1D94 = 0x001D94;              // DATA_botmid_tiles[0]
const SLOT_1D96 = 0x001D96;              // DATA_botmid_tiles[1]
const SLOT_1D98 = 0x001D98;              // bot-right primary
const SLOT_1D9C = 0x001D9C;              // top-left corner alt / top-right below-probe target
const SLOT_1D9E = 0x001D9E;              // top-left interior / top-right corner alt
const SLOT_1DA2 = 0x001DA2;              // mid-left / bot-left skip-probe sentinel
const SLOT_1DA4 = 0x001DA4;              // bot-right merge / mid-left probe match
const SLOT_1DA6 = 0x001DA6;              // bot-left merge target
const SLOT_1DA8 = 0x001DA8;              // mid-right / bot-right probe sentinel
const SLOT_1DAA = 0x001DAA;              // DATA_midleft_tiles[1] / top-right / bot-right wall-meet
const SLOT_1DAC = 0x001DAC;              // DATA_midright_tiles[1] / top-left match
const SLOT_1DAE = 0x001DAE;              // generic "interior top" fallback
const SLOT_1DB0 = 0x001DB0;              // bot-mid "shadow on empty"

// ─────────────────────────────────────────────────────────────────────
// Sub-tables (cart Y indexes word-stride, we use direct array indexing).
// Y is ($28 & 1) so each table has 2 entries.
// ─────────────────────────────────────────────────────────────────────

const DATA_smart_floor_junction_midleft_tiles  = [SLOT_1D8A, SLOT_1DAA] as const;
const DATA_smart_floor_junction_midmid_tiles   = [SLOT_1D8C, SLOT_1D8E] as const;
const DATA_smart_floor_junction_midright_tiles = [SLOT_1D90, SLOT_1DAC] as const;
const DATA_smart_floor_junction_botmid_tiles   = [SLOT_1D94, SLOT_1D96] as const;

// Sub-handlers return either a WRAM slot address (template-slot pointer)
// or -1 to signal "skip stamp" (cart returns X with high bit set, e.g.
// $FFFF, and the stamp epilogue's `TXA ; BMI skip` branches around the
// store).
const SKIP_STAMP = -1;

// ─────────────────────────────────────────────────────────────────────
// Sub-handlers
// ─────────────────────────────────────────────────────────────────────

/** CODE_smart_floor_junction_topleft ($13:C9FF). Top-left corner.
 *  - If $12 == $1D90 or $12 == $1DAC: return $1D9E (corner-alt).
 *  - Else: probe cell BELOW current; if buf16 there == $1D9C: skip
 *    (return $FFFF — defer to the existing tile below).
 *  - Else: return $1DAE (interior-top fallback). */
function smartFloorJunctionTopLeft(state: DecodeState): number {
  const cur = state.zp12 & 0xffff;
  if (cur === state.templateAt(SLOT_1D90) || cur === state.templateAt(SLOT_1DAC)) {
    return SLOT_1D9E;
  }
  setProbeToCurrent(state);
  const belowOff = getMap16Below(state);
  const belowId = readBuf16(state, belowOff);
  if (belowId === state.templateAt(SLOT_1D9C)) {
    return SKIP_STAMP;
  }
  return SLOT_1DAE;
}

/** CODE_smart_floor_junction_topmid ($13:CA2A). Top-middle.
 *  Unconditionally returns $1DAE (interior-top template). */
function smartFloorJunctionTopMid(_state: DecodeState): number {
  return SLOT_1DAE;
}

/** CODE_smart_floor_junction_topright ($13:CA2E). Mirror of topleft.
 *  - If $12 == $1D8A or $12 == $1DAA: return $1D9C.
 *  - Else: probe below; if buf16 there == $1D9E: skip.
 *  - Else: return $1DAE. */
function smartFloorJunctionTopRight(state: DecodeState): number {
  const cur = state.zp12 & 0xffff;
  if (cur === state.templateAt(SLOT_1D8A) || cur === state.templateAt(SLOT_1DAA)) {
    return SLOT_1D9C;
  }
  setProbeToCurrent(state);
  const belowOff = getMap16Below(state);
  const belowId = readBuf16(state, belowOff);
  if (belowId === state.templateAt(SLOT_1D9E)) {
    return SKIP_STAMP;
  }
  return SLOT_1DAE;
}

/** CODE_smart_floor_junction_midleft ($13:CA59). Mid-left.
 *  Default pick: DATA_smart_floor_junction_midleft_tiles[Y/2] ($1D8A or $1DAA).
 *  Overrides:
 *    $12 in {$1D8C, $1D8E, $1D90, $1DAC} → CALL_TO_MIDMID — i.e. fall
 *      through to the mid-mid pick (cart `BEQ CODE_smart_floor_junction_midmid`). We model
 *      this by returning a sentinel that callers translate, but in
 *      practice the mid-mid pick is just `DATA_midmid_tiles[Y/2]` so we
 *      can return that directly.
 *    $12 in {$1D9C, $1D9E, $1DA4} → return $FFFF (skip).
 *    $12 == $1DA2 → keep default (no override).
 *    $12 == $1DAE → return $1D9C (corner-meet remap).
 *
 *  (Cart's structure: starts with X = midleft_tiles[Y]; falls into a
 *  CMP cascade. The "fall to midmid" path replaces X with
 *  midmid_tiles[Y].) */
function smartFloorJunctionMidLeft(state: DecodeState, y: number): number {
  const cur = state.zp12 & 0xffff;
  if (
    cur === state.templateAt(SLOT_1D8C) ||
    cur === state.templateAt(SLOT_1D8E) ||
    cur === state.templateAt(SLOT_1D90) ||
    cur === state.templateAt(SLOT_1DAC)
  ) {
    // Fall-through to mid-mid pick.
    return DATA_smart_floor_junction_midmid_tiles[y]!;
  }
  if (
    cur === state.templateAt(SLOT_1D9C) ||
    cur === state.templateAt(SLOT_1D9E) ||
    cur === state.templateAt(SLOT_1DA4)
  ) {
    return SKIP_STAMP;
  }
  if (cur === state.templateAt(SLOT_1DAE)) {
    return SLOT_1D9C;
  }
  // Default (covers $1DA2 explicit + any other value).
  return DATA_smart_floor_junction_midleft_tiles[y]!;
}

/** CODE_smart_floor_junction_midmid ($13:CA98). Interior body.
 *  Returns DATA_smart_floor_junction_midmid_tiles[Y/2] ($1D8C or $1D8E). */
function smartFloorJunctionMidMid(_state: DecodeState, y: number): number {
  return DATA_smart_floor_junction_midmid_tiles[y]!;
}

/** CODE_smart_floor_junction_midright ($13:CAA0). Mirror of midleft.
 *  Default: DATA_smart_floor_junction_midright_tiles[Y/2] ($1D90 or $1DAC).
 *  Overrides:
 *    $12 in {$1D8A, $1D8C, $1D8E, $1DAA} → mid-mid fall-through.
 *    $12 in {$1D9C, $1D9E, $1DA6}        → $FFFF (skip).
 *    $12 == $1DA8                         → keep default.
 *    $12 == $1DAE                         → $1D9E. */
function smartFloorJunctionMidRight(state: DecodeState, y: number): number {
  const cur = state.zp12 & 0xffff;
  if (
    cur === state.templateAt(SLOT_1D8A) ||
    cur === state.templateAt(SLOT_1D8C) ||
    cur === state.templateAt(SLOT_1D8E) ||
    cur === state.templateAt(SLOT_1DAA)
  ) {
    return DATA_smart_floor_junction_midmid_tiles[y]!;
  }
  if (
    cur === state.templateAt(SLOT_1D9C) ||
    cur === state.templateAt(SLOT_1D9E) ||
    cur === state.templateAt(SLOT_1DA6)
  ) {
    return SKIP_STAMP;
  }
  if (cur === state.templateAt(SLOT_1DAE)) {
    return SLOT_1D9E;
  }
  return DATA_smart_floor_junction_midright_tiles[y]!;
}

/** CODE_smart_floor_junction_botleft ($13:CADF). Bot-left corner.
 *  Default: $1D92.
 *  Overrides:
 *    $12 in {$1D94, $1D96, $1D98} → bot-mid pick (fall-through).
 *    $12 in {$1D90, $1DAC}        → $1DA6 (merge target).
 *    $12 == $1DA2                  → $FFFF (skip).
 *    Otherwise                     → keep default ($1D92). */
function smartFloorJunctionBotLeft(state: DecodeState, y: number): number {
  const cur = state.zp12 & 0xffff;
  if (
    cur === state.templateAt(SLOT_1D94) ||
    cur === state.templateAt(SLOT_1D96) ||
    cur === state.templateAt(SLOT_1D98)
  ) {
    return smartFloorJunctionBotMid(state, y);
  }
  if (cur === state.templateAt(SLOT_1D90) || cur === state.templateAt(SLOT_1DAC)) {
    return SLOT_1DA6;
  }
  if (cur === state.templateAt(SLOT_1DA2)) {
    return SKIP_STAMP;
  }
  return SLOT_1D92;
}

/** CODE_smart_floor_junction_botmid ($13:CB0B). Bottom edge.
 *  Default: DATA_smart_floor_junction_botmid_tiles[Y/2] ($1D94 or $1D96).
 *  Override: $12 == 0 (empty cell) → $1DB0 (floor-bottom shadow tile). */
function smartFloorJunctionBotMid(state: DecodeState, y: number): number {
  const cur = state.zp12 & 0xffff;
  if (cur === 0x0000) return SLOT_1DB0;
  return DATA_smart_floor_junction_botmid_tiles[y]!;
}

/** CODE_smart_floor_junction_botright ($13:CB1D). Mirror of botleft.
 *  Default: $1D98.
 *  Overrides:
 *    $12 in {$1D92, $1D94, $1D96} → bot-mid fall-through.
 *    $12 in {$1D8A, $1DAA}        → $1DA4 (merge target).
 *    $12 == $1DA8                  → $FFFF (skip).
 *    Otherwise                     → keep default ($1D98). */
function smartFloorJunctionBotRight(state: DecodeState, y: number): number {
  const cur = state.zp12 & 0xffff;
  if (
    cur === state.templateAt(SLOT_1D92) ||
    cur === state.templateAt(SLOT_1D94) ||
    cur === state.templateAt(SLOT_1D96)
  ) {
    return smartFloorJunctionBotMid(state, y);
  }
  if (cur === state.templateAt(SLOT_1D8A) || cur === state.templateAt(SLOT_1DAA)) {
    return SLOT_1DA4;
  }
  if (cur === state.templateAt(SLOT_1DA8)) {
    return SKIP_STAMP;
  }
  return SLOT_1D98;
}

// ─────────────────────────────────────────────────────────────────────
// Top-level stamp dispatcher ($13:C9AD)
//
//   row==0     col==0     → topleft       (handler index 0)
//   row==0     col==mid   → topmid        (handler index 1)
//   row==0     col==last  → topright      (handler index 2)
//   row==mid   col==0     → midleft       (handler index 3)
//   row==mid   col==mid   → midmid        (handler index 4)
//   row==mid   col==last  → midright      (handler index 5)
//   row==last  col==0     → botleft       (handler index 6)
//   row==last  col==mid   → botmid        (handler index 7)
//   row==last  col==last  → botright      (handler index 8)
//
// Where "last" is `$2A - 1` for col (`$2E - 1` for row). Single-row /
// single-col objects collapse correctly: e.g. row 0 of a 1-tall object
// is both "first" and "last" — cart resolves "first" first (X=0 stays)
// because the row==last branch only runs when row != 0.
// ─────────────────────────────────────────────────────────────────────

const smartFloorJunctionStamp: PerCellHandler = (state) => {
  // Y picker: (col & 1) for sub-table index (cart uses Y = parity * 2
  // for word-stride into 2-entry tables; we use the parity directly).
  const y = state.zp28 & 0x01;

  // Build X (handler dispatch index 0/3/6 + 0/1/2):
  // row component.
  let handlerIdx: number;
  if ((state.zp2C & 0xff) === 0) {
    handlerIdx = 0;          // row 0
  } else if (((state.zp2C + 1) & 0xff) === (state.zp2E & 0xff)) {
    handlerIdx = 6;          // last row
  } else {
    handlerIdx = 3;          // middle row
  }
  // col component.
  if ((state.zp28 & 0xff) === 0) {
    // first col: add 0
  } else if (((state.zp28 + 1) & 0xff) === (state.zp2A & 0xff)) {
    handlerIdx += 2;         // last col
  } else {
    handlerIdx += 1;         // middle col
  }

  let slotAddr: number;
  switch (handlerIdx) {
    case 0: slotAddr = smartFloorJunctionTopLeft(state); break;
    case 1: slotAddr = smartFloorJunctionTopMid(state); break;
    case 2: slotAddr = smartFloorJunctionTopRight(state); break;
    case 3: slotAddr = smartFloorJunctionMidLeft(state, y); break;
    case 4: slotAddr = smartFloorJunctionMidMid(state, y); break;
    case 5: slotAddr = smartFloorJunctionMidRight(state, y); break;
    case 6: slotAddr = smartFloorJunctionBotLeft(state, y); break;
    case 7: slotAddr = smartFloorJunctionBotMid(state, y); break;
    case 8: slotAddr = smartFloorJunctionBotRight(state, y); break;
    default: return;
  }

  if (slotAddr === SKIP_STAMP) return; // $FFFF → cart's BMI skip
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_smart_floor_junction ($12:9BD5)
// Bare walker trampoline (slope=0, all 3 slots = stamp handler).
// ─────────────────────────────────────────────────────────────────────

function initSmartFloorJunction(state: DecodeState): void {
  walkerSetupTrampoline(state, smartFloorJunctionStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installSmartFloorJunctionHandlers(): void {
  registerStdObjectHandler(0x7A, initSmartFloorJunction);
}
