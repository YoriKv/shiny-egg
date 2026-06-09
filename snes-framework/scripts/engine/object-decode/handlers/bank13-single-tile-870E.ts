// Bank13 stamp handler for std object $D2 — single-tile $870E stamp.
//
//
// Init (Bank12.asm:5128, CODE_init_single_tile_870E @ $12:A147):
//   REP #$20
//   LDX #(CODE_stamp_single_tile_870E-$01)>>16     ; bank byte of per-cell handler
//   LDA #CODE_stamp_single_tile_870E-$01           ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline    ; all 3 slots = CODE_stamp_single_tile_870E
//
// Per-cell stamp (Bank13.asm:13201, CODE_stamp_single_tile_870E @ $13:ECA8):
//   REP #$30
//   LDA #$870E
// CODE_13ECAD:                     ; shared tail with sibling $D1 ($870F)
//   LDX $1D
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// Translation: every cell stamps the constant Map16 ID $870E (single-tile
// decoration, sibling of $D1's $870F stamp — both fall through to the
// same epilogue at CODE_13ECAD). The init does not mutate any walker-
// relevant DP fields, so the stream's raw column/row extents drive the
// rectangle — the spec's 2-cell run (col_extent=$0002, row_extent=$0001)
// confirms a flat `[870E]*2` fill across one row.
//
// Init DP diff: none — spec confirms xy_lo/xy_hi/$2A/$2E/$15 all unchanged
// from stream entry to walker time.
//
// Same shape as $D1 (single_tile_870F), $9E (single_tile_7502), $77
// (single_spike) and $6C (single_tile_trigger): trampoline-into-walker
// with a per-cell handler that stamps one constant Map16 ID. Differs
// from $6C in the constant and the absence of $6C's shadow-merge tail
// (CODE_wall_thick_neighbour_epilogue) — $D2's stamp ends with the shared SEP/RTL epilogue,
// no neighbour-fix.
//
// No GoldenEgg counterpart — ReSharper search across `ge.sln` for
// "single_tile_870E" / "SingleTile870E" / "init_single_tile_870E" / "Stamp870E"
// / "Tile870E" returns zero hits, matching the pattern noted on the other
// single-tile handlers in this family.

import { registerStdObjectHandler } from './index.ts';
import { makeConstStampInit } from './_shared.ts';

const TILE_SINGLE_TILE_870E = 0x870E;

const initSingleTile870E = makeConstStampInit(TILE_SINGLE_TILE_870E);

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installSingleTile870EHandlers(): void {
  registerStdObjectHandler(0xD2, initSingleTile870E);
}
