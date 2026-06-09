// Ext-object handler: no_egg_grass (ext ID 0x8D)
// Ports CODE_extobj_handler_no_egg_grass ($12:8E4A, Bank12.asm:2374) + its
// stamp routine CODE_12BB63 ($12:BB63) and the parity-1 decorator
// CODE_12BBC0 ($12:BBC0). Asm: yi/Banks/Bank12.asm:2373-2379, 7843-7910.
//
// "No-egg" grass marker — a single-cell special-collision decoration. NOT a
// walker-driven object: the init runs `JSR get_current_map16_tile` (latches
// $1D = current cell byte offset, $12 = its existing Map16 ID) then
// `JSL CODE_12BB63` once. No rectangle, no per-cell handler slots.
//
// CODE_12BB63 (the stamp routine):
//   LDX $1D                         ; X = current cell offset
//   LDA $12 ; SEC ; SBC $1CD0       ; A = currentTile - slot_1CD0
//   AND #$0001 ; TAY                ; Y = parity selector (0 or 1)
//   CLC ; ADC $1D0E                 ; A = slot_1D0E + parity
//   STA buffer,x                    ; STAMP current cell = slot_1D0E + parity
//   TYA ; ASL ; TAX
//   JSR (DATA_12BB5F,x)             ; Y=0 -> CODE_12BB82 ; Y=1 -> CODE_12BBC0
//
// Both branches decorate three neighbour cells via the directional fetch
// primitives (above, then left|right, then the diagonal above-of-that). The
// neighbour STAs write the looked-up tile (or $0000) at the *neighbour's*
// buffer offset returned by get_map16_*, NOT the current cell.
//
// CODE_12BB82 (parity 0): above = slot_1C66, left = $0000, above-left = $0000.
// CODE_12BBC0 (parity 1): above = slot_1C60, right = $0000, above-right = $0000.
//
// The slot_* values are per-tileset template slots ($00:1Cxx/1Dxx) populated
// at level load; read via state.templateAt().
//
// The traced
// run takes the parity-1 path (CODE_12BBC0) and emits 4 stamps in order:
//   $393F @ $7F836E  (current cell: slot_1D0E $393E + parity 1)
//   $2A02 @ $7F834E  (above:        slot_1C60 = $2A02)
//   $0000 @ $7F8370  (right)
//   $0000 @ $7F8350  (above-right)
// All four stamps match the spec exactly (buf addrs + map ids). The current
// cell stamp uses the walker-derived $1D; the three neighbour stamps use
// get_map16_above / get_map16_right offsets — these match the spec's probe
// dirs (above from $30:$B7, right from $30:$B7, above from $30:$B8).

import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile, getMap16Above, getMap16Left, getMap16Right } from '../fetch.ts';
import { registerExtObjectHandler } from './index.ts';
import { writeBuf16 } from './_shared.ts';

// Per-tileset template slots read by CODE_12BB63 / CODE_12BBC0 / CODE_12BB82.
const SLOT_1CD0 = 0x001cd0; // parity base (subtracted from current tile)
const SLOT_1D0E = 0x001d0e; // current-cell stamp base
const SLOT_1C60 = 0x001c60; // parity-1 "above" tile
const SLOT_1C66 = 0x001c66; // parity-0 "above" tile

// Compose the 16-bit cell-origin word from the two 8-bit DP fields
// (cart reads $1B as a word covering $1B:$1C in REP #$30).
function word1B(state: DecodeState): number {
  return (state.zp1B | (state.zp1C << 8)) & 0xffff;
}

// CODE_12BBC0 ($12:BBC0) — parity-1 decorator: above + right + above-right.
function decorateParity1(state: DecodeState): void {
  // LDA $1B ; STA $0E ; JSL get_map16_above ; LDA $1C60 ; STA buffer,x
  state.zp0E = word1B(state);
  writeBuf16(state, getMap16Above(state), state.templateAt(SLOT_1C60));
  // LDA $1B ; STA $0E ; JSL get_map16_right ; LDA #$0000 ; STA buffer,x
  state.zp0E = word1B(state);
  writeBuf16(state, getMap16Right(state), 0x0000);
  // LDA $1B ; AND #$70F0 ; STA $00
  // LDA $1B ; AND #$0F0F ; ORA #$00F0 ; INC ; AND #$0F0F ; ORA $00 ; STA $0E
  const keep = word1B(state) & 0x70f0;
  const lo = (((word1B(state) & 0x0f0f) | 0x00f0) + 1) & 0x0f0f;
  state.zp0E = (keep | lo) & 0xffff;
  // JSL get_map16_above ; LDA #$0000 ; STA buffer,x
  writeBuf16(state, getMap16Above(state), 0x0000);
}

// CODE_12BB82 ($12:BB82) — parity-0 decorator: above + left + above-left.
function decorateParity0(state: DecodeState): void {
  // LDA $1B ; STA $0E ; JSL get_map16_above ; LDA $1C66 ; STA buffer,x
  state.zp0E = word1B(state);
  writeBuf16(state, getMap16Above(state), state.templateAt(SLOT_1C66));
  // LDA $1B ; STA $0E ; JSL get_map16_left ; LDA #$0000 ; STA buffer,x
  state.zp0E = word1B(state);
  writeBuf16(state, getMap16Left(state), 0x0000);
  // LDA $1B ; AND #$70F0 ; STA $00
  // LDA $1B ; AND #$0F0F ; DEC ; AND #$0F0F ; ORA $00 ; STA $0E
  const keep = word1B(state) & 0x70f0;
  const lo = ((word1B(state) & 0x0f0f) - 1) & 0x0f0f;
  state.zp0E = (keep | lo) & 0xffff;
  // JSL get_map16_above ; LDA #$0000 ; STA buffer,x
  writeBuf16(state, getMap16Above(state), 0x0000);
}

// CODE_12BB63 ($12:BB63) — the stamp routine JSL'd by the init.
function stampNoEggGrass(state: DecodeState): void {
  // LDX $1D ; LDA $12 ; SEC ; SBC $1CD0 ; AND #$0001 ; TAY
  const parity = (state.zp12 - state.templateAt(SLOT_1CD0)) & 0x0001;
  // CLC ; ADC $1D0E ; STA buffer,x   (stamp current cell)
  writeBuf16(state, state.zp1D, (state.templateAt(SLOT_1D0E) + parity) & 0xffff);
  // TYA ; ASL ; TAX ; JSR (DATA_12BB5F,x)
  if (parity === 0) {
    decorateParity0(state);
  } else {
    decorateParity1(state);
  }
}

// CODE_extobj_handler_no_egg_grass ($12:8E4A).
function initNoEggGrass(state: DecodeState): void {
  getCurrentMap16Tile(state); // JSR get_current_map16_tile (latch $1D + $12)
  stampNoEggGrass(state);     // JSL CODE_12BB63
}

export function installExtNoEggGrassHandlers(): void {
  registerExtObjectHandler(0x8d, initNoEggGrass);
}
