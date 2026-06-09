// Bank12 ext-object $4D — mid_grass_2x2. A 2x2 block of grass tiles.
//
// Ports CODE_extobj_handler_mid_grass_2x2 ($12:8B0D) → stamp CODE_12AD3F
// ($12:AD3F), tile table DATA_12AD37 ($12:AD37).
//
// Shape-2 (walker-driven). The init forces a 2x2 extent ($2A col=2,
// $2E row=2 — overwriting the stream's raw 1x1 extents) then tail-calls
// the bare walker trampoline. The per-cell stamper indexes a 4-entry
// Map16 table by the walker col/row counters.
//
// Asm (verbatim, init — Bank12.asm:1908):
//   CODE_extobj_handler_mid_grass_2x2:
//     ... LDA #$0002 : STA $2A     ; col extent = 2
//     ... LDA #$0002 : STA $2E     ; row extent = 2
//     LDX #(CODE_12AD3F-1)>>16
//     LDA #CODE_12AD3F-1
//     JMP CODE_walker_setup_trampoline
//
// Asm (verbatim, stamp — Bank12.asm:6527):
//   CODE_12AD3F:
//     REP #$30
//     LDA $2C : ASL : ASL : STA $00   ; row*4 (byte stride between rows)
//     LDA $28 : ASL : CLC : ADC $00   ; + col*2 → word byte index
//     TAY
//     LDA DATA_12AD37,y
//     LDX $1D
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     SEP #$30
//     RTL
//
// DATA_12AD37 ($12:AD37), 4 words: dw $0080,$0081,$014B,$014C
// The cart byte index Y = (col<<1) + (row<<2); since entries are words,
// the element index = Y/2 = col + row*2. Trace (spec ext-4D) confirms:
//   (col0,row0) Y$0000 → $0080   (col1,row0) Y$0002 → $0081
//   (col0,row1) Y$0004 → $014B   (col1,row1) Y$0006 → $014C
// Buffer offsets 0x310/0x312/0x330/0x332 fall out of the walker (+2 bytes
// per col, +0x20 per row) — handled by the walker / stampCell, not here.
//
// The trace's interleaved CODE_128874 / CODE_128640 frames are the
// walker's own plumbing (off-screen-wrap sentinels + post-stamp
// bookkeeping), handled inside walkerSetupTrampoline — not part of this
// handler.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { makeRowMajorTableStamp } from './_shared.ts';

// DATA_12AD37 ($12:AD37). Indexed col + row*2 (see header for derivation).
const MID_GRASS_TILES = [0x0080, 0x0081, 0x014b, 0x014c] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_12AD3F — per-cell stamper (Bank12.asm:6527). Indexes DATA_12AD37
// by the walker column ($28) and row ($2C) counters: tiles[row*2 + col].
// ─────────────────────────────────────────────────────────────────────

const midGrassStamp = makeRowMajorTableStamp(MID_GRASS_TILES, 2);

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_mid_grass_2x2 ($12:8B0D). Forces a 2x2 extent then
// runs the bare walker trampoline. The dispatcher seeds $2A/$2E from the
// stream's raw 1x1 extents; the init overwrites both with 2 (matches the
// spec DP-diff: col_extent 0001→0002, row_extent 0001→0002). The walker
// reads zp2A/zp2E at dispatch time, so set them first.
// ─────────────────────────────────────────────────────────────────────

function initMidGrass2x2(state: DecodeState): void {
  state.zp2A = 0x0002; // col extent = 2
  state.zp2E = 0x0002; // row extent = 2
  walkerSetupTrampoline(state, midGrassStamp);
}

export function installExtMidGrass2x2Handlers(): void {
  registerExtObjectHandler(0x4d, initMidGrass2x2);
}
