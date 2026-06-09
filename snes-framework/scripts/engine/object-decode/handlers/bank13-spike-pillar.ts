// Standard objects $3F + $40 — init_spike_pillar (shared init).
//
// Cart entry: CODE_init_spike_pillar @ $12:9696 (yi/Banks/Bank12.asm:3530).
// Per-cell stamp: CODE_stamp_spike_pillar @ $13:A126 (yi/Banks/Bank13.asm:4490).
//
// "YOGANHARI" in ys_bgsc1.asm — yogan hari, "lava needle". Two object IDs
// both wire to the same init / stamp; the only difference between them is
// the orientation byte ($15) the parser pre-loads with the object ID,
// which the stamp masks with `#$0006` to pick a row of the variant table.
//
//   $3F → $15 & $0006 = $0006 → "second variant" (tip = $0115, body = $2905)
//   $40 → $15 & $0006 = $0000 → "first variant"  (tip = $0114, body = $2904)
//
// The init is a bare trampoline — no DP mutation. Spec confirms entry → walker
// time diffs are all "no" for both $3F and $40.
//
// Per-cell algorithm (Bank13.asm:4490):
//
//   REP #$30
//   LDA $15 ; AND #$0006 ; TAY                  ; Y = variant base (0 or 6)
//   LDA $2C ; BEQ skip1 ; INY ; INY             ; row != 0 → +2
//   skip1:
//   LDA $12 ; BEQ skip2 ; INY ; INY             ; existing tile != 0 → +2
//   skip2:
//   LDX $1D
//   LDA DATA_13A146,y                           ; word-indexed table read
//   STA.l !LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// DATA_13A146 (Bank13.asm:4511) — 6 words, laid out as 2 variants × 3 cases:
//
//   variant 0 ($40):  $0114 (tip)       $2904 (body, empty under)   $2906 (body, occupied under)
//   variant 1 ($3F):  $0115 (tip)       $2905 (body, empty under)   $2907 (body, occupied under)
//
// "Tip" = top of the column (row 0). "Body" = every subsequent row. The
// "occupied under" variant ($12 != 0) lets the spike merge cleanly when
// the level data already wrote a non-zero tile underneath — but the
// captured trace (clean buffer) never hits this branch.
//
// Asm primary; the captured traces
// cross-checked. No GoldenEgg counterpart (case 0x3F / 0x40 / "Lava Spike"
// searches all empty in the ReSharper-loaded "ge" solution).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_13A146 (Bank13.asm:4511) — 6-entry tile table.
//
// Indexed by Y = ($15 & $0006) + (row != 0 ? 2 : 0) + (under != 0 ? 2 : 0).
// Asm uses word indexing (Y is a byte offset); we store as plain 16-bit
// values and index by `y >> 1`.
// ─────────────────────────────────────────────────────────────────────

const DATA_spike_pillar_tiles = [
  0x0114, 0x2904, 0x2906, // variant 0 ($40): tip, body-empty, body-occupied
  0x0115, 0x2905, 0x2907, // variant 1 ($3F): tip, body-empty, body-occupied
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_spike_pillar ($13:A126, Bank13.asm:4490) — per-cell handler.
// ─────────────────────────────────────────────────────────────────────

const spikePillarStamp: PerCellHandler = (state) => {
  // Asm Y starts at ($15 & $0006). Since the table is laid out as 3
  // word-entries per variant, the variant base in our 0..5 index is
  // (($15 & 6) >> 1). The two `INY ; INY` bumps add 2 bytes (= 1 entry).
  let idx = ((state.zp15 & 0x0006) >>> 1);
  if ((state.zp2C & 0xff) !== 0) idx += 1; // row != 0
  if ((state.zp12 & 0xffff) !== 0) idx += 1; // existing under-tile != 0

  // Clamp defensively — the asm has no bound check, but $15 is masked
  // to $0006 so the variant base is 0 or 6 → final idx in 0..5 always.
  const tile = DATA_spike_pillar_tiles[idx] ?? DATA_spike_pillar_tiles[0]!;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_spike_pillar ($12:9696, Bank12.asm:3530).
//
//   REP #$20
//   LDX #(CODE_stamp_spike_pillar-1) >> 16
//   LDA #CODE_stamp_spike_pillar-1
//   JMP walker_setup_trampoline   ; slope = 0; all 3 handler slots same
//
// Pure trampoline. Spec confirms $15 / $1B / $1C / $2A / $2E are
// unchanged entry→walker-time — the stamp itself reads $15 directly
// (the object ID set by the stream parser) to pick its variant.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x3F, 0x40 share this handler.
const initSpikePillar: InitHandler = (state) => {
  walkerSetupTrampoline(state, spikePillarStamp);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// Both $3F and $40 share the same init — they differ only in the
// orientation byte the parser writes to $15, which the stamp reads.
// ─────────────────────────────────────────────────────────────────────

export function installSpikePillarHandlers(): void {
  registerStdObjectHandler(0x3F, initSpikePillar);
  registerStdObjectHandler(0x40, initSpikePillar);
}
