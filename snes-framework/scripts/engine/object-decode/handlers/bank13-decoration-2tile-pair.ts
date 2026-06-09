// Bank13 2-tile decoration pair stamp handlers + Bank12 init wrapper.
//
// Standard objects $AE and $AF — "2-tile decoration" (vertical / horizontal).
// Both IDs share the same init (`CODE_init_decoration_2tile_pair` at
// $12:9F71) which uses bit 0 of the orientation byte $15 to:
//
//   1. Pick which extent slot to FORCE to $0002 — $AE forces col extent
//      ($2A), $AF forces row extent ($2E). The other extent is left
//      whatever the stream record carried.
//   2. Pick which per-cell stamp body to wire into the walker — vertical
//      ($AE → CODE_stamp_dec_2tile_vert @ $13:E148) or horizontal
//      ($AF → CODE_stamp_dec_2tile_horiz @ $13:E170).
//
// Both stamp bodies are byte-for-byte the same shape: build Y from the
// 2x2 corner-position (col&1, row&1), then read a 4-entry word table and
// stamp the result. The tables differ in their tile set:
//
//   $AE vertical    DATA_dec_2tile_vert_tiles  @ $13:E140 → $779B/$779D/$779C/$779E
//   $AF horizontal  DATA_dec_2tile_horiz_tiles @ $13:E168 → $77AB/$77AC/$77AD/$77AE
//
// Both tile sets live in the $77 grass/decoration page; the difference is
// which 4 tile IDs out of that page get picked. No template-slot
// indirection — these are literal Map16 IDs baked into ROM.
//
// Cart `STA $2A,x` semantics: with X = ($15 & 1) << 2 the store hits $2A
// for $AE (X=0) or $2E for $AF (X=4). This is an UNCONDITIONAL set, not
// a "max with 2" — confirmed by spec $AE pre col=0001 post=0002 and
// spec $AF pre row=0001 post=0002 (the smaller value is overwritten).
//
// Asm sources:
//   CODE_init_decoration_2tile_pair       Bank12.asm:4838 ($12:9F71)
//   DATA_decoration_2tile_body_ptrs       Bank12.asm:4833 (DATA_decoration_2tile_body_ptrs)
//   CODE_stamp_dec_2tile_vert             Bank13.asm:11831 ($13:E148)
//   DATA_dec_2tile_vert_tiles             Bank13.asm:11827 (DATA_dec_2tile_vert_tiles)
//   CODE_stamp_dec_2tile_horiz            Bank13.asm:11854 ($13:E170)
//   DATA_dec_2tile_horiz_tiles            Bank13.asm:11850 (DATA_dec_2tile_horiz_tiles)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// 4-entry tile tables. Index Y is built as:
//   Y = (($28 & 1) << 1) | (($2C & 1) << 2)
// → idx = Y >> 1:
//     col 0, row 0 → idx 0
//     col 1, row 0 → idx 1
//     col 0, row 1 → idx 2
//     col 1, row 1 → idx 3
// ─────────────────────────────────────────────────────────────────────

const DATA_dec_2tile_vert_tiles = [0x779B, 0x779D, 0x779C, 0x779E] as const;
const DATA_dec_2tile_horiz_tiles = [0x77AB, 0x77AC, 0x77AD, 0x77AE] as const;

// ─────────────────────────────────────────────────────────────────────
// Shared 2x2-corner stamp body. Both vertical and horizontal variants
// build the same Y index; only the tile-set table differs.
// ─────────────────────────────────────────────────────────────────────

function stampDec2tile(state: DecodeState, table: readonly number[]): void {
  const colBit = (state.zp28 & 0x01) << 1; // 0 or 2  (stored at $00 in cart)
  const rowBit = (state.zp2C & 0x01) << 2; // 0 or 4
  const y = rowBit | colBit;                // 0 / 2 / 4 / 6 → idx 0..3
  stampCell(state, table[y >>> 1]!);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_dec_2tile_vert ($13:E148, object $AE).
// ─────────────────────────────────────────────────────────────────────

const stampDec2tileVert: PerCellHandler = (state) => {
  stampDec2tile(state, DATA_dec_2tile_vert_tiles);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_dec_2tile_horiz ($13:E170, object $AF).
// ─────────────────────────────────────────────────────────────────────

const stampDec2tileHoriz: PerCellHandler = (state) => {
  stampDec2tile(state, DATA_dec_2tile_horiz_tiles);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_decoration_2tile_pair ($12:9F71). Shared by $AE / $AF.
//
//   REP #$20
//   LDA $15 ; AND #$0001 ; ASL ; ASL ; TAX        ; X = ($15&1) << 2
//   LDA #$0002 ; STA $2A,x                        ; $AE: $2A=2, $AF: $2E=2
//   LDA $15 ; AND #$0001 ; ASL ; TAY              ; Y = ($15&1) << 1
//   LDX #(stamp_dec_2tile_vert-1)>>16             ; bank = $13 (both bodies)
//   LDA DATA_decoration_2tile_body_ptrs,y                             ; pick body ptr
//   JMP walker_setup_trampoline
//
// Both bodies live in bank $13 so the LDX-of-bank-byte is identical
// regardless of orientation. We dispatch on $15 bit 0 here directly.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xAE, 0xAF share this handler.
function initDecoration2tilePair(state: DecodeState): void {
  const orientBit = state.zp15 & 0x01;
  if (orientBit === 0) {
    // $AE — vertical: force col extent to 2, wire vert stamp body.
    state.zp2A = 0x0002;
    walkerSetupTrampoline(state, stampDec2tileVert);
  } else {
    // $AF — horizontal: force row extent to 2, wire horiz stamp body.
    state.zp2E = 0x0002;
    walkerSetupTrampoline(state, stampDec2tileHoriz);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installDecoration2tilePairHandlers(): void {
  registerStdObjectHandler(0xAE, initDecoration2tilePair);
  registerStdObjectHandler(0xAF, initDecoration2tilePair);
}
