// Bank12 extended-object "pair dispatch" init + per-cell stamp handlers.
//
// Extended objects $12 and $13 share ONE init symbol in the cart
// (CODE_extobj_handler_pair_dispatch, $12:8924). Despite the brief's
// "ext objects are inline single-cell stampers" framing, THIS pair is a
// 5-wide WALKER object: the init sets a 5×1 rectangle and tail-calls the
// walker-setup trampoline (just like the std special-coin init). Each of
// the 5 columns picks a Map16 ID from a per-ID 5-entry table indexed by
// the walker's column counter.
//
// The two IDs route through the same init but use DIFFERENT per-cell stamp
// handlers + col-indexed Map16 tables. The discriminator is $15 (the
// orientation byte = the object ID, stuffed by the Bank10 dispatcher):
// the init does `LDA $15 : AND #$0001 : ASL : TAY : LDA DATA_128920,y`,
// i.e. bit 0 of the ID selects the handler:
//   $12 → bit0 = 0 → CODE_12A6A6 / DATA_12A69C
//   $13 → bit0 = 1 → CODE_12A6C2 / DATA_12A6B8
//
// Each per-cell stamper indexes its table by the walker's COLUMN counter
// ($28) and stamps the resulting Map16 ID at $1D. The spec's per-cell
// `table-read Y=$0000/$0002/.../$0008` is exactly `$28 * 2` across cols
// 0..4. (CODE_128640, JSR'd in the cart after the stamp, is the walker's
// own column/row bookkeeping; in TS the walker owns that — the stamper
// only reads $28.)
//
// Asm sources:
//   CODE_extobj_handler_pair_dispatch     Bank12.asm:1626 ($12:8924)
//   CODE_12A6A6 (stamp, ext $12)          Bank12.asm:5979 ($12:A6A6)
//   CODE_12A6C2 (stamp, ext $13)          Bank12.asm:5993 ($12:A6C2)
//   DATA_12A69C (col table, ext $12)      ($12:A69C)
//   DATA_12A6B8 (col table, ext $13)      ($12:A6B8)
//
// Asm (verbatim, init):
//   CODE_extobj_handler_pair_dispatch:
//     REP #$20
//     LDA #$0001 : STA $2E          ; row extent = 1
//     LDA #$0005 : STA $2A          ; col extent = 5
//     LDA $15 : AND #$0001 : ASL : TAY
//     LDA DATA_128920,y             ; per-ID stamp handler ptr-1
//     LDX #(CODE_12A6A6-1)>>16
//     JMP CODE_walker_setup_trampoline
//
// Asm (verbatim, stamp body — both handlers identical except the table):
//   REP #$30
//   LDA $28 : ASL : TAY            ; column counter × 2 → word offset
//   LDA DATA_12A69C,y             ; table[col]
//   LDX $1D : STA.l buffer,x       ; STAMP
//   SEP #$30
//   RTL

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12A69C ($12:A69C) — col-indexed Map16 table for ext $12.
// From the spec per-cell trace: cols 0-2 → $96D1, cols 3-4 → $96D2.
const PAIR_TABLE_12 = [0x96D1, 0x96D1, 0x96D1, 0x96D2, 0x96D2] as const;

// DATA_12A6B8 ($12:A6B8) — col-indexed Map16 table for ext $13.
// From the spec per-cell trace: cols 0-1 → $96D3, cols 2-4 → $96D1.
const PAIR_TABLE_13 = [0x96D3, 0x96D3, 0x96D1, 0x96D1, 0x96D1] as const;

const PAIR_COL_EXTENT = 5; // init: LDA #$0005 : STA $2A
const PAIR_ROW_EXTENT = 1; // init: LDA #$0001 : STA $2E

// ─────────────────────────────────────────────────────────────────────
// makePairStamp — factory for CODE_12A6A6 / CODE_12A6C2.
//
// Both stampers are byte-for-byte identical apart from the table they
// index. Asm: `LDA $28 : ASL : TAY ; LDA.l <table>,y ; LDX $1D :
// STA.l buffer,x`. We index by the column counter ($28) directly.
// ─────────────────────────────────────────────────────────────────────

function makePairStamp(table: ReadonlyArray<number>): PerCellHandler {
  return (state) => {
    // LDA $28 : ASL : TAY → word offset; $28 is the column index.
    const col = state.zp28 & 0xff;
    const pick = table[col];
    if (pick === undefined) return; // past the 5-entry table (defensive)
    stampCell(state, pick); // LDX $1D : STA.l buffer,x
  };
}

const pairStamp12 = makePairStamp(PAIR_TABLE_12);
const pairStamp13 = makePairStamp(PAIR_TABLE_13);

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_pair_dispatch (Bank12.asm:1626).
//
// Sets the 5×1 rectangle ($2A=5, $2E=1 — overriding the parser's 1×1
// default), then picks the stamp handler from the 2-entry DATA_128920
// table via $15 bit 0, and runs the walker.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x12, 0x13 share this handler.
function initPairDispatch(state: DecodeState): void {
  state.zp2E = PAIR_ROW_EXTENT; // LDA #$0001 : STA $2E
  state.zp2A = PAIR_COL_EXTENT; // LDA #$0005 : STA $2A
  // LDA $15 : AND #$0001 : ASL : TAY : LDA DATA_128920,y
  const handler = (state.zp15 & 0x01) !== 0 ? pairStamp13 : pairStamp12;
  walkerSetupTrampoline(state, handler);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext $12 and $13 share the init symbol; the $15 bit-0
// branch inside selects the per-ID stamp table.
// ─────────────────────────────────────────────────────────────────────

export function installExtPairDispatchHandlers(): void {
  registerExtObjectHandler(0x12, initPairDispatch);
  registerExtObjectHandler(0x13, initPairDispatch);
}
