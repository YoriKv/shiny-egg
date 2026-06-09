// Bank12 ext-object handler family: LINE GUIDE STOPPERS ($9A-$9D).
//
// NAME: verified via the editor's obj-metadata — these are the line-guide
// stoppers ($9A left / $9B right / $9C top / $9D bottom). They cap the ends of
// a line guide (the dotted track a platform rides); the matching track is std
// object $D2 "Horizontal line guide". The asm symbol now agrees
// (line_guide_stopper_family); it was previously the guessed
// "flower_end_piece_family".
//
// Ext IDs $9A/$9B/$9C/$9D all share ONE init handler
// (CODE_extobj_handler_line_guide_stopper_family, $12:8EA1) plus ONE stamper
// (CODE_12BD8E, $12:BD8E). The family lays down a 2-cell stopper: a BODY tile
// at the anchor cell, plus a CAP tile in the neighbour cell directly ABOVE
// ($9A/$9B) or to the LEFT ($9C/$9D).
//
// DISPATCH KEY: $15 (the ext ID). The init re-keys it to a word index:
//   $15 = (($15 - 2) & 3) << 1   →  $9A→0, $9B→2, $9C→4, $9D→6
// That index Y selects an entry in two parallel 4-entry word tables, and
// also selects the neighbour direction (Y in {0,2}=above, Y in {4,6}=left).
//
// Single-cell anchor (no walker): the init JSRs get_current_map16_tile to
// re-resolve $1D, then JSLs the stamper which writes exactly two cells.
//
// Asm (verbatim):
//
//   CODE_extobj_handler_line_guide_stopper_family:   ; $12:8EA1
//     JSR.w CODE_get_current_map16_tile            ; re-resolve $1D from $1B/$1C
//     REP.b #$30
//     LDA.b $15 : DEC : DEC : AND.w #$0003 : ASL : STA.b $15   ; (id-2)&3 *2 → Y
//     JSL.l CODE_12BD8E
//     SEP.b #$30
//     RTL
//
//   CODE_12BD8E:                                   ; $12:BD8E
//     REP.b #$30
//     LDX.b $1D
//     LDY.b $15
//     LDA.w DATA_12BD7A,y : STA.l buffer,x         ; stamp BODY tile at anchor
//     TYA : LSR : AND.w #$0002 : TAX               ; X=0 (Y∈{0,2}) or X=2 (Y∈{4,6})
//     LDA.b $1B : STA.b $0E                        ; seed probe coord from $1B
//     JSR.w (DATA_12BD8A,x)                        ; X=0→get_map16_above, X=2→get_map16_left
//     LDA.w DATA_12BD82,y : STA.l buffer,x         ; stamp CAP tile at neighbour
//     SEP.b #$30
//     RTL
//
//   DATA_12BD8A:  dw CODE_12BDB2 (→ get_map16_above), CODE_12BDB7 (→ get_map16_left)
//
// Table values, confirmed from the asm (DATA_12BD7A/DATA_12BD82, $12:BD7A/
// $12:BD82) AND per-cell against all four ext-9[A-D] spec.json traces:
//   Y idx:        0       2       4       6        (ext: $9A     $9B     $9C     $9D)
//   DATA_12BD7A: $872F   $873F   $874F   $875F     ← body tile
//   DATA_12BD82: $0006   $0007   $0008   $0009     ← cap tile (above/above/left/left)
//
// Buf-addr checks (spec): $9A cap above $7F82E8→$7F82C8 (−$20, one row up);
// $9C cap left $7F8210→$7F820E (−2, one cell left). The cart seeds only the
// probe LOW byte (`LDA $1B : STA $0E`); the real get_map16_* compose $0E
// (low) with $0F (high page byte). stampAbove/stampLeftTile call
// setProbeToCurrent which reconstructs the full $0E/$0F word from $1B/$1C,
// matching the cart's $6CA9-indexed page resolution.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { stampCell, stampAboveTile, stampLeftTile } from './_shared.ts';
import { getCurrentMap16Tile } from '../fetch.ts';

// DATA_12BD7A ($12:BD7A): body tile per family member (word table, Y=0/2/4/6).
const BODY_TILES = [0x872F, 0x873F, 0x874F, 0x875F] as const;
// DATA_12BD82 ($12:BD82): cap tile per family member (word table, Y=0/2/4/6).
const CAP_TILES = [0x0006, 0x0007, 0x0008, 0x0009] as const;

// Neighbour direction selected by (Y>>1)&2 → DATA_12BD8A entry:
//   0 → above ($9A/$9B), 2 → left ($9C/$9D).
const DIR_ABOVE = 0;

// Ports CODE_extobj_handler_line_guide_stopper_family + CODE_12BD8E
// ($12:8EA1 / $12:BD8E).
// Merge: object IDs 0x9A, 0x9B, 0x9C, 0x9D share this handler.
function initLineGuideStopper(state: DecodeState): void {
  // Asm opens with `JSR get_current_map16_tile` ($12:8EA1) to re-resolve $1D
  // (the anchor cell) from THIS object's $1B/$1C position. The Bank10 parser
  // does NOT pre-resolve $1D for ext objects — only the walker does, and this
  // handler is walker-less (it stamps two cells directly). Without this call
  // `stampCell` below writes the BODY tile at the PREVIOUS object's stale $1D,
  // so at the real position only the cap (stamped relative to $1B/$1C) survives
  // — the "only the top half of the line-guide-stopper sphere renders" bug.
  getCurrentMap16Tile(state);

  // Init: $15 = (($15 - 2) & 3) << 1. The parser left the raw ext ID in $15;
  // re-key it to the word index Y.
  const y = (((state.zp15 - 2) & 0x03) << 1) & 0xffff;
  const entry = y >>> 1; // 0..3 → array index

  // Stamper CODE_12BD8E: stamp BODY tile at the anchor cell ($1D).
  stampCell(state, BODY_TILES[entry]!);

  // Direction = (Y >> 1) & 2 → DATA_12BD8A: above (0) or left (2).
  const dir = (y >>> 1) & 0x02;
  // Stamp CAP tile into the neighbour cell. stampAbove/stampLeftTile run
  // setProbeToCurrent (compose $0E/$0F from $1B/$1C) then get_map16_<dir>
  // then write — exactly the cart's `STA $0E ; JSR (DATA_12BD8A) ; STA buf,x`.
  if (dir === DIR_ABOVE) {
    stampAboveTile(state, CAP_TILES[entry]!);
  } else {
    stampLeftTile(state, CAP_TILES[entry]!);
  }
}

export function installExtLineGuideStopperFamilyHandlers(): void {
  registerExtObjectHandler(0x9A, initLineGuideStopper);
  registerExtObjectHandler(0x9B, initLineGuideStopper);
  registerExtObjectHandler(0x9C, initLineGuideStopper);
  registerExtObjectHandler(0x9D, initLineGuideStopper);
}
