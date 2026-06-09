// Bank13 stamp handler for the grass-floor 60-degree DOWN-going slope
// with hole (standard object $3B).
//
// Cart entry points:
//   CODE_init_grass_slope_down_60deg_hole  ($12:964A, Bank12.asm:3483)
//   CODE_grass_slope_down_60deg_hole       ($13:9FE7, Bank13.asm:4259)
//   DATA_139FE3                            (Bank13.asm:4248) — 2-entry slope-cap slot table
//
// Asm friendly notes (from Bank13.asm:4252):
//   "kusa-ana-uru-down-60" — matches KUSAANAURD60 in ys_bgsc1.asm.
//   Mirror of CODE_grass_slope_up_60deg_hole ($3A) but the stamp INCs $2E
//   instead of DECing it on column entry — i.e. each new column pushes
//   the slope-cap two rows further DOWN, carving a downward-stepping hole.
//
// Algorithm (cart-faithful):
//
//   init (CODE_init_grass_slope_down_60deg_hole, Bank12.asm:3483):
//     // Pre-collapse the row extent so the walker doesn't run away
//     // before the stamp's per-column $2E grow can drive the geometry.
//     $00 = $2A << 1                  ; 2 * col_extent
//     A   = $2E - $00                 ; row_extent - 2*col_extent (SEC; SBC)
//     if A <= 0:  $2E = $0001         ; (BEQ → set 1; BMI fallthrough → set 1)
//     else:       $2E = A             ; (BPL → store A)
//     walker_setup_keep_slope(CODE_grass_slope_down_60deg_hole)
//
//   per-cell stamp (CODE_grass_slope_down_60deg_hole):
//     if $28 != 0 and $2C == 0:
//         $2E += 2                    ; each new column extends slope by 2 rows
//     A = $2E - $2C - 1               ; cart: LDA $2E ; CLC ; SBC $2C
//                                     ; (CLC + SBC = subtract one extra — the
//                                     ;  "no SEC" is deliberate; it makes
//                                     ;  A==0 fire on the bottom row and
//                                     ;  A==1 fire on the row above)
//     if A == 0:   stamp template_at($1DEC)   ; bottom row of slope-cap
//     elif A == 1: stamp template_at($1DE8)   ; row above bottom of slope-cap
//     else:        CODE_floor_random_8way_pick ; random grass body
//
// The "INC $2E" per-column is the geometry trick that makes this object
// look like a downward-stepping hole: column 0 stamps just 1 cell (the
// slope cap), column 1 stamps 3 cells, column 2 stamps 5, etc. Combined
// with the init's clamp, the walker never overruns the available row
// extent before the stamp manages the growth.
//
// Trace verification: std-3B spec
//   (16 cols × variable rows = 256 cells). Slope-cap stamps ($A000 from
//   slot_1DEC; $9F00 from slot_1DE8) are byte-exact on every cell that
//   takes the slope_pick branch. Random-grass body cells go through
//   floor_random_8way_pick (PRNG-driven): the variant *pool* matches the
//   cart but individual picks won't byte-match (our deterministic LFSR
//   diverges from the cart's HV-counter-driven prng — same caveat as
//   bank13-floor.ts / bank13-slope-45deg.ts).
//
// Consolidation opportunity (NOT done in this PR; see report): the $3A
// (up variant) handler in sibling `bank13-grass-slope-up-60deg-hole.ts`
// has the same shape — only differences are (1) init: $3A is a plain
// walker_setup_keep_slope with no pre-clamp; (2) stamp: $3A DECs $2E
// (with floor-clamp at 1) where $3B INCs $2E; (3) the slope-cap slot
// table is different ($1DF4/$1DF0 vs $1DEC/$1DE8). A `grassSlope60Hole`
// helper parameterised on { slotTable, direction: 'up'|'down' } would
// cut roughly half this file.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { stampCell, floorRandom8wayPick } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_139FE3 (Bank13.asm:4248). 2-entry slope-cap slot table (= ANAURD60_DAT
// in ys_bgsc1.asm). Each entry is a 16-bit WRAM template-slot address.
//
//   Y = 0 (bottom row of slope-cap):       $1DEC → stamped as $A000 in the trace
//   Y = 2 (row above bottom of slope-cap): $1DE8 → stamped as $9F00 in the trace
//
// Cart indexing: `ASL ; TAY ; LDX DATA_139FE3,y` — Y = A * 2 where A is
// either 0 or 1, so the index is 0 or 2 (16-bit-word spacing). We index
// our flat array by A directly.
// ─────────────────────────────────────────────────────────────────────

