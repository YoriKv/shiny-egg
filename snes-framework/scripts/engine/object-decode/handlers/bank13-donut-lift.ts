// Bank13 stamp handler for std object $9E — single-tile checkpoint/marker $7502 stamp.
//
//
// Init (Bank12.asm:4666, CODE_init_donut_lift @ $12:9E50):
//   REP #$20
//   LDX #(CODE_stamp_donut_lift-$01)>>16     ; bank byte of per-cell handler
//   LDA #CODE_stamp_donut_lift-$01           ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline    ; all 3 slots = CODE_stamp_donut_lift
//
// Per-cell stamp (Bank13.asm:10941, CODE_stamp_donut_lift @ $13:DA8E):
//   REP #$30
//   LDX $1D
//   LDA #$7502
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// Translation: every cell stamps the constant Map16 ID $7502 (a single-tile
// checkpoint / marker tile). The init does not mutate any walker-relevant DP
// fields, so the stream's raw column/row extents drive the rectangle — the
// spec's 11-cell run (col_extent=$000B, row_extent=$0001) confirms a flat
// `[7502]*11` fill that wraps across the screen-page boundary.
//
// Init DP diff: none — spec confirms xy_lo/xy_hi/$2A/$2E/$15 all unchanged
// from stream entry to walker time.
//
// Same shape as $77 (single_spike) and $6C (single_tile_trigger):
// trampoline-into-walker with a per-cell handler that stamps one constant
// Map16 ID. Differs from $6C in the constant and the absence of $6C's
// shadow-merge tail (CODE_wall_thick_neighbour_epilogue) — $9E's stamp ends with a clean SEP/RTL,
// no neighbour-fix epilogue.
//
// No GoldenEgg counterpart — ReSharper search across `ge.sln` for
// "donut_lift" / "DonutLift" / "init_donut_lift" / "Stamp7502"
// returns zero hits, matching the pattern noted on the other single-tile
// handlers in this family.

import { registerStdObjectHandler } from './index.ts';
import { makeConstStampInit } from './_shared.ts';

const TILE_SINGLE_TILE_7502 = 0x7502;

const initDonutLift = makeConstStampInit(TILE_SINGLE_TILE_7502);

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installDonutLiftHandlers(): void {
  registerStdObjectHandler(0x9E, initDonutLift);
}
