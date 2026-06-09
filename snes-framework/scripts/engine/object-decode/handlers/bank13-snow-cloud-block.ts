// Bank13 snow-cloud-block stamp handler + Bank12 init wrapper.
//
// Standard object $3D — snow-cloud platform ("SNOWKUMO"). A 3-row-tall
// rectangular cloud-platform made of literal Map16 IDs. Structurally a
// sibling of std $15 (cloud_block) — same row/col edge-classifier idea
// but split into three separate per-edge tables (left / interior /
// right) instead of one packed 4-wide table, and the left column adds
// a shape-aware "morph" branch that swaps to alternate top-row tiles
// when the under-tile is the right-cap of a prior cloud block ($00A8 /
// $00A9), so adjacent snow-cloud blocks join cleanly.
//
// Asm sources:
//   CODE_init_snow_cloud_block   Bank12.asm:3514  ($12:967D)
//   CODE_snow_cloud_block        Bank13.asm:4367  ($13:A07A)
//   DATA_ski_lift_two_pole_extras    Bank13.asm:4423  ($13:A0CC)
//   DATA_ski_lift_two_pole_left      Bank13.asm:4427  ($13:A0D8)
//   DATA_ski_lift_two_pole_right     Bank13.asm:4431  ($13:A0DE)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-edge Map16-ID tables.
//
// The cart uses Y as a *byte* offset into word-sized tables (each INY
// adds 1; one full word step is two INYs). We pre-collapse Y to a word
// index here, so each table is indexed by row-position 0..2:
//   0  top row     ($2C == 0)
//   1  middle row  (otherwise)
//   2  bottom row  ($2C + 1 == $2E)
//
// DATA_ski_lift_two_pole_extras has six entries; entries 0..2 are the
// "fresh" left-column tiles, entries 3..5 are the "morph" replacements
// used when the under-tile is $00A8 or $00A9 (right-cap of a previous
// cloud block on the same row). The cart adds 6 to Y in that case,
// landing at indices 3..5 of the table.
// ─────────────────────────────────────────────────────────────────────

const DATA_LEFT_FRESH: ReadonlyArray<number> = [0x00B5, 0x3C00, 0x00AB];
const DATA_LEFT_MORPH: ReadonlyArray<number> = [0x00A7, 0x3C00, 0x00AB];
const DATA_INTERIOR:   ReadonlyArray<number> = [0x00A8, 0x3C01, 0x00B0];
const DATA_RIGHT:      ReadonlyArray<number> = [0x00AA, 0x3C03, 0x00B2];

// ─────────────────────────────────────────────────────────────────────
// CODE_snow_cloud_block ($13:A07A)
//
//   REP #$30
//   LDY #$0000
//   LDA $2C ; BEQ row0
//   INY INY                            ; row != 0 → Y = 2 (mid)
//   INC ; CMP $2E ; BNE row0
//   INY INY                            ; bottom row → Y = 4
//   row0:
//   LDA $28 ; BEQ leftcol
//   INC ; CMP $2A ; BNE interior
//   BRA rightcol
//   leftcol:
//     LDA $12 ; CMP #$00A8 ; BEQ morph ; CMP #$00A9 ; BNE no_morph
//     morph:    INY×6                  ; advance into extras' second half
//     no_morph: LDA DATA_ski_lift_two_pole_extras,y ; BRA store
//   interior:
//     LDA $28 ; EOR #$0001 ; AND #$0001 ; STA $00 ; LDA DATA_ski_lift_two_pole_left,y ; ADC $00
//   rightcol:
//     LDA DATA_ski_lift_two_pole_right,y
//   store: LDX $1D ; STA buffer,x
//
// The interior branch's "EOR 1 AND 1" gives parity flip on $28: even
// column → 1, odd → 0; this ADCs onto the table base so columns 1,3,5
// land on $00A9/$3C02/$00B1 ("odd-flavoured") and 2,4,6 stay on the
// base $00A8/$3C01/$00B0. Spec cell 6 (col=2) → $00A9 confirms.
// ─────────────────────────────────────────────────────────────────────

const snowCloudBlockStamp: PerCellHandler = (state) => {
  // Classify row position → wordIdx 0/1/2.
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;
  let rowIdx: number;
  if (row === 0) {
    rowIdx = 0;
  } else if (((row + 1) & 0xff) === rowExtent) {
    rowIdx = 2;
  } else {
    rowIdx = 1;
  }

  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  let mapId: number;

  if (col === 0) {
    // Leftmost column: shape-aware lookup into the "extras" table.
    const under = state.zp12 & 0xffff;
    const morph = under === 0x00A8 || under === 0x00A9;
    mapId = (morph ? DATA_LEFT_MORPH : DATA_LEFT_FRESH)[rowIdx] ?? 0;
  } else if (((col + 1) & 0xff) === colExtent) {
    // Rightmost column.
    mapId = DATA_RIGHT[rowIdx] ?? 0;
  } else {
    // Interior column: parity-flip on $28 (even col → +1, odd col → +0).
    const parity = ((col ^ 1) & 1);
    mapId = ((DATA_INTERIOR[rowIdx] ?? 0) + parity) & 0xffff;
  }

  stampCell(state, mapId);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_snow_cloud_block ($12:967D)
//
//   REP #$20
//   LDA #$0003 ; STA $2E              ; force row-extent to exactly 3
//   LDX #(handler-1)>>16
//   LDA #handler-1
//   JMP walker_setup_trampoline       ; → CODE_snow_cloud_block
//
// As with std $15, the literal store of 3 (not an increment) clobbers
// any stream-supplied $2E. Snow-cloud blocks are always 3 rows tall.
// Spec DP-diff confirms `row_extent 0001 → 0003`.
// ─────────────────────────────────────────────────────────────────────

function initSnowCloudBlock(state: DecodeState): void {
  state.zp2E = 0x0003;
  walkerSetupTrampoline(state, snowCloudBlockStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installSnowCloudBlockHandlers(): void {
  registerStdObjectHandler(0x3D, initSnowCloudBlock);
}
