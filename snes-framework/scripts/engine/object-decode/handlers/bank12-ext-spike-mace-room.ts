// Bank12 extended-object handler: spike_mace_room (ext ID $52).
//
// SHAPE: walker-driven (shape 2). The init decrements the cell origin by
// one sub-position step, sets the rectangle extents (5 cols × 2 rows),
// then tail-calls the walker trampoline. A per-cell handler indexes a tile
// table by the walker's column/row counters.
//
// Cart dispatch: CODE_108C13 → DATA_extended_object_init_ptrs[$52] → this init.
//   ext $52 init:    CODE_extobj_handler_spike_mace_room  ($12:8B63, Bank12.asm:1974)
//   per-cell stamp:  CODE_12AE3C                         ($12:AE3C, Bank12.asm:6670)
//   tile table:      DATA_12AE2C                         ($12:AE2C)
//   sentinel table:  DATA_12AB60                         ($12:AB60)
//
// ── Init (CODE_extobj_handler_spike_mace_room), verbatim from the closure:
//
//     REP #$20
//     LDA $1B : AND #$0F0F : DEC : AND #$0F0F : STA $00  ; sub-coord nibbles − 1
//     LDA $1B : AND #$F0F0 : ORA $00 : STA $1B           ; recombine with screen nibbles
//     LDA #$0005 : STA $2A                               ; col extent = 5
//     LDA #$0002 : STA $2E                               ; row extent = 2
//     LDX #(CODE_12AE3C-1)>>16 : LDA #CODE_12AE3C-1
//     JMP CODE_walker_setup_trampoline
//
//    The origin manipulation runs on the 16-bit $1C:$1B word (REP #$20):
//    it isolates the sub-X/sub-Y nibbles ($0F0F), decrements (DEC on the
//    word — borrows from sub-Y into nothing here since sub-X is non-zero),
//    re-masks, then ORs the unchanged screen nibbles ($F0F0) back in. For
//    the spec's $1B/$1C entry this nets to $1B: AD → AC, $1C unchanged —
//    matching the spec DP-diff exactly ($2A 0001→0005, $2E 0001→0002,
//    $1C/$15 unchanged). Unlike the extent-1 block family, this object
//    writes the literal cell counts ($2A=5, $2E=2), which the walker
//    consumes directly.
//
// ── Per-cell stamp (CODE_12AE3C), verbatim from the closure:
//
//     CODE_12AE3C:
//       REP #$30
//       LDY #$0000
//       LDA $28 : BEQ CODE_12AE4C          ; col == 0 → sentinel path (Y=0)
//       INC : CMP $2A : BNE CODE_12AE58    ; col != last → interior path
//       INY : INY                          ; col == last → sentinel path (Y=2)
//     CODE_12AE4C:                          ; sentinel-gated edge column
//       LDA $12 : CMP DATA_12AB60,y        ; existing cell == sentinel[Y]?
//       BNE CODE_12AE6F                    ;   no  → skip (RTL)
//       LDY #$000E : BRA CODE_12AE66       ;   yes → stamp DATA_12AE2C[7]
//     CODE_12AE58:                          ; interior column 1..(last-1)
//       LDA $2C : ASL ASL ASL : STA $00    ; row * 8
//       LDA $28 : DEC : ASL                ; (col-1) * 2
//       ORA $00 : TAY                      ; Y = (row*8) | ((col-1)*2)
//     CODE_12AE66:
//       LDX $1D : LDA DATA_12AE2C,y : STA buffer,x
//     CODE_12AE6F:
//       SEP #$30 : RTL
//
//    Note `CMP $2A` compares (col+1) to $2A (=5), i.e. col == 4 (the last
//    of the 5 columns) takes the sentinel path. Interior cols (1..3) index
//    DATA_12AE2C by `(row*8) | ((col-1)*2)`. The edge columns (col 0 and
//    the last, col 4) only stamp when the *existing* buffer cell ($12)
//    already equals DATA_12AB60[Y] — a contextual overwrite of a prior
//    rotating-base tile. At static-decode time those cells are empty
//    ($12 == $0000, no sentinel match), so the gate never fires; the spec
//    confirms cols 0 and 4 stamp nothing.
//
// Verified end-to-end through the real walker against the ext-52 spec
// (15 walker cells, cols 0..4 × rows 0..1):
//   col 1: $3D63/$3D66   col 2: $3D64/$3D67   col 3: $3D65/$3D68
//   cols 0,4: no stamp; per-cell buffer offsets match the trace.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_12AE2C ($12:AE2C). 8 words. Entry 3 is $0000 padding; entry 7 is
// $015C (the sentinel-match edge stamp) — NOT padding. Pinned to the ROM:
//   dw $3D63,$3D64,$3D65,$0000,$3D66,$3D67,$3D68,$015C  (yi/Banks/Bank12.asm:6671)
// TRAP: an earlier transcription copied a bad db dump that ended $..,$3D,$00,$00
// and dropped entry 7 to $0000 (stamping a blank tile on the sentinel path).
// ─────────────────────────────────────────────────────────────────────

