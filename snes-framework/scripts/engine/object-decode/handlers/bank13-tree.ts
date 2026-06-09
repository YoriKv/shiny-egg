// Bank13 Tree stamp + Bank12 init wrapper.
//
// Covers standard object $8D — Tree, a single-row decoration. A
// single-column ($2A = $0001) vertical decoration strip that sprinkles a
// random tile on every row except the bottom row, which is forced to a
// fixed "cap" tile. The init is a bare trampoline (no DP mutations);
// per-cell logic lives entirely in `CODE_tree_stamp`.
//
//
// Asm references:
//   yi/Banks/Bank12.asm:4468  CODE_init_tree   ($12:9CF1)
//   yi/Banks/Bank13.asm:9911  DATA_tree_tiles       ($13:D3E7)
//   yi/Banks/Bank13.asm:9915  CODE_tree_stamp       ($13:D3ED)
//
// Per-cell stamp pseudocode:
//   REP #$10                     ; X/Y -> 16-bit (A still 8-bit from walker)
//   y = 2                        ; default = "last row" cap entry
//   if ($2C + 1) != $2E:         ; not the last row -> randomise
//     y = prng & $01             ; entries 0 or 1 (= $3D70 / $3DA7)
//   REP #$20                     ; A -> 16-bit
//   y = (y & 3) << 1             ; word-index into 3-entry table
//   tile = DATA_tree_tiles[y/2]
//   STAMP tile
//
// DATA_tree_tiles (3 word entries):
//   [0] $3D70 — random variant A
//   [1] $3DA7 — random variant B
//   [2] $3D6F — bottom-row cap (only emitted at the last row)
//
// Spec note: the asm-side label says "Per-cell stamp for object $8D: at
// last COLUMN writes entry 2". That comment is wrong — the cart compares
// `$2C + 1` to `$2E` (row counter / row extent), so the special-case row
// is the BOTTOM row, not a column. Confirmed by the spec trace: object
// $8D has col extent $0001 (single column) and the entry-2 ($3D6F) stamp
// fires at cell 15 (the bottom of the $10-tall column).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_tree_tiles (Bank13.asm:9911).
// 3-entry word table: { random-A, random-B, bottom-cap }.
// ─────────────────────────────────────────────────────────────────────

const DATA_tree_tiles: ReadonlyArray<number> = [
  0x3D70, // entry 0 — random variant A
  0x3DA7, // entry 1 — random variant B
  0x3D6F, // entry 2 — bottom-row cap (last row only)
];

// ─────────────────────────────────────────────────────────────────────
// CODE_tree_stamp ($13:D3ED, Bank13.asm:9915).
//
// `$2C` is the per-row walker counter and `$2E` the row extent (both
// treated as bytes here — the cart uses 8-bit A for the compare). When
// the row counter has reached the bottom, force entry 2 (the cap);
// otherwise PRNG-pick between entries 0 and 1.
// ─────────────────────────────────────────────────────────────────────

const stampTree: PerCellHandler = (state) => {
  let idx = 2;
  const row = (state.zp2C + 1) & 0xff;
  const rowExtent = state.zp2E & 0xff;
  if (row !== rowExtent) {
    idx = prngNext(state) & 0x01;
  }
  // Cart `TYA ; AND #$0003 ; ASL ; TAY` only matters as a word-index
  // into a byte-addressed asm table; our TS array is already
  // word-typed, so we use the original 0/1/2 directly.
  stampCell(state, DATA_tree_tiles[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_tree ($12:9CF1, Bank12.asm:4468).
//
//   REP #$20
//   LDX #(CODE_tree_stamp-$01)>>16
//   LDA #CODE_tree_stamp-$01
//   JMP CODE_walker_setup_trampoline
//
// Bare trampoline — no DP mutations. Confirmed by the spec DP-diff
// table (all rows "no"). Col/row extent and orientation flow straight
// from the Bank10 stream record.
// ─────────────────────────────────────────────────────────────────────

function initTree(state: DecodeState): void {
  walkerSetupTrampoline(state, stampTree);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────

export function installTreeHandlers(): void {
  registerStdObjectHandler(0x8D, initTree);
}
