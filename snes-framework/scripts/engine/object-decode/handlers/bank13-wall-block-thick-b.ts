// Bank13 thick-wall-block "B" stamp handler + Bank12 init wrapper.
//
// Standard objects $49 and $4A — two visually distinct thick-wall-block
// variants that share one init + one stamp handler. The init hard-codes
// col_extent ($2A) to 2 (so the wall is always 2 cells wide), runs the
// walker with the same handler in every slot, and lets the stamp pick a
// tile from an 8-entry table indexed by
//
//     Y =  (col & 1) << 2          // column position within the 2-wide block
//        | (row != 0 ? 1 : 0) << 1 // top row vs body row split
//        | (orientation_skin & 1)  // $49 = 0, $4A = 1
//
// then `<< 1` to turn the word index into a byte offset (the cart uses Y
// as a byte index into a word-table).
//
// Asm sources:
//   CODE_init_wall_block_thick_b   Bank12.asm:3633  ($12:9743)
//   CODE_stamp_wall_block_thick_b  Bank13.asm:5575  ($13:A90D)
//   DATA_wall_thick_b_tiles        Bank13.asm:5605  ($13:A93B)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_wall_thick_b_tiles ($13:A93B).
//
// Eight Map16 IDs laid out as two 4-entry "skins" — the $49 skin in
// entries 0..3, the $4A skin in entries 4..7. Within each skin:
//
//   entry 0: col=0, row=0      (top-left)
//   entry 1: col=0, row!=0     (left body)
//   entry 2: col=1, row=0      (top-right)
//   entry 3: col=1, row!=0     (right body)
//
// $49 skin:  $00C8 / $00CE / $00CD / $00CF
//              two distinct top tiles + two distinct body tiles
// $4A skin:  $00D3 / $00D3 / $00D4 / $00D4
//              degenerate: top and body are the same Map16 ID per column
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_thick_b_tiles: ReadonlyArray<number> = [
  0x00C8, 0x00CE, 0x00CD, 0x00CF,
  0x00D3, 0x00D3, 0x00D4, 0x00D4,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_wall_block_thick_b ($13:A90D).
//
// REP #$30
// LDX $1D
// LDY #0
// LDA $2C ; BEQ skip ; INY ; INY        ─ row-parity contribution
// LDA $28 ; ASL ASL ; ORA Y → Y         ─ column contribution (col << 2)
// LDA $15 ; AND #2 ; ASL ASL ; ORA Y    ─ orientation contribution ((skin<<2))
// LDA DATA_wall_thick_b_tiles,Y         ─ word table read at byte offset Y
// STA.l buffer,X
//
// Both $49 and $4A go through here; col_extent $2A is forced to 2 by the
// init so the walker only ever visits col 0 and col 1.
// ─────────────────────────────────────────────────────────────────────

const wallBlockThickBStamp: PerCellHandler = (state) => {
  // Cart computes Y as a *byte* offset into a word table. Each
  // contribution is a small constant; we pre-collapse to a word index
  // and double at the end.
  let yWord = 0;
  if ((state.zp2C & 0xff) !== 0) yWord |= 0x01; // row != 0 → body row
  yWord |= (state.zp28 & 0x01) << 1;            // column position bit
  yWord |= (state.zp15 & 0x02) << 1;            // orientation skin: bit 1 → +4 entries

  stampCell(state, DATA_wall_thick_b_tiles[yWord]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_wall_block_thick_b ($12:9743).
//
// All three handler slots (odd/even/row) point at CODE_stamp_wall_block_thick_b, $17 (slope)
// = 0, $19 (row-walk end) = $7FFF, $2A (col extent) = 2. Both std $49
// and std $4A use this init — the spec confirms col_extent 1 → 2 as
// the only DP mutation.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x49, 0x4A share this handler.
function initWallBlockThickB(state: DecodeState): void {
  state.zp2A = 0x0002; // cart hard-codes col extent to 2
  walkerSetupTrampoline(state, wallBlockThickBStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installWallBlockThickBHandlers(): void {
  registerStdObjectHandler(0x49, initWallBlockThickB);
  registerStdObjectHandler(0x4A, initWallBlockThickB);
}
