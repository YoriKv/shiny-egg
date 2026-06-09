// Ext-object handler family: tree_left_3x2_trio (variant A) — IDs 0x58 / 0x59 / 0x5A.
//
// Ports CODE_extobj_handler_tree_left_3x2_trio ($12:8BE5, Bank12.asm:2043)
// plus its per-cell stamper CODE_12AF84 -> shared body CODE_12AFCE
// ($12:AF84 / $12:AFCE, Bank12.asm:6814 / 6846).
//
// Shape: WALKER-DRIVEN 3-col x 2-row rectangle. All three IDs share ONE init.
// This is the "variant A" half of the $3Dxx tree tileset; the sibling
// CODE_extobj_handler_tree_right_3x2_trio (ext 0x5B-0x5D, stamper CODE_12AFBF)
// is the matching "variant B" — see bank12-ext-tree-right-3x2-trio.ts.
//
// Init (CODE_extobj_handler_tree_left_3x2_trio, Bank12.asm:2044):
//   REP #$20
//   LDA $15 : AND #$0003 : ASL : STA $15   ; $15 = (extID & 3) << 1  (word index)
//   LDA #$0003 : STA $2A                    ; cols = 3
//   LDA #$0002 : STA $2E                    ; rows = 2
//   LDX/LDA #(CODE_12AF84-1) : JMP walker_setup_trampoline(percell=CODE_12AF84)
//
// So tableIndex = (extID & 3) = ($15 >> 1). For 0x58/0x59/0x5A that is 0/1/2.
// (NB: unlike variant B, this init does NOT INC before AND — the variant index
// is extID&3, not (extID+1)&3 — and $2A is the constant 3, not $15.)
//
// Per-cell stamper (CODE_12AF84 -> CODE_12AFCE, Bank12.asm:6814/6846):
//   $00 = DATA_12AF7E[$15] + (($2C*2 + $2C)*2)   ; row-table base + row*6 bytes
//   tile = word at ($00)[$28*2]                  ; = row_table[row*3 + col]
//   if tile == 0  -> skip (no stamp)             ; BEQ CODE_12AFFE
//   under-tile auto-tiling joins (existing tile $12):
//     tile == $3D9F: if $12 == $3D72 -> stamp $3DA9 else stamp $3D9F  (CODE_12AFED)
//     tile == $3DA0: if $12 == $3D71 -> stamp $3DA8 else stamp $3DA0
//   else stamp tile.
//   STA !RAM_YI_Level_LevelDataBuffer,X  (X = $1D)
//
// The two existing-tile special-cases ($3D9F/$3DA0) are auto-tiling joins with a
// neighbouring tree. At static-decode time the buffer cell is empty
// ($12 == 0 in every trace cell — see spec "cur_tile":"0000"), so both gates
// fall through to the plain stamp, matching the spec. Modelled for fidelity.
//
// Verified per-cell vs spec.json for all three IDs (18 walker cells incl. the
// $0000 skip cells): Map16 IDs match exactly, and the $0000 table slots
// correspond exactly to the spec's "output_mapid": null (no-stamp) cells.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12AF7E row-table pointers -> DATA_12AF5A / DATA_12AF66 / DATA_12AF72.
// Each row table is 6 words laid out [r0c0, r0c1, r0c2, r1c0, r1c1, r1c2]
// (Bank12.asm:6802 / 6805 / 6808). Index by tableIndex = (extID & 3), then (row*3+col).
// 0x0000 = empty slot (BEQ skip; no cell stamped).
const VARIANT_ROWS: readonly (readonly number[])[] = [
  // index 0 -> 0x58 (DATA_12AF5A)
  [0x0000, 0x3d80, 0x3da6, 0x0000, 0x3d7f, 0x0000],
  // index 1 -> 0x59 (DATA_12AF66)
  [0x0000, 0x3d79, 0x3d73, 0x0000, 0x3d7a, 0x3da0],
  // index 2 -> 0x5A (DATA_12AF72)
  [0x3d9d, 0x3d9e, 0x0000, 0x3d9b, 0x3d9c, 0x3d72],
];

// CODE_12AF84 / CODE_12AFCE per-cell stamper.
const perCellTreeLeft: PerCellHandler = (state: DecodeState): void => {
  // tableIndex = (extID & 3). $15 holds (extID & 3) << 1; recover via $15 >> 1.
  const tableIndex = (state.zp15 >> 1) & 0x03;
  const row = state.zp2C & 0xff;
  const col = state.zp28 & 0xff;

  const table = VARIANT_ROWS[tableIndex];
  if (!table) return;

  const tile = table[row * 3 + col] ?? 0x0000;
  if (tile === 0x0000) return; // BEQ CODE_12AFFE — empty slot, no stamp

  const under = state.zp12 & 0xffff; // existing Map16 tile at this cell
  let out = tile;
  if (tile === 0x3d9f) {
    // CMP #$3D9F BEQ CODE_12AFED: LDA $12 / CMP #$3D72 / BNE -> stamp $3D9F.
    out = under === 0x3d72 ? 0x3da9 : 0x3d9f;
  } else if (tile === 0x3da0) {
    // CMP #$3DA0 BNE store-raw; else LDA $12 / CMP #$3D71 / BNE -> stamp $3DA0.
    out = under === 0x3d71 ? 0x3da8 : 0x3da0;
  }

  stampCell(state, out);
};

// CODE_extobj_handler_tree_left_3x2_trio — the shared init for 0x58/0x59/0x5A.
// Merge: object IDs 0x58, 0x59, 0x5A share this handler.
function initTreeLeft(state: DecodeState): void {
  // $15 = (extID & 3) << 1. extID is in state.zp15 on entry.
  state.zp15 = ((state.zp15 & 0x03) << 1) & 0xff;
  state.zp2A = 0x0003; // column count = 3
  state.zp2E = 0x0002; // row count = 2
  walkerSetupTrampoline(state, perCellTreeLeft);
}

export function installExtTreeLeft3x2TrioHandlers(): void {
  registerExtObjectHandler(0x58, initTreeLeft);
  registerExtObjectHandler(0x59, initTreeLeft);
  registerExtObjectHandler(0x5a, initTreeLeft);
}
