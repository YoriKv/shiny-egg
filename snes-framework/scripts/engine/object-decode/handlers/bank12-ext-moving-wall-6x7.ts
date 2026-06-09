// Ext-object handler `moving_wall_6x7` (ext id 0x31): a 6-wide x 7-tall
// moving/sliding wall segment. Walker-driven — the init sets the column/row
// extents and tail-calls the walker trampoline; the per-cell stamper picks a
// Map16 ID from the cell's COLUMN only (every row in a column shares its tile).
//
// Ports:
//   CODE_extobj_handler_moving_wall_6x7  @ $12:8A3C  (Bank12.asm:1792) — init
//   CODE_12AB9D                          @ $12:AB9D  (Bank12.asm:6321) — per-cell
//   DATA_12AB99                          @ $12:AB99  (Bank12.asm:6318) — col tile table

import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';
import { stampCell } from './_shared.ts';

// CODE_12AB9D's column tile table. Cart: `DATA_12AB99: dw $00BD,$00BC`.
// The stamper does `AND #$0001 : ASL : TAY : LDA DATA_12AB99,y`, so the word
// index is (col & 1) * 2 → flat entry (col & 1): even col → $00BD, odd → $00BC.
const COL_TILES = [0x00bd, 0x00bc] as const;

// Tile stamped at column 0. Cart `LDA.w #$00BB` on the `$28 == 0` branch.
const COL0_TILE = 0x00bb;

// ── CODE_12AB9D ($12:AB9D) — per-cell stamper ──
//   REP #$30 : LDX $1D : LDA $28
//   BNE +      : LDA #$00BB : BRA stamp          ; col 0 → $00BB
// + AND #$0001 : ASL : TAY : LDA DATA_12AB99,y   ; else (col&1) → $00BD/$00BC
//   stamp: STA LevelDataBuffer,x : SEP #$30 : RTL
// The walker has already resolved $1D for this cell; stampCell writes there.
// Tile depends only on the column counter ($28); the row counter is unused.
const movingWall6x7PerCell: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const tile = col === 0 ? COL0_TILE : COL_TILES[col & 0x01];
  stampCell(state, tile);
};

// ── CODE_extobj_handler_moving_wall_6x7 ($12:8A3C) — init ──
//   REP #$20
//   LDA #$0006 : STA $2A    ; cols = 6
//   INC        : STA $2E    ; rows = 7  (A = $0006 + 1)
//   LDX #(CODE_12AB9D-1)>>16 : LDA #CODE_12AB9D-1
//   JMP CODE_walker_setup_trampoline
// No $17 write — the trampoline defaults slope to 0.
function initMovingWall6x7(state: DecodeState): void {
  state.zp2A = 0x0006; // cols
  state.zp2E = 0x0007; // rows (cart: INC of $0006)
  walkerSetupTrampoline(state, movingWall6x7PerCell);
}

export function installExtMovingWall6x7Handlers(): void {
  registerExtObjectHandler(0x31, initMovingWall6x7);
}
