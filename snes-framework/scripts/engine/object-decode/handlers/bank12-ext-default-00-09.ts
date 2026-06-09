// Ext-object init handler — DATA_extended_object_init_ptrs dispatch slots 0x00-0x09
// ("default" terrain/decoration blocks: bushes, small ledges, etc.).
//
// Ports CODE_extobj_handler_default_00_09 ($12:8891, Bank12.asm:1540) plus
// its per-cell stamper CODE_extobj_default_percell ($12:A48A, Bank12.asm:5806)
// and the four data tables those routines walk:
//   DATA_12A45C  10-entry tile-table pointer table   (Bank12.asm:5776)
//   DATA_12A476  10-entry pitch-table pointer table   (Bank12.asm:5789)
//   DATA_default_handler_tiles_orient0 .. DATA_12A450  per-id tile tables
//                                                      (Bank12.asm:5745-5774)
//   DATA_12A470 / A472 / A474                          per-id pitch tables
//                                                      (Bank12.asm:5780-5787)
//
// WALKER-DRIVEN extended object (shape 2 in tmp/ext-brief.md), not a single
// inline stamp. The init sets a per-id column extent + a fixed row extent of
// 3, latches `$15 = id*2` (the byte index the per-cell uses into the
// word-sized pointer tables), then tail-calls the shared walker setup
// trampoline. The walker visits the col×row rectangle column-major and calls
// the per-cell stamper for each cell.
//
// Init handler (verbatim, Bank12.asm:1540):
//   REP #$20
//   LDY $15                                  ; Y = ext id (0..9), set by parser
//   LDA DATA_default_handler_extents,y       ; per-id col extent
//   AND #$00FF : STA $2A
//   LDA #$0003 : STA $2E                     ; row extent = 3 (fixed)
//   TYA : ASL : STA $15                      ; $15 := id*2  (table byte index)
//   LDX #(CODE_extobj_default_percell-1)>>16
//   LDA #CODE_extobj_default_percell-1
//   JMP CODE_walker_setup_trampoline         ; slope 0; all 3 walker slots = stamper
//
// Per-cell stamper (verbatim, Bank12.asm:5806):
//   REP #$30
//   LDX $15                                  ; X = id*2 (byte index)
//   LDA DATA_12A45C,x : STA $00              ; $00 = tile-table ptr for this id
//   LDA DATA_12A476,x : STA $02              ; $02 = pitch-table ptr (= base-1)
//   LDY $2C                                  ; Y = row
//   BEQ +                                    ; row 0 -> base index 0
//   LDA ($02),y : AND #$00FF : TAY           ; Y = pitch[row]  (per-row base)
// + TYA : CLC : ADC $28 : ASL : TAY          ; Y = (pitch[row] + col) * 2
//   LDA ($00),y : BEQ +                      ; tile == 0 -> skip (no stamp)
//   LDX $1D : STA.l LevelDataBuffer,x        ; stamp
// + SEP #$30 : RTL
//
// Tables are ROW-MAJOR: tile[ (row==0 ? 0 : pitch[row]) + col ]. The pitch
// pointer is stored `DATA_12A47x-$01`, so `($02),y` reads byte `(y-1)` of a
// 2-byte `db` table; combined with the row-0 BEQ this yields the effective
// per-row base map below. The per-id pitch is `[0, colExtent, 2*colExtent]`
// (the row stride), so the tile table is plain row-major. This is exactly the
// two-table lookup the brief describes (A = DATA_12A45C[id], pitch B =
// DATA_12A476[id], index = (B[row] + col)).
//
// All four tables transcribed VERBATIM from the asm `dw`/`db` lines (NOT a
// ROM byte-read, so V1.0/V1.1-stable). Word 0 in a tile table is the cart's
// `LDA ($00),y : BEQ` skip sentinel. Verified: every stamped cell across the
// ext-00..ext-09 traces byte-matches (10/10 ids, all cells, plus col extents).
//
// Notable id relationships (DATA_12A45C points each id at its own body table;
// ids 6 & 7 happen to be near-identical 1-col variants). ids 4-7 are the
// single-column (col-extent 1) "narrow" variants flagged in the assignment.
//
// Per-id col extents (DATA_default_handler_extents, Bank12.asm:1510) — row
// extent is always 3:
//   id  0  1  2  3  4  5  6  7  8  9
//   ce  2  2  2  2  1  1  1  1  3  2
//
// No PRNG, no neighbour probes, no template-slot reads, no savefile gates —
// every output is a fixed table read, so there are no static-decode caveats.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// Per-id column extent. Cart: DATA_default_handler_extents (Bank12.asm:1510 —
// `db $02,$02,$02,$02,$01,$01,$01,$01,$03,$02`).
const COL_EXTENT = [2, 2, 2, 2, 1, 1, 1, 1, 3, 2] as const;

// Row extent is hard-coded to 3 by the init (`LDA #$0003 : STA $2E`).
const ROW_EXTENT = 3;

