// Standard object $E0 — init_lava_flow_down.
//
// Cart entry: CODE_init_lava_flow_down @ $12:A1DE (yi/Banks/Bank12.asm:5226).
// Per-cell stamp: CODE_stamp_lava_flow_down @ $13:F3B4 (yi/Banks/Bank13.asm:14111).
//
// Tiny 2-row ornamental "mountain peak / mini-pillar" shape with a
// built-in cap. The init is a bare walker-trampoline (no DP mutation);
// the stamp emits a 2-tile vertical pattern that repeats:
//
//   row 0  → $A605 (peak / cap tile)
//   row 1+ → $A606 (body tile, used for every cell below row 0)
//
// Spec confirms entry → walker-time diffs are all "no" for $15 / $1B /
// $1C / $2A / $2E. The stamp reads only $2C (row counter) — col is
// width-1 only, so a single column is stamped per object instance.
//
// No GoldenEgg counterpart (ReSharper "ge" search returned zero hits
// for `lava_flow_down` / `MountainMini` / object code `0xE0`).
//
// Asm primary; the captured trace
// cross-checked: cell 0 (row $0000) → $A605, cells 1-15 (rows $0001+)
// → $A606. Output sequence in spec matches exactly.

import { registerStdObjectHandler } from './index.ts';
import type { InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Tile constants (Bank13.asm:14111-14117).
// Row 0 = peak/cap; row 1+ = body. The asm starts Y at $A605 and
// increments to $A606 when $2C ≠ 0.
// ─────────────────────────────────────────────────────────────────────
const MOUNTAIN_MINI_PILLAR_PEAK = 0xA605;
const MOUNTAIN_MINI_PILLAR_BODY = 0xA606;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_lava_flow_down ($13:F3B4, Bank13.asm:14111).
//
//   REP #$30
//   LDY #$A605
//   LDA $2C ; BEQ row0          ; row 0 → keep Y = $A605
//   INY                          ; row 1+ → Y = $A606
//   row0:
//   TYA ; LDX $1D
//   STA.l !LevelDataBuffer,x
//   SEP #$30 ; RTL
// ─────────────────────────────────────────────────────────────────────
const stampLavaFlowDown: PerCellHandler = (state) => {
  const tile = (state.zp2C & 0xff) === 0
    ? MOUNTAIN_MINI_PILLAR_PEAK
    : MOUNTAIN_MINI_PILLAR_BODY;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_lava_flow_down ($12:A1DE, Bank12.asm:5226).
//
//   REP #$20
//   LDX #(CODE_stamp_lava_flow_down-1)>>16   ; bank byte
//   LDA #CODE_stamp_lava_flow_down-1         ; ptr-1
//   JMP walker_setup_trampoline                    ; slope=0; all 3 slots same fn
//
// Bare trampoline — no DP mutations. Extent (1 col × N rows) comes
// straight from the Bank10 stream record.
// ─────────────────────────────────────────────────────────────────────
const initLavaFlowDown: InitHandler = (state) => {
  walkerSetupTrampoline(state, stampLavaFlowDown);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────
export function installLavaFlowDownHandlers(): void {
  registerStdObjectHandler(0xE0, initLavaFlowDown);
}
