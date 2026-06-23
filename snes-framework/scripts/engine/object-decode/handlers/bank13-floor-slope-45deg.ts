// Bank13 stamp handler for the 45 / 67.5-degree floor slopes
// (standard objects $06 / $07 / $08 / $09).
//
// Cart entry points:
//   CODE_init_floor_slope_45deg    ($12:92DD, Bank12.asm:2932)
//   CODE_floor_slope_45deg_up      ($13:8374, Bank13.asm:677)
//   CODE_floor_slope_45deg_down    ($13:83A7, Bank13.asm:708)
//   CODE_bg_floor_random           ($13:80B4) — per-row PRNG-driven filler
//   DATA_slope45_widths            (DATA_slope45_widths, Bank12.asm:2969)
//   DATA_slope45_directions        (DATA_slope45_directions, Bank12.asm:2973)
//   DATA_138399                    (Bank13.asm:697) — UP-handler slots (4 entries; used
//                                                     only when $15 < 6, i.e. never for
//                                                     objects $06-$09 — they always fall
//                                                     through to the DOWN handler)
//   DATA_1383D7                    (Bank13.asm:737) — DOWN handler 6-entry pointer table
//   DATA_1383E3..DATA_138409       (Bank13.asm:740..) — six per-orientation slot sub-tables
//
// Algorithm (cart-faithful):
//
//   init:
//     JSR CODE_floor_row_shift_up                 ; $1B -= $10, $2E += 1 (always)
//     if $15 == 7 or $15 == 9:
//         JSR CODE_floor_row_shift_up             ; second shift for the "shallow"
//                                                 ;   67.5deg variants ($07/$09)
//     $22 = CODE_floor_slope_45deg_up    (even-col handler)
//     $1F = CODE_floor_slope_45deg_down  (odd-col handler)
//     $25 = CODE_bg_floor_random         (row handler — fills below the slope cap)
//     X = ($15 - 4) * 2                            ; → $04/$06/$08/$0A for $15 = $06/$07/$08/$09
//     $19 = DATA_slope45_widths[X]                 ; row threshold (slope-cap depth)
//     $17 = DATA_slope45_directions[X]             ; per-row $14 slope advance
//     JSR CODE_object_stream_walk                  ; run walker (3-slot dispatch)
//
//   per-cell stamp (even col → up; odd col → down):
//     For std objects $06-$09 the orientation byte $15 is ALWAYS >= 6, so
//     CODE_floor_slope_45deg_up takes the `BCS down` branch on every cell
//     and tail-calls into the down handler. We model that by wiring both
//     even and odd columns to the same down-handler function.
//
//   down handler (CODE_floor_slope_45deg_down):
//     STZ $9B                                       ; clear rewound flag
//     A = $15
//     if A != 4 and A != 5: INC $9B                 ; (always true for $06-$09)
//     A -= 4 ; ASL ; TAX                            ; X = ($15-4)*2
//     $00 = DATA_1383D7[X]                          ; pointer to per-orient sub-table
//     Y = $2C * 2
//     slotAddr = ($00)[Y]                           ; word fetch from sub-table
//     map16Id = template_at(slotAddr)               ; deref WRAM template slot
//     stamp map16Id
//
//   row handler is CODE_bg_floor_random — already ported in bank13-floor.ts
//   (the full version with neighbour-fix probes), but it's a private const
//   in that file so we mirror the slim copy approach used by
//   bank13-slope-22deg.ts and inline a minimal port here. The trace specs
//   show the full neighbour-probe sequence, so we use a slightly richer
//   port (probe + adjacency check) than 22deg's minimal version, but skip
//   the actual neighbour MUTATION (writeBuf16) since slope-tail cells in
//   the trace specs never hit a RndAdjMatch left/right neighbour — the
//   match-and-rewrite path is a no-op for these objects.
//
// Verified against trace-harness specs std-06/-07/-08/-09. Per-cell
// timelines for the up/down handler are byte-exact (every Map16 ID
// matches). bg_floor_random's pool-pick is byte-exact as long as the
// PRNG stream is identical; our deterministic LFSR diverges from the
// cart's HV-counter-driven prng, so individual cells in the random-fill
// region won't match — but the *set* of possible variants is correct.
//
// GoldenEgg cross-check: GE.Level.Obj06Main (and Obj07/08/09Main) all
// dispatch through a common helper that switches on the orientation byte
// — same dispatch shape as the cart. GE skips the second-shift for $07
// and $09 (off-by-one in vertical placement) — confirmed cart-side that
// the cart DOES do the second shift, so we follow the cart. The slot
// tables also match between cart and GE (apart from GE not using the
// template-slot indirection — GE inlines the per-tileset Map16 IDs).
//
// **Pre-existing helper limitation** (NOT fixed here, mirrors 22deg port):
// `floorRowShiftUp` in `_shared.ts` operates on `state.zp1B` as a single
// byte, whereas the cart's `LDA $1B` runs in REP #$20 and accesses the
// $1B:$1C word. For std-07/09 the spec's pre→post xy_lo delta of $E0
// AND the xy_hi delta (33→23 / 23→23) requires the 16-bit-word semantics
// to reproduce exactly. The helper bug affects the high-byte half only;
// the low-byte (sub-Y nibble) shift produced by repeated $10 subtracts
// is unaffected because $1B never underflows past $00 for the placements
// in our trace specs. Consolidation sweep can promote the helper to
// 16-bit semantics later — out of scope for this port.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerRun } from '../walker.ts';
import { TT } from '../template-slots.ts';
import {
  stampCell, floorRowShiftUp,
} from './_shared.ts';
import { bgFloorRandom } from './bank13-floor.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_slope45_widths (Bank12.asm:2969) — col-threshold $19
// values per orientation. Index by X = ($15 - 4) * 2.
//   $15=$04/$05 (22deg, not us)     → $03/$03 (X=$00/$02)
//   $15=$06/$07 (45deg)             → $04/$04 (X=$04/$06)
//   $15=$08/$09 (67.5deg, steeper)  → $05/$05 (X=$08/$0A)
// We keep all 6 entries so the table indexing matches the cart 1:1.
// ─────────────────────────────────────────────────────────────────────