const DATA_139FE3 = [
  0x001DEC, // bottom row of slope-cap (Y=0 from ASL of A=0)
  0x001DE8, // row above bottom of slope-cap (Y=2 from ASL of A=1)
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_grass_slope_down_60deg_hole (Bank13.asm:4259)
// ─────────────────────────────────────────────────────────────────────

const grassSlopeDown60degHoleStamp: PerCellHandler = (state) => {
  // Cart enters REP #$30 — 16-bit A/X/Y. We track $2E as a JS number; mask
  // on read where it matters.
  //
  //   LDA $28 ; BEQ skip_extend       ; if col == 0, no extend.
  //   LDA $2C ; BNE skip_extend       ; if row != 0, no extend.
  //   INC $2E ; INC $2E               ; else $2E += 2.
  //
  // Note: column 0 produces a 1-cell-tall hole top; each subsequent column
  // pushes $2E down by 2, growing the slope-cap region deeper into the
  // walker rectangle.
  if ((state.zp28 & 0xffff) !== 0 && (state.zp2C & 0xffff) === 0) {
    state.zp2E = (state.zp2E + 2) & 0xffff;
  }

  // Cart: LDA $2E ; CLC ; SBC $2C.
  //   CLC before SBC means carry-in = 0, i.e. an extra borrow:
  //   A = $2E - $2C - 1 (16-bit, wraps).
  // This is the cart's idiom for "distance to bottom row minus one":
  //   $2C == $2E - 1 (bottom row)         → A = 0  → slope_pick(Y=0) → slot $1DEC
  //   $2C == $2E - 2 (row above bottom)   → A = 1  → slope_pick(Y=2) → slot $1DE8
  //   else                                → floor_random_8way_pick
  const a = (state.zp2E - state.zp2C - 1) & 0xffff;

  if (a === 0 || a === 1) {
    // CODE_grass_slope_down_60deg_hole_slope_pick:
    //   ASL ; TAY ; LDX DATA_139FE3,y ; LDA $0000,x ; STA buf,$1D.
    // ASL of {0,1} gives Y of {0,2}; we index our flat table by A (0 or 1).
    const slotAddr = DATA_139FE3[a]!;
    stampCell(state, state.templateAt(slotAddr));
    return;
  }

  // Else fall-through: JSR CODE_floor_random_8way_pick.
  // Picks one of 8 random-grass slots from DATA_floor_random_grass_8way_pool
  // via `prng & 7` and stamps.
  floorRandom8wayPick(state);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_grass_slope_down_60deg_hole (Bank12.asm:3483)
// ─────────────────────────────────────────────────────────────────────

function initGrassSlopeDown60degHole(state: DecodeState): void {
  // Cart: REP #$20 (16-bit A only).
  //   LDA $2A ; ASL ; STA $00     ; $00 = 2 * col_extent
  //   LDA $2E ; SEC ; SBC $00     ; A = row_extent - 2*col_extent
  //   BEQ  case_clamp1            ; if zero → $2E = 1
  //   BPL  case_store_as_is       ; if positive → $2E = A
  //   ; BMI fallthrough            ; if negative → $2E = 1
  //
  // Net effect: $2E := max(1, $2E - 2*$2A). The 2*$2A subtraction matches
  // the +2 grow-per-column in the stamp: we pre-shrink so the walker
  // doesn't overrun before the stamp's per-column INC compensates.
  const colExtTimes2 = ((state.zp2A & 0xffff) << 1) & 0xffff;
  const diff = (state.zp2E - colExtTimes2) & 0xffff;

  // Sign test on the 16-bit result (high bit set ⇒ negative).
  const isNegative = (diff & 0x8000) !== 0;
  const isZero = diff === 0;

  if (isZero || isNegative) {
    state.zp2E = 0x0001;
  } else {
    state.zp2E = diff;
  }

  // JMP CODE_walker_setup_keep_slope (with handler-1 in A:X).
  // walkerSetupKeepSlope wires all 3 dispatch slots to the same handler.
  walkerSetupKeepSlope(state, grassSlopeDown60degHoleStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installGrassSlopeDown60degHoleHandlers(): void {
  registerStdObjectHandler(0x3B, initGrassSlopeDown60degHole);
}
