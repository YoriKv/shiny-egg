// Ports the World 6 "bone" extended-object family (ext $1B / $1C / $1D).
//
// Three sibling cart entries each load a distinct orientation constant, then
// branch to the shared body CODE_1289CC ($12:89CC):
//
//   CODE_extobj_handler_world6_bone_variant1 ($12:89B9, ext $1B): LDA #$0000
//   CODE_extobj_handler_world6_bone_variant2 ($12:89C0, ext $1C): LDA #$0002
//   CODE_extobj_handler_world6_bone_variant3 ($12:89C7, ext $1D): LDA #$0004
//
// CODE_1289CC: STA $15 (orientation), LDA #$0002 : STA $2E : STA $2A (fixed
// 2x2 extent), then JMP CODE_walker_setup_trampoline with per-cell handler
// CODE_12AAE5. So this is a walker-driven (shape-2) ext object, not a
// single-cell stamp. The dispatch key is the extID-derived orientation
// (0x00 / 0x02 / 0x04), which selects which tile group the stamper reads.
//
// Per-cell stamper CODE_12AAE5 ($12:AAE5):
//     REP #$30 : LDX $15 : LDA DATA_12AADF,x : STA $00   ; group ptr by orient
//     LDA $2C : ASL : ORA $28 : ASL : TAY                ; word index in group
//     LDA ($00),y : BEQ skip : LDX $1D : STA buffer,x    ; stamp (0 = skip)
//
// DATA_12AADF ($12:AADF) is a 3-entry word table of group pointers, indexed
// by $15 (0/2/4 as a byte offset → entry 0/1/2):
//     dw DATA_12AAC7, DATA_12AACF, DATA_12AAD7
// Each group is 4 words; the FIRST word is the BEQ-skip sentinel ($0000).
// From the asm closure (version-stable):
//     DATA_12AAC7 (orient $00, $1B): dw $0000, $A55E, $A561, $A562
//     DATA_12AACF (orient $02, $1C): dw $0000, $A55F, $A563, $A564
//     DATA_12AAD7 (orient $04, $1D): dw $0000, $A560, $A565, $A566
//
// The walker populates state.zp28 = col (inner, X / horizontal) and
// state.zp2C = row (outer, Y / vertical). The stamper's word index is
// (row<<1)|col = row*2 + col:
//     (row0,col0) -> idx0 = $0000  -> BEQ skip (no stamp, top-left)
//     (row0,col1) -> idx1                            (top-right)
//     (row1,col0) -> idx2                            (bottom-left)
//     (row1,col1) -> idx3                            (bottom-right)
// NOTE: a prior version indexed `(col<<1)|row`, which transposed the off-
// diagonal cells — the two halves of the world-6 skull rendered swapped
// (4-7/6-6 record 0x32 ext-$1B). The diagonal cells (idx 0/3) are unchanged
// either way, so a trace that only checked those wouldn't catch it.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12AADF groups, keyed by orientation ($15). Cart stamper indexes each
// group by `(row << 1) | col` (= row*2 + col — `LDA $2C : ASL : ORA $28 : ASL`),
// so the 2x2 is laid out ROW-MAJOR [r0c0, r0c1, r1c0, r1c1]. The r0c0 slot is
// the cart's BEQ-skip sentinel ($0000) — that top-left cell is left blank.
const BONE_TILE_GROUPS: Record<number, readonly number[]> = {
  0x00: [0x0000, 0xa55e, 0xa561, 0xa562],
  0x02: [0x0000, 0xa55f, 0xa563, 0xa564],
  0x04: [0x0000, 0xa560, 0xa565, 0xa566],
};

// Shared body — ports CODE_1289CC ($12:89CC). Forces a 2x2 extent and
// dispatches the walker with the orientation-selected tile group.
function initWorld6Bone(state: DecodeState, orientation: number): void {
  state.zp15 = orientation; // STA $15
  state.zp2A = 2; // STA $2A — col extent
  state.zp2E = 2; // STA $2E — row extent
  walkerSetupTrampoline(state, perCellWorld6Bone);
}

// Ports CODE_extobj_handler_world6_bone_variant1 ($12:89B9) — ext $1B.
function initWorld6BoneVariant1(state: DecodeState): void {
  initWorld6Bone(state, 0x00);
}

// Ports CODE_extobj_handler_world6_bone_variant2 ($12:89C0) — ext $1C.
function initWorld6BoneVariant2(state: DecodeState): void {
  initWorld6Bone(state, 0x02);
}

// Ports CODE_extobj_handler_world6_bone_variant3 ($12:89C7) — ext $1D.
function initWorld6BoneVariant3(state: DecodeState): void {
  initWorld6Bone(state, 0x04);
}

// Ports the per-cell stamper CODE_12AAE5 ($12:AAE5). Indexes the orientation's
// 4-word group by `(row<<1)|col` (cart `LDA $2C : ASL : ORA $28 : ASL`) and
// stamps, skipping a $0000 entry (BEQ) exactly as the cart does — that is what
// leaves the (row0,col0) top-left cell blank.
const perCellWorld6Bone: PerCellHandler = (state: DecodeState) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const group = BONE_TILE_GROUPS[state.zp15 & 0xff] ?? BONE_TILE_GROUPS[0x00];
  const tile = group[(row << 1) | col];
  if (tile === 0) return; // BEQ CODE_12AAFF — leave existing cell untouched
  stampCell(state, tile);
};

export function installExtWorld6BoneHandlers(): void {
  registerExtObjectHandler(0x1b, initWorld6BoneVariant1);
  registerExtObjectHandler(0x1c, initWorld6BoneVariant2);
  registerExtObjectHandler(0x1d, initWorld6BoneVariant3);
}
