// Bank13 random-decoration-8way stamp handler + Bank12 init wrapper.
//
// Covers standard objects $6E / $8B — both dispatch to
// `CODE_init_random_decoration_8way` (Bank12.asm:4150), a bare
// walker-trampoline that wires `CODE_random_decoration_8way`
// (CODE_random_decoration_8way, Bank13.asm:8281) as the odd-col / even-col / row
// handler. Per-ID variant emerges purely from the orientation byte
// ($15 = std-obj ID) inside the stamp handler.
//
//
// Asm reference (CODE_random_decoration_8way, Bank13.asm:8281):
//   REP #$30
//   JSL CODE_prng
//   AND #$0007 ; ASL ; TAY              ; y = (prng & 7) * 2
//   LDA $15 ; AND #$00FF
//   CMP #$008B ; BNE skip
//   LDY #$0010                          ; force y = 16 (entry 8 = $7300)
//   skip:
//   LDX $1D ; LDA DATA_random_decoration_tiles,y         ; pick word from 9-entry table
//   STA buffer,x                        ; stamp Map16 ID
//
// DATA_random_decoration_tiles (Bank13.asm:8301):
//   dw $0199, $019A, $019B, $019C, $019D, $019E, $019F, $01A0, $7300
// → orient $6E: PRNG-picks one of entries 0-7 (eight foliage tiles).
// → orient $8B: forces entry 8 ($7300 — a single solid decoration tile).
//
// Init mutates no DP fields — confirmed by both spec.md DP-diff tables
// (all rows "no"). Orientation byte $15 IS the std-obj ID, set by the
// Bank10 dispatcher before this init runs.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { stampCell } from './_shared.ts';

// DATA_random_decoration_tiles (Bank13.asm:8301).
// Literal Map16 IDs (NOT template-slot pointers — these tiles are
// resolved directly). Entries 0-7 are the $6E foliage pool; entry 8
// is the forced override for the $8B variant.
const DATA_random_decoration_tiles: ReadonlyArray<number> = [
  0x0199, 0x019A, 0x019B, 0x019C,
  0x019D, 0x019E, 0x019F, 0x01A0,
  0x7300,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_random_decoration_8way (Bank13.asm:8281)
//
// PRNG-picks 1 of 8 decoration tiles for object $6E; for object $8B
// the orientation gate overrides the pick to a single solid tile
// regardless of PRNG output. The 8-entry pool for $6E is contiguous
// Map16 IDs $0199..$01A0; the $8B override is $7300.
// ─────────────────────────────────────────────────────────────────────

const stampRandomDecoration8way: PerCellHandler = (state) => {
  let idx = prngNext(state) & 0x07;
  if ((state.zp15 & 0xff) === 0x8B) {
    // Asm `LDY #$0010` → y = 16 byte-index = word-index 8.
    idx = 8;
  }
  stampCell(state, DATA_random_decoration_tiles[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_random_decoration_8way (Bank12.asm:4150)
//
//   REP #$20
//   LDX #(CODE_random_decoration_8way-$01)>>16
//   LDA #CODE_random_decoration_8way-$01
//   JMP walker_setup_trampoline (with slope-zero default)
//
// Bare trampoline — no DP mutations. Extent/orientation come straight
// from the Bank10 stream record. Verified against the "Init handler DP
// mutations" diff tables in both spec.md files (all rows "no").
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x6E, 0x8B share this handler.
function initRandomDecoration8way(state: DecodeState): void {
  walkerSetupTrampoline(state, stampRandomDecoration8way);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object IDs $6E/$8B share the same init handler; the
// per-ID tile variant emerges from $15 (= std-obj ID, set by Bank10's
// dispatcher) inside `stampRandomDecoration8way`.
// ─────────────────────────────────────────────────────────────────────

export function installRandomDecoration8wayHandlers(): void {
  registerStdObjectHandler(0x6E, initRandomDecoration8way);
  registerStdObjectHandler(0x8B, initRandomDecoration8way);
}
