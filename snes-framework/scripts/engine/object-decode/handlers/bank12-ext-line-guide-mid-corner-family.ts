// Bank12 EXTENDED-object handler: line_guide_mid_corner_family (ext IDs $92-$95).
//
// Four ext IDs share ONE init handler. Unlike the SMALL family ($8E-$91,
// a single-cell inline stamp), the MID family is WALKER-DRIVEN: the init
// sets a 2x2 col/row extent and tail-calls the trampoline walker, which
// calls the per-cell stamper once per cell. The variant (which 4-byte
// sub-table is used) is selected from $15 (= the extID), re-encoded by the
// init as ((extID + 2) & 3) << 1 — a WORD index into a 4-entry pointer
// table (DATA_12BC22). Each sub-table holds 4 raw tile bytes; the stamper
// indexes it by (row*2 + col), gates byte==0 (no stamp), else stamps
// $8700 + byte.
//
// Asm sources (yi/Banks/Bank12.asm):
//   CODE_extobj_handler_line_guide_mid_corner_family  $12:8E6B (2395)
//   CODE_walker_setup_trampoline                              $12:A3DB
//   CODE_12BC2A (per-cell stamper)                            $12:BC2A (7937)
//   DATA_12BC22 (4 dw pointers -> BC12/BC16/BC1A/BC1E)        $12:BC22 (7934)
//   DATA_12BC12/16/1A/1E (per-variant 4-byte tile tables)     $12:BC12.. (7922)
//
// Init asm (verbatim, from `closure`):
//   CODE_extobj_handler_line_guide_mid_corner_family:
//     REP #$20
//     LDA $15 : INC : INC : AND #$0003 : ASL : STA $15  ; $15 := ((id+2)&3)<<1
//     LDA #$0002 : STA $2A : STA $2E                     ; col & row extent = 2
//     LDX #(CODE_12BC2A-$01)>>16 : LDA #CODE_12BC2A-$01  ; per-cell handler ptr
//     JMP CODE_walker_setup_trampoline                   ; runs the 2x2 walk
//
//   $15 re-encode (verified vs spec orientation): $92->$00 (BC12), $93->$02
//   (BC16), $94->$04 (BC1A), $95->$06 (BC1E).
//
// Stamper asm (verbatim, $12:BC2A):
//   REP #$30
//   LDY $15 : LDA DATA_12BC22,y : STA $00     ; $00 = sub-table ptr for variant
//   LDA $2C : ASL : ADC $28 : TAY             ; Y = row*2 + col
//   LDA ($00),y : AND #$00FF                  ; fetch raw tile byte
//   BEQ +                                     ; byte==0 -> no stamp (gate)
//   CLC : ADC #$8700                          ; Map16 = $8700 + byte
//   LDX $1D : STA LevelDataBuffer,x
//   + : SEP #$30 : RTL
//
// Per-variant 4-byte sub-tables (DATA_12BC12/16/1A/1E), read verbatim from
// Bank12.asm (little-endian bytes within each `dw`). Index = row*2 + col;
// each variant has its single $00 (no-stamp) byte at a DIFFERENT cell:
//   $92 (BC12) `dw $1514,$0018` -> bytes [0]=$14 [1]=$15 [2]=$18 [3]=$00
//   $93 (BC16) `dw $1716,$1900` -> bytes [0]=$16 [1]=$17 [2]=$00 [3]=$19
//   $94 (BC1A) `dw $001E,$1B1A` -> bytes [0]=$1E [1]=$00 [2]=$1A [3]=$1B
//   $95 (BC1E) `dw $1F00,$1D1C` -> bytes [0]=$00 [1]=$1F [2]=$1C [3]=$1D
//
// Verified: all 16 cells (4 IDs x 2x2) reproduce the spec.json per-cell
// `output_mapid`/`buf_addr` EXACTLY, including each variant's byte==0 skip
// cell. No unverified cells.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Per-variant raw tile-byte sub-tables (DATA_12BC12/16/1A/1E), little-endian
// bytes from each `dw`. Index = row*2 + col; byte 0 means "no stamp"
// (cur_tile gate). Variant index = $15 >> 1 = (extID + 2) & 3.
const LINE_GUIDE_MID_CORNER_TILE_BYTES: readonly (readonly number[])[] = [
  [0x14, 0x15, 0x18, 0x00], // $92 / DATA_12BC12  (dw $1514,$0018)
  [0x16, 0x17, 0x00, 0x19], // $93 / DATA_12BC16  (dw $1716,$1900)
  [0x1e, 0x00, 0x1a, 0x1b], // $94 / DATA_12BC1A  (dw $001E,$1B1A)
  [0x00, 0x1f, 0x1c, 0x1d], // $95 / DATA_12BC1E  (dw $1F00,$1D1C)
];

// Cart asm: `ADC #$8700`. Map16 base added to the raw sub-table byte.
const LINE_GUIDE_MID_CORNER_TILE_BASE = 0x8700;

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamper (ports $12:BC2A). variant = $15>>1; index = row*2 + col.
// byte==0 is the cart's `AND #$00FF : BEQ` gate -> skip (no write).
// ─────────────────────────────────────────────────────────────────────
const perCellLineGuideMidCorner: PerCellHandler = (state) => {
  const variant = (state.zp15 >> 1) & 0x03; // $15 = ((extID+2)&3)<<1
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  // LDA $2C : ASL : ADC $28 : TAY  -> Y = row*2 + col
  const idx = (row * 2 + col) & 0x03;
  const byte = LINE_GUIDE_MID_CORNER_TILE_BYTES[variant][idx];
  // AND #$00FF : BEQ +  -> byte 0 means no stamp for this cell.
  if (byte === 0) return;
  stampCell(state, (LINE_GUIDE_MID_CORNER_TILE_BASE + byte) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_line_guide_mid_corner_family (init). $15 := ((extID+2)&3)<<1; col/row extent = 2; then run
// the trampoline walker, which visits each of the 4 cells of the 2x2 block
// and calls perCellLineGuideMidCorner. (The walker zeroes the slope, $17.)
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0x92, 0x93, 0x94, 0x95 share this handler.
function extLineGuideMidCornerFamily(state: DecodeState): void {
  // LDA $15 : INC : INC : AND #$0003 : ASL : STA $15
  state.zp15 = (((state.zp15 + 2) & 0x0003) << 1) & 0xffff;
  // LDA #$0002 : STA $2A : STA $2E
  state.zp2A = 0x0002;
  state.zp2E = 0x0002;
  // JMP CODE_walker_setup_trampoline (with per-cell handler = CODE_12BC2A)
  walkerSetupTrampoline(state, perCellLineGuideMidCorner);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext ids $92-$95 all dispatch to the same handler (the
// $192-$195 mirrors are automatic — getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────
export function installExtLineGuideMidCornerFamilyHandlers(): void {
  registerExtObjectHandler(0x92, extLineGuideMidCornerFamily);
  registerExtObjectHandler(0x93, extLineGuideMidCornerFamily);
  registerExtObjectHandler(0x94, extLineGuideMidCornerFamily);
  registerExtObjectHandler(0x95, extLineGuideMidCornerFamily);
}
