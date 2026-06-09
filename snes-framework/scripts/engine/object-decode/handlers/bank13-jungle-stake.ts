// Standard object $2B — init_jungle_stake.
//
// Cart entries:
//   CODE_init_jungle_stake @ $12:9569 (yi/Banks/Bank12.asm:3345)
//   CODE_jungle_stake      @ $13:951B (yi/Banks/Bank13.asm:2755)
//
// Tiny vertical-stake / post object used by jungle levels. The init is a
// bare walker-trampoline tail-call; all per-cell logic lives in the
// stamp handler. The stamp handler is the simplest "row-indexed slot
// pick" in the jungle family — no PRNG, no neighbour probes, no
// template-match search.
//
// Stamp logic (CODE_jungle_stake, REP #$30 throughout):
//   y = 0
//   if $2C != 0:        y = 1
//   if $2C + 1 == $2E:  y = 2    (last row of object)
//   stamp slot_1DCE + y at the current cell (i.e. slots $1DCE/$1DD0/$1DD2
//   as a contiguous word table; the asm uses `ADC.w $1DCE` with Y in A,
//   which is equivalent to "read the word at $1DCE + y bytes").
//
//   if $2E == 1 (single-row object):
//     overwrite current cell with slot_1DD4
//
// The captured trace exercises a 3-row stake at
// (col=0, rows 0..2): cells stamp $6B00 / $6B01 / $6B02 — confirms
// slot_1DCE = $6B00, slot_1DD0 = $6B01, slot_1DD2 = $6B02 for the test
// tileset. The $1DD4 single-row-collapse path is not exercised by the
// spec (extent=3) but is preserved here from the asm.
//
// DP diff (init enter → walker time, per spec): nothing mutates. The
// init really is just a trampoline, $A1 is irrelevant for this handler.
//
// asm primary; goldenegg has no matching symbol (searched JungleStake /
// Stake / Jungle_Stake — 0 hits).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// WRAM template slots used by the stamp handler. The stamp reads four
// consecutive 16-bit slots:
//
//   $1DCE  →  row 0  (top of stake)
//   $1DD0  →  interior rows (any row where $2C != 0 and $2C+1 != $2E)
//   $1DD2  →  bottom row    ($2C+1 == $2E)
//   $1DD4  →  single-row collapse (overrides the above when $2E == 1)
//
// These slots are populated by `init_per_tileset_template_slots` and not
// yet covered by the friendly-name TT enum (see template-slots.ts) —
// neighbouring families end at $1D8A "Family6800_Anchor"+20-slot range,
// and bank13-post-vertical.ts already uses the same raw `addr: 0x1DCE`
// style. Naming the slots is consolidation candidate territory once
// the post family and stake share a TT.JungleStakeTop / etc. set.
// ─────────────────────────────────────────────────────────────────────

const SLOT_STAKE_TOP             = 0x001DCE;
const SLOT_STAKE_INTERIOR        = 0x001DD0;
const SLOT_STAKE_BOTTOM          = 0x001DD2;
const SLOT_STAKE_SINGLE_ROW      = 0x001DD4;

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_stake ($13:951B, Bank13.asm:2755) — per-cell handler.
//
// Three-section row pick (top / interior / bottom), then a single-row
// override that stomps the just-stamped cell with the "stake on its own"
// variant. The asm packs the row-classify into 5 instructions via Y as
// a word index into the slot_1DCE / slot_1DD0 / slot_1DD2 contiguous
// triple; we keep the same 3-way branch shape for readability.
//
// Note: extent $2E is treated as an 8-bit unsigned. The cart's `LDA
// $2C ; BEQ` runs in REP #$30 (A is 16-bit), but in practice $2C and
// $2E are byte-sized counters set by Bank10's stream parser, so masking
// to 8 bits here matches every observed object placement and matches
// the convention in bank13-post-vertical.ts.
// ─────────────────────────────────────────────────────────────────────
const jungleStakeStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const ext = state.zp2E & 0xff;

  // 3-way row classification (top / interior / bottom).
  let slot: number;
  if (row === 0) {
    slot = SLOT_STAKE_TOP;
  } else if (((row + 1) & 0xff) === ext) {
    slot = SLOT_STAKE_BOTTOM;
  } else {
    slot = SLOT_STAKE_INTERIOR;
  }
  stampCell(state, state.templateAt(slot));

  // Single-row collapse: if the object has only one row of extent, the
  // last action of the stamp is to overwrite the cell with the "stake
  // on its own" variant. Triggered by `LDA $2E ; DEC ; BNE done`:
  //   $2E == 1 → DEC == 0 → BNE not taken → overwrite.
  // $2E == 0 would also fall through (DEC = $FF, BNE taken), but the
  // walker terminates immediately on extent 0 so we never reach here
  // in that case.
  if (ext === 1) {
    stampCell(state, state.templateAt(SLOT_STAKE_SINGLE_ROW));
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_stake ($12:9569, Bank12.asm:3345).
//
//   REP.b #$20
//   LDX.b #(CODE_jungle_stake-$01)>>16
//   LDA.w #CODE_jungle_stake-$01
//   JMP.w CODE_walker_setup_trampoline
//
// Bare trampoline — no DP mutations (spec diff table all "no"). The
// walker reads $2A=1, $2E=3 directly from the stream's header.
// ─────────────────────────────────────────────────────────────────────
function initJungleStake(state: DecodeState): void {
  walkerSetupTrampoline(state, jungleStakeStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installJungleStakeHandlers(): void {
  registerStdObjectHandler(0x2B, initJungleStake);
}
