// Bank12 ext-object $62 — rock_3x2_b (rock variant 4).
//
// Shape: walker-driven 3-col × 2-row block. The init
// (CODE_extobj_handler_rock_3x2_b $12:8C4B) loads the per-object
// constants and tail-calls the shared walker-setup tail:
//
//   CODE_extobj_handler_rock_3x2_b ($12:8C4B, Bank12.asm:2104):
//     REP #$10
//     LDA #$06                 ; $15 = orientation/variant = 6
//     LDX #$0003               ; $2A = col extent = 3
//     LDY #$0002               ; $2E = row extent = 2
//     BRA rock_shared_tail
//   CODE_extobj_handler_rock_shared_tail ($12:8C7D):
//     STA $15 ; STX $2A ; STY $2E
//     LDX/LDA #(CODE_12B101-1) ; per-cell stamper
//     JMP CODE_walker_setup_trampoline
//
// Per-cell stamper CODE_12B101 ($12:B101, Bank12.asm:7044):
//
//     REP #$30
//     LDY $2C                  ; row counter
//     LDX $15                  ; X = $15 = 6 (16-bit; BYTE index into word tbls)
//     LDA DATA_12B0E1,x        ; ptr-table[byte 6] = entry #3 = DATA_12B065
//   loop (12B10A):
//     DEY : BMI done           ; advance ptr by one row
//     CLC : ADC DATA_12B0F1,x  ; += pitch (DATA_12B0F1[byte 6] = #3 = $0006)
//     BRA loop
//   done (12B113):
//     STA $00                  ; $00 = rowbase = DATA_12B065 + row*6
//     LDA $28 : ASL : TAY      ; Y = col*2
//     LDX $1D
//     LDA ($00),y              ; entry = DATA_12B065[row*3 + col] (a $12-bank ptr)
//     BEQ skip                 ; 0 entry → no stamp this cell
//     TAY : LDA $0000,y        ; deref word AT that address (DBR=$12)
//     STA LevelDataBuffer,x    ; stamp Map16 ID
//   skip (12B127): RTL
//
// With $15=6: ptr-table entry #3 = DATA_12B065 (Bank12.asm:6966), pitch
// $0006 (3 words/row). DATA_12B065 is a 2-row × 3-col row-major table of
// indirect ptrs; the cart derefs each (`LDA $0000,y`, DBR=$12):
//
//   entry        deref source           → Map16 ID
//   ---------    --------------------    ----------
//   $19DC        WRAM template slot      → runtime (templateAt)
//   DATA_12B00B  ROM word @ $12:B00B     → $01A7 (literal)
//   $19F0        WRAM template slot      → runtime (templateAt)
//   $19E6        WRAM template slot      → runtime (templateAt)
//   DATA_12B00D  ROM word @ $12:B00D     → $01A8 (literal)
//   $19F8        WRAM template slot      → runtime (templateAt)
//
// The distinction is purely by address range: an entry < $2000 is a WRAM
// low-RAM mirror (a per-tileset template slot) and is dereffed via
// `templateAt`; an entry >= $8000 is a Bank12 ROM address whose stored
// word IS the literal Map16 ID. DATA_12B00B/DATA_12B00D (Bank12.asm:6876/
// 6879) hold $01A7/$01A8 respectively.
//
// Trace cross-check (ext-62 spec, current.bin):
//   col0row0 $19DC      → $0211   (spec tpl_read16 slot_19DC)
//   col1row0 DATA_12B00B→ $01A7   (no tpl_read16 — ROM literal)
//   col2row0 $19F0      → $0511   (spec tpl_read16 slot_19F0)
//   col0row1 $19E6      → $0316   (spec tpl_read16 slot_19E6)
//   col1row1 DATA_12B00D→ $01A8   (no tpl_read16 — ROM literal)
//   col2row1 $19F8      → $0615   (spec tpl_read16; spec labels it slot_19F8)
// Every cell's output_mapid is reproduced.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12B065 (Bank12.asm:6966), the $15=6 entry of DATA_12B0E1. 2-row ×
// 3-col row-major [row*3 + col]. Each entry resolves to a Map16 ID via the
// cart's `LDA $0000,y` deref; we precompute that here:
//   - WRAM slots ($19xx) → read at runtime with templateAt(slot)
//   - ROM literals (DATA_12B00B=$01A7, DATA_12B00D=$01A8) → fixed
const SLOT = 'slot' as const;
const LIT = 'lit' as const;
type Entry = { kind: typeof SLOT; addr: number } | { kind: typeof LIT; id: number };

const ROCK_3X2_B_ENTRIES: readonly Entry[] = [
  { kind: SLOT, addr: 0x19DC }, { kind: LIT, id: 0x01A7 }, { kind: SLOT, addr: 0x19F0 }, // row 0
  { kind: SLOT, addr: 0x19E6 }, { kind: LIT, id: 0x01A8 }, { kind: SLOT, addr: 0x19F8 }, // row 1
];

const COLS = 3;

// CODE_12B101 ($12:B101) specialised for $15 = 6 (DATA_12B065 / pitch 6).
const rock3x2BPerCell: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const entry = ROCK_3X2_B_ENTRIES[row * COLS + col];
  // BEQ skip: a zero table entry stamps nothing (none here, but the
  // walker can visit out-of-table cells if extents drift — guard anyway).
  if (entry === undefined) return;
  // TAY : LDA $0000,y — deref the table entry to its Map16 ID.
  const id = entry.kind === SLOT ? state.templateAt(entry.addr) : entry.id;
  stampCell(state, id);
};

// CODE_extobj_handler_rock_3x2_b ($12:8C4B) + shared tail ($12:8C7D).
function initRock3x2B(state: DecodeState): void {
  state.zp15 = 0x06; // orientation/variant byte (selects DATA_12B065)
  state.zp2A = 0x0003; // col extent
  state.zp2E = 0x0002; // row extent
  walkerSetupTrampoline(state, rock3x2BPerCell);
}

export function installExtRock3x2BHandlers(): void {
  registerExtObjectHandler(0x62, initRock3x2B);
}
