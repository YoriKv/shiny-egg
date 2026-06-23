// Standard object $DD — init_random_8phase.
//
// Cart entry: CODE_init_random_8phase @ $12:A1B3 (yi/Banks/Bank12.asm:5200).
// Per-cell stamp handler: CODE_stamp_random_8phase @ $13:F2BE (Bank13.asm:13953).
// Edge-helper pair:
//   CODE_random_8phase_left_helper  @ $13:F313 (Bank13.asm:14007)
//   CODE_random_8phase_right_helper @ $13:F31E (Bank13.asm:14014)
// Grid data: DATA_random_8phase_40tile_grid @ $13:F26E (Bank13.asm:13945).
//
// A wide rectangular structural block (e.g. observed at $10 cols × $10 rows
// in the spec) with three visual zones:
//   - Row 0:      a 2-tile cap alternating by column parity ($8D8C / $8D8D).
//   - Rows 1-5:   interior body picked from a 40-entry grid keyed by
//                 row (`($2C-1)*8`) plus PRNG-rolled phase + col (`$15+$28`)
//                 wrapped mod 8. Yields the row-banded family
//                 $8C0F-$8C12 / $798C-$7990 / $7991-$7997 with phase-shifted
//                 column order.
//   - Rows 6+:    clamped to $7997 (the all-same "fade-into-floor" tile).
//
// Edge decoration: column 0 and column ($2A-1) each stamp an extra tile in
// the neighbour cell BEFORE the main grid stamp:
//   - Left edge  → stamp $7998 (row 1) / $7999 (row > 1) at the LEFT neighbour
//   - Right edge → stamp $799A (row 1) / $799B (row > 1) at the RIGHT neighbour
// This is the "decorator overwrite pattern" seen in the spec — it lays a
// 1-tile-wide fringe to the left/right of the body, overwriting whatever
// was previously there.
//
// Init mutates $15 (orientation) from $DD to a PRNG-rolled phase 0-7:
//
//   REP #$20
//   JSL prng ; AND #$0007 ; STA $15
//   LDX #(stamp-1)>>16 ; LDA #stamp-1
//   JMP walker_setup_trampoline
//
// Spec DP diff confirms only $15 changes ($DD → 7). Because $15 feeds the
// `($28 + $15) & 7` indexer, the random pick determines a column-phase
// offset into the 8-tile-per-row body grid — so the random pool is over
// COLUMN ROTATIONS of the row's tiles, not over individual tiles.
//
// asm-disassembly gotcha (noted in passing): the bytes at $13:F315-F319
// are `A9 98 79 85 00` = `LDA #$7998 ; STA $00`, but the Bank13.asm
// disassembly currently shows them as `LDA.b #$98 ; ADC.w $0085,y`
// (mis-split 16-bit immediate). The actual semantics are
// "load $7998 base, store to $00 for the row==1 path; the shared tail
// optionally increments $00 to $7999 for row > 1". Same applies to the
// right helper at $13:F320 ($799A/$799B). Cart bytes confirmed via
// xxd of the built ROM and the spec's observed stamp values.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Left, getMap16Right } from '../fetch.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell, setProbeToCurrent, writeBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_random_8phase_40tile_grid ($13:F26E, Bank13.asm:13945).
//
// 40-entry × 16-bit Map16 grid. Indexed as `[(row-1) * 8 + col_phase]`
// where row in [1..5] (rows >= 6 are clamped before this lookup) and
// col_phase = (col + $15) & 7. Spec cross-check confirms every entry
// is one of {$8C0F,$8C10,$8C11,$8C12, $798C..$7990, $7991..$7997}.
// ─────────────────────────────────────────────────────────────────────
const DATA_random_8phase_40tile_grid: ReadonlyArray<number> = [
  // row 1 (offsets $00..$0E):
  0x8C0F, 0x8C10, 0x8C11, 0x8C10, 0x8C11, 0x8C12, 0x8C0F, 0x8C10,
  // row 2 ($10..$1E):
  0x798C, 0x798D, 0x798E, 0x798D, 0x798F, 0x7990, 0x798C, 0x7990,
  // row 3 ($20..$2E):
  0x7991, 0x7992, 0x7991, 0x7993, 0x7994, 0x7997, 0x7997, 0x7997,
  // row 4 ($30..$3E):
  0x7997, 0x7997, 0x7997, 0x7997, 0x7997, 0x7995, 0x7996, 0x7994,
  // row 5 ($40..$4E):
  0x7995, 0x7996, 0x7997, 0x7997, 0x7997, 0x7997, 0x7997, 0x7997,
];

// Row-0 cap: ($28 & 1) + $8D8C → $8D8C / $8D8D alternating.
const ROW0_CAP_BASE = 0x8D8C;

// Edge-decoration tiles (left/right helpers).
// Left helper picks from {$7998 (row 1), $7999 (row > 1)}.
// Right helper picks from {$799A (row 1), $799B (row > 1)}.
const LEFT_EDGE_TILE_ROW1    = 0x7998;
const LEFT_EDGE_TILE_ROW2PLUS  = 0x7999;
const RIGHT_EDGE_TILE_ROW1   = 0x799A;
const RIGHT_EDGE_TILE_ROW2PLUS = 0x799B;

