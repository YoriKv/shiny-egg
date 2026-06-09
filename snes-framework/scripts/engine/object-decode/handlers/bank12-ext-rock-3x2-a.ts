// Bank12 extended-object handler — rock_3x2_a (ext ID $61).
//
// Shape: WALKER-DRIVEN 3-col x 2-row block (NOT single-cell). The init
// presets $15/$2A/$2E then tail-calls the shared walker trampoline with a
// per-cell stamper at $12:B101.
//
// Asm sources (yi/Banks/Bank12.asm):
//   CODE_extobj_handler_rock_3x2_a       $12:8C45  (line 2098)
//   CODE_128C4F                                 $12:8C4F  (line 2107)
//   CODE_extobj_handler_rock_shared_tail $12:8C7D  (line 2142)
//   CODE_12B101 (per-cell stamper)              $12:B101  (line 7044)
//   DATA_12B0E1 (per-ID base-table ptr table)   $12:B0E1  (line 7038)
//   DATA_12B0F1 (per-ID row-stride table)       $12:B0F1  (line 7041)
//
// Init (verbatim, comments stripped):
//   CODE_extobj_handler_rock_3x2_a:
//     REP #$10 : LDA #$04            ; orientation $15 := 4  (-> CODE_128C4F)
//   CODE_128C4F:
//     LDX #$0003 : LDY #$0002        ; col $2A := 3, row $2E := 2 (-> tail)
//   CODE_extobj_handler_rock_shared_tail:
//     STA $15 : STX $2A : STY $2E
//     LDX #(CODE_12B101-1)>>16 : LDA #CODE_12B101-1
//     JMP CODE_walker_setup_trampoline    ; slope 0, bare trampoline
//
// The dispatcher seeds $2A/$2E with 1 each; the init overwrites them with
// 3 and 2 -> a 3x2 grid = 6 stamped cells. (The spec lists 9 "cells"; the
// 3 with a null walker are walker-emitted row-wrap sentinels, not stamps.)
//
// Per-cell stamper CODE_12B101 ($12:B101), verbatim:
//   REP #$30
//   LDY $2C                              ; Y = row counter
//   LDX $15                              ; X = $15 = 4 (per-ID class index)
//   LDA DATA_12B0E1,x                    ; A = base table ptr = $B059
//   loop (Y times):  CLC : ADC DATA_12B0F1,x   ; += row stride ($0006) per row
//   STA $00                              ; $00 = $B059 + row*6
//   LDA $28 : ASL : TAY                  ; Y = col * 2
//   LDX $1D
//   LDA ($00),y                          ; entry = word@($00 + col*2)
//   BEQ skip                             ; zero entry -> leave cell untouched
//   TAY : LDA $0000,y                    ; deref: read word @ DBR($12):entry
//   STA.l buffer,x                       ; stamp it
//
// Indexing model (X=$15=4 selects this object's tables):
//   baseTbl  = DATA_12B0E1[4] = $B059   (ROM word table of per-cell entries)
//   rowStride= DATA_12B0F1[4] = $0006   (advance baseTbl ptr by 6 bytes/row)
//   entry(col,row) = word@($B059 + row*6 + col*2)        [from ROM]
//   stamp(col,row) = word@($12 : entry)                  [final indirection]
//
// The final `LDA $0000,y` reads the data bank ($12). Two cases for `entry`:
//   - entry in $19DA..$1FDA  -> bank-$12 addresses < $8000 are the WRAM
//     system/template mirror, i.e. a per-tileset template slot ->
//     state.templateAt(entry).
//   - entry >= $8000         -> a ROM-resident literal Map16 ID at
//     $12:entry. Here col 1 ($B00B/$B00D) and (2,1) ($B00F) point into a
//     contiguous ROM run $B00B.. = $01A7,$01A8,$01A9,$01AA,... so we read
//     the literal directly.
//   - entry == 0             -> skip (cart BEQ).
//
// Routing $19xx entries through templateAt keeps the object tileset-correct
// across levels (what templateAt exists for); ROM-literal entries are
// constant. The whole entry grid is baked from ROM ($12:B059), version-
// stable in structure; the literal values are cited from $12:B00B.
//
// Verified against spec.json (level 09) — all 6 stamped cells, mapid+offset:
//   (0,0) entry $19DC -> templateAt = $0211     off $024A
//   (1,0) entry $B00B -> ROM        = $01A7     off $024C
//   (2,0) entry $1A18 -> templateAt = $0A25     off $024E
//   (0,1) entry $19E6 -> templateAt = $0316     off $026A
//   (1,1) entry $B00D -> ROM        = $01A8     off $026C
//   (2,1) entry $B00F -> ROM        = $01A9     off $026E
// (The 3 logged tpl_read16 events match the 3 $19xx entries exactly; the
// other 3 are the contiguous ROM literals.) Walker offsets: base $024A,
// +2/col, +$20/row.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// Per-cell ROM "entry" words, [row][col], read from $12:B059 (+row*6,+col*2).
// 0 = skip; $19DA..$1FDA = WRAM template slot (templateAt); else ROM literal.
const ENTRY_TABLE: ReadonlyArray<ReadonlyArray<number>> = [
  // col 0     col 1     col 2
  [0x19DC, 0xB00B, 0x1A18], // row 0
  [0x19E6, 0xB00D, 0xB00F], // row 1
];

// ROM-resident literal Map16 IDs (final `LDA $0000,y` for entry >= $8000,
// i.e. a ROM address in bank $12). Cited verbatim from the $12:B00B run.
const ROM_LITERALS = new Map<number, number>([
  [0xB00B, 0x01A7],
  [0xB00D, 0x01A8],
  [0xB00F, 0x01A9],
]);

// Bounds of the WRAM template region (cart $00:19DA..$00:1FDA).
const TEMPLATE_LO = 0x19DA;
const TEMPLATE_HI = 0x1FDA;

// Ports CODE_12B101 ($12:B101). Per-cell stamper: index ENTRY_TABLE by the
// walker's (col,row) counters, then resolve the entry word through one more
// indirection (template slot, ROM literal, or skip).
const rock3x2Stamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const rowEntries = ENTRY_TABLE[row];
  if (rowEntries === undefined) return;
  const entry = rowEntries[col];
  if (entry === undefined || entry === 0) return; // cart BEQ skip
  if (entry >= TEMPLATE_LO && entry < TEMPLATE_HI) {
    stampCell(state, state.templateAt(entry));
    return;
  }
  const lit = ROM_LITERALS.get(entry);
  if (lit !== undefined) stampCell(state, lit);
};

// Ports CODE_extobj_handler_rock_3x2_a ($12:8C45) + shared tail.
// Sets 3-col x 2-row extents, orientation $15 = 4, then dispatches the bare
// walker trampoline (slope 0).
function initRock3x2A(state: DecodeState): void {
  state.zp2A = 0x0003; // col extent
  state.zp2E = 0x0002; // row extent
  state.zp15 = 0x04;   // orientation byte the init re-encodes
  walkerSetupTrampoline(state, rock3x2Stamp);
}

export function installExtRock3x2AHandlers(): void {
  registerExtObjectHandler(0x61, initRock3x2A);
}
