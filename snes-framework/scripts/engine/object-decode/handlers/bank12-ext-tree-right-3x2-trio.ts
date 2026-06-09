// Ext-object handler family: tree_right_3x2_trio — IDs 0x5B / 0x5C / 0x5D.
//
// Ports CODE_extobj_handler_tree_right_3x2_trio ($12:8C04, Bank12.asm:2058)
// plus its per-cell stamper CODE_12AFBF ($12:AFBF, Bank12.asm:6837).
//
// Shape: WALKER-DRIVEN 3-col x 2-row rectangle. All three IDs share ONE init;
// the init dispatches on $15 — it computes a variant index from the extID and
// the variant selects one of three 3x2 tile tables. So $5B/$5C/$5D are
// "variant B" of the $3Dxx tree tileset (variant A lives at the sibling
// CODE_extobj_handler_tree_left_3x2_trio / CODE_12AF84, not ported here).
//
// Init (CODE_extobj_handler_tree_right_3x2_trio):
//   REP #$20
//   LDA $15 : INC : AND #$0003 : ASL : STA $15   ; $15 = ((extID+1)&3)<<1
//   LDA #$0003 : STA $2A                          ; cols = 3
//   LDA #$0002 : STA $2E                          ; rows = 2
//   LDX/LDA #(CODE_12AFBF-1) : JMP walker_setup_trampoline(percell=CODE_12AFBF)
//
// So the variant index = (extID + 1) & 3, and $15 holds that index << 1 (a
// WORD offset into the DATA_12AFB9 pointer table). For 0x5B/0x5C/0x5D the
// variant index is 0/1/2 respectively.
//
// Per-cell stamper (CODE_12AFBF):
//   $00 = DATA_12AFB9[$15] + (($2C*2 + $2C)*2)   ; row-table base + row*6 bytes
//   tile = word at ($00)[$28*2]                  ; = row_table[row*3 + col]
//   if tile == 0  -> skip (no stamp)             ; BEQ CODE_12AFFE
//   special-cases keyed on the EXISTING tile $12:
//     tile == $3D9F: if $12 == $3D72 -> stamp $3DA9 else stamp $3D9F
//     tile == $3DA0: if $12 == $3D71 -> stamp $3DA8 else stamp $3DA0
//   else stamp tile.
//   STA !RAM_YI_Level_LevelDataBuffer,X  (X = $1D)
//
// The two existing-tile special-cases ($3D9F/$3DA0) are auto-tiling joins with
// a neighbouring tree. At static-decode time the buffer cell is empty
// ($12 == 0 in every trace cell), so both gates fall through to the plain
// stamp — matching the spec. We model the gate explicitly anyway for fidelity.
//
// Verified per-cell vs spec.json for all three IDs (18 walker cells): Map16 IDs
// and buffer offsets match (the $0000 table slots correspond exactly to the
// spec's "no stamp" cells). The walker drives $28/$2C and the buffer offset $1D.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12AFB9 row-table pointers -> DATA_12AF95 / DATA_12AFA1 / DATA_12AFAD.
// Each row table is 6 words laid out [r0c0, r0c1, r0c2, r1c0, r1c1, r1c2].
// Index by variant = (extID + 1) & 3, then by (row*3 + col).
// 0x0000 = empty slot (BEQ skip; no cell stamped).
const VARIANT_ROWS: readonly (readonly number[])[] = [
  // variant 0 -> 0x5B (DATA_12AF95)
  [0x3da5, 0x3d7d, 0x0000, 0x0000, 0x3d7e, 0x0000],
  // variant 1 -> 0x5C (DATA_12AFA1)
  [0x3d74, 0x3d7c, 0x0000, 0x3d9f, 0x3d7b, 0x0000],
  // variant 2 -> 0x5D (DATA_12AFAD)
  [0x0000, 0x3d97, 0x3d98, 0x3d71, 0x3d99, 0x3d9a],
];

// CODE_12AFBF per-cell stamper.
const perCellTreeRight: PerCellHandler = (state: DecodeState): void => {
  // $15 = variantIndex << 1 (word offset into DATA_12AFB9). Recover variant.
  const variant = (state.zp15 >> 1) & 0x03;
  const row = state.zp2C & 0xff;
  const col = state.zp28 & 0xff;

  const table = VARIANT_ROWS[variant];
  if (!table) return;

  const tile = table[row * 3 + col] ?? 0x0000;
  if (tile === 0x0000) return; // BEQ CODE_12AFFE — empty slot, no stamp

  const under = state.zp12 & 0xffff; // existing Map16 tile at this cell
  let out = tile;
  if (tile === 0x3d9f) {
    // CMP #$3D9F BEQ CODE_12AFED: LDA $12 / CMP #$3D72 / BNE -> stamp $3D9F
    out = under === 0x3d72 ? 0x3da9 : 0x3d9f;
  } else if (tile === 0x3da0) {
    // CMP #$3DA0 BNE store-raw; else LDA $12 / CMP #$3D71 / BNE -> stamp $3DA0
    out = under === 0x3d71 ? 0x3da8 : 0x3da0;
  }

  stampCell(state, out);
};

// CODE_extobj_handler_tree_right_3x2_trio — the shared init for 0x5B/0x5C/0x5D.
// Merge: object IDs 0x5B, 0x5C, 0x5D share this handler.
function initTreeRight(state: DecodeState): void {
  // $15 = ((extID + 1) & 3) << 1. extID is in state.zp15 on entry.
  state.zp15 = (((state.zp15 + 1) & 0x03) << 1) & 0xff;
  state.zp2A = 0x0003; // column extent
  state.zp2E = 0x0002; // row extent
  walkerSetupTrampoline(state, perCellTreeRight);
}

export function installExtTreeRight3x2TrioHandlers(): void {
  registerExtObjectHandler(0x5b, initTreeRight);
  registerExtObjectHandler(0x5c, initTreeRight);
  registerExtObjectHandler(0x5d, initTreeRight);
}
