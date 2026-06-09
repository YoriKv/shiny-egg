// Bank13 3x2-spike-block stamp handler + Bank12 init wrapper.
//
// Standard object $73 — 3-column-wide spike block. The init forces a
// column extent of 3 and snaps the row anchor onto an even-Y boundary
// (incrementing the row extent by 1 if it was odd) so the alternating
// top/bottom tile pair lines up with the 2-row period regardless of
// where the object was placed.
//
// The per-cell stamper indexes a single 6-entry tile table using
// (column $28) + 3 * (row $2C & 1):
//
//                       col=0    col=1    col=2
//   row parity 0 (top): $3D42   $3D43   $3D44     (DATA_3x2_spike_tiles[0..2])
//   row parity 1 (bot): $3D50   $3D51   $3D52     (DATA_3x2_spike_tiles[3..5])
//
// The 3-wide period × 2-row period gives the spike block its repeating
// brick-like silhouette (cap row + base row, repeating vertically).
//
// Asm sources:
//   CODE_init_twisted_tree_leaves            Bank12.asm:4205  ($12:9B36)
//   CODE_stamp_twisted_tree_leaves                 Bank13.asm:8411  ($13:C8C6)
//   DATA_3x2_spike_tiles                 Bank13.asm:8431  ($13:C8E3)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_3x2_spike_tiles (Bank13.asm:8431).
//
//   dw $3D42, $3D43, $3D44,    ; top    row (row-parity 0): col 0..2
//      $3D50, $3D51, $3D52     ; bottom row (row-parity 1): col 0..2
//
// The cart indexes this as words (`LDA DATA_3x2_spike_tiles,y` after `TYA / ASL
// / TAY`), so the in-memory layout is 6 contiguous 16-bit entries. We
// store as a flat number array; cart's `Y / 2` byte offset matches our
// element index directly.
// ─────────────────────────────────────────────────────────────────────

const DATA_3x2_spike_tiles: ReadonlyArray<number> = [
  0x3D42, 0x3D43, 0x3D44, // row-parity 0 (top): col 0, 1, 2
  0x3D50, 0x3D51, 0x3D52, // row-parity 1 (bot): col 0, 1, 2
];

const COL_EXTENT_FIXED = 0x0003;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_twisted_tree_leaves (Bank13.asm:8411).
//
//   REP #$30
//   LDY $28                  ; Y = column index (0..2)
//   LDA $2C ; AND #$0001
//   BEQ keep_y               ; row-parity 0: Y stays as col
//   INY / INY / INY          ; row-parity 1: Y = col + 3 (bottom-row offset)
//  keep_y:
//   TYA ; ASL ; TAY          ; Y *= 2 (word table index)
//   LDX $1D
//   LDA DATA_3x2_spike_tiles,y
//   STA buffer,x
//   SEP #$30 ; RTL
//
// Because the table is a flat 6-entry word array (rather than two
// 3-entry tables picked by row parity), the cart shifts the index by
// +3 entries for odd rows. We replicate that exactly: `col + (row & 1)
// * 3` is the entry index.
// ─────────────────────────────────────────────────────────────────────

const stampTwistedTreeLeaves: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const rowParity = state.zp2C & 0x01;
  const idx = (col + rowParity * 3) & 0xff;
  stampCell(state, DATA_3x2_spike_tiles[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_twisted_tree_leaves ($12:9B36, Bank12.asm:4205).
//
//   REP #$20
//   LDA #$0003 ; STA $2A           ; force column extent = 3
//   LDA $2E ; AND #$0001
//   BEQ skip_inc                   ; row extent already even → leave it
//   INC $2E                        ; odd → bump by 1 (even-row anchor)
//  skip_inc:
//   LDX #(CODE_stamp_twisted_tree_leaves-1)>>16
//   LDA #CODE_stamp_twisted_tree_leaves-1
//   JMP walker_setup_trampoline
//
// The `LDA $2E / AND #$0001` is a 16-bit read (still in REP #$20), but
// only bit 0 is tested, so 8-bit-vs-16-bit doesn't matter here. The
// `INC $2E` is likewise 16-bit; we model that by widening to 0xffff
// on the bump (matches 3x3-structural's full-word clamp convention).
// Cart $2A and $2E are both word-wide column/row extents.
// ─────────────────────────────────────────────────────────────────────

function initTwistedTreeLeaves(state: DecodeState): void {
  state.zp2A = COL_EXTENT_FIXED;
  if ((state.zp2E & 0x0001) !== 0) {
    state.zp2E = (state.zp2E + 1) & 0xffff;
  }
  walkerSetupTrampoline(state, stampTwistedTreeLeaves);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installTwistedTreeLeavesHandlers(): void {
  registerStdObjectHandler(0x73, initTwistedTreeLeaves);
}
