// Bank12 extended-object "pipe-mouth Lakitu-cave pair" init + per-cell stamper.
//
// Extended objects $7E and $7F share ONE init handler in the cart
// (CODE_extobj_handler_pipe_lakitu_cave_pair, $12:8D4C / Bank12.asm:2245).
// It is a walker-driven shape, but a degenerate 1x1 one: the parser's
// default 1-col x 1-row rectangle is left untouched, the init only
// re-encodes $15 into a 0/2 variant offset and tail-calls the walker-setup
// trampoline with the per-cell stamper CODE_12B3E1. The walker then runs a
// single cell (col 0, row 0) and calls the stamper once.
//
// Dispatch key: orientation byte $15 (= the ext-object ID, stuffed by the
// Bank10 ext dispatcher). The init does
//   LDA $15 : AND #$0001 : ASL : STA $15
// so $15 becomes 0 for ext $7E and 2 for ext $7F (a word-table byte
// offset). The stamper indexes the 2-entry DATA_12B3DD word table by $15:
//   $7E → $15=0 → DATA_12B3DD[0] = $77BB
//   $7F → $15=2 → DATA_12B3DD[1] = $77CC
// Both spec per-cell traces confirm (7E → Y=$0000 → $77BB at buf $7F826A;
// 7F → Y=$0002 → $77CC at buf $7F8204). Single cell, stamped at $1D.
//
// Asm sources (verbatim from yi/Banks/Bank12.asm):
//   CODE_extobj_handler_pipe_lakitu_cave_pair  $12:8D4C (Bank12.asm:2245):
//     REP #$20
//     LDA $15 : AND #$0001 : ASL : STA $15     ; $15 → 0 ($7E) / 2 ($7F)
//     LDX #(CODE_12B3E1-$01)>>16
//     LDA #CODE_12B3E1-$01
//     JMP CODE_walker_setup_trampoline
//   DATA_12B3DD  $12:B3DD (Bank12.asm:7389): dw $77BB,$77CC
//   CODE_12B3E1  $12:B3E1 (Bank12.asm:7392) — per-cell stamper:
//     REP #$30
//     LDA $15 : CLC : ADC $1D : TAX            ; X = $15 + $1D
//     LDA.l DATA_12B3DD,x                       ; tile = table[$15]  (see note)
//     STA.l $7F8000,x                           ; STAMP at $1D
//     SEP #$30
//     RTL
//   NOTE: the cart folds the table index ($15) and the buffer offset ($1D)
//   into a single X. Logically (and per the spec's per-cell trace) the
//   table read is indexed by $15 alone (0/2 → entry 0/1) and the store
//   lands at the $1D-based buffer offset — which is exactly stampCell's
//   write to state.zp1D. We model the two components separately.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12B3DD ($12:B3DD) — 2-entry Map16 word table, indexed by $15 (0/2).
const PIPE_VARIANT_TILES = [0x77bb, 0x77cc] as const;

// CODE_12B3E1 ($12:B3E1) — per-cell stamper. $15 is 0 ($7E) or 2 ($7F), a
// word offset; the table entry is $15>>1. Stamps the single 1x1 cell at $1D.
const pipeLakituCavePairStamp: PerCellHandler = (state) => {
  // LDA.l DATA_12B3DD,x where the table index is the $15 word offset.
  const tile = PIPE_VARIANT_TILES[(state.zp15 & 0xffff) >> 1];
  if (tile === undefined) return; // defensive; $15 is always 0/2 here
  stampCell(state, tile); // STA.l $7F8000,x → buffer write at $1D
};

// CODE_extobj_handler_pipe_lakitu_cave_pair ($12:8D4C). Re-encodes $15 to a
// 0/2 variant word offset and dispatches the walker, which stamps the
// single cell via the stamper above. (Extents stay at the parser's 1x1.)
// Merge: object IDs 0x7E, 0x7F share this handler.
function initPipeLakituCavePair(state: DecodeState): void {
  // LDA $15 : AND #$0001 : ASL : STA $15  →  0 for $7E, 2 for $7F.
  state.zp15 = ((state.zp15 & 0x0001) << 1) & 0xffff;
  walkerSetupTrampoline(state, pipeLakituCavePairStamp);
}

// Both IDs share initPipeLakituCavePair; the variant is selected by the
// $15 re-encode inside (no per-ID branch needed). The 0x100 mirror is
// automatic via getExtObjectHandler's `id & 0xff` mask.
export function installExtPipeLakituCavePairHandlers(): void {
  registerExtObjectHandler(0x7e, initPipeLakituCavePair);
  registerExtObjectHandler(0x7f, initPipeLakituCavePair);
}
