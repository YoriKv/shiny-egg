// Bank12 EXTENDED-object handler: "lakitu hole" (ext $80).
//
// INLINE SINGLE-CELL extended object (NOT walker-driven). Ports
// CODE_extobj_handler_lakitu_hole ($12:8D5E, Bank12.asm:2256):
//
//   CODE_extobj_handler_lakitu_hole:        ; ext-obj ID $80
//     JSR.w CODE_get_current_map16_tile     ; re-resolve $1D, latch tile -> $12
//     REP.b #$30
//     JSL.l CODE_12B3F1                      ; the stamper
//     SEP.b #$30
//     RTL
//
// Stamper (CODE_12B3F1, $12:B3F1, Bank12.asm:7401). Verbatim asm:
//
//   CODE_12B3F1:
//     LDX.b $1D                              ; resolved buffer offset
//     LDA.w #$0010                           ; constant Map16 ID
//     STA.l !RAM_YI_Level_LevelDataBuffer,x  ; stamp
//     RTL
//
// CARVE BEHAVIOUR (flagged explicitly per the porting brief):
//   Despite the "hole" name, this is NOT a read-modify-write carve. The init
//   calls CODE_get_current_map16_tile (which re-resolves $1D from $1B/$1C and
//   latches the existing cell into $12), but the stamper IGNORES $12 entirely
//   and stamps the constant Map16 ID $0010 UNCONDITIONALLY at $1D. There is no
//   edge-match test, no conditional BNE-out, no neighbour probe, and no PRNG —
//   unlike sibling castle-wall-hole-2x2 (bank12-ext-castle-wall-hole-2x2.ts) which DOES gate
//   its edge columns on the existing tile. The getCurrentMap16Tile call is kept
//   for fidelity (it is the routine that resolves $1D, and its latch of $12 is
//   simply unused here). This matches the spec timeline exactly: one STAMP of
//   $0010 at buffer offset $1D, then return.
//
// The captured trace: 1 cell, output Map16
// $0010 at buf_addr $7F82E8 (offset $1D = $82E8 & $7FFF = $02E8). The constant
// $0010 and the single unconditional stamp at the resolved anchor reproduce it.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, InitHandler } from '../state.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { stampCell } from './_shared.ts';

// Constant Map16 ID stamped by CODE_12B3F1 (LDA #$0010).
const LAKITU_HOLE_TILE = 0x0010;

// Ports CODE_extobj_handler_lakitu_hole ($12:8D5E) + its stamper CODE_12B3F1
// ($12:B3F1). Re-resolve $1D via getCurrentMap16Tile, then unconditionally
// stamp the constant tile $0010 at the resolved anchor.
const initExtLakituHole: InitHandler = (state: DecodeState): void => {
  // JSR CODE_get_current_map16_tile: re-resolves state.zp1D from $1B/$1C and
  // latches the existing tile into state.zp12 (unused by the unconditional
  // stamp below, kept for fidelity — this is the routine that sets $1D).
  getCurrentMap16Tile(state);
  // CODE_12B3F1: LDX $1D : LDA #$0010 : STA buffer,x. stampCell writes at the
  // current state.zp1D, which getCurrentMap16Tile just resolved.
  stampCell(state, LAKITU_HOLE_TILE);
};

// Registration. Ext id $80 only (the $180 mirror is automatic —
// getExtObjectHandler masks id & 0xff).
export function installExtLakituHoleHandlers(): void {
  registerExtObjectHandler(0x80, initExtLakituHole);
}
