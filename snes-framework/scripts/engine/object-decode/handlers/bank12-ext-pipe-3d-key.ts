// Bank12 ext-object $E0 — "lava locked pipe" (2x2 walker-driven stamp).
//
// Shape: WALKER-DRIVEN (shape 2). The init writes a FIXED 2x2 rectangle
// (col extent $2A = 2, row extent $2E = 2) — note it stores the literal
// $0002, it does NOT add to the stream's extents — then tail-calls the bare
// walker trampoline. The walker walks the 2 cols × 2 rows and calls the
// per-cell stamper for each cell. The stamper indexes a 4-entry word table
// (DATA_12C6E2) row-major by the walker counters:
//   Y = ((row << 1) | col) << 1   (byte offset into a `dw` table)
//   entry index = Y/2 = row*2 + col   (table width = 2 cols)
// and stamps DATA_12C6E2[entry] at $1D, then JMPs to the shared post-stamp
// walker tail CODE_128640 (cell-advance bookkeeping; does NOT change the
// Map16 we stamped — it is the walker's own loop continuation).
//
// Despite the "locked" name there is NO savefile / item-memory / flag gate
// in this handler — the per-cell asm is an unconditional table-read + stamp.
// Any "lock" behaviour lives in a runtime sprite (e.g. a key / lava gate),
// not in the static tile layout, so there is nothing to model as a
// clear/proceed gate here; all four walked cells stamp unconditionally.
//
// The trace's two "CODE_128874" cells (indices 0 and 3, position -1/-1) are
// walker bookkeeping no-ops (CODE_128874 is a bare RTS in the screen-page
// resolver), not stamps — they emit no Map16 and need no per-cell logic.
//
// Asm sources (USA V1.0):
//   CODE_extobj_handler_pipe_3d_key   Bank12.asm:2789 ($12:915B)
//   CODE_12C6EA  (per-cell stamper)        Bank12.asm:8930 ($12:C6EA)
//   DATA_12C6E2  (tile table, 4 dw)        Bank12.asm:8927 ($12:C6E2)
//   CODE_128640  (shared walker tail)      Bank12.asm:998  ($12:8640)
//
// Asm (verbatim):
//   CODE_extobj_handler_pipe_3d_key:            ; $12:915B
//     REP.b #$20
//     LDA.w #$0002 : STA.b $2A : STA.b $2E           ; fixed 2x2 extents
//     LDX.b #(CODE_12C6EA-$01)>>16
//     LDA.w #CODE_12C6EA-$01
//     JMP.w CODE_walker_setup_trampoline
//
//   CODE_12C6EA:                                     ; $12:C6EA
//     REP.b #$30
//     LDA.b $2C : ASL : ORA.b $28 : ASL : TAY        ; Y = ((row<<1)|col)<<1
//     LDA.w DATA_12C6E2,y
//     LDX.b $1D
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     SEP.b #$30 : RTL
//
//   DATA_12C6E2:  dw $7D24,$7D25,$0118,$0119          ; $12:C6E2
//
// Per-cell verification against the spec.json trace (col,row → buf_off → mapid):
//   (0,0) Y=$0000 → $7F8320 → $7D24   (entry 0)
//   (1,0) Y=$0002 → $7F8322 → $7D25   (entry 1)
//   (0,1) Y=$0004 → $7F8340 → $0118   (entry 2)
//   (1,1) Y=$0006 → $7F8342 → $0119   (entry 3)
// All four stamping cells match. (`ORA $28` == `+ $28` here because $28 is
// 0/1 and (row<<1) is even, so it is exactly the row-major index used by
// makeRowMajorTableStamp.)

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { makeRowMajorTableStamp } from './_shared.ts';

// DATA_12C6E2 ($12:C6E2) — 4 dw entries, row-major, width = 2 cols:
//   row 0: [$7D24, $7D25]   row 1: [$0118, $0119]
const TILE_TABLE = [0x7d24, 0x7d25, 0x0118, 0x0119] as const;

// CODE_12C6EA ($12:C6EA) — per-cell stamper: TILE_TABLE[row*2 + col].
// makeRowMajorTableStamp(table, width): width = 2 cols.
const perCellPipe3dKey = makeRowMajorTableStamp([...TILE_TABLE], 2);

// CODE_extobj_handler_pipe_3d_key ($12:915B) — fixed 2x2 extents,
// then dispatch the bare walker against the per-cell stamper.
function initPipe3dKey(state: DecodeState): void {
  state.zp2A = 0x0002; // col extent = 2 (cart: LDA #$0002 : STA $2A)
  state.zp2E = 0x0002; // row extent = 2 (cart: STA $2E)
  walkerSetupTrampoline(state, perCellPipe3dKey);
}

export function installExtPipe3dKeyHandlers(): void {
  registerExtObjectHandler(0xe0, initPipe3dKey);
}
