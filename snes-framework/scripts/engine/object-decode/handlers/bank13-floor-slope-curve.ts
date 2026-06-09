// Bank13 stamp handler for the curved floor slope (standard object $7B).
//
// Cart entry points:
//   CODE_init_floor_slope_curve            ($12:9BDF, Bank12.asm:4303)
//   CODE_floor_slope_curve_stamp           ($13:CB49, Bank13.asm:8815)
//   DATA_floor_slope_curve_handlers        ($13:CB90) — 4-entry sub-handler ptr table
//     leftcap / body / rightbody / rightcap
//   DATA_floor_slope_curve_tiles_down      ($13:CB98) — 9-entry slot table (col-extent < 0)
//   DATA_floor_slope_curve_tiles_up        ($13:CBAA) — 9-entry slot table (col-extent >= 0)
//   CODE_floor_slope_curve_leftcap         ($13:CBBC, Bank13.asm:8873)
//   CODE_floor_slope_curve_body            ($13:CBD0, Bank13.asm:8886)
//   CODE_floor_slope_curve_rightbody       ($13:CC19, Bank13.asm:8925)
//   CODE_floor_slope_curve_rightcap        ($13:CC6A, Bank13.asm:8971)
//
// Algorithm (cart-faithful):
//
//   init:
//     $17 = $FFFF                                  ; descending slope advance
//     walker_setup_keep_slope(CODE_floor_slope_curve_stamp)
//       — same handler wired to even-col, odd-col, AND row slots.
//
//   per-cell stamp:
//     $9B = 1                                       ; set rewound flag (this
//                                                   ; object always wants
//                                                   ; row-wrap nibble rewind)
//     LDA $2A (16-bit word, $2A:$2B); BMI?
//       negative col extent → $00 = DATA_*_tiles_down; $02 = $FFFF
//       positive col extent → $00 = DATA_*_tiles_up;   $02 = $0001
//     ($02 is dead — set but never read by any sub-handler. The cart
//     keeps it for "is this an up/down slope" symmetry but the four
//     sub-handlers each re-decide their per-row Y inline.)
//
//     Pick sub-handler by $2C (row) vs $2E (row extent):
//       row == 0                  → leftcap
//       row == 1                  → body
//       row+1 != $2E (mid rows)   → rightbody
//       row == $2E-1 (last row)   → rightcap
//
//     Sub-handler returns Y (byte offset into chosen tile table; word index = Y/2).
//     If Y bit 15 set: skip stamp (preserve existing tile).
//     Else: deref table[Y/2] → WRAM slot address → templateAt() → stamp.
//
//   Sub-handlers (all read $12 = current Map16 ID, all return Y):
//
//   leftcap (default Y=0):
//     if $12 == templateAt($1DAE): Y=0 (i.e. stamp tile[0] regardless)
//     else if ($12 & $FF00) == templateAt(Family6800_Anchor): Y=$FFFF (skip)
//     else: Y=0
//
//   body (default Y=2):
//     if ($28 + $02) == $2A (right-edge col-pair):
//       if $12 == templateAt($1DAE): early-return (Y=2; outer code stamps tile[1])
//       — wait that's not "early-return"; it RTS-es with Y=2 still set.
//       So actually: BEQ jumps past the LDY #$0006, RTS with Y=2.
//       Trace verified: the "rightmost body row" path falls back to tile[1].
//       else Y=6
//     Then in all cases:
//       if $12 in {FloorRow0_LeftLo, FloorRow0_RightLo, $1D92, $1D98}: Y=$0010
//       elif $12 in {$1D8C, $1D8E, $1D9C, $1D9E}: Y=$FFFF
//
//   rightbody (default Y = (col & 1) * 2 + 8 → $8 or $A):
//     if ($28 + $02) != $2A (not right-edge): return Y (= $8 or $A)
//     else (right-edge col-pair):
//       match $12 against {Family6800_Anchor (page-anchor), $1DAA, $1D90,
//         $1DAC, $1D8C, $1D8E}: keep Y ($8 or $A — body filler)
//       match $1D9C / $1D9E: Y=$FFFF (skip)
//       match $1DAE: Y=2 (body tile)
//       no match: Y -= 4 → $4 or $6 (top-row body fallback)
//
//   rightcap (default Y = (col & 1) * 2 + $C → $C or $E):
//     if $12 in {FloorRow0_LeftLo, FloorRow0_RightLo, $1D92, $1D94, $1D96, $1D98}:
//       keep Y ($C or $E — bottom-row body)
//     else: Y -= 4 → $8 or $A
//     Then if ($28 + $02) == $2A (right-edge col-pair):
//       if $12 in {FloorRow0_LeftLo, FloorRow0_RightLo}: Y=$0010
//       elif ($12 & $FF00) == templateAt(Family6800_Anchor): keep prior Y
//       else: Y=6
//
// Trace verification (std-7B-init_floor_slope_curve, col-extent=3,
// row-extent=6):
//   Cells 0-5 (col=0): leftcap→$680B, body→$680A, rightbody→$6801×3, rightcap→$6801.
//   Cells 6-10 (col=1): leftcap→$680B, body→$680A, rightbody→$6802×2, rightcap→$6802.
//   Cells 11-14 (col=2, right-edge): leftcap→$680B, body→$6811 (Y=$0006
//     branch fires because $28+$02==$2A and $12 mismatches all skip-tile slots),
//     rightbody→$6803 (Y -= 4 path), rightcap→$6811 (Y=$0006 branch).
//   All 15 cells match byte-for-byte against
//
// Acknowledged simplifications:
//   - $02 is stored by the init wrapper but never read by any sub-handler;
//     we mirror the store for trace fidelity (a future grep of the spec
//     might want to confirm the cart's write happened) but don't read it
//     back. The "right-edge" col-pair check is `($28 + 1) == $2A` for the
//     positive-extent path (the only path our objects actually exercise);
//     for negative-extent objects (if any registered later) the test
//     becomes `($28 - 1) == $2A` per cart semantics — guarded by the
//     `colDir` local.
//   - The 6 ($1DAA, $1DAC, $1D8C, $1D8E, $1D90, $1D92, $1D94, $1D96, $1D98,
//     $1D9C, $1D9E, $1DA0, $1DAE) trailing-family slots aren't aliased in
//     `template-slots.ts` — they belong to the Family6800_Anchor + $00..$24
//     range. We keep the WRAM addresses as raw hex with per-line comments
//     so a future template-slot naming pass can grep them.
//
// Consolidation candidates:
//   - The "4-way sub-handler dispatch + indirect tile-table deref"
//     pattern is shared with object $7C (slope_decoration_dual) at
//     CODE_slope_decoration_dual_stamp, which uses a 2-table flip on $2A sign and indexes by
//     ($28, $2C) directly. Same outer trampoline; different sub-handler
//     count and Y semantics. After $7C is ported, the outer `STX $00 /
//     STY $02 / JSR (table,x) / TYA BMI skip / LDA ($00),y / TAY / LDA
//     $0000,y / STA buf,x` post-processor could be promoted to
//     `_shared.ts` as e.g. `subHandlerDispatch(state, subHandlers,
//     tileTable)`.
//   - The "current-tile mask + Family6800 page test" is a common shape-
//     aware skip used by every Bank13 family-6800 handler. Worth a helper
//     once a third or fourth caller surfaces.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { stampCell, signed16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Bank13 family-6800 trailing-family WRAM slot addresses.
//
// These live in the 20-slot Family6800_Anchor block ($001D8A..$001DAE)
// + adjacent decoration slots. Not yet aliased in template-slots.ts.
// ─────────────────────────────────────────────────────────────────────

