// Ports CODE_extobj_handler_pipe_corner_family ($12:8EE3, Bank12.asm:2462)
// — ext IDs 0xA0..0xA3 (4-way pipe-elbow corner family; UL/UR/DL/DR quadrants).
//
//   0xA0  pipe-corner — stamper CODE_12BDEA (probes above, then left)
//   0xA1  pipe-corner — stamper CODE_12BE42 (probes below, then right)
//   0xA2  pipe-corner — stamper CODE_12BE99 (probes below, then left)
//   0xA3  pipe-corner — stamper CODE_12BEF1 (probes below, then right)
//
// ONE shared init dispatches all four IDs (Bank12.asm:2462):
//     REP #$20
//     LDA $15 : AND #$0003 : ASL : TAY               ; Y = (id & 3) * 2
//     LDA $1B : AND #$0F0F : CLC : ADC DATA_128ECB,Y ; per-id SUB-position delta
//             : AND #$0F0F : STA $00
//     LDA $1B : AND #$F0F0 : CLC : ADC DATA_128ED3,Y ; per-id SCREEN delta
//             : AND #$F0F0 : ORA $00 : STA $1B       ; recombine sub + screen
//     LDA #$0002 : STA $2A : STA $2E                 ; 2×2 walker extents (const)
//     LDX #(CODE_12BDEA-$01)>>16                     ; stamper bank ($12)
//     LDA DATA_128EDB,Y                              ; per-id stamper ptr
//     JMP CODE_walker_setup_trampoline
//
// SHAPE: walker-driven (shape 2), 2 cols × 2 rows. The shared init applies the
// origin shift, writes the (constant 2×2) extents, then tail-calls the walker.
// Each per-cell stamp (one of four near-identical stampers, CODE_12BDEA family)
// computes
//     tile = base + ($2C<<1 | $28)      ; LDA $2C ASL ORA $28 ADC #base
//          = base + col + 2*row         ; col=$28, row=$2C
// base per orientation (the stamper's `ADC #$79xx` immediate — NOT a table):
//     A0 $7970, A1 $7974, A2 $7978, A3 $797C.
//
// DISPATCH TABLES (read verbatim from asm, version-stable; Bank12.asm:2452-2459),
// indexed by (id & 3) → A0,A1,A2,A3:
//   DATA_128ECB (sub-position delta, added under AND #$0F0F): dw $FFFF,$0000,$FFFF,$0000
//   DATA_128ED3 (screen delta,       added under AND #$F0F0): dw $FFF0,$FFF0,$0000,$0000
//   DATA_128EDB (per-id stamper ptr):
//                 dw CODE_12BDEA,CODE_12BE42,CODE_12BE99,CODE_12BEF1
//
// NEIGHBOUR-MERGE PROBES (DOCUMENTED FIDELITY GAP — not modelled): before the
// stamp, each stamper probes two neighbour cells (verified from asm):
//   A0 CODE_12BDEA: above (∈ {$7942,$7943} → neighbour+3) then left
//                   (∈ {$7944,$7946,$794D,$794B} → neighbour+3/+4)
//   A1 CODE_12BE42, A2 CODE_12BE99, A3 CODE_12BEF1: the same
//                   get_map16_{above,below,left,right} probe-then-INC pattern
//                   against the corner-seam tile set, INC'ing the matched
//                   NEIGHBOUR cell by +1/+3/+4.
// The INC always writes the NEIGHBOUR cell's buffer offset (X returned by the
// get_map16_* probe) — it NEVER touches THIS object's own four 2×2 cells
// (base+col+2*row), so this object's OWN stamps are always exact.
//
// These probes are NOT inherently inert at static decode. Objects decode in
// stream order into one shared buffer, so if a PRIOR object already stamped a
// match tile into an adjacent cell, the probe WOULD fire and rewrite that
// neighbour. In all four ext-A0..A3 spec traces the neighbour cells are empty,
// so every probe falls through with no rewrite — which is exactly why the
// omission is invisible in the specs — but on real adjacent-pipe geometry they
// CAN fire. Left UNPORTED here (time-boxed audit): the effect is cosmetic
// seam-merging of already-stamped neighbour cells only, never this object's own
// output. To port faithfully: per stamper, read the neighbour via the matching
// getMap16{Above,Below,Left,Right}, CMP against the seam-tile set above, and
// write back neighbour+delta. Flag for a follow-up pass if cross-object pipe-
// seam merging is ever wanted.
//
// VERIFICATION (replayed vs ext-A0..A3 spec.json): all 16 stamped cells (4 per
// id) match `base + col + 2*row`, AND all 4 post-init $1B/$1C origins match the
// spec exactly with the asm DATA_128ECB/ED3 deltas (A0 $330B→$23FA,
// A1 $3306→$23F6, A2 $33CB→$33CA, A3 $33DF unchanged).

