// Bank13 dec-corner-4x4 stamp handler + Bank12 init wrapper.
//
// Standard object $B0 — "corner-aware 4×4 decoration block" ($77 page).
// A bare-trampoline init handler whose per-cell body picks one of nine
// Map16 IDs from a 16-entry table by classifying the walker's (col, row)
// against the rectangle's edges:
//
//   col position class (X bucket, byte index into DATA_dec_corner_4x4_tiles):
//     col == 0                → 0
//     col + 1 == colExtent    → 6   (rightmost column)
//     col odd interior        → 4   ((col & 1) * 2 + 2)
//     col even interior       → 2   ((col & 1) * 2 + 2)
//
//   row position class (Y bucket, OR'd into the X bucket):
//     row == 0                → 0
//     row + 1 == rowExtent    → 0x18 (bottommost row)
//     row odd interior        → 0x10 ((row & 1) << 3 + 8)
//     row even interior       → 0x08 ((row & 1) << 3 + 8)
//
//   Final Y = colBucket | rowBucket (the asm uses `ORA` because the two
//   buckets occupy disjoint bit ranges: 0..6 vs 0x08/0x10/0x18). Y ranges
//   over the 16 entries (each `dw`, so byte offset = wordIndex * 2).
//
// The stamp is SHAPE-AWARE READ-CONDITIONAL: if the existing cell ($12)
// is non-zero, the asm skips the write (`LDA $12 ; BNE skip`). This means
// the decoration only paints into empty buffer cells — terrain already
// stamped beneath wins. The init handler itself does not mutate any
// walker-relevant DP fields (xy_lo/xy_hi/extents/orientation pass through
// unchanged), matching the spec's init_dp_delta.
//
// Asm sources:
//   CODE_init_decoration_corner_block    Bank12.asm:4856  ($12:9F8F)
//   CODE_stamp_dec_corner_4x4            Bank13.asm:11877 ($13:E1B0)
//   DATA_dec_corner_4x4_tiles            Bank13.asm:11872 ($13:E190)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_dec_corner_4x4_tiles ($13:E190, Bank13.asm:11872) — 16-entry
// `dw` table. Indexed by Y in {0..0x1E step 2}, addressed in our typed
// array as Y >>> 1. Layout (decoded from the spec's per-cell trace):
//
//   wordIdx  Y    where in 4×4 grid       result
//   0        0x00 col 0    row 0 (TL)     $77AB
//   1        0x02 col even row 0          $77AB
//   2        0x04 col odd  row 0          $77AC
//   3        0x06 col last row 0 (TR)     $77CE
//   4        0x08 col 0    row even       $779B
//   5        0x0A col even row even       $779D
//   6        0x0C col odd  row even       $779E
//   7        0x0E col last row even       $779D
//   8        0x10 col 0    row odd        $779C
//   9        0x12 col even row odd        $77AD
//   10       0x14 col odd  row odd        $77AE
//   11       0x16 col last row odd        $77AD
//   12       0x18 col 0    row last (BL)  $77CE
//   13       0x1A col even row last       $779D
//   14       0x1C col odd  row last       $779E
//   15       0x1E col last row last (BR)  $779D
// ─────────────────────────────────────────────────────────────────────

const DATA_dec_corner_4x4_tiles: ReadonlyArray<number> = [
  0x77AB, 0x77AB, 0x77AC, 0x77CE, 0x779B, 0x779D, 0x779E, 0x779D,
  0x779C, 0x77AD, 0x77AE, 0x77AD, 0x77CE, 0x779D, 0x779E, 0x779D,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_dec_corner_4x4 ($13:E1B0).
//
//   REP #$30
//   ; --- column class -> Y bits 0..6 -----------------------------------
//   LDY #$0000
//   LDA $28 ; BEQ col_done           ; col == 0 -> Y = 0
//   LDY #$0006 ; INC ; CMP $2A
//   BEQ col_done                     ; col+1 == colExtent -> Y = 6
//   LDA $28 ; AND #$0001 ; ASL ; CLC ; ADC #$0002 ; TAY
//   ; col interior: Y = (col & 1) * 2 + 2 -> {2, 4}
// col_done:
//   STY $00                          ; save col bits
//   ; --- row class -> Y bits 3..4 --------------------------------------
//   LDY #$0000
//   LDA $2C ; BEQ row_done           ; row == 0 -> Y = 0
//   LDY #$0018 ; INC ; CMP $2E
//   BEQ row_done                     ; row+1 == rowExtent -> Y = 0x18
//   LDA $2C ; AND #$0001 ; ASL ; ASL ; ASL ; CLC ; ADC #$0008 ; TAY
//   ; row interior: Y = (row & 1) * 8 + 8 -> {8, 0x10}
// row_done:
//   TYA ; ORA $00 ; TAY              ; combine col + row bits
//   ; --- conditional stamp ---------------------------------------------
//   LDA $12 ; BNE skip               ; existing cell non-zero -> preserve
//   LDX $1D ; LDA DATA_dec_corner_4x4_tiles,y
//   STA.l buffer,x
// skip:
//   SEP #$30 ; RTL
// ─────────────────────────────────────────────────────────────────────

const decorationCornerBlockStamp: PerCellHandler = (state) => {
  // Column class -> low bits.
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  let colBits: number;
  if (col === 0) {
    colBits = 0x00;
  } else if (((col + 1) & 0xff) === colExt) {
    colBits = 0x06;
  } else {
    colBits = (((col & 0x01) << 1) + 0x02) & 0xff;   // {2, 4}
  }

  // Row class -> high bits.
  const row = state.zp2C & 0xff;
  const rowExt = state.zp2E & 0xff;
  let rowBits: number;
  if (row === 0) {
    rowBits = 0x00;
  } else if (((row + 1) & 0xff) === rowExt) {
    rowBits = 0x18;
  } else {
    rowBits = (((row & 0x01) << 3) + 0x08) & 0xff;   // {8, 0x10}
  }

  // Skip when the existing cell is already non-zero — decoration paints
  // only into empty buffer.
  if ((state.zp12 & 0xffff) !== 0) return;

  // ORA combines the two disjoint bit fields. Divide by 2 to convert the
  // asm's byte-stride index into our word-typed array offset.
  const y = (rowBits | colBits) & 0xff;
  const tile = DATA_dec_corner_4x4_tiles[y >>> 1];
  if (tile === undefined) return;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_decoration_corner_block ($12:9F8F, Bank12.asm:4856).
//
//   REP #$20
//   LDX #(CODE_stamp_dec_corner_4x4-1)>>16
//   LDA #CODE_stamp_dec_corner_4x4-1
//   JMP walker_setup_trampoline
//
// Bare trampoline — no DP mutations, no per-init state setup. Matches
// the spec's `init_dp_delta` (all five tracked fields unchanged).
// ─────────────────────────────────────────────────────────────────────

function initDecorationCornerBlock(state: DecodeState): void {
  walkerSetupTrampoline(state, decorationCornerBlockStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installDecorationCornerBlockHandlers(): void {
  registerStdObjectHandler(0xB0, initDecorationCornerBlock);
}
