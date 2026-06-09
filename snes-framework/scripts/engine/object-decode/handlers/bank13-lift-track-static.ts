// Bank13 stamp handler for the static (horizontal) lift-track rail
// (standard object $13 — "lift track static").
//
// Cart entry points:
//   CODE_init_lift_track_static  ($12:939E, Bank12.asm:3041)
//   CODE_lift_track_static       ($13:85D3, Bank13.asm:1073)
//
// Init handler (Bank12.asm:3041) — the simplest of the three lift-track
// inits. It just trampolines into the slope=0 walker setup pointing at
// the per-cell stamp; no DP mutations:
//
//   REP #$20
//   LDX.b #(CODE_lift_track_static-$01)>>16
//   LDA.w #CODE_lift_track_static-$01
//   JMP   CODE_walker_setup_trampoline           ; STZ $17 (slope=0)
//
// Spec confirms this — `init_dp_delta` shows xy_lo/xy_hi/col_extent/
// row_extent/orientation all unchanged from entry to walker time.
//
// Per-cell stamp (CODE_lift_track_static, Bank13.asm:1073):
//
//   REP #$30
//   LDX  $1D
//   LDA  $12                ; current cell's Map16 ID
//   CMP  #$00B4   BEQ  preserveRail   ; \ if the cell already holds a
//   CMP  #$00A7   BEQ  not_already... ;  | rail/joint sentinel, stamp
//                                     ; /  $00A7 (intersection/joint).
//   preserveRail:  LDA #$00A7   BRA stamp
//
//   else:
//     LDA $28               ; column counter
//     BEQ leftCap           ;   col == 0 → left cap = $0093
//     INC ; CMP $2A
//     BEQ rightCap          ;   (col+1) == col_extent → right cap = $0092
//     LDA #$00A6            ;   else middle rail = $00A6
//     BRA stamp
//   leftCap:    LDA #$0093  BRA stamp
//   rightCap:   LDA #$0092
//   stamp:      STA.l !RAM_YI_Level_LevelDataBuffer,x ; SEP #$30 ; RTL
//
// The captured trace: 16 cells of a
// 1-row, $10-col horizontal rail produce $0093, then 14× $00A6, then
// $0092 — matches the leftCap → middle → rightCap branch progression.
//
// Note: the $00B4 / $00A7 "preserveRail" check mirrors the same sentinel
// pair the 30deg / 45deg variants use — shared via `_shared.ts`
// LIFT_TRACK_KEEP_CHECK_A/B/OUT.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import {
  stampCell,
  LIFT_TRACK_KEEP_CHECK_A,
  LIFT_TRACK_KEEP_CHECK_B,
  LIFT_TRACK_KEEP_OUT,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamp tile constants (Bank13.asm:1073-1103).
// ─────────────────────────────────────────────────────────────────────

/** Left-cap Map16 ID stamped at col == 0 (CODE_1385F6). */
const LIFT_STATIC_LEFT_CAP   = 0x0093;
/** Right-cap Map16 ID stamped when col+1 == col_extent (CODE_1385FB). */
const LIFT_STATIC_RIGHT_CAP  = 0x0092;
/** Middle-rail Map16 ID stamped on every interior cell (CODE_1385E8). */
const LIFT_STATIC_MIDDLE     = 0x00A6;

// ─────────────────────────────────────────────────────────────────────
// CODE_lift_track_static (Bank13.asm:1073) — per-cell stamp.
// ─────────────────────────────────────────────────────────────────────

const liftTrackStatic: PerCellHandler = (state) => {
  // LDA $12 ; CMP #$00B4 / #$00A7 — preserve already-rail cells as $00A7.
  const cur = state.zp12 & 0xffff;
  if (cur === LIFT_TRACK_KEEP_CHECK_A || cur === LIFT_TRACK_KEEP_CHECK_B) {
    stampCell(state, LIFT_TRACK_KEEP_OUT);
    return;
  }

  // LDA $28 ; BEQ leftCap.
  const col = state.zp28 & 0xff;
  if (col === 0) {
    stampCell(state, LIFT_STATIC_LEFT_CAP);
    return;
  }

  // INC A ; CMP $2A ; BEQ rightCap. ($28 is read in REP #$30 so the
  // 16-bit INC matches `(col + 1) == col_extent` semantics; $2A is a
  // byte here — same convention as the 45deg sibling.)
  if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    stampCell(state, LIFT_STATIC_RIGHT_CAP);
    return;
  }

  // Middle rail.
  stampCell(state, LIFT_STATIC_MIDDLE);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_lift_track_static (Bank12.asm:3041).
//
// Pure trampoline into the slope=0 walker setup. No DP mutations —
// walker reads xy_lo / xy_hi / col_extent / row_extent / orientation
// directly from the stream record.
// ─────────────────────────────────────────────────────────────────────

function initLiftTrackStatic(state: DecodeState): void {
  walkerSetupTrampoline(state, liftTrackStatic);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installLiftTrackStaticHandlers(): void {
  registerStdObjectHandler(0x13, initLiftTrackStatic);
}
