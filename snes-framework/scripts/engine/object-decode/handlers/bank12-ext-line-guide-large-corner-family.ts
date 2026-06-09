// Bank12 EXTENDED-object handler: line_guide_large_corner_family (ext IDs $96-$99).
//
// Four ext IDs share ONE init handler; the variant (which of 4 tile tables
// the per-cell stamper reads) is selected from $15 (= the extID), re-encoded
// to 0/2/4/6. Walker-driven, 8x8 — the init sets $2A/$2E = 8 and tail-calls
// the walker with per-cell stamper CODE_12BD55.
//
// Asm sources (yi/Banks/Bank12.asm):
//   CODE_extobj_handler_line_guide_large_corner_family  $12:8E86  (line 2411)
//     aliases: CODE_extobj_handler_line_guide_large_corner_family
//   CODE_12BD55 (per-cell stamper)              $12:BD55  (line 7984)
//   DATA_12BD4D (pointer table)                 $12:BD4D  (line 7981)
//   tile tables: DATA_12BC4D/BC8D/BCCD/BD0D     $12:BC4D.. (lines 7957-7979)
//
// Init asm (verbatim):
//   CODE_extobj_handler_line_guide_large_corner_family:
//     REP #$20
//     LDA $15 : INC : INC : AND #$0003 : ASL : STA $15  ; $15 := ((extID+2)&3)<<1
//     LDA #$0008 : STA $2A : STA $2E                    ; 8x8 walker extents
//     LDX #(CODE_12BD55-1)>>16 : LDA #CODE_12BD55-1
//     JMP CODE_walker_setup_trampoline                  ; runs the walk
//
// Per-cell stamper asm (CODE_12BD55, verbatim):
//   REP #$30
//   LDY $15 : LDA DATA_12BD4D,y : STA $00      ; $00 = ptr to variant's tile table
//   LDA $2C : ASL : ASL : ASL : ADC $28 : TAY  ; Y = row*8 + col
//   LDA ($00),y : AND #$00FF                   ; tile byte
//   BEQ skip                                   ; 0 => no stamp
//   CLC : ADC #$8700                           ; Map16 = $8700 + tileByte
//   LDX $1D : STA buffer,x
//
// $15 re-encoding (init INC/INC/AND/ASL): extID -> orientation index:
//   $96 -> ((0x96+2)&3)<<1 = 0   -> DATA_12BC4D
//   $97 -> ((0x97+2)&3)<<1 = 2   -> DATA_12BC8D
//   $98 -> ((0x98+2)&3)<<1 = 4   -> DATA_12BCCD
//   $99 -> ((0x99+2)&3)<<1 = 6   -> DATA_12BD0D
// DATA_12BD4D = dw DATA_12BC4D,DATA_12BC8D,DATA_12BCCD,DATA_12BD0D (indexed
// by the 0/2/4/6 value, so consecutive variants are 2 bytes apart).
//
// Each tile table is declared as 32 `dw` words = 64 bytes in the asm. The
// stamper reads it as a BYTE array via `LDA ($00),y` with y = row*8 + col
// (0..63), so the dw words are consumed little-endian (low byte = even index,
// high byte = odd index). The four tables are contiguous in ROM; with the
// 64-byte byte width row*8+col never overflows past a table's own 64 bytes
// (max index 7*8+7 = 63), so each variant is self-contained.
//
// All four 64-byte tables are pinned byte-for-byte to the cart ROM at the
// labels above (V1.0 is byte-identical to the reference cart) — re-derive
// from the ROM, never hand-transcribe the `dw` words. TRAP: an earlier
// hand-transcription shifted the lower rows of the $97 and $98 tables LEFT by
// dropping the leading $00 of high-byte-first words (e.g. $3700 -> bytes
// 00,37, not 37), which made ext-$98's curve render disjointed in level 5-7.
// $96 and $99 were transcribed correctly. tileByte 0 => skip.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';

// Cart asm: `ADC #$8700`. Base added to the per-cell tile byte to form Map16.
const LINE_GUIDE_LARGE_CORNER_BASE = 0x8700;

