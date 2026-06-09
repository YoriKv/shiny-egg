// Bank12 ext-object "snowy_platform_tip" init handler — walker-driven, 1 row × 2 cols.
//
// Ext ID $C1 (sky-world pointed-spike decoration). The init forces a fixed
// 2-column × 1-row extent and tail-calls the walker trampoline with a
// per-cell stamp callback (CODE_12C302). Each cell stamps a base Map16 ID
// ($8DA5) offset by the walker COLUMN counter ($28), then probes the tile
// ABOVE and, if that tile is a specific ceiling Map16 ($152A/$152B),
// rewrites the ABOVE cell to a "spike-attached ceiling" variant
// ($8F04/$8F05).
//
// Asm sources (V1.0):
//   CODE_extobj_handler_snowy_platform_tip   Bank12.asm:2693  ($12:909F)
//   CODE_12C302  (per-cell stamp)   Bank12.asm:8673  ($12:C302)
//   CODE_get_map16_above            Bank12.asm:1206  ($12:8719)
//
// Init asm (verbatim):
//   CODE_extobj_handler_snowy_platform_tip:
//     REP #$20
//     LDA #$0002 : STA $2A        ; col extent = 2
//     DEC        : STA $2E        ; row extent = 1
//     LDX #(CODE_12C302-1)>>16
//     LDA #CODE_12C302-1
//     JMP CODE_walker_setup_trampoline
//
// Per-cell stamp asm (verbatim):
//   CODE_12C302:
//     REP #$30
//     LDA #$8DA5 : CLC : ADC $28  ; base tile + column counter
//     LDX $1D : STA.l LevelDataBuffer,x          ; stamp the spike cell
//     LDA $1B : STA $0E
//     JSL CODE_get_map16_above   ; X = above-cell buffer index
//     LDA.l LevelDataBuffer,x    ; A = tile above
//     CMP #$152A : BEQ rewrite
//     CMP #$152B : BNE done
//   rewrite (CODE_12C326):
//     SEC : SBC #$152A : CLC : ADC #$8F04
//     STA.l LevelDataBuffer,x    ; <-- X is the ABOVE cell, not the spike
//   done (CODE_12C332): SEP #$30 : RTL
//
// Verified against ext-C1 spec: col 0 → $8DA5 @ buf_off $031C,
// col 1 → $8DA6 @ buf_off $031E (walker advances $1D by 2 per column).
// In the trace the tile above was neither $152A nor $152B, so the rewrite
// branch fell through (CODE_12C332) and no second cell was modified — the
// rewrite is ported here for faithfulness but is inert in that scenario.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell, readBuf16, writeBuf16 } from './_shared.ts';
import { getMap16Above } from '../fetch.ts';

// Base spike Map16 ID; the stamp adds the column counter ($28) to it.
const SKY_SPIKE_BASE = 0x8DA5;
// Ceiling tiles that, when found directly above a spike, get rewritten to
// the spike-attached variant ($8F04 + (ceiling - $152A)).
const CEILING_LO = 0x152A;
const CEILING_HI = 0x152B;
const ATTACHED_BASE = 0x8F04;

// CODE_12C302 — per-cell stamper. Stamp $8DA5 + column at $1D, then probe
// the cell above; if it's $152A/$152B, rewrite that ABOVE cell to the
// matching $8F04/$8F05 spike-attached ceiling variant.
const snowyPlatformTipStamp: PerCellHandler = (state) => {
  // LDA #$8DA5 : CLC : ADC $28 — base + column counter (16-bit add).
  stampCell(state, (SKY_SPIKE_BASE + (state.zp28 & 0xffff)) & 0xffff);

  // LDA $1B : STA $0E ; JSL get_map16_above — getMap16Above returns the
  // ABOVE cell's byte index X (cart's X); read the tile there.
  state.zp0E = state.zp1B;
  const aboveIdx = getMap16Above(state);
  const aboveTile = readBuf16(state, aboveIdx);
  if (aboveTile === CEILING_LO || aboveTile === CEILING_HI) {
    // (tile - $152A) + $8F04, written back to the ABOVE cell (same X).
    // $152A → $8F04, $152B → $8F05.
    writeBuf16(state, aboveIdx, (aboveTile - CEILING_LO + ATTACHED_BASE) & 0xffff);
  }
};

// CODE_extobj_handler_snowy_platform_tip ($12:909F). Force col extent 2, row extent
// 1, then run the walker trampoline (slope 0) with snowyPlatformTipStamp per cell.
function initSnowyPlatformTip(state: DecodeState): void {
  state.zp2A = 0x0002;
  state.zp2E = 0x0001;
  walkerSetupTrampoline(state, snowyPlatformTipStamp);
}

export function installExtSnowyPlatformTipHandlers(): void {
  registerExtObjectHandler(0xC1, initSnowyPlatformTip);
}
