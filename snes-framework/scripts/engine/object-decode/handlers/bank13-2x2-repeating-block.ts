// Bank13 2x2 repeating-block stamp handler + Bank12 init wrapper.
//
// Standard object $66 — 2x2 repeating tile block. Fills the object's
// (cols x rows) rectangle with a 2x2 checkerboard pattern drawn from
// literal Map16 IDs $8900..$8903. Phase is derived from the low bits
// of the walker's column counter ($28) and row counter ($2C).
//
// Used heavily as a tileable interior fill (caves, rocky walls, etc.).
//
// Asm sources:
//   CODE_init_2x2_repeating_block  Bank12.asm:4050  ($12:9A2D)
//   CODE_2x2_repeating_block       Bank13.asm:7729  ($13:C291)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// CODE_2x2_repeating_block ($13:C291)
//
//   REP #$30
//   LDA $28 ; AND #$0001 ; STA $00         ; col parity     -> bit 0
//   LDA $2C ; AND #$0001 ; ASL ; ADC $00   ; row parity<<1  | col parity
//   CLC    ; ADC #$8900                    ; base Map16 ID
//   LDX $1D ; STA buffer,x                 ; stamp 16-bit ID
//   SEP #$30 ; RTL
//
// Tile picks form a 2x2 phase pattern within the object:
//   (col%2, row%2) = (0, 0) -> $8900
//   (col%2, row%2) = (1, 0) -> $8901
//   (col%2, row%2) = (0, 1) -> $8902
//   (col%2, row%2) = (1, 1) -> $8903
//
// The asm's `ADC $00` after `ASL` is functionally `OR`: the value in
// $00 is at most 1, and bit 0 of the doubled row-parity is always 0,
// so no carry path matters. Same for `ADC #$8900` — the small offset
// 0..3 can never carry into bit 8 of $8900.
// ─────────────────────────────────────────────────────────────────────

const TILE_BASE = 0x8900;

const repeatingBlock2x2Stamp: PerCellHandler = (state) => {
  const colParity = state.zp28 & 0x01;
  const rowParity = state.zp2C & 0x01;
  const phase = ((rowParity << 1) | colParity) & 0x03;
  stampCell(state, TILE_BASE + phase);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_2x2_repeating_block ($12:9A2D)
//
// Wires the 3 walker handler slots ($1F/$21, $22/$24, $25/$27) to the
// same stamp routine, sets $19=$7FFF (row handler never fires; loop
// terminates when $28 catches $2A), and STZs $17 (no diagonal slope).
// Identical setup to `walker_setup_trampoline`. Init does NOT mutate
// any walker-relevant DP fields (spec confirms entry == walker-time).
// ─────────────────────────────────────────────────────────────────────

function init2x2RepeatingBlock(state: DecodeState): void {
  walkerSetupTrampoline(state, repeatingBlock2x2Stamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function install2x2RepeatingBlockHandlers(): void {
  registerStdObjectHandler(0x66, init2x2RepeatingBlock);
}