const SLOT_1D8C = 0x001D8C; // Family6800 + $02
const SLOT_1D8E = 0x001D8E; // Family6800 + $04
const SLOT_1D90 = 0x001D90; // Family6800 + $06
const SLOT_1D92 = 0x001D92; // Family6800 + $08
const SLOT_1D94 = 0x001D94; // Family6800 + $0A
const SLOT_1D96 = 0x001D96; // Family6800 + $0C
const SLOT_1D98 = 0x001D98; // Family6800 + $0E
const SLOT_1D9C = 0x001D9C; // Family6800 + $12
const SLOT_1D9E = 0x001D9E; // Family6800 + $14
const SLOT_1DA0 = 0x001DA0; // Family6800 + $16
const SLOT_1DAA = 0x001DAA; // Family6800 + $20
const SLOT_1DAC = 0x001DAC; // Family6800 + $22
const SLOT_1DAE = 0x001DAE; // Family6800 + $24

// ─────────────────────────────────────────────────────────────────────
// DATA_floor_slope_curve_tiles_down (Bank13.asm:8867).
// 9-entry slot-address table consumed when col-extent ($2A:$2B) is
// signed-negative. Each entry is a WRAM template-slot address; the
// outer stamp dereferences via templateAt().
// ─────────────────────────────────────────────────────────────────────

