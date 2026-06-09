// Bank13 stamp handler for std object $D1 — single-tile $870F stamp.
//
//
// Init (Bank12.asm:5121, CODE_init_single_tile_870F @ $12:A13D):
//   REP #$20
//   LDX #(CODE_stamp_single_tile_870F-$01)>>16     ; bank byte of per-cell handler
//   LDA #CODE_stamp_single_tile_870F-$01           ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline    ; all 3 slots = CODE_stamp_single_tile_870F
//
// Per-cell stamp (Bank13.asm:13195, CODE_stamp_single_tile_870F @ $13:ECA1):
//   REP #$30
//   LDA #$870F
//   BRA CODE_13ECAD                ; -> shared tail (LDX $1D / STA / SEP / RTL)
// CODE_13ECAD:
//   LDX $1D
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// Translation: every cell stamps the constant Map16 ID $870F (single-tile
// decoration, sibling of $D2's $870E stamp via a BRA into the same epilogue).
// The init does not mutate any walker-relevant DP fields, so the stream's
// raw column/row extents drive the rectangle — the spec's 4-cell run
// (col_extent=$0001, row_extent=$0004) confirms a flat `[870F]*4` fill
// down a single column.
//
// Init DP diff: none — spec confirms xy_lo/xy_hi/$2A/$2E/$15 all unchanged
// from stream entry to walker time.
//
// Same shape as $9E (single_tile_7502), $77 (single_spike) and $6C
// (single_tile_trigger): trampoline-into-walker with a per-cell handler
// that stamps one constant Map16 ID. Differs from $6C in the constant
// and the absence of $6C's shadow-merge tail (CODE_wall_thick_neighbour_epilogue) — $D1's stamp
// ends with the shared SEP/RTL epilogue, no neighbour-fix.
//
// No GoldenEgg counterpart — ReSharper search across `ge.sln` for
// "single_tile_870F" / "SingleTile870F" / "init_single_tile_870F" / "Stamp870F"
// returns zero hits, matching the pattern noted on the other single-tile
// handlers in this family.

import { registerStdObjectHandler } from './index.ts';
import { makeConstStampInit } from './_shared.ts';

const TILE_SINGLE_TILE_870F = 0x870F;

const initSingleTile870F = makeConstStampInit(TILE_SINGLE_TILE_870F);

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installSingleTile870FHandlers(): void {
  registerStdObjectHandler(0xD1, initSingleTile870F);
}
