// Ports CODE_extobj_handler_rock_5x4_b ($12:8C5D) — ext object 0x64.
//
// Shape 2 (walker-driven), member of the rock family (ext 0x5F-0x66)
// that all share the per-cell stamper CODE_12B101 ($12:B101) and the dispatch
// tables DATA_12B0E1 (column-table pointer, indexed by $15) + DATA_12B0F1 (row
// stride, indexed by $15). Each member's init sets its own $15 + col/row
// extents, then tail-calls the shared trampoline
// (CODE_extobj_handler_rock_shared_tail, Bank12.asm:2142: STA $15 :
// STX $2A : STY $2E : LDX/LDA #(CODE_12B101-1) : JMP walker_setup).
//
// 0x64 init (Bank12.asm:2119): REP #$10 : LDA #$0A : LDX #$0005 : LDY #$0004
//   => $15 = 0x0A, col extent $2A = 5, row extent $2E = 4.
//
// $15 is a WORD offset into the `dw` pointer tables (0,2,4,…):
//   DATA_12B0E1[$15=0x0A] = DATA_12B099  (spec: entry at $12B0EB = $B099)
//   DATA_12B0F1[$15=0x0A] = $000A bytes  = 5 words = one 5-col row stride.
//
// Per-cell stamper CODE_12B101 ($12:B101), verbatim (shared with 0x5F-0x66):
//     REP #$30
//     LDY $2C            ; Y = row counter
//     LDX $15            ; X = orientation word-offset (0x0A)
//     LDA DATA_12B0E1,x  ; A = column-table base ptr (DATA_12B099)
//   .loop (B10A): DEY : BMI .deref : CLC : ADC DATA_12B0F1,x : BRA .loop ; +stride*row
//   .deref (B113): STA $00 ; $00 = base + row*stride
//     LDA $28 : ASL : TAY        ; Y = col*2
//     LDX $1D                    ; X = buffer offset
//     LDA ($00),y : BEQ .done    ; entry = table[row*5 + col]; 0 → skip
//     TAY : LDA $0000,y : STA buffer,x   ; two-tier deref + stamp
//   .done (B127): SEP #$30 : RTL
//
// Two-tier entry resolution — cart's `TAY : LDA $0000,y` at bank $12:
//   * entry == 0     → stamp nothing (the BEQ).
//   * entry < $2000  → WRAM low-RAM ($7E:19xx/$7E:1Axx) → per-tileset Map16
//     template slot → state.templateAt(entry).
//   * entry >= $8000 → ROM word in bank $12 (a DATA_12B0xx label) → the 1-word
//     `dw` at that label is the literal Map16 id.
//
// DATA_12B099 (Bank12.asm:6996, 20 words = 5 cols x 4 rows, row-major):
//   row0: $0000  $19DC        DATA_12B00B  $1A18        $0000
//   row1: $0000  $19E4        DATA_12B011  DATA_12B013  $0000
//   row2: $19DC  DATA_12B01F  DATA_12B021  DATA_12B015  $19F0
//   row3: $19E6  DATA_12B025  DATA_12B027  DATA_12B017  $19FA
// (Identical to 0x63's DATA_12B071 except row0 col2/col3: $1A44/$1A52 →
// DATA_12B00B/$1A18.) ROM-literal resolutions (Bank12.asm:6886+):
//   DATA_12B00B=$01A7  B011=$01AA  B013=$01AB  B015=$01AC  B017=$01AD
//   B01F=$01B1  B021=$01B2  B025=$01B4  B027=$01B5
//
// VERIFIED cell-for-cell against ext-64 spec.json: all 20 walker cells match the
// asm table 1:1 — 6 skips (col0/row0, col0/row1, col4/row0, col4/row1),
// 6 template-slot reads at the exact tpl offsets (19DC,19E4,1A18 / 19DC,19F0 /
// 19E6,19FA), 8 ROM-literal stamps at the exact buffer offsets. (The 5
// CODE_128874 cells are walker column-wrap events with no stamp.)
import type { DecodeState } from '../state.ts';
import type { RockEntry } from './_shared.ts';
import { makeRockEntryStamp } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// One cart `entry` word, tagged by resolution tier so the per-cell stamper
// applies the correct tier without a magic numeric threshold.

// DATA_12B099, indexed [row][col] (row 0..3, col 0..4) — row-major exactly as
// the cart stamper computes $00 = base + row*stride then indexes col*2.
// ROM-literal entries hold the `dw` value of the noted DATA_12B0xx label.
const ROW_TABLE: RockEntry[][] = [
  /* row 0 */ [{ skip: true }, { slot: 0x19dc }, { mapid: 0x01a7 }, { slot: 0x1a18 }, { skip: true }], // DATA_12B00B
  /* row 1 */ [{ skip: true }, { slot: 0x19e4 }, { mapid: 0x01aa }, { mapid: 0x01ab }, { skip: true }], // B011 / B013
  /* row 2 */ [{ slot: 0x19dc }, { mapid: 0x01b1 }, { mapid: 0x01b2 }, { mapid: 0x01ac }, { slot: 0x19f0 }], // B01F / B021 / B015
  /* row 3 */ [{ slot: 0x19e6 }, { mapid: 0x01b4 }, { mapid: 0x01b5 }, { mapid: 0x01ad }, { slot: 0x19fa }], // B025 / B027 / B017
];

// CODE_12B101 — per-cell stamper (shared family routine).
// CODE_12B101 — shared rock per-cell stamper (see _shared.ts).
const perCellRock5x4B = makeRockEntryStamp(ROW_TABLE, 'rowMajor');

// CODE_extobj_handler_rock_5x4_b init ($12:8C5D).
function initRock5x4B(state: DecodeState): void {
  state.zp15 = 0x000a; // STA $15 (orientation word-offset = 0x0A → DATA_12B099)
  state.zp2A = 0x0005; // STX $2A (col extent = 5)
  state.zp2E = 0x0004; // STY $2E (row extent = 4)
  walkerSetupTrampoline(state, perCellRock5x4B);
}

export function installExtRock5x4BHandlers(): void {
  registerExtObjectHandler(0x64, initRock5x4B);
}
