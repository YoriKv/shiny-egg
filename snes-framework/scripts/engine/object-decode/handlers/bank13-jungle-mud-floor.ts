// Standard object $24 — init_jungle_mud_floor.
//
// Cart entry: CODE_init_jungle_mud_floor @ $12:950E (yi/Banks/Bank12.asm:3288).
// Per-cell stamp handler: CODE_jungle_mud_floor @ $13:9228 (yi/Banks/Bank13.asm:2354).
// Tail-branch helper: CODE_jungle_floor_random_body @ $13:9049 (Bank13.asm:2061).
//
// Mud variant of the jungle-floor family (object $21). The cart's per-cell
// handler dispatches on the row counter $2C:
//   rows 0..1  : "mud top body" — JSL CODE_prng, AND #$03 latched in $00,
//                Y = $2C * 2, stamp DATA_139224[Y] + $00 (the two mud
//                seed tiles $9608 / $9300, plus a 4-way PRNG variant
//                offset that picks $9608..$960B or $9300..$9303).
//   rows 2+    : tail-jump into the shared CODE_jungle_floor_random_body
//                — JSL CODE_prng, ADC $2C (no CLC, so carry-in matters),
//                AND #$001E, index DATA_138FE1 (16-entry foliage pool,
//                stored as 16 words / Y=offset-in-bytes) and stamp.
//
// The init handler is a plain walker setup: REP #$20, load the per-cell
// handler ptr, JMP CODE_walker_setup_trampoline. No orientation or seed
// writes — matches the cart spec's "Init handler DP mutations" table
// (all walker-relevant DP fields unchanged from stream-record values).
//
// asm primary; goldenegg has no Mud/Doro symbol — checked, nothing to
// cross-reference. The std-24 spec.md was used to verify per-cell Map16
// outputs (rows 0/1 produce $9608..$960B / $9300..$9303; rows 2+ map
// into DATA_138FE1).
//
// Note re: PRNG / `ADC $2C` without `CLC` — the cart's deterministic-vs-
// HV-counter PRNG carry flag isn't reproducible offline. Our port mirrors
// `bank13-jungle-floor.ts`'s convention: `(prngNext + $2C) & $1E`. Variant
// pick will be byte-stable across our runs but won't exactly match a
// specific cart-snapshot trace. Cosmetic-only impact (foliage variant
// within the 16-entry pool).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell, jungleFloorRandomBody } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Stamp-handler tile tables.
//
//   DATA_139224 (Bank13.asm:2343): 2 entries, one per top row.
//     Row 0 → $9608  (mud-top seed; +0..+3 picks variant)
//     Row 1 → $9300  (mud-mid seed; +0..+3 picks variant)
//
//   DATA_138FE1 (Bank13.asm:2006): 16-entry foliage pool for the
//     jungle-floor random body (rows 2+ of mud floor). Shared with
//     the regular jungle floor ($21) — consumed via the shared
//     jungleFloorRandomBody helper in ./_shared.ts.
// ─────────────────────────────────────────────────────────────────────

const DATA_139224 = [0x9608, 0x9300] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_mud_floor ($13:9228, Bank13.asm:2354) — per-cell handler.
//
// Dispatch by row counter $2C:
//   row 0:  prng & 3 → variant 0..3 of $9608  ($9608..$960B)
//   row 1:  prng & 3 → variant 0..3 of $9300  ($9300..$9303)
//   row 2+: tail into jungle_floor_random_body — prng + $2C, AND $1E,
//           index DATA_138FE1 as words → stamp.
// ─────────────────────────────────────────────────────────────────────
const jungleMudFloorStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;

  if (row >= 0x0002) {
    // Tail-call CODE_jungle_floor_random_body — shared helper.
    jungleFloorRandomBody(state);
    return;
  }

  // Top body (rows 0..1): random variant 0..3 of the row's seed.
  const variant = prngNext(state, RNG_SITE.jungleMudFloorTopbody) & 0x0003;
  const seed = DATA_139224[row]!;
  stampCell(state, (seed + variant) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_mud_floor ($12:950E, Bank12.asm:3288).
//
// Plain walker setup pointing at CODE_jungle_mud_floor; no orientation
// or random parameter writes. Equivalent to the cart's:
//   REP #$20
//   LDX #(CODE_jungle_mud_floor-1)>>16
//   LDA #CODE_jungle_mud_floor-1
//   JMP CODE_walker_setup_trampoline
// ─────────────────────────────────────────────────────────────────────
function initJungleMudFloor(state: DecodeState): void {
  walkerSetupTrampoline(state, jungleMudFloorStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts as the
// rest of the jungle family ($22-$36) lands.
// ─────────────────────────────────────────────────────────────────────
export function installJungleMudFloorHandlers(): void {
  registerStdObjectHandler(0x24, initJungleMudFloor);
}