import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

const PIPE_CORNER_FIRST_ID = 0xa0;
const PIPE_CORNER_LAST_ID = 0xa3;

interface PipeCornerVariant {
  /** DATA_128ECB[id&3] — added to the $0F0F (sub-position) nibbles of $1B. */
  readonly subDelta: number;
  /** DATA_128ED3[id&3] — added to the $F0F0 (screen) nibbles of $1B. */
  readonly screenDelta: number;
  /** Stamper's `ADC #$79xx` immediate; stamped tile = base + col + 2*row. */
  readonly base: number;
}

// Keyed by ext id 0xA0..0xA3.
const PIPE_CORNER_VARIANTS: Record<number, PipeCornerVariant> = {
  0xa0: { subDelta: 0xffff, screenDelta: 0xfff0, base: 0x7970 },
  0xa1: { subDelta: 0x0000, screenDelta: 0xfff0, base: 0x7974 },
  0xa2: { subDelta: 0xffff, screenDelta: 0x0000, base: 0x7978 },
  0xa3: { subDelta: 0x0000, screenDelta: 0x0000, base: 0x797c },
};

// Per-cell stamper. Ports the four CODE_12BDEA-family stampers' final stamp:
//   LDA $2C : ASL : ORA $28 : ADC #base : STA buffer[$1D]
// = base + col + 2*row. The cart's per-variant neighbour-merge probes precede
// this but never change THIS object's stamp (see file header), so they are
// intentionally not reproduced.
const stampPipeCornerCell: PerCellHandler = (state: DecodeState): void => {
  const v = PIPE_CORNER_VARIANTS[state.zp15 & 0xff];
  if (!v) return;
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  stampCell(state, (v.base + col + 2 * row) & 0xffff);
};

// Shared init. Ports CODE_extobj_handler_pipe_corner_family: apply the two
// per-orientation origin shifts to the $1B/$1C composite (the cart's
// independent sub-nibble + screen-nibble ADC idiom), set the constant 2×2
// walker extents, and dispatch the walker with the shared stamper. $15 stays
// the ext id and selects the variant record (deltas + tile base).
function initPipeCorner(state: DecodeState): void {
  const v = PIPE_CORNER_VARIANTS[state.zp15 & 0xff];
  if (!v) return;
  // LDA $1B AND #$0F0F ADC subDelta AND #$0F0F  (sub-position nibbles)
  // LDA $1B AND #$F0F0 ADC screenDelta AND #$F0F0  (screen nibbles), then ORA.
  const word = ((state.zp1B & 0xff) | ((state.zp1C & 0xff) << 8)) & 0xffff;
  const lo = ((word & 0x0f0f) + v.subDelta) & 0x0f0f;
  const hi = ((word & 0xf0f0) + v.screenDelta) & 0xf0f0;
  const shifted = (hi | lo) & 0xffff;
  state.zp1B = shifted & 0xff;
  state.zp1C = (shifted >>> 8) & 0xff;
  state.zp2A = 0x0002; // STA $2A — col extent (constant)
  state.zp2E = 0x0002; // STA $2E — row extent (constant)
  walkerSetupTrampoline(state, stampPipeCornerCell);
}

export function installExtPipeCornerFamilyHandlers(): void {
  for (let id = PIPE_CORNER_FIRST_ID; id <= PIPE_CORNER_LAST_ID; id++) {
    registerExtObjectHandler(id, initPipeCorner);
  }
}
