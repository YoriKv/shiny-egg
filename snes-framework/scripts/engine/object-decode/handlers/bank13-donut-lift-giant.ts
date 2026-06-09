// Bank13 stamp handler + Bank12 init wrapper for std object $8E —
// 2x2 pipe-cap block. Fills the object's footprint with a 4-tile
// (col-parity x row-parity) phase pattern, with `$2A` snapped UP to
// the next even column-extent and `$2E` forced to 2 rows.
//
//
// Asm references:
//   yi/Banks/Bank12.asm:4475   CODE_init_donut_lift_giant          ($12:9CFB)
//   yi/Banks/Bank13.asm:9938   DATA_donut_lift_giant_tiles         ($13:D414)
//   yi/Banks/Bank13.asm:9942   CODE_stamp_donut_lift_giant         ($13:D41C)
//
// Init (Bank12):
//   REP #$20
//   LDA $2A ; INC ; AND #$FFFE ; STA $2A   ; round col-extent UP to even
//   LDA #$0002 ; STA $2E                    ; force 2-row footprint
//   LDX #(stamp-$01)>>16 ; LDA #stamp-$01
//   JMP CODE_walker_setup_trampoline       ; all 3 walker slots = stamp
//
// Per-cell stamp ($13:D41C, REP #$30):
//   y = ($28 & 1) * 2          ; col-parity bit -> bit 1
//   y |= ($2C * 4) & ...        ; row * 4 (since $2C is 0 or 1 here, just row<<2)
//   tile = DATA_donut_lift_giant_tiles[y/2]   ; word-indexed
//   STAMP tile
//
// DATA_donut_lift_giant_tiles (4-entry word table):
//   y=0 ($28%2=0, $2C=0) → $7500   left-col top
//   y=2 ($28%2=1, $2C=0) → $7501   right-col top
//   y=4 ($28%2=0, $2C=1) → $3DAA   left-col bottom
//   y=6 ($28%2=1, $2C=1) → $3DAB   right-col bottom
//
// Note on $2C * 4: with $2E forced to 2, $2C only takes values 0..1, so
// the asm's `ASL ASL` on $2C produces 0 or 4. If the walker ever ran
// with $2E > 2 (e.g. if a future variant reused this stamp), the table
// index could overflow — but the table is exactly 4 entries, and the
// init clamps $2E=2, so the trace shows only y ∈ {0, 2, 4, 6}.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_donut_lift_giant_tiles (DATA_pipe_cap_2x2_tiles, Bank13.asm:9938).
// ─────────────────────────────────────────────────────────────────────

const DATA_donut_lift_giant_tiles = [
  0x7500, // (col%2=0, row=0) — left-col top
  0x7501, // (col%2=1, row=0) — right-col top
  0x3DAA, // (col%2=0, row=1) — left-col bottom
  0x3DAB, // (col%2=1, row=1) — right-col bottom
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_donut_lift_giant ($13:D41C, Bank13.asm:9942).
//
// Cart computes a word-indexed offset Y = (row<<2) | ((col&1)<<1) and
// loads `DATA_pipe_cap_2x2_tiles,y`. Translating to our word-indexed array, the
// effective table index is `row * 2 + (col & 1)` (which is just the
// row-parity × col-parity phase).
// ─────────────────────────────────────────────────────────────────────

const donutLiftGiantStamp: PerCellHandler = (state) => {
  const colParity = state.zp28 & 0x01;
  const row = state.zp2C & 0x01; // $2E=2 → row ∈ {0, 1}
  const idx = (row << 1) | colParity;
  stampCell(state, DATA_donut_lift_giant_tiles[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_donut_lift_giant ($12:9CFB, Bank12.asm:4475).
//
// DP mutations per spec:
//   $2E: 0001 → 0002 (force 2-row)
//   $2A: round UP to next even (LDA $2A ; INC ; AND #$FFFE).
//        - Even input N stays N? No: INC then AND #$FFFE on even N gives
//          N (e.g. $0010 → $0011 → $0010). Wait — that's N+1 masked to
//          even, which IS N for even N and N+1 for odd N. So odd inputs
//          round up, even inputs stay put. The spec trace shows
//          $2A=$0010 entering, $2A=$0010 exiting (no change for even).
//
// Other fields ($1B/$1C/$15) unchanged per spec DP-diff.
// ─────────────────────────────────────────────────────────────────────

const initDonutLiftGiant: InitHandler = (state) => {
  // Round col-extent UP to next even. INC then AND #$FFFE: even stays,
  // odd rounds up by 1.
  state.zp2A = (state.zp2A + 1) & 0xfffe;
  state.zp2E = 0x0002;
  walkerSetupTrampoline(state, donutLiftGiantStamp);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installDonutLiftGiantHandlers(): void {
  registerStdObjectHandler(0x8E, initDonutLiftGiant);
}
