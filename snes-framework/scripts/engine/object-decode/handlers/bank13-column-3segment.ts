// Standard object $98 — init_column_3segment.
//
// Cart entries:
//   CODE_init_column_3segment       @ $12:9DC2 (yi/Banks/Bank12.asm:4585)
//   CODE_stamp_column_3segment      @ $13:D76B (yi/Banks/Bank13.asm:10429)
//   DATA_column_segment_handlers    @ $13:D765 (yi/Banks/Bank13.asm:10423)
//   DATA_column_top_tiles           @ $13:D790 (yi/Banks/Bank13.asm:10452)
//   DATA_column_middle_tiles        @ $13:D798 (yi/Banks/Bank13.asm:10460)
//   DATA_column_base_tiles          @ $13:D7BE (yi/Banks/Bank13.asm:10485)
//
// 3-segment structural vertical column. Unlike the $0C/$6D "post" family
// (bank13-post-vertical.ts / bank13-3section-vertical.ts) which read WRAM
// template slots, this object stamps from THREE ROM-literal tile tables
// keyed by the row counter ($2C):
//
//                 segment       tile source
//   row == 0    →  top-cap   →  DATA_column_top_tiles    ($7750 / $7754)
//   row == 1    →  middle    →  DATA_column_middle_tiles ($7800-$7804)
//   row >= 2    →  base      →  DATA_column_base_tiles   ($01B7 / $01B8)
//
// Note the "3 segments" are row-position fixed (top / second / rest), NOT
// proportional to row extent — even with $2E = $10 (16 rows), only row 0
// is "top" and only row 1 is "middle"; rows 2..15 are all "base".
//
// Within each segment, the picker has its own column-indexing rules:
//
//   top-cap     : y = (col_bit & 1) * 2 → entry [0] or [1]
//   base        : y = (($2C + $28) & 1) * 2 → checkerboard $01B7 / $01B8
//   middle      : sides-aware. If single column ($2A==1)             → $7804.
//                 Else  first col ($28==0)                            → entry [0] ($7800)
//                 Else  last col  ($28+1 == $2A)                      → entry [3] ($7803)
//                 Else  interior cols, y = (col_bit & 1)*2 + 2        → entry [1] or [2] ($7801 / $7802)
//
// Init handler is a bare trampoline — DP-diff table in the spec is all
// "no". The orientation byte $15=$98 and extents come direct from the
// Bank10 stream record.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_column_top_tiles (Bank13.asm:10452). 2-entry top-cap table,
// indexed by `(col_bit & 1) * 2` — i.e. even-vs-odd column.
// ─────────────────────────────────────────────────────────────────────
const DATA_column_top_tiles = [0x7750, 0x7754] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_column_middle_tiles (Bank13.asm:10460). 4 explicit entries
// ($7800-$7803). The asm also synthesises `$7804` inline for the
// single-column branch; that value isn't in the cart table but is
// returned directly by the middle picker — we treat it as the "single
// column" sentinel rather than table entry [4].
// ─────────────────────────────────────────────────────────────────────
const DATA_column_middle_tiles    = [0x7800, 0x7801, 0x7802, 0x7803] as const;
const COLUMN_MIDDLE_SINGLE_COL_ID = 0x7804;

// ─────────────────────────────────────────────────────────────────────
// DATA_column_base_tiles (Bank13.asm:10485). 2-entry base table,
// indexed by `(($2C + $28) & 1) * 2` — gives a checkerboard pattern of
// $01B7 / $01B8 across both columns and rows of the column's body.
// ─────────────────────────────────────────────────────────────────────
const DATA_column_base_tiles = [0x01B7, 0x01B8] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_column_3segment_top_pick ($13:D794, Bank13.asm:10456).
//
//   LDA DATA_column_top_tiles,y
//   RTS
//
// `y` is set up by the caller as `(col_bit & 1) * 2`.
// ─────────────────────────────────────────────────────────────────────
function columnTopPick(state: DecodeState): number {
  const colBit = state.zp28 & 0x01;
  return DATA_column_top_tiles[colBit]!;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_column_3segment_middle_pick ($13:D7A0, Bank13.asm:10464).
//
//   LDA $2A ; CMP #$0001 ; BNE skip_single
//   LDA #$7804 ; RTS                                ; single-column case
// skip_single:
//   LDA $28 ; BEQ done_at_curY                      ; first col → y unchanged
//   INY ; INY                                        ; y += 2
//   INC ; CMP $2A ; BNE done_at_curY                ; not last col → keep new y
//   LDY #$0006                                       ; last col → y = 6 (entry [3])
// done_at_curY:
//   LDA DATA_column_middle_tiles,y
//   RTS
//
// On entry y = (col_bit & 1) * 2 (set up by the parent stamp routine).
// ─────────────────────────────────────────────────────────────────────
function columnMiddlePick(state: DecodeState): number {
  const colExt = state.zp2A & 0xff;
  if (colExt === 1) return COLUMN_MIDDLE_SINGLE_COL_ID;

  const col = state.zp28 & 0xff;
  if (col === 0) {
    // first column: y stays at (col_bit & 1) * 2 → since col == 0, idx == 0
    return DATA_column_middle_tiles[0]!;
  }
  // Tentatively bump to interior idx = (col_bit & 1) + 1.
  if (((col + 1) & 0xff) === colExt) {
    // last column → y = 6 → entry [3]
    return DATA_column_middle_tiles[3]!;
  }
  const colBit = col & 0x01;
  return DATA_column_middle_tiles[colBit + 1]!;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_column_3segment_base_pick ($13:D7C2, Bank13.asm:10489).
//
//   LDA $2C ; CLC ; ADC $28 ; AND #$0001 ; ASL ; TAY
//   LDA DATA_column_base_tiles,y ; RTS
//
// Checkerboard index: ($2C + $28) & 1. Caller's earlier `y` setup is
// discarded — this picker recomputes y from scratch.
// ─────────────────────────────────────────────────────────────────────
function columnBasePick(state: DecodeState): number {
  const idx = ((state.zp2C + state.zp28) & 0x01);
  return DATA_column_base_tiles[idx]!;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_column_3segment ($13:D76B, Bank13.asm:10429).
//
// Sub-dispatches via DATA_column_segment_handlers based on row counter:
//   $2C == 0     → top-cap picker
//   $2C == 1     → middle picker
//   $2C >= 2     → base picker
//
// `y = (col_bit & 1) * 2` is computed up-front and consumed by top/middle
// pickers; base picker recomputes its own index.
// ─────────────────────────────────────────────────────────────────────
const stampColumn3segment: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;

  let tile: number;
  if (row === 0) {
    tile = columnTopPick(state);
  } else if (row === 1) {
    tile = columnMiddlePick(state);
  } else {
    tile = columnBasePick(state);
  }
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_column_3segment ($12:9DC2, Bank12.asm:4585).
//
//   REP.b #$20
//   LDX.b #(CODE_stamp_column_3segment-$01)>>16
//   LDA.w #CODE_stamp_column_3segment-$01
//   JMP.w CODE_walker_setup_trampoline
//
// Bare trampoline — no DP mutations (spec DP-diff table all "no").
// ─────────────────────────────────────────────────────────────────────
function initColumn3segment(state: DecodeState): void {
  walkerSetupTrampoline(state, stampColumn3segment);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installColumn3segmentHandlers(): void {
  registerStdObjectHandler(0x98, initColumn3segment);
}
