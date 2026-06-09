// Bank13 stamp handler for std object $77 — single-tile spike.
//
//
// Init (Bank12.asm:4247, CODE_init_twisted_tree_leaf_center @ $12:9B7B):
//   REP #$20
//   LDX #(CODE_stamp_twisted_tree_leaf_center-$01)>>16   ; bank byte of per-cell handler
//   LDA #CODE_stamp_twisted_tree_leaf_center-$01         ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline  ; all 3 slots = CODE_stamp_twisted_tree_leaf_center
//
// Per-cell stamp (Bank13.asm:8483, CODE_stamp_twisted_tree_leaf_center @ $13:C933):
//   REP #$30
//   LDX $1D
//   LDA #$3D58
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// Translation: every cell stamps the constant Map16 ID $3D58 (single-cell
// spike). The init does not mutate any walker-relevant DP fields, so the
// stream's raw column/row extents drive the rectangle — typically a 1-wide
// vertical column of spikes (col_extent=1 in the spec's 16-row sample).
//
// Init DP diff: none — spec confirms xy_lo/xy_hi/$2A/$2E/$15 all unchanged
// from stream entry to walker time.
//
// Same shape as $6C (single_tile_trigger): trampoline-into-walker with a
// per-cell handler that stamps one constant Map16 ID. The only difference
// from $6C is the constant ($3D58 here vs $0184 for the trigger) and the
// absence of $6C's shadow-merge tail (CODE_wall_thick_neighbour_epilogue) — $77's stamp ends with
// a clean SEP/RTL, no neighbour-fix epilogue.
//
// No GoldenEgg counterpart — ReSharper search across `ge.sln` for
// "twisted_tree_leaf_center" / "TwistedTreeLeafCenter" / "init_twisted_tree_leaf_center" returns zero hits,
// matching the pattern noted on the other spike handlers in this batch.

import { registerStdObjectHandler } from './index.ts';
import { makeConstStampInit } from './_shared.ts';

const TILE_SINGLE_SPIKE = 0x3D58;

const initTwistedTreeLeafCenter = makeConstStampInit(TILE_SINGLE_SPIKE);

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installTwistedTreeLeafCenterHandlers(): void {
  registerStdObjectHandler(0x77, initTwistedTreeLeafCenter);
}
