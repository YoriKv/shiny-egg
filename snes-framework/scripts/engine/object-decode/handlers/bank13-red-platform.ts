// Bank13 red-platform stamp handler + Bank12 init wrapper.
//
// Covers standard object $37 — `init_red_platform_tile` (Bank12.asm:3444).
// The init is a bare trampoline into `CODE_walker_setup_trampoline`
// pointing at `CODE_stamp_red_platform_tile` (Bank13.asm:3648).
//
//   - col extent / row extent inherit straight from the stream record
//     (test scenario: $0010 × $0001 = 16-wide single-row streak).
//   - orientation byte ($15) = $37
//   - all 3 walker handler slots → CODE_stamp_red_platform_tile
//   - 16 cells stamped in the spec, all output `$1512`, all `cur_tile=$0000`
//   - DP-diff table: init handler does NOT mutate walker-relevant DP fields.
//
// Asm reference — CODE_init_red_platform_tile (Bank12.asm:3444):
//
//   REP #$20
//   LDX #(CODE_stamp_red_platform_tile-1)>>16
//   LDA #CODE_stamp_red_platform_tile-1
//   JMP CODE_walker_setup_trampoline
//
// Asm reference — CODE_stamp_red_platform_tile (Bank13.asm:3648):
//
//   REP #$30
//   LDA $12              ; current Map16 ID at this cell
//   BNE skip             ; non-zero -> cell already has terrain, leave alone
//   LDA #$1512
//   LDX $1D
//   STA.l LevelDataBuffer,x
// skip:
//   SEP #$30
//   RTL
//
// Identical shape to `CODE_water_open` ($16) — empty-cell-only stamp of a
// fixed Map16 ID. Object $37 is the red platform: a static level-data tile
// in the red-stairs visual style that stamps $1512 only where the cell is
// empty, so it sits behind foreground tiles as a thin one-way platform.
// (Distinct from the red-platform sprite in Bank04.)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Map16 ID for the red-platform tile. Cart asm: `LDA #$1512`.
const RED_PLATFORM_TILE = 0x1512;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_red_platform_tile — per-cell stamper (Bank13.asm:3648).
//
// Empty-cell-only stamp of the red-platform tile. The current cell's
// Map16 ID is latched into `$12` by the walker before dispatch (via
// getCurrentMap16Tile); we stamp $1512 iff that's $0000.
// ─────────────────────────────────────────────────────────────────────

const redPlatformStamp: PerCellHandler = (state) => {
  if ((state.zp12 & 0xffff) !== 0) return;          // BNE skip
  stampCell(state, RED_PLATFORM_TILE);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_red_platform_tile (Bank12.asm:3444)
//
// Bare trampoline — slope=0, all 3 handler slots = redPlatformStamp,
// no DP mutations. Spec confirms all "changed" entries are "no".
// ─────────────────────────────────────────────────────────────────────

function initRedPlatform(state: DecodeState): void {
  walkerSetupTrampoline(state, redPlatformStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object $37 is structurally identical to $16 (water-open)
// — single fixed Map16, empty-cell-only stamp. Strong consolidation
// candidate: a generic `emptyCellFixedStamp(map16id)` helper in
// `_shared.ts` could collapse $16 + $37 (and likely siblings) into
// one-line registrations.
// ─────────────────────────────────────────────────────────────────────

export function installRedPlatformHandlers(): void {
  registerStdObjectHandler(0x37, initRedPlatform);
}
