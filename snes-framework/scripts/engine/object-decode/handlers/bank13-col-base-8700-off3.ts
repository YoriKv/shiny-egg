// Bank12 init wrapper + Bank13 per-cell stamp handler for the
// "col_base_8700_off3" family (std object $D0).
//
//
// Asm sources:
//   CODE_init_col_base_8700_off3   Bank12.asm:5106 ($12:A123) — std $D0 init.
//   CODE_stamp_col_pair_8706_870A  Bank13.asm:13176 ($13:EC81) — per-cell stamp.
//   DATA_col_pair_8706_tiles       Bank13.asm:13172 ($13:EC7D) — 2-entry tile table.
//
// Family context:
//   $CE (init_col_base_8700_off1) / $CF (init_col_base_8700_off2) are the
//   sibling inits — same shape (clamp $15 on $2A sign, $17=$FFFF, dispatch
//   via walker_setup_keep_slope) but each points at a different Bank13
//   stamp. They aren't ported yet; their stamp routines reference
//   different tile tables (CODE_stamp_col_base_8700 → constant $8700+$15;
//   CODE_stamp_col_pair_8702_8704 → ($8702,$8704) with column-parity
//   offset). When the siblings land, the init body here can be factored
//   into a shared helper that takes the (stamp, default-$15) pair.
//
// ─────────────────────────────────────────────────────────────────────
// Per-cell stamp (CODE_stamp_col_pair_8706_870A @ $13:EC81):
//
//   REP #$30
//   LDX $1D
//   LDY $15                  ; Y = orientation (init forces 0 or 2)
//   STZ $9B                  ; clear rewound flag
//   LDA $28                  ; signed column counter
//   BPL .pos                 ; col >= 0 → keep as-is
//   EOR #$FFFF ; INC         ; col <  0 → negate (two's complement)
// .pos:
//   AND #$0003               ; phase = |col| & 3
//   CMP #$0003
//   BNE .store               ; phase != 3 → just stamp base+phase
//   DEC $9B                  ; phase == 3 → $9B = $FFFF (signals walker
//                            ;              to use rewind-nibble path on
//                            ;              the next column wrap)
// .store:
//   CLC ; ADC DATA_col_pair_8706_tiles,y  ; tile = ($8706 or $870A) + phase
//   BRA stamp_epilogue       ; STA buffer,x ; SEP #$30 ; RTL
//
// Output: a 4-wide repeating column-strip Map16 cycle. With $15=2
// (positive $2A → init falls into the default branch), the cycle is
// $870A, $870B, $870C, $870D, $870A, … which matches the spec's 16
// observed cells exactly. With $15=0 (negative $2A → init STZ's $15),
// the cycle would be $8706, $8707, $8708, $8709, …
//
// ─────────────────────────────────────────────────────────────────────
// Init (CODE_init_col_base_8700_off3 @ $12:A123):
//
//   REP #$20
//   LDA #$0002 ; STA $15     ; default orientation = 2 (pick $870A table)
//   LDA $2A    ; BPL .keep   ; if $2A >= 0, keep $15 = 2
//   STZ $15                  ; else $2A < 0, $15 = 0  (pick $8706 table)
// .keep:
//   LDA #$FFFF ; STA $17     ; per-row slope = -1 (decorative; the stamp
//                            ;   sets $9B = $FFFF on col-phase-3 cells
//                            ;   which gates row-wrap math).
//   X = bank-byte of stamp ; A = stamp-ptr - 1
//   JMP walker_setup_keep_slope   ; all 3 walker slots = stamp.
//
// Spec confirms the init DP delta: only $15 mutates (D0 → 02). $1B/$1C/
// $2A/$2E all pass through unchanged.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { stampCell, signed16 } from './_shared.ts';

// DATA_col_pair_8706_tiles ($13:EC7D) — 2-entry tile table indexed by $15.
//   $15 = 0 → $8706
//   $15 = 2 → $870A
// (Cart accesses as `DATA_col_pair_8706_tiles,y` with y in {0, 2} since $15 is the byte
// index into a word table — i.e. y/2 picks the table entry.)
const DATA_col_pair_8706_tiles: ReadonlyArray<number> = [0x8706, 0x870A];

const stampColPair8706_870A: PerCellHandler = (state) => {
  // Clear $9B by default; the col-phase-3 path below sets it to $FFFF.
  state.rewound = 0;

  // $28 is the signed column counter. `LDA.b $28` in REP #$30 reads
  // 16-bit; BPL tests bit 15. State stores zp28 as the raw 16-bit value.
  const col16 = state.zp28 & 0xffff;
  const absCol = signed16(col16) < 0
    ? ((col16 ^ 0xffff) + 1) & 0xffff
    : col16;

  const phase = absCol & 0x0003;

  if (phase === 0x0003) {
    // Cart `DEC $9B` in 16-bit mode = $0000 → $FFFF.
    state.rewound = 0xffff;
  }

  // Table index: $15 is used as the byte offset into a 2-word table,
  // so the word entry is at (y >> 1). Init forces $15 to 0 or 2.
  const tableIdx = (state.zp15 & 0xff) >>> 1;
  const base = DATA_col_pair_8706_tiles[tableIdx] ?? 0;

  stampCell(state, (base + phase) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// Init handler for std $D0 (CODE_init_col_base_8700_off3).
// ─────────────────────────────────────────────────────────────────────

function initColBase8700Off3(state: DecodeState): void {
  // Default orientation = 2 (selects DATA_col_pair_8706_tiles[1] = $870A).
  // `LDA $2A` in REP #$20 reads 16-bit; BPL tests bit 15. If $2A is
  // negative (object grows left), clamp $15 to 0 instead.
  state.zp15 = signed16(state.zp2A) < 0 ? 0x00 : 0x02;

  // $17 = $FFFF: keep-slope dispatch so it survives. The stamp sets
  // $9B = $FFFF on col-phase-3 cells, which makes the walker take the
  // rewind-nibble path on the next column wrap (spec cells 4, 8, 12).
  state.zp17 = 0xffff;

  walkerSetupKeepSlope(state, stampColPair8706_870A);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installColBase8700Off3Handlers(): void {
  registerStdObjectHandler(0xD0, initColBase8700Off3);
}