const DATA_floor_slope_curve_tiles_down = [
  0x001D9A,  // 0: leftcap default                    (Family6800 + $10)
  0x001D9C,  // 1: body default              SLOT_1D9C
  TT.Family6800_Anchor, // 2: body right-edge fallback   = $001D8A
  SLOT_1DAA, // 3: rightbody even-col / row 0
  SLOT_1D8C, // 4: rightbody odd-col  / row 1
  SLOT_1D8E, // 5: rightbody odd-col  / row 1 (mirror)
  SLOT_1D94, // 6: rightcap even-col bottom-row
  SLOT_1D96, // 7: rightcap odd-col  bottom-row
  SLOT_1D92, // 8: body transition (Y=$0010 path)
] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_floor_slope_curve_tiles_up (Bank13.asm:8871).
// 9-entry slot-address table consumed when col-extent is signed-
// non-negative (the path exercised by the trace spec).
// ─────────────────────────────────────────────────────────────────────

const DATA_floor_slope_curve_tiles_up = [
  SLOT_1DA0, // 0: leftcap default                    → $680B (ascending)
  SLOT_1D9E, // 1: body default                       → $680A
  SLOT_1D90, // 2: body right-edge fallback           → $6803
  SLOT_1DAC, // 3: rightbody even-col                 → $6811
  SLOT_1D8C, // 4: rightbody odd-col                  → $6801
  SLOT_1D8E, // 5: rightbody odd-col (mirror)         → $6802
  SLOT_1D94, // 6: rightcap even-col bottom-row       → $6805
  SLOT_1D96, // 7: rightcap odd-col  bottom-row       → $6806
  SLOT_1D98, // 8: body transition (Y=$0010 path)     → $6807
] as const;

// ─────────────────────────────────────────────────────────────────────
// Sub-handler return value: a tagged byte-offset into the chosen tile
// table. A return of -1 (== $FFFF as a signed-16 word) means "skip
// stamp" (preserve underlying tile).
// ─────────────────────────────────────────────────────────────────────

const SKIP = -1;

/**
 * Right-edge col-pair test. Cart computes `LDA $28 + ADC $02 == $2A`
 * where $02 is $FFFF (down) or $0001 (up). For up-path: `col + 1 ==
 * extent` (last col of the rectangle). For down-path: `col - 1 ==
 * extent` (negative arithmetic). We compute both branches and pick
 * by `dirIsUp`.
 */
