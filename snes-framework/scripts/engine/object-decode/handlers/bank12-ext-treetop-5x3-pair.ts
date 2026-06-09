// Bank12 ext-object handler family: treetop_5x3_pair (IDs 0x56, 0x57).
//
// Shared init for ext-object IDs 0x56 and 0x57 ("large treetop 5x3
// pair"). Shape-2 walker-driven: the init sets the 5x3 extents and tail-
// calls the walker, which invokes the per-cell stamper for each cell.
//
// Dispatch key is $15. The init re-encodes it as ($15 & 1) << 1, so:
//   0x56 -> $15 = 0 -> variant 0 (tile table DATA_12AF08)
//   0x57 -> $15 = 2 -> variant 1 (tile table DATA_12AF26)
// $15 is then the byte offset into the 2-entry word pointer table
// DATA_12AF44 = [DATA_12AF08, DATA_12AF26]; variant = $15 >> 1.
//
// Asm sources:
//   CODE_extobj_handler_treetop_5x3_pair  Bank12.asm:2028  ($12:8BCC)
//   CODE_12AF48 (stamper)                      Bank12.asm:6790  ($12:AF48)
//   CODE_12AFCE (stamp body)                   Bank12.asm:6846  ($12:AFCE)
//   DATA_12AF44 / DATA_12AF08 / DATA_12AF26    Bank12.asm:6776  ($12:AF08)

import type { InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12AF08 ($12:AF08) — variant 0 (ext 0x56). 3 rows x 5 cols of Map16
// IDs; $0000 entries are skipped (left untouched in the buffer).
const TREETOP_TILES_VARIANT0: ReadonlyArray<number> = [
  0x3d8f, 0x3d90, 0x3d91, 0x3d92, 0x0000,
  0x3d93, 0x3d94, 0x3d95, 0x3d96, 0x3d7c,
  0x0000, 0x3d8c, 0x3d8d, 0x3d8e, 0x3d7b,
];

// DATA_12AF26 ($12:AF26) — variant 1 (ext 0x57). Same 3x5 layout, but the
// cart table is only 14 words long: the row-2 col-4 slot lies just past the
// array (the next datum is DATA_12AF42 = $0000), so it reads $0000 / no
// stamp. Faithful to model it as a short table that yields 0 out of range.
const TREETOP_TILES_VARIANT1: ReadonlyArray<number> = [
  0x0000, 0x3d81, 0x3d82, 0x3d83, 0x3d84,
  0x3d79, 0x3d85, 0x3d86, 0x3d87, 0x3d88,
  0x3d7a, 0x3d89, 0x3d8a, 0x3d8b,
];

// DATA_12AF44 ($12:AF44): word pointer table indexed by $15 (0 or 2).
const TREETOP_TABLES: ReadonlyArray<ReadonlyArray<number>> = [
  TREETOP_TILES_VARIANT0,
  TREETOP_TILES_VARIANT1,
];

// CODE_extobj_handler_treetop_5x3_pair ($12:8BCC).
//   $15 = ($15 & 1) << 1 ; $2A = 5 (cols) ; $2E = 3 (rows) ; -> walker.
// Merge: object IDs 0x56, 0x57 share this handler.
const initTreetop5x3Pair: InitHandler = (state) => {
  state.zp15 = (state.zp15 & 0x0001) << 1;
  state.zp2A = 0x0005; // col extent ($2A)
  state.zp2E = 0x0003; // row extent ($2E)
  walkerSetupTrampoline(state, perCellTreetop5x3Pair);
};

// CODE_12AF48 ($12:AF48) -> CODE_12AFCE ($12:AFCE).
//   CODE_12AF48: ptr $00 = DATA_12AF44[$15] + $2C*10 (bytes).
//   CODE_12AFCE: Y = $28*2 ; tile = word at ($00),Y == table[$2C*5 + $28].
//                BEQ -> skip the stamp when that word is $0000.
const perCellTreetop5x3Pair: PerCellHandler = (state) => {
  const table = TREETOP_TABLES[(state.zp15 & 0xff) >> 1];
  if (!table) return;
  const idx = (state.zp2C & 0xff) * 5 + (state.zp28 & 0xff);
  const tile = idx >= 0 && idx < table.length ? table[idx]! : 0;
  // CODE_12AFCE also has $3D9F/$3DA0 shape-aware fixups, but neither of
  // these two tables contains those IDs, so a plain stamp is faithful.
  if (tile !== 0) stampCell(state, tile);
};

export function installExtTreetop5x3PairHandlers(): void {
  registerExtObjectHandler(0x56, initTreetop5x3Pair);
  registerExtObjectHandler(0x57, initTreetop5x3Pair);
}