// Row threshold past which the grid lookup is bypassed and $7997 is
// stamped directly. Cart: `LDA $2C ; CMP #$0006 ; BCS clamp`.
const ROW_CLAMP_THRESHOLD = 6;
const ROW_CLAMP_TILE      = 0x7997;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_random_8phase ($13:F2BE, Bank13.asm:13953).
//
//   REP #$30
//   LDA $2C ; BNE non-row-0
//     ; row 0: $28&1 + $8D8C → stamp
//     LDA $28 ; AND #$0001 ; CLC ; ADC #$8D8C ; BRA stamp_current
//   non-row-0:
//     LDX #0
//     LDA $28 ; BEQ left_edge
//     INX ; INX               ; (helper-pair pointer is at offset 2)
//     INC                     ; A = col + 1
//     CMP $2A                 ; ≠ extent → interior column; skip helper
//     BNE interior
//   left_edge / right_edge:
//     LDA $1B ; STA $0E       ; set probe coord = current cell
//     JSR (DATA_random_8phase_edge_pointer_pair,x)
//     STA.l buffer,x          ; helper stamps fringe at LEFT/RIGHT neighbour
//   interior:
//     LDA $2C ; CMP #$0006 ; BCS clamp_to_7997
//     DEC ; ASL ASL ASL       ; ((row-1) * 8) byte offset
//     STA $00
//     LDA $28 ; CLC ; ADC $15 ; AND #$0007 ; CLC ; ADC $00
//     ASL ; TAY               ; *2 (word table)
//     LDA DATA_random_8phase_40tile_grid,y ; BRA stamp_current
//   clamp_to_7997:
//     LDA #$7997
//   stamp_current:
//     LDX $1D ; STA.l buffer,x ; SEP #$30 ; RTL
//
// Helper internals (asm bytes; .asm disassembly is mis-split — see
// header note):
//
//   left_helper:
//     JSL get_map16_left      ; X = byte offset of LEFT neighbour cell
//     LDA #$7998 ; STA $00    ; default row-1 base
//     BRA shared
//   right_helper:
//     JSL get_map16_right     ; X = byte offset of RIGHT neighbour cell
//     LDA #$799A ; STA $00
//   shared:
//     LDA $2C ; DEC ; BEQ done ; INC $00   ; bump base by 1 for row > 1
//   done:
//     LDA $00 ; RTS           ; return tile in A, X = neighbour offset
//
// The caller's `STA.l buffer,x` stamps the helper's return into the
// neighbour offset. We materialise that as `writeBuf16(state, off, tile)`.
// ─────────────────────────────────────────────────────────────────────
const stampRandom8phase: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;
  const col = state.zp28 & 0xffff;
  const colExtent = state.zp2A & 0xffff;

  // Row-0 cap path: deterministic, no $15 dependency, no edge helper.
  if (row === 0) {
    stampCell(state, (ROW0_CAP_BASE + (col & 0x0001)) & 0xffff);
    return;
  }

  // Edge-decoration pass: column 0 (LEFT helper) or column $2A - 1
  // (RIGHT helper) stamps a fringe tile in the neighbour cell. Interior
  // columns skip this.
  const isLeftEdge  = col === 0;
  const isRightEdge = !isLeftEdge && ((col + 1) & 0xffff) === colExtent;

  if (isLeftEdge || isRightEdge) {
    setProbeToCurrent(state); // mirrors `LDA $1B ; STA $0E`
    const neighbourOff = isLeftEdge ? getMap16Left(state) : getMap16Right(state);
    const baseTile = isLeftEdge ? LEFT_EDGE_TILE_ROW1 : RIGHT_EDGE_TILE_ROW1;
    // Helper tail: row > 1 bumps base by 1.
    const tile = row === 1 ? baseTile : ((baseTile + 1) & 0xffff);
    writeBuf16(state, neighbourOff, tile);
  }

  // Main current-cell stamp: row >= 6 clamps to $7997; otherwise look up
  // in the 40-entry grid keyed by row-band and phase-rotated column.
  if (row >= ROW_CLAMP_THRESHOLD) {
    stampCell(state, ROW_CLAMP_TILE);
    return;
  }

  // Interior body. row in [1..5]; index =
  //   (row - 1) * 8 + ((col + $15) & 7).
  const phase  = state.zp15 & 0x07;
  const rowBlk = (row - 1) << 3;
  const colIdx = (col + phase) & 0x07;
  const idx    = (rowBlk + colIdx) & 0x3f; // 0..39
  stampCell(state, DATA_random_8phase_40tile_grid[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_random_8phase ($12:A1B3, Bank12.asm:5200).
//
//   REP #$20
//   JSL prng ; AND #$0007 ; STA $15      ; encode random phase 0..7 into $15
//   LDX #(CODE_stamp_random_8phase-1)>>16
//   LDA #CODE_stamp_random_8phase-1
//   JMP walker_setup_trampoline           ; slope = 0; all 3 slots = same fn
//
// Spec DP diff: only $15 changes ($DD → 7 in the test trace). Walker
// extents and orientation-relevant slots ($1B/$1C/$2A/$2E) untouched.
//
// PRNG carry note: cart's `get_random_byte` returns a value whose entropy
// derives from PPU HV-counter timing; our LFSR substitute (prng.ts) is
// deterministic. The variant impact here is column-phase rotation of the
// body — purely cosmetic, since all 8 rotations sample the same per-row
// tile set, just at shifted column offsets.
// ─────────────────────────────────────────────────────────────────────
const initRandom8phase: InitHandler = (state) => {
  state.zp15 = prngNext(state, RNG_SITE.initRandom8phase) & 0x07;
  walkerSetupTrampoline(state, stampRandom8phase);
};

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installRandom8phaseHandlers(): void {
  registerStdObjectHandler(0xDD, initRandom8phase);
}