// The four 64-byte tile tables, byte-expanded little-endian from the asm `dw`
// declarations (yi/Banks/Bank12.asm lines 7957-7979). Indexed by row*8+col.
// 0 => no cell (skip stamp); else Map16 = $8700 + byte.
const LINE_GUIDE_LARGE_CORNER_TILES: readonly number[] = [
  // DATA_12BC4D ($15=0, ext $96) — offset 0
  0x00, 0x00, 0x00, 0x00, 0x20, 0x21, 0x22, 0x23,
  0x00, 0x00, 0x24, 0x25, 0x26, 0x00, 0x00, 0x00,
  0x00, 0x27, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x29, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x2a, 0x2b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x2d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x2e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  // DATA_12BC8D ($15=2, ext $97) — offset 64
  0x4b, 0x4c, 0x4d, 0x4e, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x48, 0x49, 0x4a, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x46, 0x47, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x45, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x43, 0x44,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x42,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x41,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40,
  // DATA_12BCCD ($15=4, ext $98) — offset 128
  0x3e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x3d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x3c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x3a, 0x3b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x39, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x37, 0x38, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x34, 0x35, 0x36, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x30, 0x31, 0x32, 0x33,
  // DATA_12BD0D ($15=6, ext $99) — offset 192
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x51,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x52,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x53, 0x54,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x55, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x56, 0x57, 0x00,
  0x00, 0x00, 0x00, 0x58, 0x59, 0x5a, 0x00, 0x00,
  0x5b, 0x5c, 0x5d, 0x5e, 0x00, 0x00, 0x00, 0x00,
];

// DATA_12BD4D maps the re-encoded $15 (0/2/4/6) to a tile-table pointer. We
// translate each cart pointer to a flat-array base offset (64-byte stride):
// BC4D->0, BC8D->64, BCCD->128, BD0D->192. Indexed by $15 (already 0/2/4/6).
const VARIANT_BASE: Record<number, number> = { 0: 0, 2: 64, 4: 128, 6: 192 };

// ─────────────────────────────────────────────────────────────────────
// CODE_12BD55 ($12:BD55) — per-cell stamper.
//
// Reads the variant table (selected by $15) at index row*8+col; a 0 byte
// means "no cell here" (skip), otherwise stamps $8700 + tileByte at $1D.
// ─────────────────────────────────────────────────────────────────────
const lineGuideLargeCornerPerCell: PerCellHandler = (state: DecodeState): void => {
  // LDY $15 : LDA DATA_12BD4D,y : STA $00  -> pick variant table base.
  const base = VARIANT_BASE[state.zp15 & 0x06];
  if (base === undefined) return; // out-of-range variant (shouldn't occur)
  // LDA $2C : ASL ASL ASL : ADC $28 : TAY  -> index = row*8 + col (8-bit TAY).
  const idx = (((state.zp2C & 0xff) << 3) + (state.zp28 & 0xff)) & 0xff;
  // LDA ($00),y : AND #$00FF
  const tile = LINE_GUIDE_LARGE_CORNER_TILES[base + idx] ?? 0;
  // BEQ skip
  if (tile === 0) return;
  // CLC : ADC #$8700 : STA buffer,x  (X = $1D, set by walker)
  stampCell(state, (LINE_GUIDE_LARGE_CORNER_BASE + tile) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_line_guide_large_corner_family ($12:8E86) — init.
//
// $15 := ((extID + 2) & 3) << 1 (0/2/4/6 for $96/$97/$98/$99), 8x8 extents,
// then dispatch the walker with the per-cell stamper above.
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0x96, 0x97, 0x98, 0x99 share this handler.
function extLineGuideLargeCornerFamily(state: DecodeState): void {
  // LDA $15 : INC : INC : AND #$0003 : ASL : STA $15
  state.zp15 = (((state.zp15 + 2) & 0x0003) << 1) & 0xff;
  // LDA #$0008 : STA $2A : STA $2E
  state.zp2A = 0x0008;
  state.zp2E = 0x0008;
  // JMP CODE_walker_setup_trampoline (runs the walk synchronously)
  walkerSetupTrampoline(state, lineGuideLargeCornerPerCell);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext ids $96-$99 all dispatch to the same init (the
// $196-$199 mirrors are automatic — getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────
export function installExtLineGuideLargeCornerFamilyHandlers(): void {
  registerExtObjectHandler(0x96, extLineGuideLargeCornerFamily);
  registerExtObjectHandler(0x97, extLineGuideLargeCornerFamily);
  registerExtObjectHandler(0x98, extLineGuideLargeCornerFamily);
  registerExtObjectHandler(0x99, extLineGuideLargeCornerFamily);
}
