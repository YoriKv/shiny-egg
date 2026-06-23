// Bank13 ice-floor random-fill stamp handler + Bank12 init wrapper.
//
// Standard object $DB — icy floor (random-fill stamp). The walker runs
// over a rectangular region; the first row is a sparse PRNG-driven
// scatter of two floor-top tiles ($0017 / $0018), and rows below it
// form a 2-wide column body that fades into a uniform fill tile
// ($8C0D) once the body extends past row 4.
//
// The init handler is a bare trampoline — whatever extents the stream
// supplies flow straight into the walker.
//
// Asm sources:
//   CODE_init_ice_floor       Bank12.asm:5186  ($12:A19F)
//   CODE_stamp_ice_floor      Bank13.asm:13831 ($13:F1A2)
//   DATA_ice_floor_4entries   Bank13.asm:13822 ($13:F194)
//   DATA_ice_floor_3stamps Bank13.asm:13826 ($13:F19C)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { prngNext, RNG_SITE } from '../prng.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_ice_floor_4entries — 4-entry sparse scatter
// table consumed by the row-0 PRNG branch. Indexed by Y = prng & $06
// (word offset 0/2/4/6). Two of the entries are $0000 → BEQ skip,
// giving each row-0 cell a 50% chance of being left as-is, 25% chance
// of $0017, 25% chance of $0018 (the two floor-top scatter tiles).
// ─────────────────────────────────────────────────────────────────────

const DATA_ice_floor_4entries: ReadonlyArray<number> = [
  0x0000, 0x0017, 0x0000, 0x0018,
];

// ─────────────────────────────────────────────────────────────────────
// DATA_ice_floor_3stamps — 3-entry tile table for
// rows 1..3 (the body of the floor column). Indexed by ($2C - 1) * 2
// (word offset 0/2/4). The handler ADCs `$28 & 1` onto the loaded
// value, giving each table entry a +0 / +1 variant for even / odd
// columns:
//   row 1: $8C01 (even col) / $8C02 (odd col)
//   row 2: $8C05 / $8C06
//   row 3: $8C09 / $8C0A
// Rows 4+ fall through to the uniform $8C0D fill tile.
// ─────────────────────────────────────────────────────────────────────

const DATA_ice_floor_3stamps: ReadonlyArray<number> = [
  0x8C01, 0x8C05, 0x8C09,
];

const ICE_FLOOR_FILL_TILE = 0x8C0D;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_ice_floor ($13:F1A2)
//
//   REP #$30
//   LDA $2C ; BNE body                  ; row != 0 → column body
//   LDA $12 ; BNE done                  ; row 0 + non-empty under-tile → skip
//   JSL prng ; AND #$0006 ; TAY
//   LDA DATA_ice_floor_4entries,y
//   BEQ done                            ; 2/4 entries are $0000 → skip stamp
//   BRA store
// body:
//   LDA $28 ; AND #$0001 ; STA $00      ; $00 = column parity (0 or 1)
//   LDA $2C ; DEC ; ASL                 ; A = (row - 1) * 2 (word offset)
//   CMP #$0006 ; BCC ok                 ; row in 1..3?
//   LDA #$8C0D ; BRA store              ; row 4+ → uniform fill tile
// ok:
//   TAY ; LDA DATA_ice_floor_3stamps,y ; CLC ; ADC $00
// store:
//   LDX $1D ; STA buffer,x
// done:
//   SEP #$30 ; RTL
//
// PRNG-carry caveat: the cart's prng output depends on PPU H/V counter
// timing; our deterministic LFSR will produce the right *distribution*
// of $0000/$0017/$0018 but won't byte-match a specific cart-snapshot
// trace's row-0 scatter. Cosmetic-only (floor-top scatter variant).
// ─────────────────────────────────────────────────────────────────────

const iceFloorStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;

  if (row === 0) {
    // Row 0: sparse PRNG-driven floor-top scatter. Skip if the cell is
    // already non-empty (under-tile guard) or if the PRNG picks a $0000
    // slot.
    if ((state.zp12 & 0xffff) !== 0) return;
    const y = prngNext(state, RNG_SITE.iceFloorScatter) & 0x06;
    const idx = y >>> 1;
    const tile = DATA_ice_floor_4entries[idx] ?? 0;
    if (tile === 0) return;
    stampCell(state, tile);
    return;
  }

  // Rows 1+: 2-column-parity body, clamped to the $8C0D fill tile past
  // row 3.
  const parity = state.zp28 & 0x0001;
  const wordOff = ((row - 1) & 0xff) * 2;
  let tile: number;
  if (wordOff >= 0x0006) {
    tile = ICE_FLOOR_FILL_TILE;
  } else {
    const idx = wordOff >>> 1;
    tile = ((DATA_ice_floor_3stamps[idx] ?? 0) + parity) & 0xffff;
  }
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_ice_floor ($12:A19F)
//
//   REP #$20
//   LDX #(handler-1)>>16
//   LDA #handler-1
//   JMP walker_setup_trampoline          ; → CODE_stamp_ice_floor
//
// Trivial trampoline — no DP mutations. Stream-supplied col/row
// extents flow straight into the walker (the spec's DP-diff confirms
// every relevant field is unchanged at walker time).
// ─────────────────────────────────────────────────────────────────────

function initIceFloor(state: DecodeState): void {
  walkerSetupTrampoline(state, iceFloorStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installIceFloorHandlers(): void {
  registerStdObjectHandler(0xDB, initIceFloor);
}
