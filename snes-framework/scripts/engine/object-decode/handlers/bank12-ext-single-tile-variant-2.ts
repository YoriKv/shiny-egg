// Extended-object handler: single_tile_variant_2 (Bank12).
//
// Ports CODE_extobj_handler_single_tile_variant_2 ($12:88AE, Bank12.asm:1556)
// and its shared per-cell stamper CODE_12A4C9 ($12:A4C9, Bank12.asm:5841).
// Unlike most ext objects (which stamp a single fixed cell), this handler
// sets a 2x2 walker extent ($2A/$2E = 0001 -> 0002 at walker time) and
// paints a fixed 2x2 block of Map16 ids selected by the extID.
//
// Init (Bank12.asm:1556):
//   REP #$20
//   INC $2A : INC $2E              ; col/row extent 1 -> 2 (a 2x2 block)
//   LDA $15 : AND #$0001 : ASL : STA $15
//                                  ; $15 = (extID & 1) << 1  → $0A:0, $0B:2
//   LDX/LDA #CODE_12A4C9-1 : JMP CODE_walker_setup_trampoline
//
// Stamper (CODE_12A4C9, Bank12.asm:5841):
//   REP #$30
//   LDX $15 : LDA DATA_12A4C5,x : STA $00    ; $00 = pool ptr (re-encoded $15)
//   LDA $2C : ASL : ADC $28 : ASL : TAY      ; Y = (row*2 + col)*2 word offset
//   LDA ($00),y : LDX $1D : STA buffer,x     ; stamp pool[row*2 + col]
//
//   DATA_12A4C5[0] -> CODE_12A4B5 = { $9096, $9097, $90A6, $90A7 }  (ext $0A)
//   DATA_12A4C5[2] -> CODE_12A4BD = { $907C, $9095, $90A4, $90A5 }  (ext $0B)
//
// The 2x2 block stays within one screen page in the spec traces, so each
// cell's buffer offset is the anchor offset $1D plus a constant delta
// (col*2 + row*$20 — the standard 2-byte/cell, $20-byte/row YI buffer
// stride). This is the cart's per-cell "LDX $1D ... + walker offset" path;
// it reproduces the spec's exact buf_addr sequence
// ($7F82EA/$7F830A/$7F82EC/$7F830C for $0A — i.e. $1D, $1D+$20, $1D+$02,
// $1D+$22) without re-resolving the page.

import { registerExtObjectHandler } from './index.ts';
import { writeBuf16 } from './_shared.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import type { DecodeState, InitHandler } from '../state.ts';

// Per-cell buffer-offset deltas from the anchor ($1D), in walker stamp order
// (col0row0, col0row1, col1row0, col1row1) — matching the spec timeline.
// Each delta pairs with its pool index = row*2 + col (the stamper's Y/2).
const CELL_LAYOUT: ReadonlyArray<readonly [delta: number, poolIndex: number]> = [
  [0x00, 0], // col 0, row 0
  [0x20, 2], // col 0, row 1
  [0x02, 1], // col 1, row 0
  [0x22, 3], // col 1, row 1
];

// DATA_12A4C5 pools, keyed by the re-encoded $15 = (extID & 1) << 1.
// Each pool is the 2x2 Map16 block, indexed [row*2 + col].
const POOLS: Record<number, ReadonlyArray<number>> = {
  0: [0x9096, 0x9097, 0x90a6, 0x90a7], // ext $0A → DATA_12A4C5[0] = CODE_12A4B5
  2: [0x907c, 0x9095, 0x90a4, 0x90a5], // ext $0B → DATA_12A4C5[2] = CODE_12A4BD
};

// Ports CODE_extobj_handler_single_tile_variant_2 + CODE_12A4C9 stamper.
// Stamps a fixed 2x2 Map16 block, pool chosen by extID parity.
// Merge: object IDs 0x0A, 0x0B share this handler.
const stampSingleTileVariant2: InitHandler = (state: DecodeState): void => {
  // Init: $15 = (extID & 1) << 1. Stamper indexes the pool table by that.
  const poolKey = (state.zp15 & 0x01) << 1;
  const pool = POOLS[poolKey];
  if (!pool) return; // id not owned by this handler

  // Resolve the anchor cell offset ($1D) from this object's position ($1B/$1C).
  // The parser's ext dispatch sets $1B/$1C but NOT $1D (see _shared.ts) — the
  // cart establishes $1D via its walker; we do it here. Without this the 2x2
  // block stamps at the PREVIOUS object's stale $1D (e.g. 3-3's ext-$0B after
  // a std-24 floor painted tiles ~18 cells away at (107,112)).
  getCurrentMap16Tile(state);
  const anchor = state.zp1D;
  for (const [delta, poolIndex] of CELL_LAYOUT) {
    writeBuf16(state, anchor + delta, pool[poolIndex]);
  }
};

export function installExtSingleTileVariant2Handlers(): void {
  registerExtObjectHandler(0x0a, stampSingleTileVariant2);
  registerExtObjectHandler(0x0b, stampSingleTileVariant2);
}
