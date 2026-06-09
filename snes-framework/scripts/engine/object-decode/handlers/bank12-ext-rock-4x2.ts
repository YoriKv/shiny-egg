// Ports CODE_extobj_handler_rock_4x2 ($12:8C2D) — ext object 0x5F.
//
// Shape 2 (walker-driven). The init (Bank12.asm:2082) is:
//     REP #$10 : LDA #$00 : LDX #$0004 : LDY #$0002
//     BRA CODE_extobj_handler_rock_shared_tail   ($12:8C7D)
// and the shared tail does:
//     STA $15 : STX $2A : STY $2E         ; $15=0, col extent=4, row extent=2
//     LDX/LDA #(CODE_12B101-1) : JMP CODE_walker_setup_trampoline
// So this is a 4-col x 2-row block painted by the standard walker, with the
// per-cell stamper CODE_12B101 and orientation byte $15 = 0. (IDs $60-$66
// share that tail with different $15/extent stubs; only 0x5F is assigned here.)
//
// Per-cell stamper CODE_12B101 ($12:B101, Bank12.asm:7044), verbatim:
//     REP #$30
//     LDY $2C            ; Y = row counter
//     LDX $15            ; X = orientation (0)
//     LDA DATA_12B0E1,x  ; A = the column-table pointer for this orientation
//   .loop (B10A):
//     DEY : BMI .deref   ; add stride `row` times (row==0 → 0 adds)
//     CLC : ADC DATA_12B0F1,x : BRA .loop
//   .deref (B113):
//     STA $00            ; $00 = colTablePtr + row*stride
//     LDA $28 : ASL : TAY        ; Y = col*2
//     LDX $1D                    ; X = buffer offset
//     LDA ($00),y        ; entry = colTable[col]  (DP-indirect-indexed word)
//     BEQ .done          ; entry==0 → stamp nothing
//     TAY : LDA $0000,y  ; A = mem16[$12:entry]  (see two-tier note below)
//     STA buffer,x       ; stamp it
//   .done (B127): SEP #$30 : RTL
//
// Tables (Bank12.asm:6931+, resolved via codegraph closure):
//   DATA_12B0E1[$15] = column-table base ptr; [$00] = DATA_12B02B.
//   DATA_12B0F1[$15] = row stride;            [$00] = $0008 (8 bytes = 4 words).
//   DATA_12B02B (the orientation-0 column table) holds 4 cols x 2 rows of
//   16-bit `entry` words (row0 = first 4, row1 = next 4 at +$0008):
//     row0: $19DC      $1A44      $1A52      $0000
//     row1: $19E6  DATA_12B00D  DATA_12B01D  $1A1A
//
// Two-tier entry resolution — the cart's `TAY : LDA $0000,y` reads the SNES
// bus at bank $12, offset = entry:
//   * entry < $2000  → WRAM low-RAM mirror ($7E:19xx) → a per-tileset Map16
//     template slot → state.templateAt(entry).  (e.g. $19DC,$1A44,$1A52,
//     $19E6,$1A1A — the GroundTopLeft / WallRight / etc. slots.)
//   * entry >= $8000 → ROM in bank $12 → a literal Map16 id stored at that
//     DATA label. DATA_12B00D = $01A8, DATA_12B01D = $01B0 (constant
//     rock tiles, identical across all tilesets).
//   * entry == 0     → stamp nothing (the BEQ).
//
// Verified cell-for-cell against the captured trace
// (all 8 data cells: same entry, same skip at col3/row0, same stamped Map16
// id at the same buffer offset; the spec's tpl_read16 slot equals each
// WRAM-range entry, and the two ROM-constant cells stamp $01A8 / $01B0).
import type { DecodeState } from '../state.ts';
import type { RockEntry } from './_shared.ts';
import { makeRockEntryStamp } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12B02B column table for orientation $15 = 0, indexed [col][row]
// (col 0..3, row 0..1). Each value is the cart `entry` word:
//   - a WRAM template-slot address (< $2000)  → state.templateAt(entry)
//   - a literal Map16 id from a $12:Bxxx ROM word (kept as the dereferenced
//     constant, since DATA_12B00D/$01D are 1-word ROM tables)
//   - 0 → stamp nothing
// Tagged so the per-cell stamper applies the correct tier without a magic
// numeric threshold.

const COLUMN_TABLE: RockEntry[][] = [
  /* col 0 */ [{ slot: 0x19dc }, { slot: 0x19e6 }],
  /* col 1 */ [{ slot: 0x1a44 }, { mapid: 0x01a8 }], // row1 = DATA_12B00D
  /* col 2 */ [{ slot: 0x1a52 }, { mapid: 0x01b0 }], // row1 = DATA_12B01D
  /* col 3 */ [{ skip: true }, { slot: 0x1a1a }],    // row0 entry == 0
];

// CODE_12B101 — per-cell stamper.
// CODE_12B101 — shared rock per-cell stamper (see _shared.ts).
const perCellRock4x2 = makeRockEntryStamp(COLUMN_TABLE, 'colMajor');

// CODE_extobj_handler_rock_4x2 init ($12:8C2D).
function initRock4x2(state: DecodeState): void {
  state.zp15 = 0x0000; // STA $15 (orientation re-encoded to 0)
  state.zp2A = 0x0004; // STX $2A (col extent)
  state.zp2E = 0x0002; // STY $2E (row extent)
  walkerSetupTrampoline(state, perCellRock4x2);
}

export function installExtRock4x2Handlers(): void {
  registerExtObjectHandler(0x5f, initRock4x2);
}
