// Bank12 EXTENDED-object handler: line_guide_small_corner_family (ext IDs $8E-$91).
//
// Four ext IDs share ONE init handler; the variant (which of 4 sequential
// Map16 IDs is stamped) is selected from $15 (= the extID) via
// `(id + 2) & 3`. Single-cell inline stamp — no walker.
//
// Asm sources (yi/Banks/Bank12.asm):
//   CODE_extobj_handler_line_guide_small_corner_family  $12:8E56  (line 2382)
//     aliases: CODE_extobj_handler_line_guide_small_corner_family
//   CODE_get_current_map16_tile                   $12:86FD  (line 1171)
//   CODE_12BC01 (inline stamper)                  $12:BC01  (line 7912)
//
// Asm (verbatim):
//
//   CODE_extobj_handler_line_guide_small_corner_family:
//     JSR.w CODE_get_current_map16_tile   ; resolve $1D from $1B/$1C, latch $12
//     REP.b #$30
//     LDA.b $15 : INC : INC : AND.w #$0003 : STA.b $15   ; $15 := (extID+2)&3
//     JSL.l CODE_12BC01
//     SEP.b #$30
//     RTL
//
//   CODE_12BC01:
//     REP.b #$30
//     LDX.b $1D
//     LDA.w #$8710 : CLC : ADC.b $15      ; tile = $8710 + ((extID+2)&3)
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     SEP.b #$30
//     RTL
//
// Output Map16 = $8710 + ((extID + 2) & 3). Verified vs spec.json (all 4):
//   ext $8E -> (0x8E+2)&3 = 0 -> $8710   (buf $7F8368)
//   ext $8F -> (0x8F+2)&3 = 1 -> $8711   (buf $7F82AC)
//   ext $90 -> (0x90+2)&3 = 2 -> $8712   (buf $7F8284)
//   ext $91 -> (0x91+2)&3 = 3 -> $8713   (buf $7F82CC)
// The parser sets $15 = extID before the handler runs; the init's INC/INC/AND
// re-encodes it. ($15 is consumed only by the stamper here, then RTL.)
//
// The cart does `ADC $15` after `CLC`, but $15 was just freshly stored as a
// 0..3 value, so the carry is deterministic (no HV-counter dependence).

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { stampCell } from './_shared.ts';

// Cart asm: `LDA.w #$8710`. Base of the 4 sequential small line-guide-corner
// Map16 IDs ($8710..$8713); the ($15+ offset) selects the color variant.
const LINE_GUIDE_SMALL_CORNER_BASE_TILE = 0x8710;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_line_guide_small_corner_family ($12:8E56).
//
// Single-cell inline stamp. `getCurrentMap16Tile` re-resolves the anchor
// cell's buffer offset into $1D (may throw ScreenOverflowError — let it
// propagate; the parser catches it). Then $15 := (extID + 2) & 3 and the
// stamper writes $8710 + $15 at the resolved $1D.
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0x8E, 0x8F, 0x90, 0x91 share this handler.
function extLineGuideSmallCornerFamily(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D (and latches $12).
  getCurrentMap16Tile(state);
  // LDA $15 : INC : INC : AND #$0003 : STA $15
  state.zp15 = (state.zp15 + 2) & 0x0003;
  // CODE_12BC01: LDA #$8710 : CLC : ADC $15 : STA buffer,x
  stampCell(state, (LINE_GUIDE_SMALL_CORNER_BASE_TILE + state.zp15) & 0xffff);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext ids $8E-$91 all dispatch to the same handler (the
// $18E-$191 mirrors are automatic — getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────
export function installExtLineGuideSmallCornerFamilyHandlers(): void {
  registerExtObjectHandler(0x8e, extLineGuideSmallCornerFamily);
  registerExtObjectHandler(0x8f, extLineGuideSmallCornerFamily);
  registerExtObjectHandler(0x90, extLineGuideSmallCornerFamily);
  registerExtObjectHandler(0x91, extLineGuideSmallCornerFamily);
}
