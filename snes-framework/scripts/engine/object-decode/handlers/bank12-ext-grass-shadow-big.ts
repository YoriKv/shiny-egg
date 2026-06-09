// Bank12 ext-object init handler — grass_shadow_big (ext ID 0x6C).
//
// Ports CODE_extobj_handler_grass_shadow_big ($12:8CBF, yi/Banks/Bank12.asm:2185)
// and its per-cell stamper CODE_12B194 ($12:B194) → CODE_12B203 ($12:B203).
//
// SHAPE: WALKER-DRIVEN multi-cell (shape 2). The init re-encodes the
// orientation byte and writes fixed column/row extents, then tail-calls the
// walker setup trampoline with the per-cell handler CODE_12B194. The walker
// (CODE_object_stream_walk) runs synchronously, calling the per-cell stamper
// once per (col,row) cell of the 5×3 rectangle.
//
// Init asm (verbatim, $12:8CBF):
//   REP #$10
//   LDX #$0004 : STX $15      ; orientation := 4 (selects CODE_12B203 stamper)
//   LDX #$0005               ; cols  := 5
//   LDY #$0003               ; rows  := 3
//   STX $2A : STY $2E        ; $2A=5 (col extent), $2E=3 (row extent)
//   REP #$20 : SEP #$10
//   LDX/LDA #(CODE_12B194-1) ; per-cell handler
//   JMP CODE_walker_setup_trampoline   ; slope=0, runs the walk
// Confirms spec.json: col_extent 0001→0005, row_extent 0001→0003,
// orientation 6C→04.  ($1B/$1C untouched.)
//
// Per-cell stamper CODE_12B194 ($12:B194):
//   LDA $28 : ASL : STA $00        ; $00 = col*2
//   LDA $2C : ASL ASL ASL : ORA $00; A = row*8 + col*2
//   TAY
//   LDX $15 : JSR (DATA_12B18E,x)  ; $15=4 → 3rd entry = CODE_12B203
//   LDX $1D : STA buffer,x         ; stamp returned tile at current cell
// (DATA_12B18E = dw CODE_12B1BF, CODE_12B1DB, CODE_12B203; X=$15=4 picks the
//  CODE_12B203 word.  The row*8+col*2 value computed here is NOT used by the
//  $15=4 path — CODE_12B203 recomputes its own index from $2C and $00.)
//
// CODE_12B203 ($12:B203) — the actual tile picker for this family:
//   LDA $2C : ASL : TAY           ; Y = row*2
//   LDA DATA_12B1FD,y             ; row-stride base
//   CLC : ADC $00                 ; + col*2   ($00 = col*2 from CODE_12B194)
//   TAY
//   LDA DATA_12B1DF,y             ; final tile (16-bit)
//   RTS
// So: tileIndexBytes = DATA_12B1FD[row*2] + col*2 ; tile = DATA_12B1DF word
// at that byte offset (i.e. DATA_12B1DF[(DATA_12B1FD[row*2] + col*2) / 2]).
//
// DATA tables read verbatim from the asm source (Bank12.asm) and cross-checked
// against the ext-6C spec.md per-cell trace (all 15 stamping cells matched).
// DATA_12B1FD row-stride (Bank12.asm:7173 — dw $0000,$000A,$0014):
//   row0 → 0x0000, row1 → 0x000A, row2 → 0x0014  (stride 0x0A = 5 cols × 2B)
// DATA_12B1DF tile table (Bank12.asm:7169, 15 words = 3 rows × 5 cols), row-major:
//   row0: 7760 7761 7762 7763 7764   (grass band, top)
//   row1: 7765 7766 7767 7768 7769   (grass band, mid)
//   row2: 01CB 01CC 01CD 01CE 01CF   (shadow band, bottom)
//
// Note: $15 is a per-object register the walker also passes to even/odd-col
// and row dispatch, but for this family all three walker handler slots are the
// same CODE_12B194 (spec: even/odd/row handler all @ 12B193). The single
// per-cell function below covers every cell.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { registerExtObjectHandler } from './index.ts';

// CODE_12B203 tile picker tables (see header).
// Row-stride table DATA_12B1FD, indexed by row (cart indexes by row*2 into a
// word table; we store as plain per-row word values).
const ROW_STRIDE = [0x0000, 0x000a, 0x0014] as const;
// Tile table DATA_12B1DF, a flat word array indexed by (byte offset / 2).
const TILE_TABLE = [
  0x7760, 0x7761, 0x7762, 0x7763, 0x7764, // row 0
  0x7765, 0x7766, 0x7767, 0x7768, 0x7769, // row 1
  0x01cb, 0x01cc, 0x01cd, 0x01ce, 0x01cf, // row 2
] as const;

// Ports CODE_12B194 + CODE_12B203 ($15=4 path). Index = ROW_STRIDE[row] +
// col*2 (byte offset into DATA_12B1DF), so TILE_TABLE[(stride + col*2)/2].
const perCellGrassShadowBig: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  // Byte offset into DATA_12B1DF, exactly as CODE_12B203 computes it.
  const byteOff = (ROW_STRIDE[row] + col * 2) & 0xffff;
  const tile = TILE_TABLE[byteOff >>> 1] ?? 0x0000;
  stampCell(state, tile);
};

// Ports CODE_extobj_handler_grass_shadow_big ($12:8CBF).
// Sets orientation=4, extents 5×3, dispatches the walker with the per-cell
// stamper. Walker reads $28 (col 0..4) / $2C (row 0..2) per cell.
function initGrassShadowBig(state: DecodeState): void {
  state.zp15 = 0x04; // orientation (selects CODE_12B203 inside CODE_12B194)
  state.zp2A = 0x05; // col extent
  state.zp2E = 0x03; // row extent
  walkerSetupTrampoline(state, perCellGrassShadowBig);
}

export function installExtGrassShadowBigHandlers(): void {
  // 0x6C only; the 0x16C mirror is automatic (getExtObjectHandler masks id&0xff).
  registerExtObjectHandler(0x6c, initGrassShadowBig);
}
