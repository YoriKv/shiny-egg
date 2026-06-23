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
// Neighbour epilogue: the cart's JMP CODE_wall_thick_neighbour_epilogue tails
// into wall_thick_neighbour_epilogue — a shared routine that probes the cells
// below / right / below-right and remaps their Map16 IDs when they match wall-
// tile families. For a 1-wide cement column (colExt 1) the right-probe fires on
// EVERY cell: row 0 → wall_h_block_right_probe, rows 1+ →
// wall_h_block_right_probe_random. When the cell to the right is a diagonal-wall
// cap ($00C9..$00CC) or body ($00C2), the remap stamps the connector/seam tiles
// ($00C5 / $00D5 / $77E2-$77E5) that join the cement column to an abutting
// diagonal wall — e.g. record $2B, where two cement columns ($53@120, $54@135)
// sit directly left of diagonal walls. (An earlier port SKIPPED this epilogue as
// "cosmetic, only adjacent to a $41 wall"; that dropped those 10 join tiles. The
// epilogue is the cart's, byte-for-byte, so it's correct wherever a neighbour
// happens to be $0000 too — it just no-ops there.)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { wallThickNeighbourEpilogue } from './bank13-floor.ts';

const TILE_GRAY_CEMENT_BLOCK = 0x0184;

const stampGrayCementBlock: PerCellHandler = (state) => {
  stampCell(state, TILE_GRAY_CEMENT_BLOCK);
  // Cart: JMP CODE_wall_thick_neighbour_epilogue (tail-call).
  wallThickNeighbourEpilogue(state);
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
