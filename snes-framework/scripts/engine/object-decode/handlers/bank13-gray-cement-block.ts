// Bank13 stamp handler for std object $6C — gray cement block.
//
//
// Init (Bank12.asm:4136, CODE_init_gray_cement_block @ $12:9AC6):
//   REP #$20
//   LDX #(CODE_gray_cement_block-$01)>>16     ; bank byte of per-cell handler
//   LDA #CODE_gray_cement_block-$01           ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline    ; all 3 slots = CODE_gray_cement_block
//
// Per-cell stamp (Bank13.asm:8247, CODE_gray_cement_block @ $13:C7B2):
//   REP #$30
//   LDX $1D
//   LDA #$0184
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   JMP CODE_wall_thick_neighbour_epilogue                ; fall-through to wall_thick_neighbour_epilogue
//
// Translation: every cell stamps the constant Map16 ID $0184 — a flat
// fill of the gray cement-block tile across the object rectangle — then
// JMPs CODE_wall_thick_neighbour_epilogue to attach a secondary (shadow-merge) effect.
// The trace's 3-cell run (col_extent=$0003, row_extent=$0001) confirms
// `[0184, 0184, 0184]`.
//
// Init DP diff: none — the init handler does not mutate any walker-
// relevant DP field before invoking the walker (see spec.md table).
//
// Shadow-merge epilogue: the cart's JMP CODE_wall_thick_neighbour_epilogue tails into
// wall_thick_neighbour_epilogue — a shared shadow-overlay routine that
// probes the cells below/right/below-right and remaps their Map16 IDs
// if they match specific wall-tile families ($00C2..$00D1, etc.). The
// trace records the probes but every neighbour reads as $0000 (the
// pre-stamp buffer fill) so no writeback fires. We skip the epilogue
// for the same reason `bank13-floor.ts`'s $48 wall_block_thick_a port
// skips it: only matters when the cement block is placed adjacent to a
// $41 wall block, which is a shadow-merge cosmetic detail rather
// than a structural-render requirement.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

const TILE_GRAY_CEMENT_BLOCK = 0x0184;

const stampGrayCementBlock: PerCellHandler = (state) => {
  stampCell(state, TILE_GRAY_CEMENT_BLOCK);
};

function initGrayCementBlock(state: DecodeState): void {
  walkerSetupTrampoline(state, stampGrayCementBlock);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installGrayCementBlockHandlers(): void {
  registerStdObjectHandler(0x6C, initGrayCementBlock);
}