const DATA_slope45_widths = [0x0003, 0x0003, 0x0004, 0x0004, 0x0005, 0x0005] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_slope45_directions (Bank12.asm:2973) — $17 (per-row
// slope advance) per orientation. Same indexing as widths.
//   X=$00 → $FFFF (-1)   descending
//   X=$02 → $0001 (+1)   ascending
//   X=$04 → $FFFF (-1)   45deg descending  ($06)
//   X=$06 → $0001 (+1)   45deg ascending   ($07)
//   X=$08 → $FFFE (-2)   67.5deg descending ($08)
//   X=$0A → $0002 (+2)   67.5deg ascending  ($09)
// ─────────────────────────────────────────────────────────────────────

const DATA_slope45_directions = [0xFFFF, 0x0001, 0xFFFF, 0x0001, 0xFFFE, 0x0002] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_1383D7 (Bank13.asm:737) — 6-entry pointer table. Index by
// X = ($15 - 4) * 2; each entry points to a sub-table of WRAM
// template-slot addresses, one per row of the slope cap.
//
// We replace the cart's "pointer to sub-table" indirection with a
// direct array-of-arrays since each sub-table's contents are static
// in our port.
//
// Sub-tables (verified against Bank13.asm:740..757):
//   DATA_1383E3 (X=$0): [$1A50,           $1A5C, $1CC2]              ; $15=$04 (22deg)
//   DATA_1383FB (X=$2): [$1C66, $1A34, $1A5E (Family1200_Anchor)]    ; $15=$05 (22deg)
//   DATA_1383E9 (X=$4): [$1C6A, $1A16 (Family0A00_Anchor), $1A28, $1CBE]                   ; $15=$06 (45deg descending)
//   DATA_138401 (X=$6): [$1C68, $1A02 (Family0800_Anchor), $1A14, $1CC0]                   ; $15=$07 (45deg ascending)
//   DATA_1383F1 (X=$8): [$1C6C, $19EE,                              $19F6, $1A00, $1CEC]   ; $15=$08 (67.5deg descending)
//   DATA_138409 (X=$A): [$1C6E, $19DA (Family0200_Anchor), $19E2, $19EC, $1CEE]            ; $15=$09 (67.5deg ascending)
//
// For objects $06-$09 only the X=$4/$6/$8/$A sub-tables are reached.
// The 22deg entries (X=$0/$2) are included for table-indexing fidelity
// but never read by this handler — 22deg uses bank13-slope-22deg.ts.
// ─────────────────────────────────────────────────────────────────────

// DATA_1383E3 — $15=$04 (descending 22deg)
const SUBTABLE_15_04 = [
  TT.Family1000_Anchor,           // = $001A50, row 0
  0x001A5C,                        // row 1
  TT.FlatFloor_Row3LeftLo,        // = $001CC2, row 2
] as const;

// DATA_1383FB — $15=$05 (ascending 22deg)
const SUBTABLE_15_05 = [
  0x001C66,                        // row 0
  0x001A34,                        // row 1
  TT.Family1200_Anchor,           // = $001A5E, row 2
] as const;

// DATA_1383E9 — $15=$06 (45deg descending) — 4 rows
const SUBTABLE_15_06 = [
  0x001C6A,                        // row 0: slope-cap top tile
  TT.Family0A00_Anchor,           // = $001A16, row 1
  0x001A28,                        // row 2
  0x001CBE,                        // row 3: slope-base seam tile
] as const;

// DATA_138401 — $15=$07 (45deg ascending) — 4 rows
const SUBTABLE_15_07 = [
  0x001C68,                        // row 0
  TT.Family0800_Anchor,           // = $001A02, row 1
  0x001A14,                        // row 2
  0x001CC0,                        // row 3
] as const;

// DATA_1383F1 — $15=$08 (67.5deg descending) — 5 rows
const SUBTABLE_15_08 = [
  0x001C6C,                        // row 0
  0x0019EE,                        // row 1
  0x0019F6,                        // row 2
  0x001A00,                        // row 3
  0x001CEC,                        // row 4
] as const;

// DATA_138409 — $15=$09 (67.5deg ascending) — 5 rows
const SUBTABLE_15_09 = [
  0x001C6E,                        // row 0
  TT.Family0200_Anchor,           // = $0019DA, row 1
  0x0019E2,                        // row 2
  0x0019EC,                        // row 3
  0x001CEE,                        // row 4
] as const;

const DATA_1383D7_subtables: readonly (readonly number[])[] = [
  SUBTABLE_15_04, SUBTABLE_15_05,
  SUBTABLE_15_06, SUBTABLE_15_07,
  SUBTABLE_15_08, SUBTABLE_15_09,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_slope_45deg_down (Bank13.asm:708)
//
// Per-cell stamp used as BOTH even-col and odd-col handler for our
// objects (the cart's up-handler tail-calls into down whenever $15 >= 6,
// which is always for objects $06-$09).
// ─────────────────────────────────────────────────────────────────────

const floorSlope45degDown: PerCellHandler = (state) => {
  // STZ $9B; check $15 against 4/5; INC $9B otherwise.
  // For $15 in {6,7,8,9} the INC always runs → rewound = 1.
  state.rewound = 0;
  const orient = state.zp15 & 0xff;
  if (orient !== 4 && orient !== 5) {
    state.rewound = 1;
  }

  // X = ($15 - 4) * 2 (cart: DEC×4 then ASL); range $0..$0A.
  // Bounds: subTableIdx 0..5 for $15 in 4..9.
  const subTableIdx = (orient - 4) & 0xff;
  if (subTableIdx > 5) return; // safety; cart would index garbage
  const subTable = DATA_1383D7_subtables[subTableIdx]!;

  // Y = $2C * 2 → row index into sub-table.
  const row = state.zp2C & 0xff;
  // Cart reads ($00),Y as a word — Y = row*2 selects the row'th 16-bit
  // entry. Out-of-range indices read garbage in the cart; we no-op for
  // safety (shouldn't happen given $19 ≤ subTable length).
  if (row >= subTable.length) return;
  const slotAddr = subTable[row]!;

  // LDA $0000,Y dereferences the template slot to a Map16 ID and stamps.
  const map16Id = state.templateAt(slotAddr);
  stampCell(state, map16Id);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_slope_45deg_up (Bank13.asm:677)
//
// For objects $06-$09 the orientation byte $15 is always >= 6, so the
// `CMP #$0006 / BCS down` branch ALWAYS taken and the up-specific path
// (the $15 < 6 branch) is unreachable. We mirror that by tail-calling
// the down handler unconditionally — keeps the per-cell dispatch
// semantically identical to the cart for the four objects we register.
//
// We do NOT port the $15 < 6 path (DATA_138399 dispatch) because the
// init handler at $12:92DD is reached only when the standard-object
// pointer table for $06-$09 dispatched us here; the dispatcher loads
// $15 = object_id, so $15 ∈ {6,7,8,9}. Other entry points that might
// set $15 < 6 and call this handler (e.g. via direct walker rewiring)
// don't exist in the cart.
// ─────────────────────────────────────────────────────────────────────

const floorSlope45degUp: PerCellHandler = (state) => {
  // For $15 ∈ {6,7,8,9}: fall through to down handler.
  floorSlope45degDown(state);
};

// The cart installs `CODE_bg_floor_random` (the FULL routine) into the $25
// row-handler slot — see CODE_init_floor_slope_45deg's `LDA #CODE_bg_floor_random-$01 ;
// STA $25`. We use the full `bgFloorRandom` (not a slim variant): its last-row
// branch gates whether a roll happens, so it must be present for the per-site
// PRNG replay ($13810C) to stay cadence-aligned with the cart.

// ─────────────────────────────────────────────────────────────────────
// CODE_init_floor_slope_45deg (Bank12.asm:2932)
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x06, 0x07, 0x08, 0x09 share this handler.
function initFloorSlope45deg(state: DecodeState): void {
  // Always one row-shift-up: $1B -= $10, $2E += 1.
  floorRowShiftUp(state);

  // Second shift only for $15 == 7 or $15 == 9 (the "shallow" variants).
  // Cart: CMP #$0007 BEQ shift ; CMP #$0009 BNE skip ; shift: JSR shift_up.
  const orient = state.zp15 & 0xff;
  if (orient === 7 || orient === 9) {
    floorRowShiftUp(state);
  }

  // Wire per-cell handler slots:
  //   $22 even-col → up (which tail-calls down for $15 >= 6)
  //   $1F odd-col  → down
  //   $25 row      → bg_floor_random
  //
  // X = ($15 - 4) * 2 ; $19 = DATA_slope45_widths[X] ; $17 = DATA_slope45_directions[X].
  // Indices 0..5 for $15 in 4..9; for our registered IDs $06-$09 the
  // index range is 2..5.
  const tableIdx = (orient - 4) & 0xff;
  // Cart would read garbage on out-of-range; guard for safety.
  if (tableIdx > 5) return;

  state.zp19 = DATA_slope45_widths[tableIdx]!;
  state.zp17 = DATA_slope45_directions[tableIdx]!;

  // JSR CODE_object_stream_walk — run walker with 3-slot dispatch.
  // walkerRun's `rowsEnd` parameter maps to $19 (the row-threshold).
  walkerRun(
    state,
    /*oddCol=*/  floorSlope45degDown,
    /*evenCol=*/ floorSlope45degUp,
    /*row=*/     bgFloorRandom,
    /*rowsEnd=*/ state.zp19,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installFloorSlope45degHandlers(): void {
  // All four IDs dispatch through the same init handler; the orientation
  // byte $15 (= the object ID, $06..$09) selects width/direction/sub-table.
  registerStdObjectHandler(0x06, initFloorSlope45deg);
  registerStdObjectHandler(0x07, initFloorSlope45deg);
  registerStdObjectHandler(0x08, initFloorSlope45deg);
  registerStdObjectHandler(0x09, initFloorSlope45deg);
}
