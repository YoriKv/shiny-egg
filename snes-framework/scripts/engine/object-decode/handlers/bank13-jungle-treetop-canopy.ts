// Standard objects $29 / $2A — init_jungle_treetop_canopy.
//
// Cart entry:        CODE_init_jungle_treetop_canopy @ $12:954F (yi/Banks/Bank12.asm:3330).
// Per-cell handler:  CODE_jungle_treetop_canopy      @ $13:94D0 (yi/Banks/Bank13.asm:2704).
// Data tables:       DATA_12954B   (handler dispatch, Bank12.asm:3326 — both
//                                   entries point at CODE_jungle_treetop_canopy;
//                                   the orientation routing lives in $15 +
//                                   DATA_1394C8 instead)
//                    DATA_1394C8   (4 row-pointers, Bank13.asm:2693)
//                    DATA_139478 / DATA_13948C / DATA_1394A0 / DATA_1394B4
//                                  (per-orient/variant row-of-tiles arrays,
//                                   Bank13.asm:2677-2691 — KS_UP_LT_DT0/DT1,
//                                   KS_UP_RT_DT0/DT1).
//
// Left/right half of a large jungle treetop canopy (leafy foliage with
// hanging vines) used by world-1 jungle levels. Two object IDs share one
// init: bit 1 of the object byte ($15) selects the left ($29) vs right
// ($2A) half (matches JNGL_KS_UP0 / JNGL_KS_UP1 in ys_bgsc1.asm). The
// canopy is built as an ascending tile run — the old "steps up" name
// described that build mechanism, not a staircase visual. The init
// re-encodes $15 to the four-entry DATA_1394C8 space: bit-1 → bit-2
// (ASL), so $15 ends as 0 (std $29) or 4 (std $2A).
//
// Init body (Bank12.asm:3330-3342):
//   REP #$20
//   LDA $15 ; AND #$0002 ; TAY ; ASL ; STA $15  ; orient bit → $15 = 0 or 4
//   STZ $A1                                     ; reset variant accumulator
//   LDA #$0002 ; STA $17                        ; slope = +2 per row
//                                                 (ascending tile run: each
//                                                 column starts 2 nibbles
//                                                 right of the previous, so
//                                                 the walker's rewind sets
//                                                 $9B and the next column
//                                                 stamps "step-up" tiles)
//   LDX #(jungle_treetop_canopy-1)>>16
//   LDA DATA_12954B,Y                           ; handler ptr-1 (Y=0/2 →
//                                                 both → CODE_jungle_treetop_canopy)
//   JMP CODE_walker_setup_keep_slope            ; (does NOT clear $17)
//
// Per-cell handler (Bank13.asm:2704-2745):
//   REP #$30
//   LDA $28 ; AND #$0001 ; STA $00              ; $00 = col-parity (0 or 1)
//   BNE odd_col                                 ; col odd → set $9B=1
//     STZ $9B                                   ; col even → clear $9B
//     LDA $2C ; BNE skip_prng                   ; first row only?
//       JSL prng ; AND #$0002 ; STA $A1         ; new variant bit for this col-pair
//   skip_prng:
//   BRA decide                                  ; (merge)
//   odd_col: LDA #$0001 ; STA $9B
//   decide:
//   LDA $2C ; EOR #$FFFF ; INC                  ; A = -row (2's complement)
//   CMP #$0005 ; BCS row_out_of_range           ; unsigned: only $2C==0 has A < 5
//     ASL ; ADC $00 ; ASL ; TAY                 ; Y = $00 * 2 (since A==0)
//     LDA $A1 ; ORA $15 ; TAX                   ; X = $A1 | $15 → 0/2/4/6
//     LDA DATA_1394C8,X ; STA $00               ; pick one of 4 row pointers
//     LDA ($00),Y                               ; word from pointer + Y
//     BRA store
//   row_out_of_range:
//     LDA #$961B                                ; rows 1..15 stamp $961B
//   store:
//     LDX $1D ; STA buffer,X ; RTL
//
// Spec cross-check (std-29 trace):
//   col=0 row=0: prng=$B0 → $A1 = $B0 & 2 = 0; $15=0 → X=0 → DATA_139478;
//     Y = (0*2 + 0)*2 = 0 → DATA_139478[0] = $9B01.   ✓
//   col=1 row=0: $9B=1 (odd col, no new prng); $A1=0, $15=0 → X=0 →
//     DATA_139478; Y = (0*2 + 1)*2 = 2 → DATA_139478[1] = $9B00.   ✓
//   col=2 row=0 (rewound from col 1, even col → new prng=$68): $A1=0;
//     X=0 → DATA_139478[0]=$9B01.                                  ✓
//   col=N row=1..15: A = $FFFF/$FFFE/... BCS → $961B.               ✓
//
// Spec cross-check (std-2A trace):
//   $15 starts as $2A: bit1 = 1, ASL → $15 = 4. (Spec post-init: $15=04.) ✓
//   col=0 row=0: prng=$B0 → $A1=0; X = 0 | 4 = 4 → DATA_1394A0;
//     Y=0 → DATA_1394A0[0] = $960E.                                ✓
//   col=1 row=0: $A1=0, X=4 → DATA_1394A0; Y=2 → DATA_1394A0[1] = $960F.  ✓
//
// asm primary; goldenegg has no Jungle-Steps symbol — verified via
// resharper search across the ge solution (no hits for JungleSteps /
// JNGL_KS / Staircase / etc.).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell, signed8 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_139478 / DATA_13948C / DATA_1394A0 / DATA_1394B4 (Bank13.asm:2677-2691).
//
// Each is a 10-entry "row-of-tiles" array indexed by `depth*2 + colParity`
// where depth = the cell's distance below the step top (0..4). Entries 0/1 are
// the step lip; 2..9 are the descending interior rows. The canopy is built
// upward, so a column visits depths 0,1,2,3,… and walks the whole array — NOT just the
// first two entries (an earlier note wrongly assumed only row 0 was reached).
//
//   DATA_139478 (KS_UP_LT_DT0): $9B01 $9B00 ... (used when X=0; $15=0, $A1=0)
//   DATA_13948C (KS_UP_LT_DT1): $961D $961C ... (used when X=2; $15=0, $A1=2)
//   DATA_1394A0 (KS_UP_RT_DT0): $960E $960F ... (used when X=4; $15=4, $A1=0)
//   DATA_1394B4 (KS_UP_RT_DT1): $9B02 $9B03 ... (used when X=6; $15=4, $A1=2)
// ─────────────────────────────────────────────────────────────────────

