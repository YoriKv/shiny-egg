// Bank13 stamp handler for std object $76 — 2-wide spike pair (right variant).
//
//
// Init (Bank12.asm:4238, CODE_init_twisted_tree_leaf_right @ $12:9B6C):
//   REP #$20
//   LDA #$0002 ; STA $2A             ; force column extent to 2
//   LDX #(CODE_stamp_twisted_tree_leaf_right-$01)>>16       ; bank byte of per-cell handler
//   LDA #CODE_stamp_twisted_tree_leaf_right-$01             ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline      ; all 3 handler slots = CODE_stamp_twisted_tree_leaf_right
//
// Per-cell stamp (Bank13.asm:8467, CODE_stamp_twisted_tree_leaf_right @ $13:C91D):
//   REP #$30
//   LDA $28 ; ASL ; TAY              ; Y = column * 2 (word index)
//   LDX $1D
//   LDA DATA_twisted_tree_leaf_right_tiles,y
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// DATA_twisted_tree_leaf_right_tiles (DATA_2wide_spike_pair_right_tiles, Bank13.asm:8479):
//   col 0 → $3D56 (left tile), col 1 → $3D55 (right tile).
//
// Init DP diff: col_extent ($2A) 0001 → 0002 (column extent is rewritten
// unconditionally — every $76 placement stamps exactly 2 columns wide).
// Spec confirms xy_lo/xy_hi/$2E/$15 unchanged.
//
// Mirror-symmetric counterpart to $75 CODE_2wide_spike_pair_left (same
// init shape, table entries are the other spike pair pixels — left's is
// {$3D53, $3D57}, right's is {$3D56, $3D55}). Once the left handler
// lands, both could share a single `stamp2WideSpikePair(table)` helper
// in `_shared.ts` — see consolidation note in the parent batch tracker.
//
// No GoldenEgg counterpart — ReSharper "ge" lookups for TwoWideSpikePair /
// 2wide_spike / SpikePairRight / init_spike_pair / 0x76 all return zero
// hits, matching the pattern noted on the other spike handlers in batch 14.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_twisted_tree_leaf_right_tiles (DATA_2wide_spike_pair_right_tiles, Bank13.asm:8479) —
// 2-entry word table indexed by column position ($28 * 2).
// ─────────────────────────────────────────────────────────────────────

const DATA_twisted_tree_leaf_right_tiles = [
  0x3D56, // col 0 — left tile of the right-variant pair
  0x3D55, // col 1 — right tile of the right-variant pair
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_twisted_tree_leaf_right ($13:C91D, Bank13.asm:8467) — per-cell stamp.
// ─────────────────────────────────────────────────────────────────────

const stampTwistedTreeLeafRight: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  // Init forces $2A=2, so col is always in 0..1. Guard defensively
  // against an out-of-range $28 to keep the lookup pure.
  const tile = DATA_twisted_tree_leaf_right_tiles[col] ?? DATA_twisted_tree_leaf_right_tiles[0]!;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_twisted_tree_leaf_right ($12:9B6C, Bank12.asm:4238).
//
// Writes col_extent = 2 then trampolines into the walker setup with
// the per-cell stamp routine. Trampoline wires the same handler into
// all three dispatch slots (even-col / odd-col / row), so col-parity
// and row-end are irrelevant — every cell calls stampTwistedTreeLeafRight.
// ─────────────────────────────────────────────────────────────────────

const initTwistedTreeLeafRight: InitHandler = (state) => {
  state.zp2A = 0x0002;
  walkerSetupTrampoline(state, stampTwistedTreeLeafRight);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installTwistedTreeLeafRightHandlers(): void {
  registerStdObjectHandler(0x76, initTwistedTreeLeafRight);
}
