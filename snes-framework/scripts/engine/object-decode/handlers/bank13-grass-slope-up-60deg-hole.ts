// Bank13 stamp handler for std object $3A — "grass-floor 60-degree upward
// slope with hole" (KUSAANAURU60 in ys_bgsc1.asm: kusa/ana/uru/60).
//
// Cart entry points:
//   CODE_init_grass_slope_up_60deg_hole  @ $12:9640  (Bank12.asm:3476)
//   CODE_grass_slope_up_60deg_hole       @ $13:9FAA  (Bank13.asm:4214)
//   CODE_floor_random_8way_pick          @ $13:C15F  (Bank13.asm:7639) — shared dirt-fill
//   DATA_139FA6                          @ $13:9FA6  (Bank13.asm:4202)
//                                                    dw $1DF4, $1DF0
//                                        ANAURU60_DAT — two WRAM template-slot
//                                        addresses (1DF4=base, 1DF0=cap) the
//                                        slope-pick path dereferences.
//
// Init handler is a vanilla `walker_setup_keep_slope` trampoline; it loads
// the per-cell stamp pointer + bank into A/X and JMPs into the keep-slope
// walker (which does NOT zero $17 — but $3A also doesn't pre-set $17, so
// the walker effectively runs with whatever $17 the upstream parser left).
// We mirror by calling `walkerSetupKeepSlope` directly with $17 left at its
// pre-init value (the parser zeros $17 between objects).
//
// Per-cell algorithm (`CODE_grass_slope_up_60deg_hole`, REP #$30 throughout):
//
//   if (col != 0) AND (row == 0):
//       $2E -= 2                          ; shrink height by 2 per column-step
//       if $2E == 0:    $2E = 1           ; clamp to 1 (slope hits ceiling)
//       elif $2E < 0:   $2E = 1           ; (asm: BPL skips clamp, fall thru)
//   A = $2E - $2C - 1                     ; SBC without prior SEC subtracts 1
//   if A == 0 OR A == 1:                  ; we're on cap row (A=0) or one above (A=1)
//       Y = A << 1                        ; 0 → $1DF4 (base), 2 → $1DF0 (cap)
//       slot = DATA_139FA6[A]
//       stamp template_at(slot)
//   else:
//       floor_random_8way_pick()          ; dirt-tile randomiser body
//
// In words: every column descends 2 cells less than the previous (60deg up
// pitch); within a column, the bottom two cells stamp the cap+base slope
// silhouette ($A100 / $A200 for the test placement), and rows above that
// fill with random grass-tile variants from the 8-way pool.
//
// Verified against trace-harness spec `std-3A-init_grass_slope_up_60deg_hole`:
// every per-cell Map16 ID matches the cart-side trace BYTE-EXACT for the
// `$A100` / `$A200` slope tiles. The `floor_random_8way_pick` random body
// uses our deterministic LFSR rather than the cart's HV-counter prng, so
// the *specific* `$390E/$390F/$3910/$3911/$392B/$392C` per-cell picks won't
// match cell-for-cell, but the *set* of possible variants is identical
// (matches the consolidation pattern in `_shared.ts:floorRandom8wayPick`).
//
// GoldenEgg cross-check (`GE.Level.Obj3AMain`, Level.cs:4714) reproduces
// the exact arithmetic — same "$h != 0 && $v == 0 → maxh -= 2; clamp ≤0
// to 1" first-row adjustment, same "switch (maxh - v - 1)" cap-or-fill
// dispatch with cases 0/1 reading 16-bit slot pointers from offset $9F6E6
// (= ROM PC for DATA_139FA6) and default falling through to code13C15F
// (= `CODE_floor_random_8way_pick`). No divergence.
//
// Consolidation note: this is a near-mirror of $3B (grass_slope_down_60deg_hole)
// which uses DATA_139FE3 (slots $1DEC/$1DE8) and INCREMENTS $2E by 2 in
// the per-column adjustment instead of decrementing. The two ports could
// share a factory once $3B lands — flagged at the bottom of this file.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { stampCell, floorRandom8wayPick, signed8 } from './_shared.ts';

// ───────────────────────────────────────────────────────────────────────
// DATA_139FA6 (Bank13.asm:4202) — ANAURU60_DAT.
//   index 0 (A=0, "exactly at $2E-1"): $1DF4 → base/floor slope tile slot
//   index 1 (A=1, "one row above")   : $1DF0 → cap slope tile slot
//
// These are unnamed WRAM template-slot addresses (in the trailing
// $001DE8-$001DFC family — no TT.* alias yet). We dereference via
// `state.templateAt(...)` which converts WRAM address → populated
// template ID.
// ───────────────────────────────────────────────────────────────────────

