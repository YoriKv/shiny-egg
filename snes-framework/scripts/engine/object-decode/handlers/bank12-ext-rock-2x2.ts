// Ports CODE_extobj_handler_rock_2x2 (Bank12.asm:2136) — ext object 0x66
// = !Define_YI_ExtObj66_Rock8: "Rock 8 (small rock)", the last ID in the rock
// family (0x5F-0x66). 2x2 walker-driven via the shared per-cell stamper
// CODE_12B101.
//
// NAMING: the cart label `CODE_extobj_handler_rock_2x2` matches the
// behaviour-verified ID (ExtendedObjectIDs.asm:286): Rock8, a 2x2 small
// rock, NOT a branch. (The actual "old branch" is ext 0x67; see
// bank12-ext-old-branch.ts.) Earlier disassemblies mislabelled this
// `CODE_extobj_handler_old_branch_2x2`; the asm has since been corrected.
//
// Shape 2 (walker-driven), identical structure to its DONE siblings
// (bank12-ext-rock-4x2.ts / -5x3 / -3x2-a / -3x2-b). The init is:
//     REP #$10 : LDA #$0E : LDX #$0002 : TXY      ; (Bank12.asm:2137-2140)
//     (falls into) CODE_extobj_handler_rock_shared_tail
// and the shared tail (Bank12.asm:2142) does:
//     STA $15 : STX $2A : STY $2E        ; $15=0x0E, col extent=2, row extent=2
//     LDX/LDA #(CODE_12B101-1) : JMP CODE_walker_setup_trampoline
// So this is a 2-col x 2-row block painted by the standard walker, with the
// shared per-cell stamper CODE_12B101 and orientation byte $15 = 0x0E.
//
// Per-cell stamper CODE_12B101 (Bank12.asm:7044), verbatim:
//     REP #$30
//     LDY $2C            ; Y = row counter
//     LDX $15            ; X = orientation ($0E)  -- byte index into word tables
//     LDA DATA_12B0E1,x  ; A = column-table base ptr for this orientation = $B0D9
//   .loop (B10A):
//     DEY : BMI .deref   ; add stride `row` times (row==0 → 0 adds)
//     CLC : ADC DATA_12B0F1,x : BRA .loop   ; stride = DATA_12B0F1[$0E] = $0004
//   .deref (B113):
//     STA $00            ; $00 = colTableBase + row*4  (4 bytes = 2 words/row)
//     LDA $28 : ASL : TAY        ; Y = col*2
//     LDX $1D                    ; X = current buffer offset
//     LDA ($00),y        ; entry = colTable word at [$00 + col*2] = idx row*2+col
//     BEQ .done          ; entry==0 → stamp nothing
//     TAY : LDA $0000,y  ; A = mem16[$12:entry]  (two-tier; see note below)
//     STA !RAM_YI_Level_LevelDataBuffer,x       ; stamp it (buffer offset = X)
//   .done (B127): SEP #$30 : RTL
//
// Tables (Bank12.asm:7019-7025, read directly from the asm + spec.json trace):
//   DATA_12B0E1[$15] = column-table base ptr per orientation. The spec.json
//     trace resolves index $000E → record $12B0EF = $B0D9 = DATA_12B0D9.
//   DATA_12B0F1[$15] = row stride; [$0E] = $0004 (4 bytes = 2 words/row → 2 cols).
//   DATA_12B0D9 (orientation-$0E column table, Bank12.asm:7019) holds
//   2 cols x 2 rows of 16-bit `entry` words, the stamper indexes [row*2 + col]:
//       dw $19DC, $1A18, $19E6, DATA_12B00F
//     idx0 (row0,col0)=$19DC  idx1 (row0,col1)=$1A18
//     idx2 (row1,col0)=$19E6  idx3 (row1,col1)=DATA_12B00F ($B00F)
//   i.e. in [col][row] form:  col0=[$19DC,$19E6]  col1=[$1A18,DATA_12B00F].
//
// Two-tier entry resolution — the cart's `TAY : LDA $0000,y` reads at bank $12,
// offset = entry. Matched against the spec trace:
//   * entry < $8000 ($19DC/$1A18/$19E6) → WRAM low-RAM mirror ($7E:19xx/1Axx) →
//     a per-tileset Map16 template slot → state.templateAt(entry). The trace
//     shows a tpl_read16 of each: $19DC=$0211, $19E6=$0316, $1A18=$0A25.
//   * entry >= $8000 (DATA_12B00F = $B00F) → ROM word in bank $12 →
//     `LDA $12:B00F` = $01A9 (Bank12.asm:7018), a constant Map16 id (same across
//     all tilesets). The spec trace shows NO tpl_read16 for this cell, just a
//     direct stamp of $01A9 — consistent with the ROM-literal tier.
//   * entry == 0 → stamp nothing (the BEQ). No zero entry exists in this table.
//
// (all 4 data cells: col0/row0→slot $19DC ($0211)@7F8288, col0/row1→slot $19E6
// ($0316)@7F82A8, col1/row0→slot $1A18 ($0A25)@7F828A, col1/row1→ROM $01A9
// @7F82AA; the two CODE_128874 marker cells (col=null, off-screen subX/subY=-1)
// are walker bookkeeping, not stamps).
import type { DecodeState } from '../state.ts';
import type { RockEntry } from './_shared.ts';
import { makeRockEntryStamp } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12B0D9 column table for orientation $15 = 0x0E, indexed [col][row]
// (col 0..1, row 0..1). Each value is the resolved cart `entry`:
//   - a WRAM template-slot address (< $8000) → state.templateAt(entry)
//   - a ROM-literal Map16 id (DATA_12B00F deref = $01A9) → stamped directly
//   - 0 → stamp nothing (none in this table)

const COLUMN_TABLE: RockEntry[][] = [
  /* col 0 */ [{ slot: 0x19dc }, { slot: 0x19e6 }],
  /* col 1 */ [{ slot: 0x1a18 }, { mapid: 0x01a9 }], // row1 = DATA_12B00F deref
];

// CODE_12B101 — shared rock per-cell stamper (see _shared.ts).
const perCellRock2x2 = makeRockEntryStamp(COLUMN_TABLE, 'colMajor');

// CODE_extobj_handler_rock_2x2 init (Bank12.asm:2136) — Rock 8, 2x2.
function initRock2x2(state: DecodeState): void {
  state.zp15 = 0x000e; // STA $15 (orientation re-encoded to 0x0E)
  state.zp2A = 0x0002; // STX $2A (col extent)
  state.zp2E = 0x0002; // STY $2E (row extent)
  walkerSetupTrampoline(state, perCellRock2x2);
}

export function installExtRock2x2Handlers(): void {
  registerExtObjectHandler(0x66, initRock2x2);
}
