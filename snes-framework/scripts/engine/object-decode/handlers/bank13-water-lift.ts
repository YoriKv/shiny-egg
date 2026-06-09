// Standard object $1C — init_water_lift.
//
// Cart entry: CODE_init_water_lift @ $12:9420 (yi/Banks/Bank12.asm:3129)
// Per-cell stamp handler: CODE_water_lift_stamp @ $13:8F44
// (yi/Banks/Bank13.asm:1900). Matches WTRLIFT in ys_bgsc1.asm.
//
// Shape: 2-tile-wide vertical "under-water bobbing platform" column.
// The init forces col_extent = 2 regardless of the stream record's col
// extent (spec confirms $2A 0001 → 0002), then runs the standard
// walker trampoline with a single per-cell stamper. Row extent comes
// straight from the stream record ($2E unchanged).
//
// The stamp picks one of 6 Map16 IDs (DATA_138F6B = WTRLIFT_DT):
// 2 top-row tiles, 2 mid-body tiles, 2 bottom-row tiles. Y-index is
// `col*2` plus a row-section bias:
//   row == 0           → +$0      (top    : $1507 / $1508)
//   row == $2E-1       → +$8      (bottom : $1503 / $1504)
//   else (body)        → +$4      (mid    : $001B / $001C)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_138F6B (WTRLIFT_DT) — 6-entry tile table (Bank13.asm:1926).
//   index 0/1 → top-row    left/right  ($1507 / $1508)
//   index 2/3 → mid body   left/right  ($001B / $001C)
//   index 4/5 → bottom-row left/right  ($1503 / $1504)
// ─────────────────────────────────────────────────────────────────────

const DATA_138F6B = [0x1507, 0x1508, 0x001B, 0x001C, 0x1503, 0x1504] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_water_lift_stamp ($13:8F44).
//
// Asm distilled (REP #$30 word ops; Y is BYTE offset into a word table,
// so word-array index = Y >> 1):
//   X = $1D
//   Y = $28 << 1
//   if  $2C == 0          : table_idx = Y           ; top row
//   elif $2C + 1 == $2E   : table_idx = Y | $0008   ; bottom row
//   else                  : table_idx = Y | $0004   ; body
//   stamp DATA_138F6B[table_idx >> 1] at buffer,X
// ─────────────────────────────────────────────────────────────────────
const waterLiftStamp: PerCellHandler = (state) => {
  const colBase = (state.zp28 & 0xff) << 1;    // Y = $28 ASL
  const row = state.zp2C & 0xff;

  let yByte: number;
  if (row === 0) {
    yByte = colBase;                            // top row
  } else if (((row + 1) & 0xff) === (state.zp2E & 0xff)) {
    yByte = colBase | 0x0008;                   // bottom row
  } else {
    yByte = colBase | 0x0004;                   // body row
  }

  // Y is a BYTE offset into a word table → divide by 2 for array index.
  const tile = DATA_138F6B[(yByte >>> 1) & 0x07] ?? 0;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_water_lift ($12:9420).
//
// Cart (verbatim):
//   REP #$20
//   LDA #$0002 ; STA $2A          ; force col extent to 2 tiles wide
//   LDX #(CODE_water_lift_stamp-1)>>16
//   LDA #CODE_water_lift_stamp-1
//   JMP walker_setup_trampoline
//
// Only DP mutation: $2A := 2 (spec: 0001 → 0002). No slope, no row-
// extent bump, no origin shift. Standard trampoline pattern.
// ─────────────────────────────────────────────────────────────────────
function initWaterLift(state: DecodeState): void {
  state.zp2A = 0x0002;
  walkerSetupTrampoline(state, waterLiftStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object $1C is one entry in the water family alongside
// $16 (open), $17 (meets-ground), $18/$19 (meets-land/rock). The init
// dispatcher is wired by the parent after the batch completes.
// ─────────────────────────────────────────────────────────────────────
export function installWaterLiftHandlers(): void {
  registerStdObjectHandler(0x1C, initWaterLift);
}
