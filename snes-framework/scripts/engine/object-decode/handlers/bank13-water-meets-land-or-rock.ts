// Bank13 water-meets-land / water-on-rock stamp handlers + the shared
// Bank12 init wrapper.
//
// Covered handlers:
//   $18 init_water_meets_land_or_rock (variant select via $15 bit 0)
//        $15 bit 0 == 0 → CODE_water_meets_land   ($13:8DEB)
//   $19 init_water_meets_land_or_rock (same init)
//        $15 bit 0 == 1 → CODE_water_on_rock      ($13:8E52)
//
// Cart asm: yi/Banks/Bank12.asm:3089 (init dispatcher)
//           yi/Banks/Bank13.asm:1705 (CODE_water_meets_land)
//           yi/Banks/Bank13.asm:1757 (CODE_water_on_rock)
//
// Init handler (Bank12 $93EE):
//   LDA $15 ; AND #$0001 ; TAY ; ASL ; TAX
//   LDA DATA_water_land_rock_stamp_ptrs,X       ; ptr-1 word
//   LDX DATA_water_land_rock_stamp_banks,Y       ; bank byte
//   JMP CODE_walker_setup_trampoline
// — the standard "trampoline with one per-cell handler" pattern; the
// only twist is the $15-bit-0 dispatch picking which Bank13 stamper to
// pass into the trampoline.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// CODE_water_meets_land — WTRLAND, 18-tile waterline stamp.
//
// 3x3 grid of waterline / corner tiles (rows: top / mid / bottom;
// cols: left / mid / right). When the current cell already overlaps
// open water (page byte == $16), an alternate 3x3 grid is used (offset
// by 9 entries = +$12 bytes).
//
// Cart pseudocode (Y is a BYTE offset into a word table, so the
// word-array index = Y >> 1):
//   $0A = 0
//   if ($12 & $FF00) == $1600: $0A = $12
//   Y = (row==0 ? 0 : row==last ? $0C : $06)
//     + (col==0 ? 0 : col==last ? $04 : $02)
//   Y += $0A
//   stamp DATA_138E2E[Y >> 1]
// ─────────────────────────────────────────────────────────────────────

const DATA_138E2E = [
  0x0125, 0x0126, 0x0127, 0x0128, 0x0129, 0x012A, 0x012B, 0x012C,
  0x012D, 0x012E, 0x012F, 0x0130, 0x0131, 0x0132, 0x0133, 0x0134,
  0x0135, 0x0136,
] as const;

const waterMeetsLand: PerCellHandler = (state) => {
  // Alt-grid offset when the underlying tile is in the open-water page.
  // Asm: CMP $12 & $FF00 == $1600 → $0A = $12; else $0A = 0.
  // Convert to word index by shifting right 1: +9 entries.
  const altOffset = (state.zp12 & 0xff00) === 0x1600 ? 9 : 0;

  // Row pick: 0 / 3 / 6 for first / interior / last row (word indices).
  let idx: number;
  const row = state.zp2C & 0xff;
  if (row === 0) {
    idx = 0;
  } else if (((row + 1) & 0xff) === (state.zp2E & 0xff)) {
    idx = 6;
  } else {
    idx = 3;
  }

  // Column pick: +0 / +1 / +2 for first / interior / last column.
  const col = state.zp28 & 0xff;
  if (col !== 0) {
    idx += 1;
    if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
      idx += 1;
    }
  }

  stampCell(state, DATA_138E2E[(idx + altOffset) & 0x1f]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_water_on_rock — WTRROCK, 20-tile rock-shore stamp.
//
// Two tile tables (each a row-major grid of 4 columns):
//   DATA_138E90 (12 word entries, 3 rows × 4 cols) — used for rows 0..2.
//   DATA_138EA8 (8 word entries,  2 rows × 4 cols) — used for rows 3+.
//
// Cart picks word index via Y = (rowBits << 3) | ((col & 3) << 1),
// then `LDA DATA,Y` reads the 16-bit word. Y is a BYTE offset into a
// word table, so the word-array index = Y >> 1 = (rowBits << 2) | (col & 3).
//
// rowBits:
//   rows 0..2 → rowBits = row     (3 distinct row patterns)
//   rows 3+   → rowBits = !row.bit0 (alternating 2 row patterns;
//              `row ^ 1 & 1` makes the stripe alignment line up)
// ─────────────────────────────────────────────────────────────────────

const DATA_138E90 = [
  0x1601, 0x1602, 0x1603, 0x1604,
  0x1605, 0x1606, 0x1607, 0x1608,
  0x1609, 0x160A, 0x160B, 0x160C,
] as const;

const DATA_138EA8 = [
  0x160D, 0x160E, 0x160F, 0x1610,
  0x1611, 0x1612, 0x1613, 0x1614,
] as const;

const waterOnRock: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const col = state.zp28 & 0xff;
  const colBits = col & 0x03;

  if (row < 3) {
    // Rows 0..2: 3 patterns of 4 tiles.
    const idx = (row << 2) | colBits;       // = Y >> 1, where Y = row*8 + colBits*2
    stampCell(state, DATA_138E90[idx]!);
    return;
  }

  // Rows 3+: alternating 2 patterns of 4 tiles.
  // rowBits = (row ^ 1) & 1 → 1 when row even, 0 when row odd.
  const rowBits = (row ^ 1) & 0x01;
  const idx = (rowBits << 2) | colBits;
  stampCell(state, DATA_138EA8[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_water_meets_land_or_rock ($12:93EE).
//
// Standard walker-trampoline init. $15 bit 0 picks between the two
// stamp routines via DATA_water_land_rock_stamp_banks/DATA_water_land_rock_stamp_ptrs:
//   bit 0 == 0 → CODE_water_meets_land  (objects with $15 = $18)
//   bit 0 == 1 → CODE_water_on_rock     (objects with $15 = $19)
//
// Standard objects $18 and $19 both register this single init; the
// runtime variant is selected from the orientation byte (which the
// dispatcher pre-sets equal to the object ID).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x18, 0x19 share this handler.
function initWaterMeetsLandOrRock(state: DecodeState): void {
  const handler = (state.zp15 & 0x01) === 0 ? waterMeetsLand : waterOnRock;
  walkerSetupTrampoline(state, handler);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installWaterMeetsLandOrRockHandlers(): void {
  registerStdObjectHandler(0x18, initWaterMeetsLandOrRock);
  registerStdObjectHandler(0x19, initWaterMeetsLandOrRock);
}
