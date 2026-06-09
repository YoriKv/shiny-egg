// Bank13 stamp handler for std object $74 — 3-wide horizontal spike row.
//
//
// Init (Bank12.asm:4220, CODE_init_twisted_tree_leaves_wide @ $12:9B4E):
//   REP #$20
//   LDA #$0003 ; STA $2A             ; force column extent to 3
//   LDX #(CODE_stamp_twisted_tree_leaves_wide-$01)>>16       ; bank byte of per-cell handler
//   LDA #CODE_stamp_twisted_tree_leaves_wide-$01             ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline      ; all 3 handler slots = CODE_stamp_twisted_tree_leaves_wide
//
// Per-cell stamp (Bank13.asm:8435, CODE_stamp_twisted_tree_leaves_wide @ $13:C8EF):
//   REP #$30
//   LDA $28 ; ASL ; TAY              ; Y = column * 2 (word index)
//   LDX $1D
//   LDA DATA_twisted_tree_leaves_wide_tiles,y ; word-indexed lookup
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// DATA_twisted_tree_leaves_wide_tiles (DATA_3wide_spike_row_tiles, Bank13.asm:8443):
//   col 0 → $3D53 (left spike), col 1 → $3D54 (middle), col 2 → $3D55 (right).
//
// Init DP diff: col_extent ($2A) 0001 → 0003 (column extent is rewritten
// unconditionally, so user-authored extents are ignored — every $74 placement
// stamps exactly 3 columns wide). Spec confirms xy_lo/xy_hi/$2E/$15 unchanged.
//
// No GoldenEgg counterpart — case 0x74 / "3wide spike" / similar searches all
// empty in the ReSharper-loaded "ge" solution (matches the pattern noted on
// the other spike handlers in this batch).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_twisted_tree_leaves_wide_tiles (DATA_3wide_spike_row_tiles, Bank13.asm:8443) — 3-entry
// word table indexed by column position ($28 * 2).
// ─────────────────────────────────────────────────────────────────────

const DATA_twisted_tree_leaves_wide_tiles = [
  0x3D53, // col 0 — left spike
  0x3D54, // col 1 — middle spike
  0x3D55, // col 2 — right spike
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_twisted_tree_leaves_wide ($13:C8EF, Bank13.asm:8435) — per-cell stamp.
// ─────────────────────────────────────────────────────────────────────

const stampTwistedTreeLeavesWide: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  // Asm clamps via init forcing $2A=3, so col is always in 0..2.
  // Guard defensively against an out-of-range $28 (couldn't be reached
  // through normal stream playback but keeps the lookup pure).
  const tile = DATA_twisted_tree_leaves_wide_tiles[col] ?? DATA_twisted_tree_leaves_wide_tiles[0]!;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_twisted_tree_leaves_wide ($12:9B4E, Bank12.asm:4220).
//
// Writes col_extent = 3 then trampolines into the walker setup with the
// per-cell stamp routine. Trampoline wires the same handler into all
// three dispatch slots (even-col / odd-col / row), so col-parity and
// row-end are irrelevant — every cell calls stampTwistedTreeLeavesWide.
// ─────────────────────────────────────────────────────────────────────

const initTwistedTreeLeavesWide: InitHandler = (state) => {
  state.zp2A = 0x0003;
  walkerSetupTrampoline(state, stampTwistedTreeLeavesWide);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installTwistedTreeLeavesWideHandlers(): void {
  registerStdObjectHandler(0x74, initTwistedTreeLeavesWide);
}
