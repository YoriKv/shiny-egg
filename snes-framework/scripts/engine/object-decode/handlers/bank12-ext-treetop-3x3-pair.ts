// Ports CODE_extobj_handler_treetop_3x3_pair ($12:8BB3, Bank12.asm:2014)
// — the shared init for ext ids 0x54 and 0x55 (treetop 3x3 paired block).
//
// Walker-driven 3x3 block; both ids share one init and differ only by an
// orientation index selecting one of two tile tables.
//
// Init CODE_extobj_handler_treetop_3x3_pair (REP #$20):
//   LDA $15 : AND #$0001 : ASL : STA $15   ; orientation = (id & 1) << 1
//                                          ;   0x54 -> 0, 0x55 -> 2
//   LDA #$0003 : STA $2A : STA $2E         ; 3 columns, 3 rows
//   LDX/LDA #CODE_12AEF6-1 : JMP CODE_walker_setup_trampoline
//
// Per-cell stamper CODE_12AEF6 ($12:AEF6, Bank12.asm:6765):
//   REP #$30
//   LDX $15                       ; orientation -> byte index into DATA_12AEF2
//   LDA $2C : ASL : ADC $2C : ASL ; row * 6 (bytes) = row * 3 words
//   ADC DATA_12AEF2,x : STA $00   ; $00 = &table[orientation] + row*6
//   JMP CODE_12AFCE
// CODE_12AFCE:
//   LDA $28 : ASL : TAY           ; col * 2 (bytes)
//   LDA ($00),y                   ; tile = table[orientation][row*3 + col]
//   BEQ CODE_12AFFE               ; zero entry -> transparent, NO stamp
//   ... (3D9F/3DA0 under-tile overlay special cases; see note) ...
//   STA buffer,x
//
// DATA_12AEF2 = dw DATA_12AECE, DATA_12AEE0  (orientation 0 / 2 base ptrs)
// DATA_12AECE (orientation 0, id 0x54), words indexed row*3+col:
//   row0: 0000 0000 3DA1 | row1: 3D79 3D77 3DA2 | row2: 3D7A 3DA0 0000
// DATA_12AEE0 (orientation 2, id 0x55), words indexed row*3+col:
//   row0: 3DA4 0000 0000 | row1: 3DA3 3D78 3D7C | row2: 0000 3D9F 3D7B
// (verified cell-for-cell against ext-54 / ext-55 trace specs.)
//
// Under-tile overlay note: CODE_12AFCE remaps the stamped tile when the
// table entry is 3D9F/3DA0 AND the *existing* buffer tile ($12) is 3D72/3D71
// (treetop-to-treetop join). At static-decode time the anchor cells are empty
// ($12 = 0x0000, matching the trace's cur_tile=0000 on every cell), so this
// branch is never taken and the raw table tile is emitted — exactly what the
// traces show. We omit the overlay; document it here for the consolidation
// sweep.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12AECE / DATA_12AEE0 (Bank12.asm:6754/6758), flat row-major
// [row*3 + col] word tables. 0x0000 = transparent slot (cart emits no stamp).
// Keyed by the orientation byte the init writes ($15: 0 for id 0x54, 2 for
// id 0x55) — same indexing as the cart's DATA_12AEF2 pointer table.
const ORIENT_TABLES: Record<number, readonly number[]> = {
  0x00: [
    0x0000, 0x0000, 0x3da1, // row 0
    0x3d79, 0x3d77, 0x3da2, // row 1
    0x3d7a, 0x3da0, 0x0000, // row 2
  ],
  0x02: [
    0x3da4, 0x0000, 0x0000, // row 0
    0x3da3, 0x3d78, 0x3d7c, // row 1
    0x0000, 0x3d9f, 0x3d7b, // row 2
  ],
};

// Merge: object IDs 0x54, 0x55 share this handler.
function initTreetop3x3Pair(state: DecodeState): void {
  // Re-encode orientation exactly as the cart: (id & 1) << 1.
  state.zp15 = ((state.zp15 & 0x0001) << 1) & 0xffff;
  state.zp2A = 0x0003; // 3 columns
  state.zp2E = 0x0003; // 3 rows
  walkerSetupTrampoline(state, perCellTreetop3x3Pair);
}

const perCellTreetop3x3Pair: PerCellHandler = (state) => {
  const table = ORIENT_TABLES[state.zp15 & 0xff];
  if (!table) return;
  const col = state.zp28 & 0xff; // walker column counter ($28)
  const row = state.zp2C & 0xff; // walker row counter ($2C)
  const tile = table[row * 3 + col];
  if (!tile) return; // zero table entry -> transparent slot, no stamp (BEQ)
  stampCell(state, tile);
};

export function installExtTreetop3x3PairHandlers(): void {
  registerExtObjectHandler(0x54, initTreetop3x3Pair);
  registerExtObjectHandler(0x55, initTreetop3x3Pair);
}
