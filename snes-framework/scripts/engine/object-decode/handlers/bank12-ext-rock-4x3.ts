// Ports CODE_extobj_handler_rock_4x3 — ext object 0x65.
//
// Shape 2 (walker-driven), part of the rock family ext 0x5F-0x66 that all
// share the per-cell stamper CODE_12B101 ($12:B101) and the dispatch tables
// DATA_12B0E1 (column-table base ptr, indexed by $15) + DATA_12B0F1 (row stride,
// indexed by $15). Each member's init sets its own $15 + col/row extents, then
// tail-calls CODE_walker_setup_trampoline (shared tail: STA $15 : STX $2A :
// STY $2E : LDX/LDA #(CODE_12B101-1) : JMP walker_setup).
//
// 0x65 init: $15 = $0C, col extent $2A = 4, row extent $2E = 3 (spec
// init_dp_delta: col 1→4, row 1→3, orientation 65→0C).
//
// $15 is a WORD offset into the `dw` dispatch tables. For $15 = $0C:
//   DATA_12B0E1[$0C] = DATA_12B0C1  (spec timeline record_addr=$12B0ED value=$B0C1)
//   DATA_12B0F1[$0C] = $0008 bytes = 4 words = one 4-col row stride.
//
// Per-cell stamper CODE_12B101 ($12:B101), verbatim:
//     REP #$30
//     LDY $2C            ; Y = row counter
//     LDX $15            ; X = orientation word-offset ($0C)
//     LDA DATA_12B0E1,x  ; A = column-table base ptr (DATA_12B0C1)
//   .loop (B10A): DEY : BMI .deref : CLC : ADC DATA_12B0F1,x : BRA .loop  ; +stride*row
//   .deref (B113): STA $00         ; $00 = base + row*stride
//     LDA $28 : ASL : TAY          ; Y = col*2
//     LDX $1D                      ; X = buffer offset
//     LDA ($00),y : BEQ .done      ; entry = table[row*4 + col]; 0 → skip
//     TAY : LDA $0000,y : STA buffer,x   ; two-tier deref + stamp
//   .done (B127): SEP #$30 : RTL
//
// Table DATA_12B0C1 (Bank12.asm:7018, 12 words = 4 cols x 3 rows, row-major;
// from asm closure):
//   row0 (words 0-3):  $0000       $1A04        $1A18        $0000
//   row1 (words 4-7):  $19DC  DATA_12B01F  DATA_12B023  $19F0
//   row2 (words 8-11): $19E6  DATA_12B019  DATA_12B029  $19FA
//   where the ROM-literal 1-word tables deref to constant rock-art tiles
//   (identical across all tilesets):
//     DATA_12B01F=$01B1  DATA_12B019=$01AE  DATA_12B023=$01B3  DATA_12B029=$01B6
//
// Two-tier entry resolution — cart's `TAY : LDA $0000,y` at bank $12:
//   * entry < $2000  → WRAM low-RAM ($7E:19xx/$7E:1Axx) → per-tileset Map16
//     template slot → state.templateAt(entry).
//   * entry >= $8000 → ROM word in bank $12 → a literal Map16 id (the
//     DATA_12B0xx label addresses, pre-dereferenced here).
//   * entry == 0     → stamp nothing (the BEQ).
//
// VERIFIED cell-for-cell:
// all 12 walker cells match — 2 skips (col0/row0, col3/row0), 6 template-slot
// reads at the exact tpl offsets ($19DC,$19E6,$1A04,$1A18,$19F0,$19FA), and 4
// ROM-literal stamps ($01B1,$01AE,$01B3,$01B6) at the exact buffer offsets.
import type { DecodeState } from '../state.ts';
import type { RockEntry } from './_shared.ts';
import { makeRockEntryStamp } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// One cart `entry` word, tagged by resolution tier so the per-cell stamper
// applies the correct tier without a magic numeric threshold.

// DATA_12B0C1 column table for orientation $15 = $0C, indexed [col][row]
// (col 0..3, row 0..2). Row-major source transposed to [col][row] to match the
// sibling rock handlers' indexing. ROM-literal entries pre-dereferenced.
const COLUMN_TABLE: RockEntry[][] = [
  /* col 0 */ [{ skip: true }, { slot: 0x19dc }, { slot: 0x19e6 }],     // row0 entry == 0
  /* col 1 */ [{ slot: 0x1a04 }, { mapid: 0x01b1 }, { mapid: 0x01ae }], // DATA_12B01F / 019
  /* col 2 */ [{ slot: 0x1a18 }, { mapid: 0x01b3 }, { mapid: 0x01b6 }], // DATA_12B023 / 029
  /* col 3 */ [{ skip: true }, { slot: 0x19f0 }, { slot: 0x19fa }],     // row0 entry == 0
];

// CODE_12B101 — per-cell stamper (shared family routine).
// CODE_12B101 — shared rock per-cell stamper (see _shared.ts).
const perCellRock4x3 = makeRockEntryStamp(COLUMN_TABLE, 'colMajor');

// CODE_extobj_handler_rock_4x3 init.
function initRock4x3(state: DecodeState): void {
  state.zp15 = 0x000c; // STA $15 (orientation word-offset = $0C → DATA_12B0C1)
  state.zp2A = 0x0004; // STX $2A (col extent = 4)
  state.zp2E = 0x0003; // STY $2E (row extent = 3)
  walkerSetupTrampoline(state, perCellRock4x3);
}

export function installExtRock4x3Handlers(): void {
  registerExtObjectHandler(0x65, initRock4x3);
}
