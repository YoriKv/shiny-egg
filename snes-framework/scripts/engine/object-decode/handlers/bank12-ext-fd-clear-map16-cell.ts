// Bank12 EXTENDED-object handler: clear Map16 cell (ext $FD).
//
// EXTENDED-object family (4-byte stream record, dispatched by CODE_108C13
// via DATA_extended_object_init_ptrs at slot $FD). No walker
// (spec.json `walker_setup: null`) — a single cell is stamped inline at the
// parser-resolved anchor.
//
// As the friendly name says, this CLEARS a Map16 cell: it stamps the
// constant Map16 id $0000 at the anchor. A $0000 stamp is MEANINGFUL here —
// the renderer treats Map16 id 0 as blank — so we must `stampCell(state,
// 0x0000)`, NOT skip the write. The trace confirms exactly one cell with
// output mapid $0000 at buf $7F8200 (offset $0200) and an empty decision
// template (is_decorator:false).
//
// Asm sources (V1.0):
//   CODE_extobj_FD_clear_map16_cell   Bank12.asm:2837 ($12:917A)
//     aliases: CODE_extobj_FD_clear_map16_cell
//   CODE_extobj_stamp_clear_cell      Bank12.asm:8944 ($12:C6FF)
//     aliases: CODE_extobj_stamp_clear_cell
//   CODE_get_current_map16_tile       Bank12.asm:1171 ($12:86FD)
//
// Asm (verbatim):
//
//   CODE_extobj_FD_clear_map16_cell:
//     JSR.w CODE_get_current_map16_tile   ; resolve $1D from $1B/$1C, latch $12
//     REP.b #$30
//     JSL.l CODE_extobj_stamp_clear_cell
//     SEP.b #$30
//     RTL
//
//   CODE_extobj_stamp_clear_cell:
//     LDX.b $1D
//     LDA.w #$0000
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     RTL
//
// Same shape as bank12-ext-single-cell-dispatch.ts ($0F, stamps $00B6):
// re-resolve $1D via getCurrentMap16Tile, then stamp a flat constant — here
// the constant is $0000 (the "clear" value). No branch, no table read, no
// decision input (confirmed by the trace: single cell, mapid $0000, empty
// decision_template, is_decorator:false).

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { extConstStamp } from './_shared.ts';

// Cart asm: `LDA.w #$0000`. Clears the anchor cell to Map16 id $0000
// (blank in the renderer).
const CLEAR_CELL_TILE = 0x0000;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_FD_clear_map16_cell (Bank12.asm:2837, $12:917A).
//
// `extConstStamp` performs exactly the cart's two steps:
//   getCurrentMap16Tile — re-resolves the anchor's buffer offset into $1D
//   (may throw ScreenOverflowError — let it propagate; the parser catches
//   it), then stamps the constant at the resolved $1D, mirroring
//   CODE_extobj_stamp_clear_cell.
// ─────────────────────────────────────────────────────────────────────

function extFdClearMap16Cell(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile, then stamp the clear value $0000 at $1D.
  extConstStamp(state, CLEAR_CELL_TILE);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $FD only (the $1FD mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtFdClearMap16CellHandlers(): void {
  registerExtObjectHandler(0xFD, extFdClearMap16Cell);
}
