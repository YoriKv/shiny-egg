// Bank13 3x3 structural-block stamp handler + Bank12 init wrapper.
//
// Standard object $69 — init_3x3_structural ("fortress/tower structural
// block"). The per-cell stamper classifies each cell as one of nine
// (column-edge × row-edge) cases and stamps a tile from one of three
// 3-entry tables:
//
//                  row==0          interior         row==last
//   col==0         $6100           $0185            $6103     (DATA_3x3_left_tiles)
//   interior       $6101           $0186            $6104     (DATA_3x3_middle_tiles)
//   col==last      $6102           $0187            $6105     (DATA_3x3_right_tiles)
//
// The asm picks Y in {0, 2, 4} from $28/$2A (column-edge classification)
// and the table from $2C/$2E (row-edge classification). Y is the byte
// offset into the dw-table, so the per-entry index is Y/2 in our number
// array.
//
// Init handler clamps both extents to a minimum of 4 — the visual
// design needs at least 3 distinct sections per axis, so any object
// shorter than 4 in either dimension is bumped up.
//
// Asm sources:
//   CODE_init_3x3_structural             Bank12.asm:4092  ($12:9A75)
//   CODE_3x3_structural                  Bank13.asm:8113  ($13:C6E3)
//   DATA_3x3_left_tiles                  Bank13.asm:8150  ($13:C716)
//   DATA_3x3_middle_tiles                Bank13.asm:8154  ($13:C71C)
//   DATA_3x3_right_tiles                 Bank13.asm:8158  ($13:C722)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Static tile tables. Each is indexed by the column-edge classification
// (left = 0, interior = 1, right = 2).
// ─────────────────────────────────────────────────────────────────────

const DATA_3x3_left_tiles:   ReadonlyArray<number> = [0x6100, 0x6101, 0x6102]; // row 0  (top)
const DATA_3x3_middle_tiles: ReadonlyArray<number> = [0x0185, 0x0186, 0x0187]; // interior row
const DATA_3x3_right_tiles:  ReadonlyArray<number> = [0x6103, 0x6104, 0x6105]; // last row (bottom)

const EXTENT_MIN = 0x0004;

// ─────────────────────────────────────────────────────────────────────
// Per-cell handler — CODE_3x3_structural ($13:C6E3, Bank13.asm:8113).
//
//   REP #$30
//   LDX $1D                ; X = buffer offset
//   LDY #$0000             ; Y = column-edge class * 2  (default = left)
//   LDA $28
//   BEQ row_select         ; col==0 → keep Y=0 (left)
//   INY / INY              ; Y = 2 (interior)
//   INC
//   CMP $2A
//   BNE row_select         ; not the last column → keep Y=2
//   INY / INY              ; Y = 4 (right)
//  row_select:
//   LDA $2C
//   BEQ pick_top           ; row==0 → top table
//   INC
//   CMP $2E
//   BNE pick_mid           ; not the last row → middle table
//   BRA pick_bot           ; last row → bottom table
//  pick_top: LDA DATA_3x3_left_tiles,Y ; BRA stamp
//  pick_mid: LDA DATA_3x3_middle_tiles,Y ; BRA stamp
//  pick_bot: LDA DATA_3x3_right_tiles,Y
//  stamp:    STA LevelDataBuffer,X ; SEP #$30 ; RTL
// ─────────────────────────────────────────────────────────────────────

const stamp3x3Structural: PerCellHandler = (state) => {
  const col    = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  const row    = state.zp2C & 0xff;
  const rowExt = state.zp2E & 0xff;

  // Column-edge classification → byte index Y in {0, 2, 4}.
  let colIdx: 0 | 1 | 2;
  if (col === 0) {
    colIdx = 0; // left edge
  } else if (((col + 1) & 0xff) === colExt) {
    colIdx = 2; // right edge
  } else {
    colIdx = 1; // interior
  }

  // Row-edge classification picks the table.
  let table: ReadonlyArray<number>;
  if (row === 0) {
    table = DATA_3x3_left_tiles;            // top row
  } else if (((row + 1) & 0xff) === rowExt) {
    table = DATA_3x3_right_tiles;           // bottom row
  } else {
    table = DATA_3x3_middle_tiles;          // interior row
  }

  stampCell(state, table[colIdx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_3x3_structural ($12:9A75, Bank12.asm:4092).
//
//   REP #$20
//   LDA $2A ; CMP #$0004 ; BCS skip1 ; LDA #$0004 ; STA $2A
//   LDA $2E ; CMP #$0004 ; BCS skip2 ; LDA #$0004 ; STA $2E
//   LDX #(CODE_3x3_structural-1)>>16
//   LDA #CODE_3x3_structural-1
//   JMP walker_setup_trampoline
//
// Clamps column extent ($2A) and row extent ($2E) to a minimum of 4
// (16-bit unsigned compare), then runs the walker with the 3x3 stamp.
// The asm reads $2A with `LDA.b $2A` (DP, 16-bit due to REP #$20) and
// $2E with `LDA.l $00002E` (long, 16-bit) — both are 16-bit reads so
// we honour that by clamping the full word.
// ─────────────────────────────────────────────────────────────────────

function init3x3Structural(state: DecodeState): void {
  // BCS = unsigned greater-or-equal: keep value if >= 4, else clamp to 4.
  if ((state.zp2A & 0xffff) < EXTENT_MIN) {
    state.zp2A = EXTENT_MIN;
  }
  if ((state.zp2E & 0xffff) < EXTENT_MIN) {
    state.zp2E = EXTENT_MIN;
  }
  walkerSetupTrampoline(state, stamp3x3Structural);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function install3x3StructuralHandlers(): void {
  registerStdObjectHandler(0x69, init3x3Structural);
}
