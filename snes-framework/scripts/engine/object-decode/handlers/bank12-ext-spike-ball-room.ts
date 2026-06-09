// Extended object $53 — `CODE_extobj_handler_spike_ball_room`
// ("chain-link / suspension pillar", a fixed 5-wide x 3-tall fenced
// column whose two outer columns are blank-gutter seam-fixers so that
// adjacent pillars tile together).
//
// WALKER-DRIVEN extended object (shape 2 — same idiom as the $0D/$0E
// 8x16_block). Init handler CODE_extobj_handler_spike_ball_room
// ($12:8B8B, Bank12.asm:1994):
//
//   REP #$20
//   LDA $1B : AND #$0F0F : DEC : AND #$0F0F : STA $00   ; sub-coords - 1
//   LDA $1B : AND #$F0F0 : ORA $00 : STA $1B            ; (keep screen nibbles)
//   LDA #$0005 : STA $2A                                ; col extent = 5
//   LDA #$0003 : STA $2E                                ; row extent = 3
//   LDX #(CODE_12AE88-1)>>16 : LDA #CODE_12AE88-1
//   JMP CODE_walker_setup_trampoline                   ; slope 0; all 3 slots
//
// The $1B mutation decrements ONLY the sub-screen nibbles ($0F0F) of the
// anchor word (so the spec's xy_lo 28 → 27). Since the trace anchor's
// sub-X nibble is non-zero ($8 → $7) there is no borrow; we keep the
// cart's nibble-masked form so sub-X = 0 wraps $x0 → $xF (NOT a borrow
// into screen-X), matching the cart exactly.
//
// The walker visits the 5-col x 3-row grid in COLUMN-MAJOR order
// (outer = column 0..4, inner = row 0..2). Per cell, CODE_12AE88
// ($12:AE88, Bank12.asm:6710) branches on the column counter ($28):
//
//   - col 0 (first) and col 4 (last == colExtent-1) → "gutter" path
//     (CODE_12AE98): Y = 0 for col 0, Y = 2 for the last col.
//       * row 2            → NO stamp.            (CMP #$0002 : BEQ)
//       * else if cur tile ($12) == DATA_12AB60[Y] → stamp $015C.
//       * else             → NO stamp.            (CMP DATA_12AB60,y : BNE)
//     These outer columns are seam-fixers: they only paint where they
//     find an adjacent pillar's edge tile ($015A for col 0 / $015B for
//     the last col), swapping it to the shared seam tile $015C. On a
//     zero-initialised buffer the compare never matches, so the gutter
//     columns paint nothing — exactly what the trace shows (cells 1/2/3
//     and 17/18/19: no stamp).
//
//   - interior cols 1/2/3 → CODE_12AEA8:
//       Y = row*8 + (col-1)*2   ; LDA $2C : ASL ASL ASL : STA $00
//                               ; LDA $28 : DEC : ASL : ORA $00 : TAY
//       word = DATA_12AE72[Y]
//       if word >= 0 (BPL, bit15 clear) → stamp `word` as-is.
//       else (bit15 set — the $8000 entry at row 2 / col 1):
//            if cur tile ($12) == $015A → stamp $015C  (seam swap)
//            else                       → stamp the CURRENT tile ($12).
//                 (The cart's `LDA $12 : CMP #$015A : BNE CODE_12AEC5`
//                  leaves A = $12 on the no-match path, so AEC5 stores
//                  $12 — NOT $8000 and NOT a hard $0000. On a zero buffer
//                  $12 == $0000, which the trace records for cell 7.)
//
// DATA_12AE72 ($12:AE72, Bank12.asm:6706) — verbatim from the cart:
//   dw $3D63,$3D6C,$3D65,$0000   ; row 0 (col1,col2,col3,pad)
//   dw $3D69,$3D6A,$3D6B,$0000   ; row 1
//   dw $8000,$010E,$010F         ; row 2 (col1 = $8000 seam marker)
// Every reachable entry matches the spec.json per-cell `record_value`s
// (cols 1/2/3 of rows 0/1/2) exactly.
//
// DATA_12AB60 ($12:AB60, Bank12.asm:6280) — gutter compare values:
//   dw $015A,$015B               ; Y=0 → $015A, Y=2 → $015B
//
// No PRNG, no neighbour probes, no savefile/flag gates — pure
// (row, col, current-tile) → table lookup.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Fixed rectangle the init writes (STA $2A / STA $2E).
const PILLAR_COLS = 0x05; // col extent = 5 (LDA #$0005 : STA $2A)
const PILLAR_ROWS = 0x03; // row extent = 3 (LDA #$0003 : STA $2E)

