// Bank12 EXTENDED-object handler: tree-left grass overhang (ext $4B).
//
// EXTENDED-object family (4-byte stream record, dispatched by CODE_108C13
// via DATA_extended_object_init_ptrs). Inline single-cell
// (shape 1) — no walker. The init re-resolves the anchor via
// CODE_get_current_map16_tile, then tail-calls CODE_12AD00 which stamps a
// CONSTANT tile $3D41 at the anchor and then runs a right-neighbour
// seam-fix: if the cell immediately to the right is a tree-right edge tile
// ($3D3B / $3D3C / $3D49), that RIGHT cell is overwritten with the joint
// tile $3D4A so the two tree halves blend.
//
// There is no `$15`/param dispatch — the Map16 ids are flat constants.
//
// Asm sources:
//   CODE_extobj_handler_tree_left_grass  Bank12.asm:1892 ($12:8AF5)
//     aliases: CODE_extobj_handler_tree_left_grass
//   CODE_12AD00 / CODE_12AD05            Bank12.asm:6497 ($12:AD00)
//   CODE_get_current_map16_tile          Bank12.asm:1171 ($12:86FD)
//   CODE_get_map16_right                 Bank12.asm:1349 ($12:87E2)
//
// Asm (verbatim):
//
//   CODE_extobj_handler_tree_left_grass:
//     JSR.w CODE_get_current_map16_tile   ; resolve $1D from $1B/$1C, latch $12
//     REP.b #$30
//     JSL.l CODE_12AD00
//     SEP.b #$30
//     RTL
//
//   CODE_12AD00:
//     LDX.b $1D
//     LDA.w #$3D41
//   CODE_12AD05:
//     STA.l !RAM_YI_Level_LevelDataBuffer,x   ; stamp $3D41 at the anchor
//     LDA.b $1B ; STA.b $0E                    ; probe coord = current cell
//     JSL.l CODE_get_map16_right               ; X = right-neighbour offset
//     LDA.l !RAM_YI_Level_LevelDataBuffer,x    ; read right neighbour tile
//     CMP.w #$3D3B ; BEQ CODE_12AD24
//     CMP.w #$3D3C ; BEQ CODE_12AD24
//     CMP.w #$3D49 ; BNE CODE_12AD2C
//   CODE_12AD24:
//     NOP
//     LDA.w #$3D4A
//     STA.l !RAM_YI_Level_LevelDataBuffer,x    ; overwrite RIGHT cell with joint tile
//   CODE_12AD2C:
//     RTL
//
// Spec (ext-4B) cell 0: anchor xy=33:F2 → stamp $3D41 at $7F83E4 (offset
// $03E4), then probe right; trace's right neighbour is empty (no match) so
// only the $3D41 stamp lands. The seam-fix branch is still ported so it
// fires faithfully when a tree-right edge sits to the right.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile, getMap16Right } from '../fetch.ts';
import { stampCell, readBuf16, writeBuf16, setProbeToCurrent } from './_shared.ts';

// Cart asm: `LDA.w #$3D41`. Constant tree-left grass overhang tile.
const TREE_LEFT_GRASS_TILE = 0x3D41;

// Cart asm: right-neighbour seam-fix. If the cell to the right is one of
// these tree-right edge tiles, overwrite it with the joint tile.
const SEAM_MATCH_A = 0x3D3B;
const SEAM_MATCH_B = 0x3D3C;
const SEAM_MATCH_C = 0x3D49;
const SEAM_JOINT_TILE = 0x3D4A;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_tree_left_grass ($12:8AF5) → CODE_12AD00 ($12:AD00).
//
// `getCurrentMap16Tile` re-resolves the anchor's buffer offset into $1D
// (and latches the existing tile into $12). It may throw
// ScreenOverflowError — let it propagate; the parser catches it. Then
// stamp the constant tile and run the right-neighbour seam-fix.
// ─────────────────────────────────────────────────────────────────────

function extTreeLeftGrass(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D (and latches $12).
  getCurrentMap16Tile(state);

  // CODE_12AD05: stamp $3D41 at the anchor cell ($1D).
  stampCell(state, TREE_LEFT_GRASS_TILE);

  // LDA $1B / STA $0E ; JSL CODE_get_map16_right — probe the RIGHT
  // neighbour. `getMap16Right` returns that neighbour's buffer offset.
  setProbeToCurrent(state);
  const rightOff = getMap16Right(state);
  const rightTile = readBuf16(state, rightOff);

  // If the right neighbour is a tree-right edge tile, overwrite THAT cell
  // (not the anchor) with the joint tile $3D4A.
  if (rightTile === SEAM_MATCH_A || rightTile === SEAM_MATCH_B || rightTile === SEAM_MATCH_C) {
    writeBuf16(state, rightOff, SEAM_JOINT_TILE);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $4B only (the $14B mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtTreeLeftGrassHandlers(): void {
  registerExtObjectHandler(0x4B, extTreeLeftGrass);
}
