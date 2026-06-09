// Bank12 extended-object "pipe entry (4 directions)" init + per-cell stamper.
//
// Extended objects $6D, $6E, $6F, $70 share ONE init handler in the cart
// (CODE_extobj_handler_pipe_entry_4dir, $12:8CDC / Bank12.asm:2202). It is a
// WALKER-DRIVEN 2x2 block: the init sets col/row extents to 2, re-encodes
// the extID byte $15 into a 0/2/4/6 direction word-offset, and tail-calls
// the walker-setup trampoline with the per-cell stamper CODE_12B21A
// ($12:B21A / Bank12.asm:7190). The walker runs the 2-col x 2-row rectangle
// and calls the stamper for each of the 4 cells.
//
// Dispatch key: the extID byte $15 (stuffed by the Bank10 ext dispatcher).
// The init does `LDA $15 : DEC : AND #$0003 : ASL : STA $15` — note the DEC
// (the asm comment calls it "$15 mod 4 with -1 shift") — so $15 becomes a
// per-direction WORD offset into the 4-entry base-tile table DATA_12B212:
//   ext $6D → (0x6D-1)&3=0 → $15=0 → DATA_12B212[0] = $7D14
//   ext $6E → (0x6E-1)&3=1 → $15=2 → DATA_12B212[1] = $7D18
//   ext $6F → (0x6F-1)&3=2 → $15=4 → DATA_12B212[2] = $7D0C
//   ext $70 → (0x70-1)&3=3 → $15=6 → DATA_12B212[3] = $7D10
// (Each ext-6D..70 spec.md DP-mutation table confirms 6D→00, 6E→02,
//  6F→04, 70→06.)
//
// The stamper adds a per-cell sub-index built from the walker counters:
//   sub = ($2C << 1) | $28   (= (row<<1) | col, both masked to bit 0)
//   tile = DATA_12B212[$15>>1] + sub
// so the 2x2 block lays four consecutive Map16 IDs in (col,row) order:
//   (col0,row0)=base+0  (col1,row0)=base+1  (col0,row1)=base+2  (col1,row1)=base+3
// Verified cell-for-cell against all four ext-6D..70 spec.json per-cell
// traces (e.g. $6D: 7D14/7D15/7D16/7D17; $6F: 7D0C/7D0D/7D0E/7D0F).
//
// Mirror IDs 0x16D-0x170 are automatic via getExtObjectHandler's `id & 0xff`
// mask.
//
// Asm sources (verbatim from yi/Banks/Bank12.asm):
//   CODE_extobj_handler_pipe_entry_4dir  ($12:8CDC / Bank12.asm:2202):
//     REP #$20
//     LDA $15 : DEC : AND #$0003 : ASL : STA $15  ; $15 → 0/2/4/6 (dir × 2)
//     LDA #$0002 : STA $2A : STA $2E              ; col + row extent = 2
//     LDX.b #(CODE_12B21A-$01)>>16
//     LDA.w #CODE_12B21A-$01
//     JMP CODE_walker_setup_trampoline
//   DATA_12B212  $12:B212 (Bank12.asm:7187): dw $7D14,$7D18,$7D0C,$7D10
//   CODE_12B21A  $12:B21A (Bank12.asm:7190) — per-cell stamper:
//     REP #$30
//     LDX $1D
//     LDY $15
//     LDA $2C : ASL : ORA $28                  ; sub = (row<<1) | col
//     CLC : ADC DATA_12B212,y                  ; tile = base[$15>>1] + sub
//     STA.l !RAM_YI_Level_LevelDataBuffer,x    ; STAMP at $1D
//     SEP #$30
//     RTL

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12B212 ($12:B212) — 4-entry per-direction base-tile word table,
// indexed by the re-encoded $15 (0/2/4/6 → entries 0..3).
const DATA_12B212 = [0x7d14, 0x7d18, 0x7d0c, 0x7d10] as const;

// CODE_12B21A ($12:B21A) — per-cell stamper. tile = base[$15>>1] +
// ((row<<1)|col), stamped at the walker's current cell offset $1D.
const pipeEntry4dirStamp: PerCellHandler = (state) => {
  const base = DATA_12B212[(state.zp15 & 0xffff) >> 1];
  if (base === undefined) return; // defensive; $15 is always 0/2/4/6 here
  // LDA $2C : ASL : ORA $28  →  sub = (row<<1) | col (each bit 0 within the
  // 2x2 block). The cart's ADC adds the full $2C<<1 | $28, but the walker
  // only ever produces col/row in {0,1} for this 2x2 extent.
  const sub = (((state.zp2C & 0xff) << 1) | (state.zp28 & 0xff)) & 0xffff;
  stampCell(state, (base + sub) & 0xffff);
};

// CODE_extobj_handler_pipe_entry_4dir ($12:8CDC / Bank12.asm:2202).
// Re-encodes $15 to a 0/2/4/6 direction word-offset, sets the 2x2 extents,
// and dispatches the walker, which stamps all four cells via the stamper
// above.
// Merge: object IDs 0x6D, 0x6E, 0x6F, 0x70 share this handler.
function initPipeEntry4dir(state: DecodeState): void {
  // LDA $15 : DEC : AND #$0003 : ASL : STA $15  →  0/2/4/6 (note the DEC).
  state.zp15 = ((((state.zp15 & 0xffff) - 1) & 0x0003) << 1) & 0xffff;
  state.zp2A = 0x0002; // col extent = 2
  state.zp2E = 0x0002; // row extent = 2
  walkerSetupTrampoline(state, pipeEntry4dirStamp);
}

// All four IDs share initPipeEntry4dir; the direction is selected inside by
// the $15 re-encode (no per-ID branch needed). The 0x100 mirror is automatic
// via getExtObjectHandler's `id & 0xff` mask.
export function installExtPipeEntry4dirHandlers(): void {
  registerExtObjectHandler(0x6d, initPipeEntry4dir);
  registerExtObjectHandler(0x6e, initPipeEntry4dir);
  registerExtObjectHandler(0x6f, initPipeEntry4dir);
  registerExtObjectHandler(0x70, initPipeEntry4dir);
}
