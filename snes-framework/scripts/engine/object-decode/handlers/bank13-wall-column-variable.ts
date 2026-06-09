// Bank13 wall-column-variable stamp handler + Bank12 init wrapper.
//
// Standard objects $4B / $4C / $4D — wall_column_variable: three skins of
// a fixed-width 3-row wall column. The orientation byte ($15) bits 0-2
// select both:
//   - the column width via DATA_wall_column_widths ($0004 / $0006 / $0008)
//   - the per-skin base offset into the 18-entry top/mid/bot tile tables
//     via DATA_wall_column_skin_offsets (+$0000 / +$0008 / +$0014 bytes,
//     i.e. word indices 0 / 4 / 10).
//
// Per the specs, all three IDs share both the init handler (only $2A is
// rewritten) and the per-cell stamp handler. The "delta" between IDs is
// entirely encoded in the orientation byte the cart re-reads twice:
//   - once in the init to pick a column-width from a 3-entry table
//   - once in the stamp to pick the skin-base offset into 3 tile tables
//
// Row dispatch in the stamp picks one of 3 tile tables:
//   - $2C == 0           → DATA_wall_column_top_tiles  (top row)
//   - $2C + 1 == $2E     → DATA_wall_column_bot_tiles  (bottom row)
//   - else               → DATA_wall_column_mid_tiles  (interior)
//
// Asm sources:
//   CODE_init_wall_column_variable     Bank12.asm:3653  ($12:9768)
//   DATA_wall_column_widths            Bank12.asm:3679  ($12:9797)
//   CODE_stamp_wall_column_variable    Bank13.asm:5609  ($13:A94B)
//   DATA_wall_column_skin_offsets      Bank13.asm:5649  ($13:A984)
//   DATA_wall_column_top_tiles         Bank13.asm:5653  ($13:A98A)
//   DATA_wall_column_mid_tiles         Bank13.asm:5659  ($13:A9AE)
//   DATA_wall_column_bot_tiles         Bank13.asm:5665  ($13:A9D2)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_wall_column_widths (Bank12.asm:3679).
//
// 3-entry column-width table indexed by the init's "skin index" (Y/2):
//   skin 0 ($4B) → $0004 (4 cells wide)
//   skin 1 ($4C) → $0006 (6 cells wide)
//   skin 2 ($4D) → $0008 (8 cells wide)
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_column_widths: ReadonlyArray<number> = [0x0004, 0x0006, 0x0008];

// ─────────────────────────────────────────────────────────────────────
// DATA_wall_column_skin_offsets (Bank13.asm:5649).
//
// 3-entry skin base-offset table for the per-cell stamp. Asm values are
// byte offsets ($0000 / $0008 / $0014); divided by 2 they give the
// starting word index in the 18-entry tile tables: 0, 4, 10.
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_column_skin_offsets_bytes: ReadonlyArray<number> = [
  0x0000, 0x0008, 0x0014,
];

// ─────────────────────────────────────────────────────────────────────
// DATA_wall_column_{top,mid,bot}_tiles — DATA_wall_column_top_tiles / _13A9AE / _13A9D2.
//
// Three 18-entry tile tables. Skin selects an 8 / 6 / 4-entry sub-window
// (skin 0: indices 0..3, skin 1: indices 4..9, skin 2: indices 10..17).
// The cart loads tables as words by Y-byte offset; we store flat 16-bit
// arrays of length 18 and index by word.
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_column_top_tiles: ReadonlyArray<number> = [
  0x0174, 0x0175, 0x0175, 0x0178, 0x0174, 0x0175, 0x0175, 0x0175,
  0x0176, 0x0178, 0x0174, 0x0175, 0x0175, 0x0175, 0x0175, 0x0175,
  0x0177, 0x0178,
];

const DATA_wall_column_mid_tiles: ReadonlyArray<number> = [
  0x0179, 0x017A, 0x017A, 0x017D, 0x0179, 0x017A, 0x017A, 0x017A,
  0x017B, 0x017D, 0x0179, 0x017A, 0x017A, 0x017A, 0x017A, 0x017A,
  0x017C, 0x017D,
];

const DATA_wall_column_bot_tiles: ReadonlyArray<number> = [
  0x017E, 0x017F, 0x017F, 0x0182, 0x017E, 0x017F, 0x017F, 0x017F,
  0x0180, 0x0182, 0x017E, 0x017F, 0x017F, 0x017F, 0x017F, 0x017F,
  0x0181, 0x0182,
];

/** Compute the skin index 0..2 from orientation $15:
 *    (($15 & $0007) - 3)
 *  Asm uses three DECs after the AND; same result mod 256, but the
 *  walker only feeds in $4B/$4C/$4D so the result is always 0/1/2. */
function skinIndex(state: DecodeState): number {
  return ((state.zp15 & 0x07) - 3) & 0xff;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_wall_column_variable ($13:A94B).
//
//   1. Compute word index = (col * 2 + skin_base_bytes) / 2
//      = col + (skin_base_bytes / 2).
//      For skins 0/1/2 the base word indices are 0 / 4 / 10.
//   2. Dispatch by row position:
//        $2C == 0           → top table
//        $2C + 1 == $2E     → bottom table
//        else               → middle table
//   3. Stamp the picked Map16 ID at the walker's current cell.
// ─────────────────────────────────────────────────────────────────────

const wallColumnVariableStamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const skin = skinIndex(state);
  const baseBytes = DATA_wall_column_skin_offsets_bytes[skin] ?? 0;
  // Asm: TAY (Y = col*2 + baseBytes). Our tables are flat word arrays so
  // collapse the *2 / >>1 round-trip into a direct word index.
  const wordIdx = (col + (baseBytes >>> 1)) & 0xff;

  const row = state.zp2C & 0xff;
  const rowExt = state.zp2E & 0xff;

  let table: ReadonlyArray<number>;
  if (row === 0) {
    table = DATA_wall_column_top_tiles;
  } else if (((row + 1) & 0xff) === rowExt) {
    table = DATA_wall_column_bot_tiles;
  } else {
    table = DATA_wall_column_mid_tiles;
  }

  stampCell(state, table[wordIdx] ?? 0);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_wall_column_variable ($12:9768).
//
// Pre-walker DP mutation (per spec): only $2A (col extent) changes.
// Width comes from DATA_wall_column_widths indexed by skin index.
// All 3 walker handler slots get the same per-cell stamp; $17 (slope)
// clears to 0 — the walkerSetupTrampoline does both.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x4B, 0x4C, 0x4D share this handler.
function initWallColumnVariable(state: DecodeState): void {
  const skin = skinIndex(state);
  const width = DATA_wall_column_widths[skin] ?? 0;
  state.zp2A = width & 0xffff;
  walkerSetupTrampoline(state, wallColumnVariableStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installWallColumnVariableHandlers(): void {
  registerStdObjectHandler(0x4B, initWallColumnVariable);
  registerStdObjectHandler(0x4C, initWallColumnVariable);
  registerStdObjectHandler(0x4D, initWallColumnVariable);
}
