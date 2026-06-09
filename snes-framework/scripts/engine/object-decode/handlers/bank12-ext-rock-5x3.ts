// Ports CODE_extobj_handler_rock_5x3 ($12:8C39) — ext object 0x60.
//
// Shape 2 (walker-driven), part of the rock family ext 0x5F-0x66 that all
// share the per-cell stamper CODE_12B101 ($12:B101) and the dispatch tables
// DATA_12B0E1 (column-table base ptr, indexed by $15) + DATA_12B0F1 (row stride,
// indexed by $15). Each member's init sets its own $15 + col/row extents, then
// tail-calls CODE_walker_setup_trampoline (shared tail @ Bank12.asm:2142:
// STA $15 : STX $2A : STY $2E : LDX/LDA #(CODE_12B101-1) : JMP walker_setup).
//
// 0x60 init (Bank12.asm:2090): REP #$10 : LDA #$02 : LDX #$0005 : LDY #$0003
//   => $15 = 2, col extent $2A = 5, row extent $2E = 3.
//
// $15 is a WORD offset into the `dw` dispatch tables (0,2,4,…), not an index:
//   DATA_12B0E1[$15=2] = DATA_12B03B  (verified by spec timeline record_value=B03B)
//   DATA_12B0F1[$15=2] = $000A bytes = 5 words = one 5-col row stride.
//
// Per-cell stamper CODE_12B101 ($12:B101, Bank12.asm:7044), verbatim:
//     REP #$30
//     LDY $2C            ; Y = row counter
//     LDX $15            ; X = orientation word-offset (2)
//     LDA DATA_12B0E1,x  ; A = column-table base ptr (DATA_12B03B)
//   .loop (B10A): DEY : BMI .deref : CLC : ADC DATA_12B0F1,x : BRA .loop  ; +stride*row
//   .deref (B113): STA $00 ; $00 = base + row*stride
//     LDA $28 : ASL : TAY        ; Y = col*2
//     LDX $1D                    ; X = buffer offset
//     LDA ($00),y : BEQ .done    ; entry = table[row*5 + col]; 0 → skip
//     TAY : LDA $0000,y : STA buffer,x   ; two-tier deref + stamp
//   .done (B127): SEP #$30 : RTL
//
// Table DATA_12B03B (Bank12.asm:6941, 15 words = 5 cols x 3 rows, row-major):
//   row0: $0000  $1A04  $1A44  $1A52  $0000
//   row1: $19DC  DATA_12B01F  DATA_12B021  DATA_12B023  $19F0
//   row2: $19E6  DATA_12B025  DATA_12B027  DATA_12B029  $19FA
//   where DATA_12B01F..029 are 1-word ROM tables = $01B1..$01B6 (the constant
//   rock-art tiles, identical across all tilesets).
//
// Two-tier entry resolution — cart's `TAY : LDA $0000,y` at bank $12:
//   * entry < $2000  → WRAM low-RAM ($7E:19xx/$7E:1Axx) → per-tileset Map16
//     template slot → state.templateAt(entry).
//   * entry >= $8000 → ROM word in bank $12 → a literal Map16 id (the
//     DATA_12B0xx label addresses, pre-dereferenced here to $01Bx).
//   * entry == 0     → stamp nothing (the BEQ).
//
// VERIFIED cell-for-cell:
// all 15 walker cells match — 2 skips (col0/row0, col4/row0), 9 template-slot
// reads at the exact tpl offsets, 6 ROM-literal stamps ($01B1..$01B6) at the
// exact buffer offsets.
import type { DecodeState } from '../state.ts';
import type { RockEntry } from './_shared.ts';
import { makeRockEntryStamp } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// One cart `entry` word, tagged by resolution tier so the per-cell stamper
// applies the correct tier without a magic numeric threshold.

// DATA_12B03B column table for orientation $15 = 2, indexed [col][row]
// (col 0..4, row 0..2). ROM-literal entries DATA_12B01F..029 stored
// pre-dereferenced to their 1-word ROM contents ($01B1..$01B6).
const COLUMN_TABLE: RockEntry[][] = [
  /* col 0 */ [{ skip: true }, { slot: 0x19dc }, { slot: 0x19e6 }],   // row0 entry == 0
  /* col 1 */ [{ slot: 0x1a04 }, { mapid: 0x01b1 }, { slot: 0x19f0 }], // row1 = DATA_12B01F
  /* col 2 */ [{ slot: 0x1a44 }, { mapid: 0x01b2 }, { mapid: 0x01b4 }], // DATA_12B021 / 025
  /* col 3 */ [{ slot: 0x1a52 }, { mapid: 0x01b3 }, { mapid: 0x01b5 }], // DATA_12B023 / 027
  /* col 4 */ [{ skip: true }, { slot: 0x19f0 }, { slot: 0x19fa }],   // row0 entry == 0
];

// CODE_12B101 — per-cell stamper (shared family routine).
// CODE_12B101 — shared rock per-cell stamper (see _shared.ts).
const perCellRock5x3 = makeRockEntryStamp(COLUMN_TABLE, 'colMajor');

// CODE_extobj_handler_rock_5x3 init ($12:8C39).
function initRock5x3(state: DecodeState): void {
  state.zp15 = 0x0002; // STA $15 (orientation word-offset = 2 → DATA_12B03B)
  state.zp2A = 0x0005; // STX $2A (col extent = 5)
  state.zp2E = 0x0003; // STY $2E (row extent = 3)
  walkerSetupTrampoline(state, perCellRock5x3);
}

export function installExtRock5x3Handlers(): void {
  registerExtObjectHandler(0x60, initRock5x3);
}