// Per-id tile tables (A), ROW-MAJOR, verbatim from the asm `dw` lines.
// 0x0000 = "skip" sentinel (cart's `LDA ($00),y : BEQ`).
//   id0 DATA_default_handler_tiles_orient0 (5746)
//   id1 DATA_12A402 (5749) | id2 DATA_12A40E (5752) | id3 DATA_12A41A (5755)
//   id4 DATA_12A426 (5758) | id5 DATA_12A42C (5761) | id6 DATA_12A432 (5764)
//   id7 DATA_12A438 (5767) | id8 DATA_12A43E (5770) | id9 DATA_12A450 (5773)
const TILE_TABLE: ReadonlyArray<ReadonlyArray<number>> = [
  /* 0x00 */ [0x9600, 0x9601, 0x9610, 0x9611, 0x0000, 0x920d],
  /* 0x01 */ [0x967d, 0x967e, 0x967b, 0x967c, 0x920c, 0x0000],
  /* 0x02 */ [0x0000, 0x0000, 0x9606, 0x9607, 0x9208, 0x920c],
  /* 0x03 */ [0x0000, 0x0000, 0x9604, 0x9605, 0x920d, 0x920e],
  /* 0x04 */ [0x0000, 0x967a, 0x920d],
  /* 0x05 */ [0x0000, 0x9618, 0x920c],
  /* 0x06 */ [0x0000, 0x967f, 0x920b],
  /* 0x07 */ [0x0000, 0x9612, 0x920a],
  /* 0x08 */ [0x0000, 0x9604, 0x9605, 0x9613, 0x9614, 0x9615, 0x9208, 0x9209, 0x920a],
  /* 0x09 */ [0x9606, 0x9607, 0x9616, 0x9617, 0x920b, 0x920c],
] as const;

// Per-id pitch tables (B). pitch[row] is the row's base word-index into the
// tile table (row 0 forced to 0 by the cart's BEQ). Cart stores
// `DATA_12A47x-$01` and indexes by row; combined with the -1 bias the
// effective per-row base is below — equal to `[0, colExtent, 2*colExtent]`.
//   ids 0-3,9 -> DATA_12A470 (`db $02,$04`)  -> [0,2,4]
//   ids 4-7   -> DATA_12A472 (`db $01,$02`)  -> [0,1,2]
//   id8       -> DATA_12A474 (`db $03,$06`)  -> [0,3,6]
const PITCH_TABLE: ReadonlyArray<ReadonlyArray<number>> = [
  /* 0x00 */ [0, 2, 4],
  /* 0x01 */ [0, 2, 4],
  /* 0x02 */ [0, 2, 4],
  /* 0x03 */ [0, 2, 4],
  /* 0x04 */ [0, 1, 2],
  /* 0x05 */ [0, 1, 2],
  /* 0x06 */ [0, 1, 2],
  /* 0x07 */ [0, 1, 2],
  /* 0x08 */ [0, 3, 6],
  /* 0x09 */ [0, 2, 4],
] as const;

// CODE_extobj_default_percell ($12:A48A). Two-table lookup:
//   wordIndex = (row == 0 ? 0 : pitch[row]) + col
//   tile      = tileTable[wordIndex]      (skip when 0 or out of range)
// `$15` holds id*2 after the init; the cart indexes the word-sized pointer
// tables by that byte offset, i.e. entry `$15 >> 1` = the ext id.
const extDefaultPerCell: PerCellHandler = (state: DecodeState): void => {
  const id = (state.zp15 >>> 1) & 0xff; // $15 = id*2 -> table id
  const tiles = TILE_TABLE[id];
  const pitch = PITCH_TABLE[id];
  if (tiles === undefined || pitch === undefined) return;

  const col = state.zp28 & 0xff; // walker column counter ($28)
  const row = state.zp2C & 0xff; // walker row counter ($2C)
  const base = row === 0 ? 0 : pitch[row] ?? 0; // row 0 -> base 0 (cart BEQ)
  const tile = tiles[base + col];
  if (tile === undefined || tile === 0x0000) return; // cart BEQ skip
  stampCell(state, tile);
};

// CODE_extobj_handler_default_00_09 ($12:8891). Sets per-id col extent +
// fixed row extent 3, latches $15 = id*2, runs the col×row walker with the
// per-cell stamper.
function initExtDefault0009(state: DecodeState): void {
  const id = state.zp15 & 0xff;
  state.zp2A = COL_EXTENT[id] ?? 1;
  state.zp2E = ROW_EXTENT;
  state.zp15 = (id << 1) & 0xff; // TYA : ASL : STA $15
  walkerSetupTrampoline(state, extDefaultPerCell);
}

// Register ext ids 0x00-0x09. The 0x100 mirror is automatic
// (getExtObjectHandler masks id & 0xff).
export function installExtDefault0009Handlers(): void {
  for (let id = 0x00; id <= 0x09; id++) {
    registerExtObjectHandler(id, initExtDefault0009);
  }
}