const SLOPE_SLOT_BASE = 0x001DF4; // A == 0 → row $2E-1 (bottom of slope)
const SLOPE_SLOT_CAP  = 0x001DF0; // A == 1 → row $2E-2 (just above bottom)

const DATA_139FA6 = [SLOPE_SLOT_BASE, SLOPE_SLOT_CAP] as const;

// ───────────────────────────────────────────────────────────────────────
// CODE_grass_slope_up_60deg_hole — per-cell stamp (Bank13.asm:4214).
// ───────────────────────────────────────────────────────────────────────

const grassSlopeUp60degHole: PerCellHandler = (state) => {
  // Step 1 — per-column first-row adjustment.
  //
  // Cart: `LDA $28 ; BEQ skip` — only runs when col != 0.
  //       `LDA $2C ; BNE skip` — only runs when row == 0.
  // I.e. fires exactly once per column (except col 0, where the BEQ on $28
  // skips it). Decrements $2E by 2; if the result is 0 or negative, clamps
  // to 1.
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  if (col !== 0 && row === 0) {
    // DEC $2E twice in REP #$30. We work signed because the asm's BPL
    // tests bit 15 of the 16-bit word; with our 8-bit $2E we reproduce
    // the same control flow via signed8().
    const decremented = (signed8(state.zp2E) - 2) & 0xff;
    state.zp2E = decremented;
    // Cart: `BEQ clamp ; BPL skip` — clamp on (==0) OR (negative).
    if (decremented === 0 || signed8(decremented) < 0) {
      state.zp2E = 0x01;
    }
  }

  // Step 2 — compute A = $2E - $2C - 1.
  //
  // Cart: `LDA $2E ; CLC ; SBC $2C`. The 65816's SBC subtracts (operand +
  // !carry); with CLC the carry is clear, so the result is $2E - $2C - 1.
  // Both operands fit in 8 bits for all observed placements (max $2E
  // is the user-set height-1 byte, ≤ $7F after the parser's cap).
  const a = (signed8(state.zp2E) - signed8(state.zp2C) - 1) & 0xffff;

  // Step 3 — dispatch on A: 0 or 1 → slope-pick; otherwise → dirt-fill.
  if (a === 0 || a === 1) {
    const slotAddr = DATA_139FA6[a]!;
    stampCell(state, state.templateAt(slotAddr));
    return;
  }
  floorRandom8wayPick(state);
};

// ───────────────────────────────────────────────────────────────────────
// CODE_init_grass_slope_up_60deg_hole — init (Bank12.asm:3476).
//
// Cart asm in full:
//   LDX.b #(CODE_grass_slope_up_60deg_hole-$01)>>16
//   LDA.w #CODE_grass_slope_up_60deg_hole-$01
//   JMP.w CODE_walker_setup_keep_slope
//
// I.e. plain dispatch into the keep-slope walker setup with the per-cell
// stamp pointer in A/X. No DP mutations (the spec's "Init handler DP
// mutations" table is entirely "Changed: no"). $17 stays at its pre-init
// value (parser zeros it between objects, so effectively $17 = 0 → walker
// step is "straight down, no slope-rewind on row wrap").
// ───────────────────────────────────────────────────────────────────────

function initGrassSlopeUp60degHole(state: DecodeState): void {
  walkerSetupKeepSlope(state, grassSlopeUp60degHole);
}

// ───────────────────────────────────────────────────────────────────────
// Registration.
// ───────────────────────────────────────────────────────────────────────

export function installGrassSlopeUp60degHoleHandlers(): void {
  registerStdObjectHandler(0x3A, initGrassSlopeUp60degHole);
}

// ───────────────────────────────────────────────────────────────────────
// Consolidation candidate (NOT done here — flagged for batch-7 follow-up):
//
//   $3B (CODE_init_grass_slope_down_60deg_hole / CODE_grass_slope_down_60deg_hole)
//   is a structural mirror of $3A:
//     - same per-column-first-row adjustment shape, but INC $2E by 2
//       instead of DEC by 2 (slope grows downward across columns).
//     - same A = $2E - $2C - 1 dispatch.
//     - different slope-pick table: DATA_139FE3 = dw $1DEC, $1DE8 (cap/base).
//     - same `floor_random_8way_pick` dirt-fill default.
//
//   Once `bank13-grass-slope-down-60deg-hole.ts` lands, both can share a
//   small `makeGrassSlope60HoleStamp({ direction, slotBase, slotCap })`
//   factory in this file or in `_shared.ts`. Held back for now because
//   "two examples → factory" is the project's consolidation gate (see
//   `_shared.ts` jungle-family promotion history).
