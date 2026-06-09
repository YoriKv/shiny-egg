// Standard object $F5 — init_spike.
//
// Cart entries:
//   CODE_init_spike  @ $12:A3C7 (yi/Banks/Bank12.asm:5508)
//   CODE_stamp_spike (per-cell stamper)     @ $13:FD6E (yi/Banks/Bank13.asm:15300)
//
// "Decorative vertical column with $8413 cap + $2910 body." The init is a
// bare trampoline — no DP mutations (spec DP-diff table is all "no",
// col/row extents come straight from the Bank10 stream record).
//
// The stamper is the simplest two-tile-column pattern in Bank13:
//
//   REP #$30
//   LDA $2C ; BNE body
//   LDA #$8413 ; BRA done       ; row 0 → top-cap tile
// body:
//   LDA #$2910                  ; row >= 1 → body tile (literal Map16 ID)
// done:
//   LDX $1D
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// Both tiles are literal Map16 IDs — no template-slot indirection. Unlike
// the closely-related $98 `column_3segment` (which has top / middle / base
// rows from three tables), $F5 is row-position binary: just row 0 vs the
// rest. Closer in shape to the $AE/$AF `decoration_2tile_pair` family,
// but without the 2x2-corner index logic (no column-parity branch).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Literal Map16 IDs from CODE_stamp_spike. Cap on the top row, body for
// every row beneath.
// ─────────────────────────────────────────────────────────────────────
const DECORATION_2TILE_COLUMN_CAP_TILE  = 0x8413;
const DECORATION_2TILE_COLUMN_BODY_TILE = 0x2910;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_spike ($13:FD6E). Per-cell stamper; row 0 = cap, row >= 1 = body.
// ─────────────────────────────────────────────────────────────────────
const stampSpike: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const tile = row === 0
    ? DECORATION_2TILE_COLUMN_CAP_TILE
    : DECORATION_2TILE_COLUMN_BODY_TILE;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_spike ($12:A3C7). Bare trampoline.
//
//   REP.b #$20
//   LDX.b #(CODE_stamp_spike-$01)>>16
//   LDA.w #CODE_stamp_spike-$01
//   JMP.w CODE_walker_setup_trampoline
// ─────────────────────────────────────────────────────────────────────
function initSpike(state: DecodeState): void {
  walkerSetupTrampoline(state, stampSpike);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installSpikeHandlers(): void {
  registerStdObjectHandler(0xF5, initSpike);
}