const DATA_139478 = [
  0x9B01, 0x9B00, 0x9639, 0x9638, 0x9629, 0x9628, 0x9631, 0x9630,
  0x961B, 0x9620,
] as const;

const DATA_13948C = [
  0x961D, 0x961C, 0x963D, 0x963C, 0x962D, 0x962C, 0x9635, 0x9634,
  0x961B, 0x9624,
] as const;

const DATA_1394A0 = [
  0x960E, 0x960F, 0x963A, 0x963B, 0x962A, 0x962B, 0x9632, 0x9633,
  0x961B, 0x9623,
] as const;

const DATA_1394B4 = [
  0x9B02, 0x9B03, 0x963E, 0x963F, 0x962E, 0x962F, 0x9636, 0x9637,
  0x961B, 0x9627,
] as const;

// DATA_1394C8 — 4 pointers, indexed by X = $A1 | $15 → 0/2/4/6.
// We replace the pointer indirection with a direct table lookup.
const DATA_1394C8 = [DATA_139478, DATA_13948C, DATA_1394A0, DATA_1394B4] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_treetop_canopy ($13:94D0, Bank13.asm:2704) — per-cell handler.
//
// On a NEW column (even col): clear $9B, and on the FIRST row of that
// column re-roll $A1 from prng (bit 1 only — so $A1 ∈ {0, 2}). On a
// REWOUND column (odd col, after rewind): set $9B=1 and reuse the
// existing $A1.
//
// Row 0 of every column: pick stamp from one of 4 tile arrays via
// X = $A1 | $15 (∈ {0, 2, 4, 6}), Y = $00 * 2 (col-parity * 2).
// Rows 1..15: stamp the fixed body tile $961B (jungle "trunk fill").
// ─────────────────────────────────────────────────────────────────────

