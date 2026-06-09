// Bank13 stamp handler + Bank12 init wrapper for std objects $94-$97 —
// the 4-orientation 2x2 grass/cattail decoration family. Each cell is
// stamped from a 16-entry per-orientation tile table; the four std IDs
// share one init + one stamp routine, and the orientation byte $15
// (= the object ID itself) selects one of 4 four-tile sub-tables.
//
//
// Asm references:
//   yi/Banks/Bank12.asm:4571   CODE_init_number_platform     ($12:9DA8)
//   yi/Banks/Bank13.asm:10392  DATA_number_platform_tiles    ($13:D719)
//   yi/Banks/Bank13.asm:10397  CODE_stamp_number_platform    ($13:D739)
//
// Init (Bank12, REP #$20):
//   LDA $2A ; INC ; AND #$FFFE ; STA $2A   ; round col-extent UP to even
//   LDA $2E ; INC ; AND #$FFFE ; STA $2E   ; round row-extent UP to even
//   LDX #(stamp-$01)>>16 ; LDA #stamp-$01
//   JMP CODE_walker_setup_trampoline       ; all 3 walker slots = stamp
//
// Per-cell stamp ($13:D739, REP #$30):
//   y  = ($15 & $0003) << 3      ; orient * 8 (byte stride per orient)
//   y |= ($28 & $0001) << 1      ; col-parity bit -> bit 1
//   y |= ($2C & $0001) << 2      ; row-parity bit -> bit 2
//   tile = (word*)DATA_grass_tuft_2x2_tiles[y/2]
//   STAMP tile
//
// Within each orientation the 4 sub-table entries are arranged TL/TR/BL/BR
// (row=0/col=0, row=0/col=1, row=1/col=0, row=1/col=1).
//
// $2A/$2E rounded-up-to-even: traces show $2A=$2E=$0010 entering and
// exiting unchanged (already even). The masking still matters for any
// stream record that would specify an odd extent, so we apply it.
//
// Tile coverage: $7600-$7607 (top halves) + $7775-$777C (bottom halves)
// — see DATA_number_platform_tiles header comment in Bank13.asm.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_number_platform_tiles (DATA_grass_tuft_2x2_tiles, Bank13.asm:10392).
//
// 16 words = 4 orientations × 4 cells (TL, TR, BL, BR). Indexed as
//   idx = (orient & 3) * 4 + (row & 1) * 2 + (col & 1)
// ─────────────────────────────────────────────────────────────────────

const DATA_number_platform_tiles = [
  // orient 0 ($94): grass tuft variant A
  0x7600, 0x7601, 0x7775, 0x7776,
  // orient 1 ($95): grass tuft variant B
  0x7602, 0x7603, 0x7777, 0x7778,
  // orient 2 ($96): grass tuft variant C
  0x7604, 0x7605, 0x7779, 0x777A,
  // orient 3 ($97): grass tuft variant D
  0x7606, 0x7607, 0x777B, 0x777C,
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_number_platform ($13:D739, Bank13.asm:10397).
// ─────────────────────────────────────────────────────────────────────

const numberPlatformStamp: PerCellHandler = (state) => {
  const orient = state.zp15 & 0x03;
  const colParity = state.zp28 & 0x01;
  const rowParity = state.zp2C & 0x01;
  const idx = (orient << 2) | (rowParity << 1) | colParity;
  stampCell(state, DATA_number_platform_tiles[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_number_platform ($12:9DA8, Bank12.asm:4571).
//
// Both $2A and $2E rounded UP to next even via `INC ; AND #$FFFE`:
// even N → N, odd N → N+1. Trace shows $0010 → $0010 (no-op for even).
// Other DP fields ($1B/$1C/$15) unchanged.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x94, 0x95, 0x96, 0x97 share this handler.
const initNumberPlatform: InitHandler = (state) => {
  state.zp2A = (state.zp2A + 1) & 0xfffe;
  state.zp2E = (state.zp2E + 1) & 0xfffe;
  walkerSetupTrampoline(state, numberPlatformStamp);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// All four IDs share the same init — orientation is read from $15
// (= the object ID, written by the stream parser).
// ─────────────────────────────────────────────────────────────────────

export function installNumberPlatformHandlers(): void {
  registerStdObjectHandler(0x94, initNumberPlatform);
  registerStdObjectHandler(0x95, initNumberPlatform);
  registerStdObjectHandler(0x96, initNumberPlatform);
  registerStdObjectHandler(0x97, initNumberPlatform);
}