const DATA_12AE2C = [
  0x3D63, 0x3D64, 0x3D65, 0x0000,
  0x3D66, 0x3D67, 0x3D68, 0x015C,
] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_12AB60 ($12:AB60). Sentinel Map16 IDs for the edge-column gate —
// the WALL-THICK ($48) edge tiles $015A (col 0) / $015B (last col). When a
// wall tile sits in the spike-mace's edge column, the gate rewrites it to the
// carved-edge tile $015C. Pinned to ROM: `dw $015A,$015B` (Bank12.asm).
// (Was wrongly transcribed as $3D00/$3D60, so the gate never fired and the
// underlying $48 wall tile survived instead of being carved to $015C.)
// ─────────────────────────────────────────────────────────────────────

const DATA_12AB60 = [0x015A, 0x015B] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_12AE3C — per-cell stamper. See header for the verified algorithm.
// ─────────────────────────────────────────────────────────────────────

const spikeMaceRoomStamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0xffff;

  // Interior column: col != 0 and (col + 1) != $2A (col is not the last).
  if (col !== 0 && ((col + 1) & 0xffff) !== (state.zp2A & 0xffff)) {
    // Y = (row*8) | ((col-1)*2); word index = Y>>1.
    const row = state.zp2C & 0xffff;
    const byteIndex = ((row << 3) | ((col - 1) << 1)) & 0xffff;
    stampCell(state, DATA_12AE2C[byteIndex >> 1]!);
    return;
  }

  // Edge column (first or last): sentinel-gated overwrite. Y = 0 for col 0,
  // Y = 2 for the last column. Stamp DATA_12AE2C[7] ($015C) only if the
  // existing cell ($12) matches DATA_12AB60[Y>>1] — i.e. a prior object
  // already stamped the sentinel tile ($3D00/$3D60) into this edge cell
  // (cells start empty, so the gate fires only on such an overlap).
  const sentinelIndex = col === 0 ? 0 : 1;
  if ((state.zp12 & 0xffff) === DATA_12AB60[sentinelIndex]) {
    stampCell(state, DATA_12AE2C[0x0e >> 1]!);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_spike_mace_room ($12:8B63). See header for the
// verified init sequence.
// ─────────────────────────────────────────────────────────────────────

function initSpikeMaceRoom(state: DecodeState): void {
  // LDA $1B : AND #$0F0F : DEC : AND #$0F0F : STA $00 (16-bit on $1C:$1B).
  const word = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subDec = ((word & 0x0f0f) - 1) & 0x0f0f;
  // LDA $1B : AND #$F0F0 : ORA $00 : STA $1B.
  const newWord = ((word & 0xf0f0) | subDec) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;
  state.zp2A = 0x0005; // col extent (literal cell count)
  state.zp2E = 0x0002; // row extent (literal cell count)
  walkerSetupTrampoline(state, spikeMaceRoomStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Only ext $52 (the 0x152 mirror is automatic via
// getExtObjectHandler's `id & 0xff` mask).
// ─────────────────────────────────────────────────────────────────────

export function installExtSpikeMaceRoomHandlers(): void {
  registerExtObjectHandler(0x52, initSpikeMaceRoom);
}
