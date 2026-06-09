// Bank13 stamp handler + Bank12 init wrapper for std object $DE —
// "small_inc_width" / small-tile-set with pre-incremented column extent.
//
// Stamps a tall, thin column-grown structure where the top two rows form
// a 4-tile head (DATA_small_tile_set_top_2tiles, used per (col,row<2) cell
// with `+ col` mixed into the tile ID) and rows 2+ form a 2-tile body
// (DATA_small_tile_set_body_2tiles, picked by column parity only).
//
//
// Asm references:
//   yi/Banks/Bank12.asm:5210   CODE_init_small_inc_width       ($12:A1C6)
//   yi/Banks/Bank13.asm:14031  DATA_small_tile_set_top_2tiles  ($13:F333)
//   yi/Banks/Bank13.asm:14035  DATA_small_tile_set_body_2tiles ($13:F337)
//   yi/Banks/Bank13.asm:14039  CODE_stamp_small_tile_set       ($13:F33B)
//
// Init (Bank12, REP #$20):
//   INC $2A                              ; col_extent += 1 (grows width by 1)
//   LDX/LDA #CODE_stamp_small_tile_set-1
//   JMP walker_setup_trampoline          ; all 3 walker slots = stamp
//
// Per-cell stamp ($13:F33B, REP #$30):
//   y = $28 * 2                          ; (initial Y, body path keeps it)
//   if $2C >= 2:                         ; row >= 2 → body branch
//     tile = DATA_small_tile_set_body_2tiles[col]
//   else:                                ; rows 0..1 → top branch
//     y = $2C * 2                        ; Y overwritten; top table is row-indexed
//     tile = DATA_small_tile_set_top_2tiles[row] + $28
//   STAMP tile
//
// DATA_small_tile_set_top_2tiles (2-entry word table, row-indexed):
//   row=0 → $79A4   ; +col gives $79A4 / $79A5 (col 0 / 1)
//   row=1 → $79A6   ; +col gives $79A6 / $79A7
//
// DATA_small_tile_set_body_2tiles (2-entry word table, col-parity indexed):
//   col=0 → $799B
//   col=1 → $7999
//
// Init DP diff: col_extent ($2A) 0001 → 0002 in the captured trace. Note
// that this is `INC` rather than a write — the column extent the user
// authored is increased by 1, so e.g. an authored width of 2 produces a
// 3-column stamp. The cart's tables only define 2 distinct top-row tile
// pairs and 2 body parities, but the top-branch uses `+ col` so columns
// beyond width 2 stamp incrementally-numbered Map16 IDs (likely garbage
// at width > 2 — but the +col arithmetic is faithful to the asm).
//
// No GoldenEgg counterpart — ReSharper search for "SmallIncWidth" /
// "smallTileSet" / "small_inc_width" in the loaded `ge` solution returned
// 0 results.
//
// Consolidation candidate: shares the walker_setup_trampoline + simple
// word-indexed stamp shape with the wider "2wide / 3wide spike pair"
// family and the `pipe_cap_2x2` 4-entry stamp. Distinct enough (split
// top/body tables, `+ col` mix, INC-rather-than-write of $2A) that
// merging into a parameterised helper isn't an obvious win — keep
// inline until another INC-$2A + top/body-table handler is ported.

import { registerStdObjectHandler } from './index.ts';
import type { InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_small_tile_set_top_2tiles (Bank13.asm:14031) —
// row-indexed by ($2C * 2) for rows 0..1. Caller adds $28 to the loaded
// word, so col 0 stamps the listed entry verbatim and col 1 stamps
// (entry + 1).
// ─────────────────────────────────────────────────────────────────────

const DATA_small_tile_set_top_2tiles = [
  0x79A4, // row 0 (col 0 → $79A4, col 1 → $79A5)
  0x79A6, // row 1 (col 0 → $79A6, col 1 → $79A7)
] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_small_tile_set_body_2tiles (Bank13.asm:14035) —
// col-parity-indexed by ($28 * 2). No +col mix on the body branch.
// ─────────────────────────────────────────────────────────────────────

const DATA_small_tile_set_body_2tiles = [
  0x799B, // col 0
  0x7999, // col 1
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_small_tile_set ($13:F33B, Bank13.asm:14039). Per-cell.
// ─────────────────────────────────────────────────────────────────────

const stampSmallTileSet: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  let tile: number;
  if (row >= 2) {
    // Body path: Y kept at col*2, table indexed by col-parity. Mask to
    // table length so any out-of-range column lands on a defined entry.
    tile = DATA_small_tile_set_body_2tiles[col & 1]!;
  } else {
    // Top path: Y overwritten to row*2, table indexed by row, then
    // result += col. Cart performs ADC $28 with carry assumed clear;
    // 16-bit add of small offset can't overflow into a bogus value.
    const base = DATA_small_tile_set_top_2tiles[row]!;
    tile = (base + col) & 0xffff;
  }
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_small_inc_width ($12:A1C6, Bank12.asm:5210).
//
// Increments the authored column extent by 1, then dispatches through
// walker_setup_trampoline with stampSmallTileSet wired into all three
// handler slots (even-col / odd-col / row). $2E (row extent) and $15
// (orientation) are passed through unchanged.
// ─────────────────────────────────────────────────────────────────────

const initSmallIncWidth: InitHandler = (state) => {
  state.zp2A = (state.zp2A + 1) & 0xffff;
  walkerSetupTrampoline(state, stampSmallTileSet);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installSmallIncWidthHandlers(): void {
  registerStdObjectHandler(0xDE, initSmallIncWidth);
}
