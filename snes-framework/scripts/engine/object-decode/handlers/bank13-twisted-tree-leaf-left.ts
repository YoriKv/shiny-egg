// Bank13 stamp handler for std object $75 — 2-wide spike pair (left variant).
//
//
// Init (Bank12.asm:4229, CODE_init_twisted_tree_leaf_left @ $12:9B5D):
//   REP #$20
//   LDA #$0002 ; STA $2A             ; force column extent to 2
//   LDX #(CODE_stamp_twisted_tree_leaf_left-$01)>>16       ; bank byte of per-cell handler
//   LDA #CODE_stamp_twisted_tree_leaf_left-$01             ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline      ; all 3 handler slots = CODE_stamp_twisted_tree_leaf_left
//
// Per-cell stamp (Bank13.asm:8452, CODE_stamp_twisted_tree_leaf_left @ $13:C907):
//   REP #$30
//   LDA $28 ; ASL ; TAY              ; Y = column * 2 (word index)
//   LDX $1D
//   LDA DATA_twisted_tree_leaf_left_tiles,y
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// DATA_twisted_tree_leaf_left_tiles (DATA_2wide_spike_pair_left_tiles, Bank13.asm:8463):
//   col 0 → $3D53 (left spike), col 1 → $3D57 (right spike).
//
// Init DP diff: col_extent ($2A) 0001 → 0002 (column extent rewritten
// unconditionally, so user-authored extents are ignored — every $75
// placement stamps exactly 2 columns wide). Spec confirms
// xy_lo/xy_hi/$2E/$15 unchanged.
//
// No GoldenEgg counterpart — case 0x75 / "2wide spike pair" / similar
// searches all empty in the ReSharper-loaded "ge" solution (matches the
// pattern seen across the rest of the spike-handler family).
//
// Consolidation candidate: $76 (CODE_2wide_spike_pair_right) is structurally
// identical — same init shape (force $2A=$0002), same per-cell shape
// (word-indexed lookup by column), only the 2-entry tile table differs
// ($3D56 / $3D55 vs $3D53 / $3D57). When the $76 port lands, both can
// share a single "2-col word-indexed stamp" helper parameterised on the
// tile pair — see comments on `stampTwistedTreeLeafLeft` below. Same shape
// also matches $74 (3wide_spike_row) except for table length / forced
// col extent.

import { registerStdObjectHandler } from './index.ts';
import type { InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_twisted_tree_leaf_left_tiles (DATA_2wide_spike_pair_left_tiles, Bank13.asm:8463) —
// 2-entry word table indexed by column position ($28 * 2).
// ─────────────────────────────────────────────────────────────────────

const DATA_twisted_tree_leaf_left_tiles = [
  0x3D53, // col 0 — left spike
  0x3D57, // col 1 — right spike
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_twisted_tree_leaf_left ($13:C907, Bank13.asm:8452) — per-cell stamp.
//
// The asm doesn't mask $28, but the init forces $2A=2 so column counter
// only ever advances 0 → 1 in normal stream playback. Mask defensively
// to keep the lookup pure if an out-of-range $28 ever leaked through.
// ─────────────────────────────────────────────────────────────────────

const stampTwistedTreeLeafLeft: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const tile = DATA_twisted_tree_leaf_left_tiles[col] ?? DATA_twisted_tree_leaf_left_tiles[0]!;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_twisted_tree_leaf_left ($12:9B5D, Bank12.asm:4229).
//
// Writes col_extent = 2 then trampolines into the walker setup with the
// per-cell stamp routine. Trampoline wires the same handler into all
// three dispatch slots (even-col / odd-col / row), so col-parity and
// row-end are irrelevant — every cell calls stampTwistedTreeLeafLeft.
// ─────────────────────────────────────────────────────────────────────

const initTwistedTreeLeafLeft: InitHandler = (state) => {
  state.zp2A = 0x0002;
  walkerSetupTrampoline(state, stampTwistedTreeLeafLeft);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installTwistedTreeLeafLeftHandlers(): void {
  registerStdObjectHandler(0x75, initTwistedTreeLeafLeft);
}