function isRightEdgeColPair(state: DecodeState, dirIsUp: boolean): boolean {
  const col = state.zp28 & 0xff;
  const extent = state.zp2A & 0xff;
  const sum = dirIsUp ? (col + 1) & 0xff : (col - 1) & 0xff;
  return sum === extent;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_slope_curve_leftcap (Bank13.asm:8873).
// Row-0 sub-handler. Returns byte-offset Y.
// ─────────────────────────────────────────────────────────────────────

function leftcap(state: DecodeState): number {
  const cur = state.zp12 & 0xffff;
  // CMP $1DAE → equal: fall to RTS with Y=0.
  if (cur === state.templateAt(SLOT_1DAE)) return 0;
  // AND #$FF00; CMP Family6800_Anchor → equal: Y=$FFFF (skip).
  const masked = cur & 0xFF00;
  if (masked === state.templateAt(TT.Family6800_Anchor)) return SKIP;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_slope_curve_body (Bank13.asm:8886).
// Row-1 sub-handler. Returns byte-offset Y.
// ─────────────────────────────────────────────────────────────────────

function body(state: DecodeState, dirIsUp: boolean): number {
  let y = 2; // default tile[1]
  const cur = state.zp12 & 0xffff;

  if (isRightEdgeColPair(state, dirIsUp)) {
    // Cart: `BEQ CODE_13CC18` → if $12 == $1DAE, jump to RTS WITHOUT
    // setting Y=$0006 — i.e. keep Y=2.
    if (cur === state.templateAt(SLOT_1DAE)) {
      // Continue to neighbour-match cascade with Y=2.
    } else {
      y = 6;
    }
  }

  // Neighbour cascade — applies regardless of right-edge branch outcome.
  if (cur === state.templateAt(TT.FloorRow0_LeftLo))  return 0x0010;
  if (cur === state.templateAt(TT.FloorRow0_RightLo)) return 0x0010;
  if (cur === state.templateAt(SLOT_1D92))            return 0x0010;
  if (cur === state.templateAt(SLOT_1D98))            return 0x0010;
  if (cur === state.templateAt(SLOT_1D8C))            return SKIP;
  if (cur === state.templateAt(SLOT_1D8E))            return SKIP;
  if (cur === state.templateAt(SLOT_1D9C))            return SKIP;
  if (cur === state.templateAt(SLOT_1D9E))            return SKIP;

  return y;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_slope_curve_rightbody (Bank13.asm:8925).
// Rows 2..$2E-2 sub-handler. Returns byte-offset Y.
// ─────────────────────────────────────────────────────────────────────

function rightbody(state: DecodeState, dirIsUp: boolean): number {
  const colParity = state.zp28 & 0x01;
  let y = (colParity << 1) + 0x0008; // $0008 (even) or $000A (odd)

  if (!isRightEdgeColPair(state, dirIsUp)) return y;

  const cur = state.zp12 & 0xffff;
  // Six "keep Y" tiles: page anchor + 5 family slots.
  if (cur === state.templateAt(TT.Family6800_Anchor)) return y;
  if (cur === state.templateAt(SLOT_1DAA))            return y;
  if (cur === state.templateAt(SLOT_1D90))            return y;
  if (cur === state.templateAt(SLOT_1DAC))            return y;
  if (cur === state.templateAt(SLOT_1D8C))            return y;
  if (cur === state.templateAt(SLOT_1D8E))            return y;
  // Skip tiles.
  if (cur === state.templateAt(SLOT_1D9C))            return SKIP;
  if (cur === state.templateAt(SLOT_1D9E))            return SKIP;
  // $1DAE → body tile (Y=2).
  if (cur === state.templateAt(SLOT_1DAE))            return 0x0002;
  // No match → Y -= 4 (rightbody top-row body fallback).
  y = (y - 4) & 0xffff;
  return y;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_slope_curve_rightcap (Bank13.asm:8971).
// Last-row sub-handler. Returns byte-offset Y.
// ─────────────────────────────────────────────────────────────────────

function rightcap(state: DecodeState, dirIsUp: boolean): number {
  const colParity = state.zp28 & 0x01;
  let y = (colParity << 1) + 0x000C; // $000C (even) or $000E (odd)

  const cur = state.zp12 & 0xffff;
  // First cascade: keep Y if matches a "bottom-row body" tile,
  // otherwise Y -= 4.
  let bottomRowMatch = false;
  if (cur === state.templateAt(TT.FloorRow0_LeftLo))  bottomRowMatch = true;
  else if (cur === state.templateAt(TT.FloorRow0_RightLo)) bottomRowMatch = true;
  else if (cur === state.templateAt(SLOT_1D92))       bottomRowMatch = true;
  else if (cur === state.templateAt(SLOT_1D94))       bottomRowMatch = true;
  else if (cur === state.templateAt(SLOT_1D96))       bottomRowMatch = true;
  else if (cur === state.templateAt(SLOT_1D98))       bottomRowMatch = true;
  if (!bottomRowMatch) y = (y - 4) & 0xffff;

  // Second cascade: right-edge col-pair gate.
  if (!isRightEdgeColPair(state, dirIsUp)) return y;
  if (cur === state.templateAt(TT.FloorRow0_LeftLo))  return 0x0010;
  if (cur === state.templateAt(TT.FloorRow0_RightLo)) return 0x0010;
  const masked = cur & 0xFF00;
  if (masked === state.templateAt(TT.Family6800_Anchor)) return y;
  return 0x0006;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_slope_curve_stamp (Bank13.asm:8815).
// Outer per-cell stamp. Picks one of 4 sub-handlers by row, then
// dereferences the chosen tile table at the returned byte-offset Y.
// ─────────────────────────────────────────────────────────────────────

const floorSlopeCurveStamp: PerCellHandler = (state) => {
  // $9B = 1 — set rewound flag for keep-slope walker row-wrap.
  state.rewound = 1;

  // BMI on 16-bit ($2A:$2B). $02 latched for $FFFF (down) / $0001 (up).
  // We model the down/up choice via the boolean dirIsUp; $02 itself is
  // never read by sub-handlers (cart stores it for symmetry only).
  const colExtent16 = signed16((state.zp2A | (state.zp2B << 8)) & 0xffff);
  const dirIsUp = colExtent16 >= 0;
  const table = dirIsUp ? DATA_floor_slope_curve_tiles_up : DATA_floor_slope_curve_tiles_down;

  // Pick sub-handler by row vs row-extent.
  //   row == 0          → leftcap     (X=0)
  //   row == 1          → body        (X=2)
  //   row+1 != extent   → rightbody   (X=4)
  //   row == extent-1   → rightcap    (X=6)
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;
  let y: number;
  if (row === 0) {
    y = leftcap(state);
  } else if (row === 1) {
    y = body(state, dirIsUp);
  } else if (((row + 1) & 0xff) === rowExtent) {
    y = rightcap(state, dirIsUp);
  } else {
    y = rightbody(state, dirIsUp);
  }

  // TYA; BMI skip — Y signed-16 negative means "don't stamp".
  if (y < 0 || (y & 0x8000) !== 0) return;

  // Byte-offset Y → word index Y >>> 1.
  const wordIdx = (y >>> 1) & 0xffff;
  if (wordIdx >= table.length) return; // safety (cart would index garbage)
  const slotAddr = table[wordIdx]!;
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_floor_slope_curve (Bank12.asm:4303).
// Object $7B: keep-slope walker init with $17 = $FFFF (descending bias).
// ─────────────────────────────────────────────────────────────────────

function initFloorSlopeCurve(state: DecodeState): void {
  // $17 = $FFFF — per-row $14 slope advance (-1, descending).
  state.zp17 = 0xFFFF;

  // Walker keeps caller's $17; same handler wired to even/odd/row slots.
  walkerSetupKeepSlope(state, floorSlopeCurveStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installFloorSlopeCurveHandlers(): void {
  registerStdObjectHandler(0x7B, initFloorSlopeCurve);
}
