// Bank13 stamp handler for std object $99 — RockInWaterfall: a rock in a
// waterfall, drawn as a 3-wide floor block with a random middle column.
//
//
// Init (Bank12.asm:4593, CODE_init_rock_in_waterfall @ $12:9DCC):
//   REP #$20
//   LDA #$0003 ; STA $2A             ; force col extent to 3
//   ; --- shift cell origin one column to the left (subX/subY DEC) ---
//   LDA $1B
//   PHA
//   AND #$F0F0 ; STA $00             ; preserve screen-page nibbles
//   PLA
//   AND #$0F0F                       ; isolate sub-nibbles
//   DEC                              ; subX -= 1 (subY borrows on underflow)
//   AND #$0F0F                       ; reapply mask
//   ORA $00                          ; merge with preserved screen nibbles
//   STA $1B
//   LDX #(CODE_stamp_floor_3wide-$01)>>16       ; bank byte of per-cell handler
//   LDA #CODE_stamp_floor_3wide-$01             ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline      ; all 3 slots = CODE_stamp_floor_3wide
//
// Per-cell stamp (Bank13.asm:10503, CODE_stamp_floor_3wide @ $13:D7DE):
//   REP #$30
//   LDA $2C ; CMP #2 ; BCC .edge     ; rows 0..1 -> edge-pick table
//   LDA $28 ; BEQ .exit              ; rows 2+ col 0 -> skip
//   INC ; CMP $2A ; BEQ .exit        ; rows 2+ last col (col+1==$2A) -> skip
//   JSL CODE_bg_floor_random         ; rows 2+ middle column -> random pick
//   BRA .exit
// .edge:                             ; CODE_floor_3wide_edge_pick
//   ASL ; ASL ; ASL ; STA $00        ; row*8
//   LDA $28 ; ASL ; ORA $00 ; TAY    ; Y = row*8 | col*2 (byte offset)
//   LDA DATA_floor_3wide_tiles,y                ; word table lookup
//   LDX $1D ; STA.l buffer,x         ; stamp
// .exit: SEP #$30 ; RTL
//
// DATA_rock_in_waterfall_tiles (DATA_floor_3wide_tiles, Bank13.asm:10499) — 7-word table.
//   Byte offset (Y):
//     $00 row=0 col=0 → $01B9
//     $02 row=0 col=1 → $01BA
//     $04 row=0 col=2 → $01BB
//     $06 row=0 col=3 → $0000  ← never reached (col_extent capped at 3)
//     $08 row=1 col=0 → $01BC
//     $0A row=1 col=1 → $01BD
//     $0C row=1 col=2 → $01BE
//
// Init DP diff (from spec):
//   - col_extent ($2A): 0001 → 0003 (forced).
//   - xy_lo ($1B): 46 → 45 (subX 6 → 5; subY untouched in the no-underflow
//     case captured by the trace).
// xy_hi, row_extent and orientation byte are untouched.
//
// The middle column on rows 2+ calls CODE_bg_floor_random — same routine
// used by object $01's basic 3-wide floor — for the PRNG-driven grass
// variant pick (with the FlatFloor neighbour-fix dance). Re-uses the
// exported `bgFloorRandom` per-cell handler from `bank13-floor.ts` so the
// neighbour-fix side-effects stay byte-identical with the cart.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { bgFloorRandom } from './bank13-floor.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_rock_in_waterfall_tiles (DATA_floor_3wide_tiles, Bank13.asm:10499) — 7-word
// table. Indexed as `row*4 + col` (word index; cart computes byte offset
// `row*8 | col*2` then loads a 16-bit word). Entry at row=0 col=3 is
// the unreachable $0000 sentinel.
// ─────────────────────────────────────────────────────────────────────

const DATA_rock_in_waterfall_tiles = [
  0x01B9, 0x01BA, 0x01BB, 0x0000, // row 0 — col 0..3 (col 3 unreachable)
  0x01BC, 0x01BD, 0x01BE,         // row 1 — col 0..2
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_floor_3wide ($13:D7DE, Bank13.asm:10503) — per-cell stamp.
//
//   row < 2 → DATA_rock_in_waterfall_tiles lookup (edge / cap tiles).
//   row >= 2 + col == 0 → skip (left margin).
//   row >= 2 + col+1 == colExtent → skip (right margin).
//   row >= 2 + middle column → CODE_bg_floor_random (PRNG grass variant).
// ─────────────────────────────────────────────────────────────────────

const stampRockInWaterfall: PerCellHandler = (state) => {
  const row       = state.zp2C & 0xff;
  const col       = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;

  if (row < 2) {
    // Edge-pick path: cart Y = row*8 | col*2 (byte offset into a
    // word-array). Word index = row*4 + col.
    const idx = ((row & 0x07) << 2) | (col & 0x03);
    const tile = DATA_rock_in_waterfall_tiles[idx] ?? 0;
    stampCell(state, tile);
    return;
  }

  // Rows 2+: skip outer columns, delegate middle to bg_floor_random.
  if (col === 0) return;
  if (((col + 1) & 0xff) === colExtent) return;
  bgFloorRandom(state);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_rock_in_waterfall ($12:9DCC, Bank12.asm:4593). Forces
// col_extent = 3, decrements subX (with subY borrow on underflow), then
// trampolines into the walker with the per-cell stamp. The trampoline
// wires the stamp into all three dispatch slots (even-col / odd-col /
// row), so col-parity and row-end are irrelevant — every cell calls
// stampRockInWaterfall which then branches internally on $2C/$28.
// ─────────────────────────────────────────────────────────────────────

const initRockInWaterfall: InitHandler = (state) => {
  state.zp2A = 0x0003;

  // 16-bit DEC of $1B/$1C low-nibble pair (subX/subY), keeping screen
  // nibbles intact. Mirrors the AND #$F0F0 / DEC / AND #$0F0F / ORA
  // dance in the asm — DEC underflows from $00 to $FF on the low byte,
  // borrowing into the subY nibble in that edge case.
  const word1B = ((state.zp1C & 0xff) << 8) | (state.zp1B & 0xff);
  const screenKeep = word1B & 0xF0F0;
  const subKeep    = ((word1B & 0x0F0F) - 1) & 0x0F0F;
  const merged     = (screenKeep | subKeep) & 0xFFFF;
  state.zp1B = merged & 0xff;
  state.zp1C = (merged >>> 8) & 0xff;

  walkerSetupTrampoline(state, stampRockInWaterfall);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installRockInWaterfallHandlers(): void {
  registerStdObjectHandler(0x99, initRockInWaterfall);
}