const jungleTreetopCanopyStamp: PerCellHandler = (state) => {
  // $00 = col parity (0 = even, 1 = odd).
  const colParity = state.zp28 & 0x0001;
  state.zp00 = colParity;

  if (colParity === 0) {
    // Even col: clear rewound flag; re-roll $A1 on the first row.
    state.rewound = 0;
    if ((state.zp2C & 0xffff) === 0) {
      state.zpA1 = prngNext(state, RNG_SITE.jungleTreetopCanopy) & 0x0002;
    }
  } else {
    // Odd col (post-rewind): mark the walker as rewound; keep $A1.
    state.rewound = 0x0001;
  }

  // Cart: A = -$2C (16-bit two's complement) = the cell's DEPTH below the
  // step top. Jungle treetop canopies are built upward (negative height), so $2C counts the
  // signed-16-bit sequence 0, $FFFF, $FFFE, $FFFD … and `-$2C` = 0, 1, 2, 3.
  // Our walker keeps $2C 8-bit (0, $FF, $FE …) so we must sign-extend it
  // (signed8) before negating — otherwise `-(0x00FF)` = $FF01 ≥ 5 routes every
  // body row to the plain $961B fill, the "inside tiles missing texture" bug.
  // Depth ≥ 5 uses the $961B trunk-fill body; depths 0..4 use the table.
  const negRow = (-signed8(state.zp2C)) & 0xffff;
  if (negRow >= 0x0005) {
    stampCell(state, 0x961B);
    return;
  }

  // Pick stamp from the 4-way table. Cart Y (byte) = ((-row)*2 + $00)*2, so the
  // word index is `negRow*2 + colParity` — depth 0 = the row-0 step lip
  // (entries 0/1), depths 1..4 walk DEEPER into the table (entries 2..9 = the
  // textured staircase-interior tiles $9639/$9629/$9631/… ). Entry 8 of each
  // table is itself $961B, so depth-4 even cols join the body fill naturally.
  const tableIdx = (state.zpA1 | state.zp15) & 0xff;
  const tableSelector = (tableIdx >>> 1) & 0x03; // X = 0/2/4/6 → 0/1/2/3
  const table = DATA_1394C8[tableSelector]!;
  const wordIdx = (negRow * 2 + colParity) & 0xff; // ∈ [0,9] for negRow ∈ [0,4]
  stampCell(state, table[wordIdx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_treetop_canopy ($12:954F, Bank12.asm:3330).
//
// Bit 1 of $15 picks the variant (left- vs right-rising). The init
// re-encodes $15 via ASL so the per-cell handler can OR it with $A1
// directly to form the DATA_1394C8 index.
//
//   $15 = $29 (binary ..101001) → bit1=0 → $15 = 0
//   $15 = $2A (binary ..101010) → bit1=1 → $15 = 4
//
// Slope $17 = +2 per row: each new column rises by 2 nibbles in xy_lo,
// producing the staircase rise. walkerSetupKeepSlope does NOT zero
// $17 (unlike walkerSetupTrampoline), preserving the preset.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x29, 0x2A share this handler.
const initJungleTreetopCanopy: InitHandler = (state) => {
  const variantBit = state.zp15 & 0x0002;
  state.zp15 = (variantBit << 1) & 0xff;   // ASL: bit1 → bit2 (0 or 4)
  state.zpA1 = 0;                          // STZ $A1
  state.zp17 = 0x0002;                     // slope = +2 per row
  walkerSetupKeepSlope(state, jungleTreetopCanopyStamp);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in alongside
// the rest of the jungle family ($21-$2E).
// ─────────────────────────────────────────────────────────────────────

export function installJungleTreetopCanopyHandlers(): void {
  registerStdObjectHandler(0x29, initJungleTreetopCanopy);
  registerStdObjectHandler(0x2A, initJungleTreetopCanopy);
}
