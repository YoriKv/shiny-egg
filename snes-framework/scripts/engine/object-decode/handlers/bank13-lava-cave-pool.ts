// Bank13 mountain-stone-cap stamp handler + Bank12 init wrapper.
//
// Standard object $DF — `lava_cave_pool`. A 2-row-extended,
// column-aware terrain stamper: bumps the row-extent by 1 so that an
// N-tile-wide object stamps 2 rows (body row + cap row), then picks
// from an 8-entry tile table where the row selects the upper/lower
// half ($8D9x body / $A6xx cap) and the column position selects the
// left-edge / middle-A / middle-B / right-edge variant.
//
// Asm sources:
//   CODE_init_lava_cave_pool        Bank12.asm:5218  ($12:A1D2)
//   CODE_stamp_lava_cave_pool       Bank13.asm:14066 ($13:F36E)
//   DATA_lava_cave_pool_tiles       Bank13.asm:14062 ($13:F35E)
//
// Layout of DATA_lava_cave_pool_tiles (8 words, asm order):
//   row 0 / col 0..3 → $8D92, $8D90, $8D91, $8D93
//   row 1 / col 0..3 → $A602, $A600, $A601, $A603
//
// The column "selector" produced by the asm (`$00..$03`) maps as:
//   0 → left edge   (col == 0)
//   1 → middle A    (col odd, not at right edge)
//   2 → middle B    (col even, not at right edge)
//   3 → right edge  (col + 1 == col_extent)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_lava_cave_pool_tiles ($13:F35E, Bank13.asm:14062).
//
// 8 entries: [row*4 + col_selector]. The cart indexes by Y = byte
// offset, which is `(row*4 + selector) << 1`; we use entry index
// directly.
// ─────────────────────────────────────────────────────────────────────

const DATA_lava_cave_pool_tiles: ReadonlyArray<number> = [
  0x8D92, 0x8D90, 0x8D91, 0x8D93,
  0xA602, 0xA600, 0xA601, 0xA603,
];

// ─────────────────────────────────────────────────────────────────────
// CMP $8D2E..$8D32 "stone-mid merge" nudge.
//
// Cart asm:
//   LDA DATA_lava_cave_pool_tiles,y  ; A = picked tile
//   LDY $12                              ; Y = current underlying tile
//   CMP #$8D2E ; BCC done
//   CMP #$8D32 ; BCS done
//   TYA ; CLC ; ADC #$0004               ; stamp underlying+4 instead
//
// In practice the picked tile is always from the table above, none of
// which sit in [$8D2E, $8D32) — so the nudge branch is unreachable for
// this handler's table. We still implement it for parity in case a
// future neighbour-rewrite or alternate table change lands here.
// ─────────────────────────────────────────────────────────────────────

const MERGE_LO = 0x8D2E;
const MERGE_HI = 0x8D32;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_lava_cave_pool ($13:F36E, Bank13.asm:14066).
// ─────────────────────────────────────────────────────────────────────

const stampLavaCavePool: PerCellHandler = (state) => {
  // $00 = $2C << 2 → row offset into the table (0 for row 0, 4 for row 1).
  const rowBase = (state.zp2C & 0xff) << 2;

  // Column selector ∈ {0, 1, 2, 3}.
  //   col == 0           → 0 (left edge)
  //   col + 1 == col_ext → 3 (right edge)
  //   else               → (col & 1) + 1 (1 or 2, alternating middle)
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  let selector: number;
  if (col === 0) {
    selector = 0;
  } else if (((col + 1) & 0xff) === colExtent) {
    selector = 3;
  } else {
    selector = (col & 1) + 1;
  }

  const idx = (rowBase + selector) & 0x07;
  const picked = DATA_lava_cave_pool_tiles[idx]!;

  // Stone-mid merge nudge (dead-code in practice for the table above —
  // kept for asm parity).
  const cur = state.zp12 & 0xffff;
  const stamp = picked >= MERGE_LO && picked < MERGE_HI
    ? (cur + 0x0004) & 0xffff
    : picked;

  stampCell(state, stamp);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_lava_cave_pool ($12:A1D2, Bank12.asm:5218).
//
//   REP #$20
//   INC $2E                              ; +1 row for the cap
//   LDX #(CODE_stamp_lava_cave_pool-1)>>16
//   LDA #CODE_stamp_lava_cave_pool-1
//   JMP walker_setup_trampoline
//
// Identical handler for even-col / odd-col / row slots; $19 = $7FFF;
// slope = 0. Spec confirms only `$2E` mutates (0001 → 0002).
// ─────────────────────────────────────────────────────────────────────

function initLavaCavePool(state: DecodeState): void {
  state.zp2E = (state.zp2E + 1) & 0xffff;
  walkerSetupTrampoline(state, stampLavaCavePool);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installLavaCavePoolHandlers(): void {
  registerStdObjectHandler(0xDF, initLavaCavePool);
}
