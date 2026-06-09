// Bank13 open-water stamp handler + Bank12 init wrapper.
//
// Covers standard object $16 — `init_water_open` (Bank12.asm:3064).
// The init is a bare trampoline into `CODE_walker_setup_trampoline`
// pointing at `CODE_water_open` (Bank13.asm:1549).
//
//   - col extent / row extent = $0010 (16 wide × 16 tall by default)
//   - orientation byte ($15) = $16
//   - all 3 walker handler slots → CODE_water_open
//   - 256 cells stamped, all output `$1600`, all `cur_tile=$0000`
//   - DP-diff table: init handler does NOT mutate walker-relevant DP fields.
//
// Asm reference — CODE_water_open at Bank13.asm:1549:
//
//   CODE_water_open:
//     REP #$30
//     LDA $12             ; current Map16 ID at this cell
//     BNE skip            ; non-zero -> cell already has terrain, leave alone
//     LDX $1D
//     LDA #$1600
//     STA.l LevelDataBuffer,x
//   skip:
//     SEP #$30
//     RTL
//
// The stamper writes $1600 (open-water tile) ONLY into empty cells. This
// is why object $16 is the "fill water" primitive — it never overwrites
// pre-existing land tiles, so dropping a big water rectangle behind a
// pre-placed island just fills the gaps.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Map16 ID for the open-water tile. Cart asm: `LDA #$1600`.
const WATER_OPEN_TILE = 0x1600;

// ─────────────────────────────────────────────────────────────────────
// CODE_water_open — per-cell stamper (Bank13.asm:1549).
//
// Empty-cell-only stamp. The current cell's Map16 ID is latched into
// `$12` by the walker before dispatch (via getCurrentMap16Tile); we
// stamp $1600 iff that's $0000.
// ─────────────────────────────────────────────────────────────────────

const waterOpenStamp: PerCellHandler = (state) => {
  if ((state.zp12 & 0xffff) !== 0) return;        // BNE skip
  stampCell(state, WATER_OPEN_TILE);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_water_open (Bank12.asm:3064)
//
//   REP #$20
//   LDX #(CODE_water_open-1)>>16
//   LDA #CODE_water_open-1
//   JMP CODE_walker_setup_trampoline
//
// Bare trampoline — slope=0, all 3 handler slots = waterOpenStamp,
// no DP mutations. Spec confirms all "changed" entries are "no".
// ─────────────────────────────────────────────────────────────────────

function initWaterOpen(state: DecodeState): void {
  walkerSetupTrampoline(state, waterOpenStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object $16 is the simplest of the water family —
// siblings $17-$1E layer more shape-aware logic on top (waterline
// transitions, ground/land joins, bridges, etc.) and live in their
// own files until consolidation.
// ─────────────────────────────────────────────────────────────────────

export function installWaterOpenHandlers(): void {
  registerStdObjectHandler(0x16, initWaterOpen);
}
