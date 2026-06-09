// Ports CODE_extobj_handler_flower_pattern_family ($12:90ED, yi/Banks/Bank12.asm:2735)
// + its shared per-cell stamper CODE_12C3D3 ($12:C3D3, Bank12.asm:8762).
//
// Extended-object family, ext IDs $C5-$C9: a 5-way flower-pattern wall block.
// WALKER-DRIVEN (shape-2) handler — the init sets per-variant col/row extents
// then tail-calls the walker; the per-cell stamper indexes a per-variant tile
// grid by (col,row). Dispatch key is $15 (the ext id): the cart re-encodes it
// to a 0..4 variant index via ($15 - $C5).
//
// Init (CODE_extobj_handler_flower_pattern_family), verbatim:
//   REP #$20
//   LDA $15 ; SEC ; SBC #$00C5 ; ASL ; STA $15 ; TAX   ; $15 := variant_idx*2
//   LDA DATA_1290D9,x : STA $2A                         ; col extent
//   LDA DATA_1290E3,x : STA $2E                         ; row extent
//   LDX #(CODE_12C3D3-1)>>16 ; LDA #CODE_12C3D3-1
//   JMP CODE_walker_setup_trampoline                    ; slope 0; runs the walk
//
// Per-cell (CODE_12C3D3), verbatim:
//   REP #$30
//   LDY $15 ; LDA DATA_12C3BF,y : STA $00   ; $00 -> ROWTILES[variant]
//            LDA DATA_12C3C9,y : STA $02    ; $02 -> COLSTRIDE[variant]
//   LDY $2C ; LDA ($02),y & $FF             ; stride = COLSTRIDE[variant][row]
//   CLC ; ADC $28 ; TAY                     ; index = stride + col
//   LDA ($00),y & $FF                       ; low = ROWTILES[variant][index]
//   BEQ skip                                ; low==0 => transparent (no stamp)
//   ORA #$7900 ; LDX $1D ; STA LevelDataBuffer,x   ; tile = $7900 | low
//
// Data tables (exact bytes, Bank12.asm:2728-2732 and 8726-8760):
//   DATA_1290D9 (col $2A): dw $0002,$0003,$0002,$0002,$0002
//   DATA_1290E3 (row $2E): dw $0002,$0003,$0003,$0002,$0002
//   ROWTILES (DATA_12C3BF -> 5 arrays):
//     C5 DATA_12C398: CD CE CF D0
//     C6 DATA_12C39C: 00 D1 D2 D0 D5 CF D0 D2 00
//     C7 DATA_12C3A5: 00 D2 CD D5 CF 00
//     C8 DATA_12C3AB: CA 00 CB CC
//     C9 DATA_12C3AF: 00 C5 C6 C7
//   COLSTRIDE (DATA_12C3C9 -> 5 arrays):
//     C5 DATA_12C3B3: 00 02
//     C6 DATA_12C3B5: 00 03 06
//     C7 DATA_12C3B8: 00 02 04
//     C8 DATA_12C3BB: 00 02
//     C9 DATA_12C3BD: 00 02
//
// Verified per-cell against ext-C5..C9 spec.json: every stamped cell matches
// (tile = $7900|low) AND every harness "????" cell corresponds exactly to a
// low==0 (skip) entry in the table above.
import type { DecodeState, PerCellHandler } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

type Variant = {
  cols: number;       // DATA_1290D9 col extent
  rows: number;       // DATA_1290E3 row extent
  rowTiles: number[]; // DATA_12C3BF[idx] -> tile low bytes (0 = skip)
  colStride: number[];// DATA_12C3C9[idx] -> per-row base index into rowTiles
};

// Keyed by ext id $C5-$C9 (the cart's variant index = id - $C5).
const VARIANTS: Record<number, Variant> = {
  0xC5: { cols: 2, rows: 2, rowTiles: [0xCD, 0xCE, 0xCF, 0xD0], colStride: [0x00, 0x02] },
  0xC6: { cols: 3, rows: 3, rowTiles: [0x00, 0xD1, 0xD2, 0xD0, 0xD5, 0xCF, 0xD0, 0xD2, 0x00], colStride: [0x00, 0x03, 0x06] },
  0xC7: { cols: 2, rows: 3, rowTiles: [0x00, 0xD2, 0xCD, 0xD5, 0xCF, 0x00], colStride: [0x00, 0x02, 0x04] },
  0xC8: { cols: 2, rows: 2, rowTiles: [0xCA, 0x00, 0xCB, 0xCC], colStride: [0x00, 0x02] },
  0xC9: { cols: 2, rows: 2, rowTiles: [0x00, 0xC5, 0xC6, 0xC7], colStride: [0x00, 0x02] },
};

// CODE_12C3D3 — shared per-cell stamper. index = colStride[row] + col;
// low = rowTiles[index]; low==0 => transparent (cart BEQ); else $7900|low.
const flowerPatternPerCell: PerCellHandler = (state) => {
  const v = VARIANTS[state.zp15 & 0xff];
  if (!v) return;
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const index = ((v.colStride[row] ?? 0) + col) & 0xff;
  const low = (v.rowTiles[index] ?? 0) & 0xff;
  if (low === 0) return; // cart BEQ CODE_12C3FC: 0 => no stamp
  stampCell(state, 0x7900 | low);
};

// CODE_extobj_handler_flower_pattern_family — set per-variant extents, run walk.
// (We register per id, so $15 still holds $C5-$C9 here; the stamper keys on it
// instead of the cart's re-encoded *2 index — same variant selection.)
// Merge: object IDs 0xC5, 0xC6, 0xC7, 0xC8, 0xC9 share this handler.
function initFlowerPattern(state: DecodeState): void {
  const v = VARIANTS[state.zp15 & 0xff];
  if (!v) return;
  state.zp2A = v.cols; // DATA_1290D9,x -> $2A
  state.zp2E = v.rows; // DATA_1290E3,x -> $2E
  walkerSetupTrampoline(state, flowerPatternPerCell);
}

export function installExtFlowerPatternFamilyHandlers(): void {
  registerExtObjectHandler(0xC5, initFlowerPattern);
  registerExtObjectHandler(0xC6, initFlowerPattern);
  registerExtObjectHandler(0xC7, initFlowerPattern);
  registerExtObjectHandler(0xC8, initFlowerPattern);
  registerExtObjectHandler(0xC9, initFlowerPattern);
}
