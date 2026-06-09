// Bank13 4-tile-cycle stamp handler + Bank12 init wrapper.
//
// Standard object $D3 — 4-tile cycling pattern. Fills the object's
// (cols x rows) rectangle with one of 4 consecutive Map16 IDs
// $854B..$854E. The phase is computed by a helper that mixes the low
// 2 bits of the walker's xy_lo ($1B) with the low bit of the row
// counter ($2C) — giving a 4-tile horizontal cycle that alternates
// pair-wise between rows. Visually resembles a brick-like tessellation
// without a fixed 2x2 grid.
//
// Asm sources:
//   CODE_init_4tile_cycle_854B       Bank12.asm:5135  ($12:A151)
//   CODE_stamp_4tile_cycle_854B      Bank13.asm:13212 ($13:ECB6)
//   CODE_compute_4tile_cycle_index   Bank13.asm:13223 ($13:ECC8)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// CODE_compute_4tile_cycle_index ($13:ECC8)
//
//   LDA $1B ; AND #$0003 ; STA $00       ; xy_lo low-2-bits   (0..3)
//   LDA $2C ; AND #$0001 ; ASL ; ADC $00 ; row parity << 1 + xy_lo bits
//   AND #$0003                            ; mask back to 0..3
//   RTS
//
// The final AND #$0003 means the row-parity contribution effectively
// XORs bit 1 of the xy_lo low-2-bits. Resulting phase table (rows ↓,
// xy_lo&3 →):
//
//        xy_lo&3 = 0   1   2   3
//   row%2=0:  0   1   2   3
//   row%2=1:  2   3   0   1
//
// xy_lo advances by +1 per column (column step writes back to $1B),
// so consecutive columns step through $854B → $854C → $854D → $854E
// then wrap. xy_lo also picks up the screen-page low nibble, so the
// pattern is anchored to absolute world-X (a wide object straddling a
// page boundary stays phase-aligned).
// ─────────────────────────────────────────────────────────────────────

const TILE_BASE = 0x854B;

const stamp4tileCycle854B: PerCellHandler = (state) => {
  const xyLowBits = state.zp1B & 0x0003;
  const rowParity = state.zp2C & 0x0001;
  const phase = (((rowParity << 1) + xyLowBits) & 0x0003);
  stampCell(state, TILE_BASE + phase);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_4tile_cycle_854B ($12:A151)
//
// Trivial walker_setup_trampoline to the stamp handler at $13ECB6.
// All 3 walker handler slots ($1F/$21, $22/$24, $25/$27) point at the
// same per-cell stamp, $19=$7FFF (row handler never fires — loop ends
// when $2C catches $2E), and $17 is zeroed (no diagonal slope). Init
// does NOT mutate any walker-relevant DP field (spec confirms entry ==
// walker-time).
// ─────────────────────────────────────────────────────────────────────

function init4tileCycle854B(state: DecodeState): void {
  walkerSetupTrampoline(state, stamp4tileCycle854B);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function install4tileCycle854BHandlers(): void {
  registerStdObjectHandler(0xD3, init4tileCycle854B);
}
