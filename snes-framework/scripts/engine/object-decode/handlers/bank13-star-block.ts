// Bank13 stamp handler for std object $DA — single-tile $8A00 stamp.
//
//
// Init (Bank12.asm:5179, CODE_init_star_block @ $12:A195):
//   REP #$20
//   LDX #(CODE_stamp_star_block-$01)>>16     ; bank byte of per-cell handler
//   LDA #CODE_stamp_star_block-$01           ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline    ; all 3 slots = CODE_stamp_star_block
//
// Per-cell stamp (Bank13.asm:13813, CODE_stamp_star_block @ $13:F186):
//   REP #$30
//   LDA #$8A00
//   LDX $1D
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// Translation: every cell stamps the constant Map16 ID $8A00 (single-tile
// decoration). The init does not mutate any walker-relevant DP fields, so
// the stream's raw column/row extents drive the rectangle — the spec's
// 256-cell run (col_extent=$0010, row_extent=$0010) confirms a flat
// `[8A00]*256` 16×16 fill.
//
// Init DP diff: none — spec confirms xy_lo/xy_hi/$2A/$2E/$15 all unchanged
// from stream entry to walker time.
//
// Same shape as $D2 (single_tile_870E), $D1 (single_tile_870F), $9E
// (single_tile_7502), $77 (single_spike) and $6C (single_tile_trigger):
// trampoline-into-walker with a per-cell handler that stamps one constant
// Map16 ID. Differs from $6C in the constant and the absence of $6C's
// shadow-merge tail (CODE_wall_thick_neighbour_epilogue) — $DA's stamp ends with a clean SEP/RTL,
// no neighbour-fix epilogue.
//
// No GoldenEgg counterpart — ReSharper search across `ge.sln` for
// "star_block" / "StarBlock" / "init_star_block" / "Stamp8A00"
// / "Tile8A00" returns zero hits, matching the pattern noted on the other
// single-tile handlers in this family.

import { registerStdObjectHandler } from './index.ts';
import { makeConstStampInit } from './_shared.ts';

const TILE_SINGLE_TILE_8A00 = 0x8A00;

const initStarBlock = makeConstStampInit(TILE_SINGLE_TILE_8A00);

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installStarBlockHandlers(): void {
  registerStdObjectHandler(0xDA, initStarBlock);
}