// Seam tiles the cart swaps in (LDA #$015C) when an adjacent pillar's
// edge tile is detected, plus the interior seam-marker compare value.
const SEAM_SWAP_OUT = 0x015C;        // CODE_12AEC2: LDA #$015C
const SEAM_MATCH_INTERIOR = 0x015A;  // interior $8000 path: CMP #$015A

// DATA_12AE72 ($12:AE72), the interior tile word table, 4 words per row;
// only the first 3 words of each row are reachable for a 5-col object
// (interior cols 1/2/3). Indexed by `(row*8 + (col-1)*2) >> 1`.
const DATA_12AE72: readonly number[] = [
  0x3D63, 0x3D6C, 0x3D65, 0x0000, // row 0: col1, col2, col3, pad
  0x3D69, 0x3D6A, 0x3D6B, 0x0000, // row 1
  0x8000, 0x010E, 0x010F,         // row 2: col1 ($8000 seam marker), col2, col3
] as const;

// DATA_12AB60 ($12:AB60) gutter-column compare values, indexed by
// Y (0 = first col, 2 = last col). `dw $015A,$015B`.
const DATA_12AB60: readonly number[] = [0x015A, 0x015B] as const;

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamper. Ports CODE_12AE88 ($12:AE88, Bank12.asm:6710).
//
// The walker has latched this cell's buffer offset into `$1D`, the
// column/row counters into `$28`/`$2C`, and the existing Map16 ID into
// `$12`.
// ─────────────────────────────────────────────────────────────────────

const stampSpikeBallRoom: PerCellHandler = (state: DecodeState): void => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const cur = state.zp12 & 0xffff;

  // Column dispatch (CODE_12AE88 head): col 0 OR col == colExtent-1 →
  // gutter; else interior.
  const isFirstCol = col === 0;
  const isLastCol = ((col + 1) & 0xff) === (state.zp2A & 0xff);

  if (isFirstCol || isLastCol) {
    // Gutter / seam-fix path (CODE_12AE98). Y = 0 for col 0, Y = 2 for last.
    const y = isFirstCol ? 0 : 2;
    if (row === 2) return;                  // CMP #$0002 : BEQ (no stamp)
    if (cur !== DATA_12AB60[y >> 1]!) return; // CMP DATA_12AB60,y : BNE (no stamp)
    stampCell(state, SEAM_SWAP_OUT);        // BRA CODE_12AEC2 : LDA #$015C
    return;
  }

  // Interior path (CODE_12AEA8), cols 1/2/3.
  const y = ((row << 3) + ((col - 1) << 1)) & 0xff; // row*8 + (col-1)*2
  const word = DATA_12AE72[y >> 1];
  if (word === undefined) return; // outside the fixed 5x3 grid — never reached

  if ((word & 0x8000) === 0) {
    stampCell(state, word);                 // BPL CODE_12AEC5: stamp word as-is
    return;
  }
  // bit15 set (the $8000 seam marker at row 2 / col 1).
  if (cur === SEAM_MATCH_INTERIOR) {
    stampCell(state, SEAM_SWAP_OUT);        // CMP #$015A == → LDA #$015C : stamp
  } else {
    stampCell(state, cur);                  // BNE CODE_12AEC5: A still = $12 → stamp cur
  }
};

// ─────────────────────────────────────────────────────────────────────
// Init handler. Ports CODE_extobj_handler_spike_ball_room ($12:8B8B):
// decrement the anchor's sub-screen nibbles by 1, set the fixed 5x3
// rectangle, single stamper in all walker slots, slope 0.
// ─────────────────────────────────────────────────────────────────────

const initSpikeBallRoom: InitHandler = (state: DecodeState): void => {
  // LDA $1B : AND #$0F0F : DEC : AND #$0F0F : ORA ($1B & $F0F0)
  // — decrement only the sub-screen nibbles, preserving screen nibbles.
  // The cart op is on the 16-bit word at $1B:$1C; the DEC only touches
  // the $0F0F (sub) nibbles. At sub-X = 0 the cart wraps $x0 → $xF (no
  // borrow into screen-X); the nibble masks reproduce that.
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subDec = ((word1B & 0x0f0f) - 1) & 0x0f0f;
  const newWord = ((word1B & 0xf0f0) | subDec) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  state.zp2A = PILLAR_COLS; // col extent = 5
  state.zp2E = PILLAR_ROWS; // row extent = 3
  walkerSetupTrampoline(state, stampSpikeBallRoom);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Only ext id $53 — the 0x100 mirror is automatic
// (getExtObjectHandler masks id & 0xff). The parent (object-decode/
// index.ts) wires this installer in.
// ─────────────────────────────────────────────────────────────────────

export function installExtSpikeBallRoomHandlers(): void {
  registerExtObjectHandler(0x53, initSpikeBallRoom);
}
