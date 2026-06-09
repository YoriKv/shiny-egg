// Ports CODE_extobj_handler_underground_lava_rock ($12:8FE4).
//
// ext 0xB3 — underground lava-rock (yogan-iwa). A fixed 2-cell horizontal
// pair (self + right neighbour). No walker, no PRNG, no template/flag gates:
// the init re-resolves the anchor, then a shared helper stamps two adjacent
// constant Map16 ids.
//
// Asm (init), Bank12.asm:2594 ($12:8FE4):
//   CODE_extobj_handler_underground_lava_rock:
//     JSR.w CODE_get_current_map16_tile   ; re-resolve $1D off the anchor coords
//     REP.b #$30
//     JSL.l CODE_12C0CF                    ; stamp the 2-cell pair
//     SEP.b #$30
//     RTL
//
// Asm (shared 2-tile stamper), CODE_12C0CF (Bank12.asm:8390, $12:C0CF):
//   CODE_12C0CF:
//     LDX.b $1D
//     LDA.w #$8D8E
//     STA.l !RAM_YI_Level_LevelDataBuffer,x    ; self cell ← $8D8E
//     LDA.b $1B : STA.b $0E                     ; seed probe coord = current cell
//     JSL.l CODE_get_map16_right                ; X = right-neighbour buffer offset
//     LDA.w #$8D8F
//     STA.l !RAM_YI_Level_LevelDataBuffer,x    ; right cell ← $8D8F
//     RTL
//
// Verified against ext-B3 spec.json (anchor resolved to buf 7F82EE):
//   STAMP $8D8E → 7F82EE  (self)
//   probe right
//   STAMP $8D8F → 7F82F0  (right neighbour, same screen page, +2 bytes)
//
// $8D8E / $8D8F are the left/right halves of the underground lava-rock tile.
import type { DecodeState } from '../state.ts';
import { stampCell, stampRightTile } from './_shared.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { registerExtObjectHandler } from './index.ts';

// Cart `LDA #$8D8E` self half; the right half is the next id ($8D8F), written
// by the second store in CODE_12C0CF.
const LAVA_ROCK_LEFT = 0x8d8e;
const LAVA_ROCK_RIGHT = 0x8d8f;

// Ports CODE_extobj_handler_underground_lava_rock + CODE_12C0CF ($12:8FE4 / $12:C0CF).
function initUndergroundLavaRock(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D from the anchor coords
  // (and latches the existing tile into $12; that value is unused here, the
  // call is for the $1D re-resolution side effect, exactly as the cart does).
  getCurrentMap16Tile(state);

  // CODE_12C0CF first store: self cell at $1D ← $8D8E.
  stampCell(state, LAVA_ROCK_LEFT);

  // CODE_12C0CF second half: seed the probe coord to the current cell
  // (`LDA $1B : STA $0E`), step one cell RIGHT via CODE_get_map16_right, and
  // store $8D8F there. stampRightTile performs exactly that sequence
  // (setProbeToCurrent + getMap16Right + writeBuf16).
  stampRightTile(state, LAVA_ROCK_RIGHT);
}

export function installExtUndergroundLavaRockHandlers(): void {
  registerExtObjectHandler(0xb3, initUndergroundLavaRock);
}
